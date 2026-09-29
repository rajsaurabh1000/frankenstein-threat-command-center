const feedList = document.getElementById("feedList");
const gaugeScore = document.getElementById("gaugeScore");
const gaugeArc = document.getElementById("gaugeArc");
const globalLevel = document.getElementById("globalLevel");
const eventCount = document.getElementById("eventCount");
const connectionStatus = document.getElementById("connectionStatus");
const briefText = document.getElementById("briefText");
const briefMode = document.getElementById("briefMode");
const briefUpdated = document.getElementById("briefUpdated");
const mitigateBtn = document.getElementById("mitigateBtn");
const vignette = document.getElementById("vignette");

const CIRC = 553;
let ws;
let briefPollTimer;
let feedHydrated = false;

function severityClass(sev) {
  if (sev >= 8) return "high";
  if (sev >= 5) return "mid";
  return "low";
}

function setGauge(score, level) {
  const clamped = Math.max(0, Math.min(100, score));
  gaugeScore.textContent = Math.round(clamped);
  globalLevel.textContent = level;
  const offset = CIRC - (clamped / 100) * CIRC;
  gaugeArc.style.strokeDashoffset = String(offset);
  const critical = level === "CRITICAL" || clamped >= 75;
  gaugeArc.classList.toggle("critical", critical);
  vignette.classList.toggle("critical", critical);
}

function prependFeedItem(scored) {
  const e = scored.event;
  const li = document.createElement("li");
  li.className = "feed-item";
  if (e.severity >= 8 || scored.threat_level === "CRITICAL") {
    li.classList.add("pulse-high");
  }
  li.innerHTML = `
    <div class="row">
      <span class="type">${escapeHtml(e.event_type)}</span>
      <span class="severity ${severityClass(e.severity)}">SEV ${e.severity}</span>
    </div>
    <div class="meta">
      ${escapeHtml(e.origin)} · ${escapeHtml(e.source)} · score ${scored.score} · ${scored.threat_level}
    </div>
  `;
  feedList.prepend(li);
  while (feedList.children.length > 50) {
    feedList.removeChild(feedList.lastChild);
  }
}

function renderState(state) {
  setGauge(state.global_score, state.threat_level);
  eventCount.textContent = `${state.event_count} events`;
  if (state.mitigated) {
    mitigateBtn.disabled = true;
    mitigateBtn.textContent = "NEUTRALIZED";
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshBrief() {
  try {
    const res = await fetch("/api/brief");
    if (!res.ok) return;
    const data = await res.json();
    briefText.textContent = data.text;
    briefMode.textContent = data.mode;
    briefUpdated.textContent = new Date(data.updated_at).toLocaleTimeString();
  } catch {
    /* ignore */
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/threats`);

  ws.onopen = () => {
    connectionStatus.textContent = "LIVE";
    connectionStatus.classList.add("live");
    connectionStatus.classList.remove("down");
  };

  ws.onclose = () => {
    connectionStatus.textContent = "RECONNECTING";
    connectionStatus.classList.remove("live");
    connectionStatus.classList.add("down");
    setTimeout(connectWs, 2000);
  };

  ws.onmessage = (msg) => {
    let data;
    try {
      data = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (data.type === "event") {
      feedHydrated = true;
      prependFeedItem({
        event: data.payload.event,
        score: data.payload.score,
        threat_level: data.payload.threat_level,
      });
      setGauge(data.payload.global_score, data.payload.global_threat_level);
    } else if (data.type === "state") {
      renderState(data.payload);
      if (!feedHydrated && data.payload.recent_events?.length) {
        feedList.innerHTML = "";
        data.payload.recent_events
          .slice()
          .reverse()
          .forEach((se) => prependFeedItem(se));
        feedHydrated = true;
      }
    } else if (data.type === "system") {
      prependFeedItem({
        event: {
          event_type: data.payload.message || "MITIGATION",
          origin: "SOC-CONSOLE",
          source: "live",
          severity: 1,
        },
        score: 0,
        threat_level: "LOW",
      });
      mitigateBtn.disabled = true;
      mitigateBtn.textContent = "NEUTRALIZED";
      refreshBrief();
    } else if (data.type === "brief") {
      briefText.textContent = data.payload.text;
      briefMode.textContent = data.payload.mode;
    }
  };
}

mitigateBtn.addEventListener("click", async () => {
  mitigateBtn.disabled = true;
  try {
    await fetch("/api/mitigate", { method: "POST" });
    mitigateBtn.textContent = "NEUTRALIZED";
  } catch {
    mitigateBtn.disabled = false;
  }
});

connectWs();
refreshBrief();
briefPollTimer = setInterval(refreshBrief, 15000);
