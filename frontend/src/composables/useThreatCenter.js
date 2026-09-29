import { computed, onMounted, onUnmounted, ref } from "vue";

const MAX_FEED = 50;

export function useThreatCenter() {
  const connected = ref(false);
  const reconnecting = ref(false);
  const globalScore = ref(0);
  const globalLevel = ref("LOW");
  const containmentStatus = ref("ACTIVE");
  const contained = ref(false);
  const feed = ref([]);
  const briefText = ref("");
  const briefMode = ref("template");
  const health = ref(null);
  const selectedScenario = ref("critical");
  const runningScenario = ref(false);
  const containing = ref(false);

  let ws;
  let briefTimer;
  let reconnectTimer;

  const isCritical = computed(
    () => globalLevel.value === "CRITICAL" || globalScore.value >= 78
  );

  function prependFeed(item) {
    feed.value = [item, ...feed.value].slice(0, MAX_FEED);
  }

  function applyState(state) {
    globalScore.value = state.global_score ?? 0;
    globalLevel.value = state.threat_level ?? "LOW";
    contained.value = !!state.contained;
    containmentStatus.value = state.containment_status ?? "ACTIVE";
    health.value = state.health ?? health.value;
    if (Array.isArray(state.recent_events) && feed.value.length === 0) {
      feed.value = [...state.recent_events].reverse();
    }
  }

  async function hydrateFromRest() {
    try {
      const [stateRes, briefRes] = await Promise.all([
        fetch("/api/state"),
        fetch("/api/brief"),
      ]);
      if (stateRes.ok) applyState(await stateRes.json());
      if (briefRes.ok) {
        const brief = await briefRes.json();
        briefText.value = brief.text ?? "";
        briefMode.value = brief.mode ?? "template";
      }
    } catch {
      /* bridge may be starting */
    }
  }

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "event") {
      prependFeed({
        event: msg.payload.event,
        risk_score: msg.payload.risk_score,
        threat_level: msg.payload.threat_level,
      });
      globalScore.value = msg.payload.global_score ?? globalScore.value;
      globalLevel.value = msg.payload.global_threat_level ?? globalLevel.value;
    } else if (msg.type === "state") {
      applyState(msg.payload);
    } else if (msg.type === "health") {
      health.value = msg.payload;
    } else if (msg.type === "brief") {
      briefText.value = msg.payload.text ?? briefText.value;
      briefMode.value = msg.payload.mode ?? briefMode.value;
    } else if (msg.type === "system") {
      prependFeed({
        event: {
          attack_type: "CONTAINMENT",
          source_ip: "SOC-CONSOLE",
          source: "soc_console",
          raw_severity: 1,
          status: msg.payload.containment_status ?? "CONTAINED",
        },
        risk_score: 0,
        threat_level: "LOW",
      });
      contained.value = true;
      containmentStatus.value = "CONTAINED";
    }
  }

  function connectWs() {
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }

    reconnecting.value = true;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/ws/threats`);

    ws.onopen = () => {
      connected.value = true;
      reconnecting.value = false;
    };

    ws.onclose = () => {
      connected.value = false;
      reconnecting.value = true;
      reconnectTimer = window.setTimeout(async () => {
        await hydrateFromRest();
        connectWs();
      }, 2000);
    };

    ws.onmessage = (evt) => handleMessage(evt.data);
  }

  async function runScenario() {
    runningScenario.value = true;
    try {
      await fetch("/api/demo/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: selectedScenario.value }),
      });
      contained.value = false;
      containmentStatus.value = "ACTIVE";
    } finally {
      runningScenario.value = false;
    }
  }

  async function containThreat() {
    if (containing.value || contained.value) return;
    containing.value = true;
    try {
      await fetch("/api/contain", { method: "POST" });
      contained.value = true;
      containmentStatus.value = "CONTAINED";
    } finally {
      containing.value = false;
    }
  }

  onMounted(async () => {
    await hydrateFromRest();
    connectWs();
    briefTimer = window.setInterval(hydrateFromRest, 15000);
  });

  onUnmounted(() => {
    if (ws) ws.close();
    if (briefTimer) clearInterval(briefTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });

  return {
    connected,
    reconnecting,
    globalScore,
    globalLevel,
    containmentStatus,
    contained,
    feed,
    briefText,
    briefMode,
    health,
    selectedScenario,
    runningScenario,
    containing,
    isCritical,
    runScenario,
    containThreat,
  };
}
