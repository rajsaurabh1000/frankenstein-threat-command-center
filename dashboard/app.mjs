import {
  createApp,
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from "/static/vendor/vue.esm-browser.js";
import {
  fetchTourSteps,
  playNarration,
  prefetchNarration,
  stopNarration,
  unlockNarrationAudio,
} from "/static/narration.mjs";
import { ARCHITECTURE_DIAGRAM_SVG } from "/static/architecture-diagram.mjs";
import { AttackGlobe } from "/static/attack-globe.mjs";

const MAX_FEED = 50;
const CIRC = 553;
const ATTACK_PALETTE_DARK = {
  "SQL Injection": "#ff5c5c",
  "Brute Force": "#fa582d",
  "Credential Stuffing": "#ff8c42",
  "Port Scan": "#2dd4ff",
  "SSH Connection": "#a78bfa",
  "Login Attempt": "#3dd68c",
  "File Access": "#ffb020",
  "CONTAINMENT": "#64748b",
  default: "#94a3b8",
};

function sevClass(sev) {
  if (sev >= 8) return "high";
  if (sev >= 5) return "mid";
  return "low";
}

function healthClass(status) {
  if (["ONLINE", "CONNECTED", "READY"].includes(status)) return "ok";
  return "warn";
}

function attackAbbr(type) {
  if (!type) return "??";
  const parts = type.split(" ");
  if (parts.length === 1) return type.slice(0, 2).toUpperCase();
  return parts.map((p) => p[0]).join("").slice(0, 3).toUpperCase();
}

function exportEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LEVEL_PALETTE_DARK = {
  CRITICAL: "#ff5c5c",
  HIGH: "#fa582d",
  ELEVATED: "#ffb020",
  LOW: "#3dd68c",
};

/** Threat meter: semicircle from 0 (left) to 100 (right), zones match the bridge's landscape thresholds. */
const METER = { cx: 120, cy: 120, r: 92 };
const METER_ZONES = [
  { level: "LOW", from: 0, to: 35 },
  { level: "ELEVATED", from: 35, to: 58 },
  { level: "HIGH", from: 58, to: 78 },
  { level: "CRITICAL", from: 78, to: 100 },
];
const METER_GAP = 0.9; // visual gap between zones, in score points

function meterPoint(value, r = METER.r) {
  const a = Math.PI * (1 - value / 100);
  return [METER.cx + r * Math.cos(a), METER.cy - r * Math.sin(a)];
}

function meterArc(from, to, r = METER.r) {
  const [x1, y1] = meterPoint(from, r);
  const [x2, y2] = meterPoint(to, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function zoneSpan(zone, upTo = 100) {
  const from = zone.from + (zone.from > 0 ? METER_GAP / 2 : 0);
  const to = Math.min(zone.to - (zone.to < 100 ? METER_GAP / 2 : 0), upTo);
  return to > from ? meterArc(from, to) : "";
}

const METER_TRACK = METER_ZONES.map((z) => ({ level: z.level, d: zoneSpan(z) }));
const METER_TICKS = [35, 58, 78].map((v) => {
  const [x1, y1] = meterPoint(v, METER.r + 9);
  const [x2, y2] = meterPoint(v, METER.r - 9);
  const [lx, ly] = meterPoint(v, METER.r + 20);
  return { v, x1, y1, x2, y2, lx, ly };
});
const TREND_WINDOW_MS = 120000;
// The bridge's `critical_alarm` flag means a critical *landscape* (e.g. an injected campaign),
// not a 4 s severity flash, so the alarm can start instantly without false alarms.
// Older bridges don't send the flag: fall back to CRITICAL held longer than a flash.
const ALARM_FALLBACK_MS = 5000;
const SIREN_CYCLE_S = 2.6; // one wail (up-down-up-down); cycles are chained back-to-back
const ALARM_SNOOZE_MS = 15000; // Acknowledge silences the siren this long, then it re-arms
const BASE_TITLE = "Threat Command Center";

function polarXY(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function donutSlicePath(cx, cy, outerR, innerR, startDeg, endDeg) {
  const sweep = endDeg - startDeg;
  if (sweep <= 0) return "";
  if (sweep >= 359.99) {
    const mid = startDeg + 180;
    const [ox1, oy1] = polarXY(cx, cy, outerR, startDeg);
    const [ox2, oy2] = polarXY(cx, cy, outerR, mid);
    const [ix1, iy1] = polarXY(cx, cy, innerR, startDeg);
    const [ix2, iy2] = polarXY(cx, cy, innerR, mid);
    return `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 1 1 ${ox2} ${oy2} A ${outerR} ${outerR} 0 1 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 1 0 ${ix2} ${iy2} A ${innerR} ${innerR} 0 1 0 ${ix1} ${iy1} Z`;
  }
  const large = sweep > 180 ? 1 : 0;
  const [x1, y1] = polarXY(cx, cy, outerR, startDeg);
  const [x2, y2] = polarXY(cx, cy, outerR, endDeg);
  const [x3, y3] = polarXY(cx, cy, innerR, endDeg);
  const [x4, y4] = polarXY(cx, cy, innerR, startDeg);
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z`;
}

function buildPieSlices(items, innerRatio = 0.55) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) {
    return { slices: [], total: 0, empty: true };
  }
  let angle = -90;
  const outerR = 48;
  const innerR = outerR * innerRatio;
  const slices = items
    .filter((i) => i.value > 0)
    .map((item) => {
      const pct = item.value / total;
      const sweep = pct * 360;
      const start = angle;
      angle += sweep;
      const [px, py] = polarXY(0, 0, 3.2, start + sweep / 2); // hover pop-out direction
      return {
        label: item.label,
        value: item.value,
        color: item.color,
        pct: Math.round(pct * 100),
        dx: px.toFixed(2),
        dy: py.toFixed(2),
        path: donutSlicePath(50, 50, outerR, innerR, start, start + sweep),
      };
    });
  return { slices, total, empty: slices.length === 0 };
}

function countFeedBy(feed, keyFn) {
  const counts = {};
  for (const row of feed) {
    const k = keyFn(row) || "Other";
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

createApp({
  setup() {
    const connected = ref(false);
    const reconnecting = ref(false);
    const globalScore = ref(0);
    const globalLevel = ref("LOW");
    const containmentStatus = ref("ACTIVE");
    const contained = ref(false);
    const feed = ref([]);
    const briefText = ref("");
    const briefMode = ref("template");
    const aiInsights = ref({
      recommendations: [],
      playbook_name: "Baseline monitoring",
      playbook_rationale: "",
      confidence: 0.75,
      focal_attack: null,
      focal_insight: "",
      llm_active: false,
      model: null,
    });
    const aiCapabilities = ref([]);
    const llmConfigured = ref(false);
    const executiveQuestion = ref(
      "What should we do first given current posture?"
    );
    const copilotPrompts = [
      "What should we do first given current posture?",
      "Should we initiate containment now?",
      "Summarize risk for leadership in one paragraph.",
      "How does API vs stream ingest affect our score?",
    ];
    const askAnswer = ref("");
    const askMode = ref("");
    const askLoading = ref(false);
    const briefRefreshing = ref(false);
    const briefPulse = ref(false);
    const health = ref(null);
    const selectedScenario = ref("critical");
    const runningScenario = ref(false);
    const containing = ref(false);
    const scoreHistory = ref([]);
    const scoreSamples = ref([]); // { t, v } for the meter's 60 s delta and 2 min trend
    const clock = ref("");
    const platform = ref({
      product: "Threat Command Center",
      edition: "Unified Telemetry Platform",
      version: "1.0.0",
      environment: "enterprise",
      region: "us-west-2",
      tenant: "primary",
      build: "release",
    });
    const displayScore = ref(0);
    const feedHighlightKey = ref(null);
    const activeTab = ref("executive");
    const briefUpdatedAt = ref("");
    const copilotOpen = ref(false);
    const copilotInput = ref(null);
    const lumiAvatarSrc = ref("/static/assets/copilot/lumi.png");
    const showCopilotIntro = ref(false);
    const copilotIntro = ref({
      id: "copilot-intro",
      title: "Problem, architecture, and approach",
      problem: "",
      narration: "",
    });
    const introSpeaking = ref(false);
    const introLoading = ref(false);
    const introVoiceHint = ref("");
    const introAutoplayBlocked = ref(false);
    const lumiGuideActive = ref(false);
    const tourHighlightId = ref(null);
    const tourAutoPlay = ref(false);
    const tourSteps = ref([]);
    const tourIndex = ref(0);
    const voiceLoading = ref(false);
    const voiceSpeaking = ref(false);
    const voiceError = ref("");
    const voiceEnabled = ref(true);
    let tourAdvanceLock = false;
    let guideRun = 0;
    let introTourHandoff = false;
    const uiReady = ref(false);
    const displayedBrief = ref("");
    const briefTyping = ref(false);
    let typewriterTimer = null;
    const SECTION_TARGETS = {
      executive: "command-deck",
      operations: "section-live",
      intelligence: "section-intelligence",
      platform: "section-scenario",
    };

    const TOUR_SKIP_SCROLL = new Set([
      "lumi-fab-anchor",
      "copilot-panel",
      "action-dock",
      "export-summary-btn",
      "dashboard-toolbar-status",
      "contain-primary-btn",
    ]);

    function scrollTourTarget(highlight) {
      if (!highlight || TOUR_SKIP_SCROLL.has(highlight)) return;
      const el = document.getElementById(highlight);
      if (el) {
        const block = highlight === "section-live" || highlight === "command-deck" ? "start" : "center";
        el.scrollIntoView({ behavior: "smooth", block });
      }
    }

    const dashTabs = [
      { id: "executive", label: "Posture", shortcut: "1" },
      { id: "operations", label: "Telemetry", shortcut: "2" },
      { id: "intelligence", label: "Intelligence", shortcut: "3" },
      { id: "platform", label: "Response", shortcut: "4" },
    ];

    function goTab(id) {
      if (!dashTabs.some((t) => t.id === id)) return;
      activeTab.value = id;
      const targetId = SECTION_TARGETS[id] || id;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function onGlobalKeydown(evt) {
      if (evt.target && ["INPUT", "TEXTAREA", "SELECT"].includes(evt.target.tagName)) {
        return;
      }
      if (evt.key === "Escape" && copilotOpen.value) {
        copilotOpen.value = false;
        return;
      }
      const hit = dashTabs.find((t) => t.shortcut === evt.key);
      if (hit) {
        evt.preventDefault();
        goTab(hit.id);
      }
    }

    function closeCopilot() {
      copilotOpen.value = false;
    }

    async function toggleCopilot() {
      copilotOpen.value = !copilotOpen.value;
      if (copilotOpen.value) {
        await nextTick();
        copilotInput.value?.focus();
      }
    }

    function useCopilotPrompt(text) {
      executiveQuestion.value = text;
      copilotInput.value?.focus();
    }

    function onLumiAvatarError() {
      lumiAvatarSrc.value = "/static/assets/copilot/lumi-copilot.svg";
    }

    async function resolveLumiAvatar() {
      try {
        const res = await fetch("/static/assets/copilot/lumi.png", { method: "HEAD" });
        if (res.ok) {
          lumiAvatarSrc.value = "/static/assets/copilot/lumi.png";
        }
      } catch {
        /* bundled SVG default */
      }
    }

    let ws;
    let briefTimer;
    let reconnectTimer;
    let clockTimer;

    const isCritical = computed(
      () => globalLevel.value === "CRITICAL" || globalScore.value >= 78
    );

    // ---- Critical-zone alarm -------------------------------------------------------------
    const alarmNow = ref(Date.now());
    const criticalAlarm = ref(false); // from the bridge
    const bridgeSendsAlarm = ref(false); // false => older bridge, use the fallback below
    const criticalSince = ref(null);
    const alarmSince = ref(null);
    const alarmAcked = ref(false);
    const alarmSound = ref(true); // sirens by default; 🔔 toggle mutes
    const alarmSoundBlocked = ref(false); // true until the visitor has interacted (browser autoplay rule)
    let sirenCtx = null;
    let sirenNodes = null; // the cycle currently sounding, so it can be cut off instantly
    let sirenLoopTimer = null;
    let snoozeTimer = null;
    const alarmSnoozeUntil = ref(null);

    /** Browsers only allow audio after a user gesture: unlock on the first click / key / tap. */
    function unlockSirenAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        sirenCtx = sirenCtx || new Ctx();
        if (sirenCtx.state === "suspended") sirenCtx.resume();
        alarmSoundBlocked.value = false;
      } catch {
        /* audio is optional */
      }
    }
    if (typeof window !== "undefined") {
      for (const evt of ["pointerdown", "keydown", "touchstart"]) {
        window.addEventListener(evt, unlockSirenAudio, { passive: true });
      }
    }

    watch(
      globalLevel,
      (lvl) => {
        if (lvl !== "CRITICAL") criticalSince.value = null;
        else if (!criticalSince.value) criticalSince.value = Date.now();
      },
      { immediate: true }
    );

    const alarmActive = computed(() => {
      if (contained.value || containing.value) return false;
      if (bridgeSendsAlarm.value) return criticalAlarm.value;
      return !!criticalSince.value && alarmNow.value - criticalSince.value > ALARM_FALLBACK_MS;
    });

    const alarmElapsed = computed(() => {
      if (!alarmSince.value) return "00:00";
      const secs = Math.max(0, Math.floor((alarmNow.value - alarmSince.value) / 1000));
      return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
    });

    /** One cycle of an emergency "wail" siren, synthesized with WebAudio (no audio asset): two
     *  detuned voices sweeping 620-1180 Hz through a low-pass filter. Cycles start and end on the
     *  same pitch, so chained cycles form one continuous siren. */
    function playSirenCycle() {
      if (!sirenCtx || sirenCtx.state !== "running") {
        alarmSoundBlocked.value = true; // no gesture yet; the strip shows a hint
        return false;
      }
      try {
        const ctx = sirenCtx;
        const t = ctx.currentTime;
        const dur = SIREN_CYCLE_S;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.14, t + 0.03);
        master.gain.setValueAtTime(0.14, t + dur - 0.03);
        master.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 2200;
        tone.connect(master).connect(ctx.destination);
        const oscs = [];
        for (const v of [
          { type: "sawtooth", mult: 1, level: 0.55 },
          { type: "square", mult: 1.006, level: 0.25 },
        ]) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = v.type;
          g.gain.value = v.level;
          const f = osc.frequency;
          f.setValueAtTime(620 * v.mult, t);
          f.linearRampToValueAtTime(1180 * v.mult, t + dur * 0.25);
          f.linearRampToValueAtTime(620 * v.mult, t + dur * 0.5);
          f.linearRampToValueAtTime(1180 * v.mult, t + dur * 0.75);
          f.linearRampToValueAtTime(620 * v.mult, t + dur);
          osc.connect(g).connect(tone);
          osc.start(t);
          osc.stop(t + dur + 0.05);
          oscs.push(osc);
        }
        sirenNodes = { master, oscs, ctx };
        alarmSoundBlocked.value = false;
        return true;
      } catch {
        return false; /* audio is optional */
      }
    }

    function stopSiren() {
      if (sirenLoopTimer) clearTimeout(sirenLoopTimer);
      sirenLoopTimer = null;
      if (!sirenNodes) return;
      const { master, oscs, ctx } = sirenNodes;
      sirenNodes = null;
      try {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        oscs.forEach((o) => o.stop(t + 0.08));
      } catch {
        /* already stopped */
      }
    }

    function sirenShouldPlay() {
      if (!alarmActive.value || !alarmSound.value || alarmAcked.value) return false;
      return !(voiceSpeaking.value || introSpeaking.value); // never talk over Lumi
    }

    /** Continuous siren: chain cycles until acknowledged, muted, contained, or Lumi speaks. */
    function runSiren() {
      if (!sirenShouldPlay()) {
        stopSiren();
        return;
      }
      if (sirenLoopTimer) return; // already sounding
      const loop = () => {
        sirenLoopTimer = null;
        if (!sirenShouldPlay() || !playSirenCycle()) {
          if (!sirenShouldPlay()) stopSiren();
          return; // the 1 s clock tick retries (e.g. once audio is unlocked)
        }
        sirenLoopTimer = setTimeout(loop, SIREN_CYCLE_S * 1000 - 20);
      };
      loop();
    }

    function clearSnooze() {
      if (snoozeTimer) clearTimeout(snoozeTimer);
      snoozeTimer = null;
      alarmSnoozeUntil.value = null;
    }

    const alarmSnoozeSecs = computed(() =>
      alarmSnoozeUntil.value ? Math.max(0, Math.ceil((alarmSnoozeUntil.value - alarmNow.value) / 1000)) : 0
    );

    function toggleAlarmSound() {
      unlockSirenAudio();
      alarmSound.value = !alarmSound.value;
      if (alarmSound.value) runSiren();
      else stopSiren();
    }

    /** Silence for ALARM_SNOOZE_MS; if the threat is still not contained, buzz again. */
    function acknowledgeAlarm() {
      alarmAcked.value = true;
      stopSiren();
      clearSnooze();
      alarmSnoozeUntil.value = Date.now() + ALARM_SNOOZE_MS;
      snoozeTimer = setTimeout(() => {
        snoozeTimer = null;
        alarmSnoozeUntil.value = null;
        if (alarmActive.value) {
          alarmAcked.value = false; // re-arm: strip flashes and the siren buzzes again
          runSiren();
        }
      }, ALARM_SNOOZE_MS);
    }

    watch(alarmActive, (on) => {
      alarmSince.value = on ? Date.now() : null;
      document.title = on ? `⚠ CRITICAL · ${BASE_TITLE}` : BASE_TITLE;
      if (on) {
        alarmAcked.value = false;
        runSiren(); // instantly
      } else {
        stopSiren(); // contained (or cleared): all quiet
        clearSnooze();
        alarmAcked.value = false;
      }
    });

    watch([voiceSpeaking, introSpeaking], ([v, i]) => {
      if (v || i) stopSiren(); // Lumi talking: pause; the clock tick resumes afterwards
    });

    const postureAlerts = computed(() => {
      const alerts = [];
      if (isCritical.value) {
        alerts.push({
          type: "danger",
          text: "Critical landscape — align executives and validate containment",
          section: "executive",
        });
      }
      if (kpis.value.critical > 0) {
        alerts.push({
          type: "warning",
          count: kpis.value.critical,
          text: "priority events in live queue",
          section: "live",
        });
      }
      if (contained.value) {
        alerts.push({
          type: "info",
          text: "Containment active — monitor score decay",
          section: "executive",
        });
      }
      return alerts;
    });

    const meterValue = computed(() => Math.max(0, Math.min(100, displayScore.value)));

    const meterLit = computed(() =>
      METER_ZONES.map((z) => ({ level: z.level, d: zoneSpan(z, meterValue.value) })).filter((z) => z.d)
    );

    const meterNeedle = computed(() => {
      const [x, y] = meterPoint(meterValue.value, METER.r);
      const [xi, yi] = meterPoint(meterValue.value, METER.r - 13);
      return { x, y, xi, yi };
    });

    const meterDelta = computed(() => {
      const pts = scoreSamples.value;
      if (pts.length < 2) return null;
      const last = pts[pts.length - 1];
      const past = pts.find((p) => p.t >= last.t - 60000);
      if (!past || last.t - past.t < 8000) return null;
      return Math.round(last.v - past.v);
    });

    const meterTrend = computed(() => {
      const pts = scoreSamples.value;
      if (pts.length < 2) return null;
      const end = pts[pts.length - 1].t;
      const win = pts.filter((p) => p.t >= end - TREND_WINDOW_MS);
      if (win.length < 2) return null;
      const start = win[0].t; // fill the width until a full 2 minutes of history exists
      const span = Math.max(1, end - start);
      const W = 240;
      const H = 40;
      const x = (t) => ((t - start) / span) * W;
      const y = (v) => H - (Math.max(0, Math.min(100, v)) / 100) * H;
      const line = win.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
      const area = `${line} L${x(win[win.length - 1].t).toFixed(1)},${H} L${x(win[0].t).toFixed(1)},${H} Z`;
      const secs = Math.round(span / 1000);
      const label = secs >= 115 ? "Last 2 min" : `Last ${Math.max(5, Math.round(secs / 5) * 5)} s`;
      return { line, area, critY: y(78).toFixed(1), label };
    });

    const gaugeOffset = computed(() => {
      const clamped = Math.max(0, Math.min(100, displayScore.value));
      return CIRC - (clamped / 100) * CIRC;
    });

    const envDisplay = computed(() => {
      const raw = (platform.value.environment || "enterprise").toLowerCase();
      if (raw === "demonstration" || raw === "demo") return "SOC console";
      if (raw === "enterprise") return "Enterprise";
      return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    });

    const regionDisplay = computed(() => {
      const region = platform.value.region || "us-west-2";
      return String(region).toUpperCase();
    });

    const tenantDisplay = computed(() => {
      const tenant = platform.value.tenant || "primary";
      return String(tenant).replace(/_/g, " ");
    });

    const riskSummary = computed(() => {
      const score = Math.round(globalScore.value);
      const crit = kpis.value.critical;
      const top = attackMix.value.slices?.[0];
      const vector = top ? `${top.label} (${top.pct}% of queue)` : "mixed vectors";
      if (contained.value) {
        return `Containment is active. Landscape ${score}/100 with response hooks engaged — verify isolation and monitor score decay.`;
      }
      if (globalLevel.value === "CRITICAL" || score >= 78) {
        return `Critical posture ${score}/100 · ${crit} priority events · dominant ${vector}. Recommend executive alignment and containment readiness.`;
      }
      if (score >= 45 || globalLevel.value === "HIGH") {
        return `Elevated posture ${score}/100 · ${crit} priority events · ${vector}. Continue unified monitoring and validate playbook actions.`;
      }
      if (kpis.value.total === 0) {
        return "Awaiting telemetry from enterprise API and live stream ingest.";
      }
      return `Stable posture ${score}/100 · ${kpis.value.total} events in queue · ${vector}. Operations within expected thresholds.`;
    });

    const missionLine = computed(() => {
      if (contained.value) {
        return "Containment executed — attack stream isolated · landscape score decaying · brief refreshed for leadership.";
      }
      if (globalLevel.value === "CRITICAL" || globalScore.value >= 78) {
        return "Critical posture — unified ingest active · deterministic scoring elevated · initiate containment when ready.";
      }
      if (globalScore.value >= 45) {
        return "Active threat environment — telemetry normalized · landscape and per-event risk updating in real time.";
      }
      return "From raw telemetry to executive action — one schema, one score, one narrative.";
    });

    const narrativeSteps = computed(() => {
      const score = globalScore.value;
      const hasFeed = feed.value.length > 0;
      const briefReady = (briefText.value || "").length > 40;
      return [
        {
          id: "ingest",
          label: "Ingest",
          detail: "Dual-source normalize",
          done: hasFeed && feed.value.length >= 8,
          active: hasFeed,
        },
        {
          id: "score",
          label: "Score",
          detail: "Landscape + risk",
          done: score >= 35,
          active: score >= 12,
        },
        {
          id: "brief",
          label: "Brief",
          detail: "Executive summary",
          done: briefReady && score >= 25,
          active: briefReady,
        },
        {
          id: "respond",
          label: "Respond",
          detail: "Containment hook",
          done: contained.value,
          active: containing.value || contained.value || score >= 55,
        },
      ];
    });

    watch(
      globalScore,
      (target) => {
        const start = displayScore.value;
        const end = target;
        const duration = 650;
        const t0 = performance.now();
        function tick(now) {
          const p = Math.min(1, (now - t0) / duration);
          const eased = 1 - (1 - p) ** 3;
          displayScore.value = start + (end - start) * eased;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { immediate: true }
    );

    const healthRows = computed(() => {
      if (!health.value) {
        return [
          { label: "Legacy API", status: "DEGRADED", detail: "Loading…" },
          { label: "Live Telemetry", status: "DEGRADED", detail: "Loading…" },
          { label: "Analytics Bridge", status: "ONLINE", detail: "Starting" },
          { label: "WebSocket", status: "DISCONNECTED", detail: "Connecting" },
          { label: "AI Enrichment", status: "READY", detail: "Template" },
        ];
      }
      return [
        health.value.legacy_api,
        health.value.attack_stream,
        health.value.analytics_bridge,
        health.value.websocket,
        health.value.ai_enrichment,
      ].map((item) => ({
        label: item.component,
        status: item.status,
        detail: item.detail,
      }));
    });

    const scenarios = [
      { id: "normal", label: "Normal", desc: "Low-noise reconnaissance" },
      { id: "port_scan", label: "Port Scan", desc: "Repeated scanning pattern" },
      { id: "brute_force", label: "Brute Force", desc: "Credential pressure campaign" },
      { id: "critical", label: "Critical Attack", desc: "SQLi + escalation spike" },
    ];

    const kpis = computed(() => {
      const events = feed.value;
      const critical = events.filter(
        (e) => (e.event?.raw_severity ?? 0) >= 8 || e.threat_level === "CRITICAL"
      ).length;
      const avgRisk =
        events.length === 0
          ? 0
          : events.reduce((s, e) => s + (e.risk_score ?? 0), 0) / events.length;
      const legacy = events.filter((e) => e.event?.source === "legacy_api").length;
      const live = events.filter((e) => e.event?.source === "live_stream").length;
      return {
        total: events.length,
        critical,
        avgRisk: Math.round(avgRisk),
        legacy,
        live,
      };
    });

    const executiveHighlights = computed(() => [
      {
        label: "Landscape",
        value: `${Math.round(globalScore.value)}/100 · ${globalLevel.value}`,
        tone: globalScore.value >= 60 ? "risk" : "neutral",
      },
      {
        label: "Priority queue",
        value: `${kpis.value.critical} events`,
        tone: kpis.value.critical > 0 ? "risk" : "neutral",
      },
      {
        label: "Response state",
        value: containmentStatus.value,
        tone: contained.value ? "ok" : "warn",
      },
    ]);

    const selectedScenarioPreview = computed(() => {
      const hit = scenarios.find((s) => s.id === selectedScenario.value);
      if (!hit) return "";
      if (hit.id === "critical") {
        return "Expect landscape spike, SQLi-weighted mix, and CRITICAL brief language within seconds.";
      }
      if (hit.id === "brute_force") {
        return "Credential pressure pattern — elevated brute-force share in composition charts.";
      }
      if (hit.id === "port_scan") {
        return "Reconnaissance-heavy feed — port scan dominance, moderate landscape lift.";
      }
      return "Baseline noise — suitable for opening the room before escalating scenarios.";
    });

    const chartPalette = computed(() => ({
      attack: ATTACK_PALETTE_DARK,
      level: LEVEL_PALETTE_DARK,
      severity: { high: "#ff5c5c", mid: "#ffb020", low: "#3dd68c" },
      ingestApi: "#5eb8ff",
      ingestStream: "#a78bfa",
    }));

    const attackMix = computed(() => {
      const palette = chartPalette.value.attack;
      const entries = countFeedBy(feed.value, (r) => r.event?.attack_type).slice(0, 6);
      const items = entries.map(([label, value]) => ({
        label,
        value,
        color: palette[label] || palette.default,
      }));
      const pie = buildPieSlices(items);
      return { ...pie, segments: pie.slices };
    });

    // ---- 3D attack map -----------------------------------------------------------------
    const globeCanvas = ref(null);
    let globe = null;

    const protectedRegions = computed(() =>
      platform.value.geo_targets?.length
        ? platform.value.geo_targets
        : [{ region: "us-west-2", city: "Oregon (us-west-2)", lat: 45.84, lon: -119.7, assets: [], primary: true }]
    );

    /** Region of the asset an event targeted (web tier vs. legacy core), from the bridge's config. */
    function regionForAsset(destination) {
      const hit = protectedRegions.value.find((r) => (r.assets || []).includes(destination));
      return (hit || protectedRegions.value[0]).region;
    }

    const regionHits = computed(() => {
      const counts = Object.fromEntries(protectedRegions.value.map((r) => [r.region, { ext: 0, internal: 0 }]));
      for (const row of feed.value) {
        const g = row.event?.geo;
        if (!g) continue;
        const c = counts[regionForAsset(row.event.destination)];
        if (c) g.internal ? (c.internal += 1) : (c.ext += 1);
      }
      return protectedRegions.value.map((r) => ({ ...r, ...counts[r.region] }));
    });

    function globeEvent(item) {
      const geo = item?.event?.geo;
      if (!globe || !geo) return;
      const region = regionForAsset(item.event.destination);
      if (geo.internal) globe.addInternal(item.threat_level, region);
      else globe.addAttack({ lat: geo.lat, lon: geo.lon, level: item.threat_level, region });
    }

    function initGlobe() {
      if (globe || !globeCanvas.value) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      globe = new AttackGlobe(globeCanvas.value, {
        targets: protectedRegions.value,
        reducedMotion: !!reduced,
      });
      globe.setContained(contained.value);
      // replay the most recent external events so the map is alive on first paint
      feed.value
        .filter((r) => r.event?.geo && !r.event.geo.internal)
        .slice(0, 10)
        .reverse()
        .forEach((row, i) => setTimeout(() => globeEvent(row), 250 + i * 320));
    }

    watch(contained, (on) => globe?.setContained(on));
    watch(
      () => platform.value.geo_targets,
      (t) => t && globe?.setTargets(t)
    );

    const mapOrigins = computed(() => {
      const byCity = {};
      for (const row of feed.value) {
        const g = row.event?.geo;
        if (!g || g.internal) continue;
        const key = `${g.city}|${g.country}`;
        byCity[key] = byCity[key] || { city: g.city, country: g.country, count: 0, techniques: {} };
        byCity[key].count += 1;
        const t = row.event.technique;
        if (t) {
          const tk = byCity[key].techniques;
          tk[t.id] = tk[t.id] || { ...t, n: 0 };
          tk[t.id].n += 1;
        }
      }
      const list = Object.values(byCity).sort((a, b) => b.count - a.count);
      const max = list[0]?.count || 1;
      return list.slice(0, 5).map((o) => ({
        city: o.city,
        country: o.country,
        count: o.count,
        pct: Math.round((o.count / max) * 100),
        technique: Object.values(o.techniques).sort((a, b) => b.n - a.n)[0] || null, // what this origin does most
      }));
    });

    const mapStats = computed(() => {
      const ext = feed.value.filter((r) => r.event?.geo && !r.event.geo.internal);
      return {
        origins: new Set(ext.map((r) => r.event.geo.city)).size,
        countries: new Set(ext.map((r) => r.event.geo.country)).size,
        internal: feed.value.filter((r) => r.event?.geo?.internal).length,
      };
    });

    const techniqueByAttack = computed(() => {
      const map = {};
      for (const row of feed.value) {
        const t = row.event?.technique;
        if (t && !map[row.event.attack_type]) map[row.event.attack_type] = t;
      }
      return map;
    });

    // Donut hover/tap: one focused slice per chart drives the pop-out, centre readout and legend.
    const pieHover = ref({ level: null, attack: null });
    function setPieHover(chart, label) {
      pieHover.value = { ...pieHover.value, [chart]: label };
    }
    function togglePieHover(chart, label) {
      setPieHover(chart, pieHover.value[chart] === label ? null : label);
    }
    function pieFocus(chart, pie) {
      const label = pieHover.value[chart];
      return label ? pie.slices.find((s) => s.label === label) || null : null;
    }

    const threatLevelPie = computed(() => {
      const levelColors = chartPalette.value.level;
      const order = ["CRITICAL", "HIGH", "ELEVATED", "LOW"];
      const counts = Object.fromEntries(order.map((l) => [l, 0]));
      for (const row of feed.value) {
        const lvl = row.threat_level || "LOW";
        if (counts[lvl] !== undefined) counts[lvl] += 1;
        else counts.LOW += 1;
      }
      const items = order.map((label) => ({
        label,
        value: counts[label],
        color: levelColors[label],
      }));
      return buildPieSlices(items);
    });

    const severityPie = computed(() => {
      const sev = chartPalette.value.severity;
      const buckets = { high: 0, mid: 0, low: 0 };
      for (const row of feed.value) {
        const c = sevClass(row.event?.raw_severity ?? 1);
        buckets[c] += 1;
      }
      return buildPieSlices([
        { label: "High (8–10)", value: buckets.high, color: sev.high },
        { label: "Medium (5–7)", value: buckets.mid, color: sev.mid },
        { label: "Low (1–4)", value: buckets.low, color: sev.low },
      ]);
    });

    const severityBars = computed(() => {
      const total = feed.value.length || 1;
      return (severityPie.value.slices || []).map((s) => ({
        label: s.label.split(" ")[0],
        value: s.value,
        pct: (s.value / total) * 100,
        color: s.color,
      }));
    });

    const telemetryShare = computed(() => {
      const legacy = kpis.value.legacy;
      const live = kpis.value.live;
      const total = legacy + live || 1;
      return {
        legacy,
        live,
        legacyPct: Math.round((legacy / total) * 100),
        livePct: Math.round((live / total) * 100),
      };
    });

    const topSourceIps = computed(() => {
      const entries = countFeedBy(feed.value, (r) => r.event?.source_ip).slice(0, 5);
      const max = entries[0]?.[1] || 1;
      return entries.map(([label, value]) => ({
        label,
        value,
        pct: (value / max) * 100,
      }));
    });

    const postureDelta = computed(() => {
      const pts = scoreHistory.value;
      if (pts.length < 2) {
        return { delta: 0, dir: "flat", label: "Building baseline" };
      }
      const delta = Math.round(pts[pts.length - 1] - pts[0]);
      if (delta > 2) return { delta, dir: "up", label: `+${delta} pts session` };
      if (delta < -2) return { delta, dir: "down", label: `${delta} pts session` };
      return { delta, dir: "flat", label: "Stable posture" };
    });

    const executiveRiskKpis = computed(() => {
      const total = feed.value.length || 0;
      const highShare =
        total === 0
          ? 0
          : Math.round(
              ((severityPie.value.slices?.find((s) => s.label.startsWith("High"))?.value ||
                0) /
                total) *
                100
            );
      const topAttack = attackMix.value.slices[0];
      return [
        {
          label: "High-severity share",
          value: total ? `${highShare}%` : "—",
          hint: "Events rated severity 8–10",
          tone: highShare >= 25 ? "risk" : "neutral",
        },
        {
          label: "Dominant vector",
          value: topAttack ? topAttack.label : "—",
          hint: topAttack ? `${topAttack.pct}% of visible queue` : "Awaiting events",
          tone: "info",
        },
        {
          label: "Landscape trend",
          value: postureDelta.value.label,
          tone: postureDelta.value.dir === "up" ? "risk" : "ok",
          hint: "Since session connect",
        },
        {
          label: "Telemetry blend",
          value: `${telemetryShare.value.legacyPct}% API · ${telemetryShare.value.livePct}% stream`,
          hint: "Unified ingest sources",
          tone: "info",
        },
      ];
    });

    function seriesPath(pts, w, h, padY, clampMin = 0, clampMax = 100) {
      if (pts.length < 2) return { line: "", area: "" };
      const min = clampMin;
      const max = clampMax;
      const range = max - min || 1;
      const innerH = h - padY * 2;
      const line = pts
        .map((v, i) => {
          const x = (i / (pts.length - 1)) * w;
          const y = padY + innerH - ((Math.max(min, Math.min(max, v)) - min) / range) * innerH;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      return { line, area: `${line} L${w},${h} L0,${h} Z` };
    }

    const sparkPath = computed(() => {
      const { line } = seriesPath(scoreHistory.value, 280, 40, 2, 0, 100);
      return line;
    });

    const landscapeChart = computed(() => {
      const pts = scoreHistory.value;
      const w = 320;
      const h = 88;
      const { line, area } = seriesPath(pts, w, h, 8, 0, 100);
      const grid = [0, 25, 50, 75, 100].map((v) => {
        const y = 8 + (h - 16) - (v / 100) * (h - 16);
        return { y, label: v };
      });
      const last = pts.length ? Math.round(pts[pts.length - 1]) : Math.round(globalScore.value);
      return { line, area, grid, w, h, last, empty: pts.length < 2 };
    });

    function pushScore(score) {
      scoreHistory.value = [...scoreHistory.value, score].slice(-24);
      const now = Date.now();
      scoreSamples.value = [...scoreSamples.value, { t: now, v: score }].filter(
        (p) => now - p.t <= TREND_WINDOW_MS + 5000
      );
    }

    function runBriefTypewriter(text) {
      if (typewriterTimer) {
        clearInterval(typewriterTimer);
        typewriterTimer = null;
      }
      const full = (text || "").trim();
      if (!full) {
        displayedBrief.value = "";
        briefTyping.value = false;
        return;
      }
      briefTyping.value = true;
      displayedBrief.value = "";
      let idx = 0;
      const tickMs = full.length > 380 ? 5 : 9;
      typewriterTimer = setInterval(() => {
        idx += 1;
        displayedBrief.value = full.slice(0, idx);
        if (idx >= full.length) {
          clearInterval(typewriterTimer);
          typewriterTimer = null;
          briefTyping.value = false;
        }
      }, tickMs);
    }

    function applyBriefPayload(brief, { animate = false } = {}) {
      if (!brief) return;
      const nextText = brief.text ?? briefText.value;
      briefText.value = nextText;
      if (animate) {
        runBriefTypewriter(nextText);
      } else {
        if (typewriterTimer) {
          clearInterval(typewriterTimer);
          typewriterTimer = null;
        }
        displayedBrief.value = (nextText || "").trim();
        briefTyping.value = false;
      }
      briefMode.value = brief.mode ?? briefMode.value;
      if (brief.updated_at) {
        try {
          const iso = new Date(brief.updated_at).toISOString(); // UTC, matching the header clock
          briefUpdatedAt.value = `${iso.slice(11, 19)}Z · ${iso.slice(0, 10)}`;
        } catch {
          briefUpdatedAt.value = "";
        }
      }
      if (brief.insights) {
        aiInsights.value = { ...aiInsights.value, ...brief.insights };
      }
      briefPulse.value = true;
      setTimeout(() => {
        briefPulse.value = false;
      }, 800);
    }

    function exportBoardSummary() {
      const score = Math.round(globalScore.value);
      const level = exportEscape(globalLevel.value);
      const levelKey = String(globalLevel.value || "LOW").toLowerCase();
      const kpiLevelClass =
        {
          critical: "kpi-critical",
          high: "kpi-high",
          elevated: "kpi-warn",
          low: "kpi-ok",
        }[levelKey] || "kpi-brand";
      const pillLevelClass =
        {
          critical: "pill-critical",
          high: "pill-high",
          elevated: "pill-medium",
          low: "pill-low",
        }[levelKey] || "pill-low";
      const showAlert =
        globalLevel.value === "CRITICAL" || score >= 78 || kpis.value.critical > 0;
      const heroBadgeClass = `hero-badge hero-badge--${levelKey === "critical" || levelKey === "high" || levelKey === "elevated" || levelKey === "low" ? levelKey : "low"}`;
      const alertHtml = showAlert
        ? `<div class="alert-banner"><span class="alert-icon">!</span><div><strong>Leadership attention</strong><br />${exportEscape(
            globalLevel.value === "CRITICAL"
              ? "Landscape posture is CRITICAL — validate containment and executive brief before closing the session."
              : `${kpis.value.critical} priority event(s) in the unified queue — review telemetry and playbook actions.`
          )}</div></div>`
        : "";
      const recs = (aiInsights.value.recommendations || [])
        .map(
          (r, i) =>
            `<li class="rec-item"><span class="rec-num">${i + 1}</span><span>${exportEscape(r)}</span></li>`
        )
        .join("");
      const recList = recs
        ? `<ul class="rec-list">${recs}</ul>`
        : `<p class="muted">No playbook recommendations loaded.</p>`;
      const focal = aiInsights.value.focal_insight
        ? `<div class="focal-card"><span class="focal-label">Focal event analysis</span><p>${exportEscape(aiInsights.value.focal_insight)}</p></div>`
        : "";
      const product = exportEscape(platform.value.product || "Threat Command Center");
      const generated = exportEscape(new Date().toLocaleString());
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${product} — Executive Summary</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #0f172a;
      --muted: #64748b;
      --line: #dbe4f0;
      --surface: #ffffff;
      --bg: #eef2f8;
      --bg-accent: #e8eef9;
      --pan-orange: #fa582d;
      --pan-orange-deep: #e04e26;
      --pan-coral: #ff7a4d;
      --pan-navy: #0b1220;
      --pan-slate: #1e293b;
      --cyan: #0891b2;
      --cyan-soft: #ecfeff;
      --violet: #6366f1;
      --critical: #dc2626;
      --critical-soft: #fef2f2;
      --high: #ea580c;
      --high-soft: #fff7ed;
      --elevated: #ca8a04;
      --elevated-soft: #fefce8;
      --low: #059669;
      --low-soft: #ecfdf5;
      --shadow-sm: 0 4px 14px rgba(15, 23, 42, 0.06);
      --shadow: 0 16px 48px rgba(15, 23, 42, 0.1);
      --radius: 16px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(250, 88, 45, 0.12), transparent 55%),
        radial-gradient(ellipse 60% 40% at 100% 0%, rgba(8, 145, 178, 0.1), transparent 50%),
        linear-gradient(180deg, var(--bg) 0%, #f8fafc 100%);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 920px; margin: 0 auto; padding: 32px 24px 56px; }
    .hero {
      background:
        linear-gradient(125deg, var(--pan-navy) 0%, #152238 35%, #3d1a12 72%, var(--pan-orange-deep) 100%);
      color: #fff;
      border-radius: calc(var(--radius) + 2px);
      padding: 34px 38px 30px;
      box-shadow: var(--shadow), inset 0 1px 0 rgba(255,255,255,0.12);
      margin-bottom: 26px;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(250, 88, 45, 0.15), transparent);
      opacity: 0.6;
      pointer-events: none;
    }
    .hero-orb {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
    }
    .hero-orb--1 {
      width: 280px; height: 280px;
      right: -80px; top: -100px;
      background: radial-gradient(circle, rgba(255, 122, 77, 0.35) 0%, transparent 68%);
    }
    .hero-orb--2 {
      width: 160px; height: 160px;
      left: 55%; bottom: -60px;
      background: radial-gradient(circle, rgba(8, 145, 178, 0.25) 0%, transparent 70%);
    }
    .hero-inner { position: relative; z-index: 1; }
    .hero-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 10px;
      font-weight: 800;
      color: rgba(255, 255, 255, 0.75);
    }
    .hero-badge {
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(8px);
    }
    .hero-badge--critical { background: rgba(220, 38, 38, 0.35); border-color: rgba(254, 202, 202, 0.5); }
    .hero-badge--high { background: rgba(234, 88, 12, 0.35); border-color: rgba(254, 215, 170, 0.5); }
    .hero-badge--elevated { background: rgba(202, 138, 4, 0.35); border-color: rgba(253, 230, 138, 0.5); }
    .hero-badge--low { background: rgba(5, 150, 105, 0.35); border-color: rgba(167, 243, 208, 0.5); }
    .hero h1 {
      margin: 0 0 12px;
      font-size: 28px;
      font-weight: 800;
      line-height: 1.15;
      max-width: 680px;
      letter-spacing: -0.02em;
      text-shadow: 0 2px 24px rgba(0,0,0,0.35);
    }
    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }
    .hero-meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.92);
    }
    .hero-meta-chip::before {
      content: "";
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--pan-coral);
      box-shadow: 0 0 8px var(--pan-coral);
    }
    .alert-banner {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: linear-gradient(90deg, var(--critical-soft) 0%, #fff 100%);
      border: 1px solid #fecaca;
      border-left: 5px solid var(--critical);
      color: #7f1d1d;
      border-radius: var(--radius);
      padding: 16px 18px;
      margin-bottom: 24px;
      font-size: 14px;
      box-shadow: var(--shadow-sm);
    }
    .alert-icon {
      flex-shrink: 0;
      width: 28px; height: 28px;
      border-radius: 8px;
      background: var(--critical);
      color: #fff;
      font-weight: 800;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 26px;
    }
    .kpi-tile {
      background: var(--surface);
      border-radius: var(--radius);
      padding: 18px 16px 16px;
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--line);
      position: relative;
      overflow: hidden;
    }
    .kpi-tile::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--pan-slate), #94a3b8);
    }
    .kpi-tile--score::before { background: linear-gradient(90deg, var(--pan-orange-deep), var(--pan-coral)); }
    .kpi-tile.kpi-critical::before { background: linear-gradient(90deg, #991b1b, var(--critical)); }
    .kpi-tile.kpi-high::before { background: linear-gradient(90deg, #c2410c, var(--high)); }
    .kpi-tile.kpi-warn::before { background: linear-gradient(90deg, #a16207, var(--elevated)); }
    .kpi-tile.kpi-ok::before { background: linear-gradient(90deg, #047857, var(--low)); }
    .kpi-tile.kpi-brand::before { background: linear-gradient(90deg, var(--cyan), var(--violet)); }
    .kpi-tile--score {
      grid-column: span 1;
      background: linear-gradient(165deg, #fff 0%, #fff7f4 100%);
      border-color: rgba(250, 88, 45, 0.22);
    }
    .kpi-value { font-size: 30px; font-weight: 800; line-height: 1; margin-bottom: 6px; letter-spacing: -0.03em; }
    .kpi-value-sub { font-size: 15px; font-weight: 600; color: var(--muted); letter-spacing: 0; }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 800; }
    .kpi-hint { display: block; margin-top: 8px; font-size: 11px; color: var(--muted); font-weight: 500; }
    .kpi-critical .kpi-value { color: var(--critical); }
    .kpi-high .kpi-value { color: var(--high); }
    .kpi-warn .kpi-value { color: var(--elevated); }
    .kpi-ok .kpi-value { color: var(--low); }
    .kpi-brand .kpi-value { color: var(--pan-slate); }
    .kpi-tile--score .kpi-value { color: var(--pan-orange-deep); font-size: 36px; }
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      padding: 0;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .panel-accent {
      height: 5px;
      background: linear-gradient(90deg, var(--pan-orange-deep), var(--pan-coral), var(--cyan));
    }
    .panel-accent--playbook {
      background: linear-gradient(90deg, var(--violet), var(--cyan), var(--low));
    }
    .panel-body { padding: 24px 28px 26px; }
    .panel-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .panel-head h2 {
      margin: 0 0 6px;
      font-size: 19px;
      font-weight: 800;
      color: var(--pan-navy);
      letter-spacing: -0.02em;
    }
    .panel-head p { margin: 0; color: var(--muted); font-size: 13px; max-width: 560px; line-height: 1.5; }
    .pill {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pill-critical { background: var(--critical-soft); color: #b91c1c; border: 1px solid #fecaca; }
    .pill-high { background: var(--high-soft); color: #c2410c; border: 1px solid #fed7aa; }
    .pill-medium { background: var(--elevated-soft); color: #a16207; border: 1px solid #fde68a; }
    .pill-low { background: var(--low-soft); color: #047857; border: 1px solid #a7f3d0; }
    .pill-mode {
      background: linear-gradient(135deg, #eef2ff, #ecfeff);
      color: #4338ca;
      border: 1px solid #c7d2fe;
    }
    .brief-body {
      margin: 0;
      font-size: 15px;
      line-height: 1.65;
      color: #e2e8f0;
      padding: 20px 22px;
      background: linear-gradient(145deg, #0f172a 0%, #1e293b 55%, #0f172a 100%);
      border: 1px solid #334155;
      border-radius: 14px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .brief-body::before {
      content: "Executive narrative";
      display: block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--pan-coral);
      margin-bottom: 10px;
    }
    .playbook-rationale {
      margin: 0 0 18px;
      font-size: 14px;
      color: var(--muted);
      padding: 12px 14px;
      background: var(--bg-accent);
      border-radius: 12px;
      border-left: 3px solid var(--violet);
    }
    .rec-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .rec-item {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
      font-size: 14px;
      color: var(--ink);
    }
    .rec-item:nth-child(odd) { border-color: rgba(250, 88, 45, 0.15); }
    .rec-num {
      flex-shrink: 0;
      width: 28px; height: 28px;
      border-radius: 10px;
      background: linear-gradient(145deg, var(--pan-orange-deep), var(--pan-coral));
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(250, 88, 45, 0.35);
    }
    .focal-card {
      margin-top: 20px;
      padding: 16px 18px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--cyan-soft) 0%, #f0f9ff 100%);
      border: 1px solid #7dd3fc;
      box-shadow: var(--shadow-sm);
    }
    .focal-label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      color: var(--cyan);
      margin-bottom: 8px;
    }
    .focal-card p { margin: 0; font-size: 14px; color: var(--ink); }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .meta-chip {
      background: #f1f5f9;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--pan-slate);
    }
    .footer {
      margin-top: 32px;
      padding: 20px 22px;
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--line);
      font-size: 12px;
      color: var(--muted);
      box-shadow: var(--shadow-sm);
    }
    .footer-bar {
      height: 3px;
      border-radius: 999px;
      margin-bottom: 14px;
      background: linear-gradient(90deg, var(--pan-navy), var(--pan-orange-deep), var(--cyan));
    }
    .footer strong { color: var(--ink); font-weight: 700; }
    .muted { color: var(--muted); font-size: 14px; }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
      .hero, .panel, .kpi-tile, .footer { box-shadow: none; break-inside: avoid; }
      .brief-body { color: #1e293b; background: #f8fafc; border-color: #cbd5e1; }
      .brief-body::before { color: var(--pan-orange-deep); }
    }
    @media (max-width: 720px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .hero h1 { font-size: 22px; }
      .hero { padding: 26px 22px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <span class="hero-orb hero-orb--1" aria-hidden="true"></span>
      <span class="hero-orb hero-orb--2" aria-hidden="true"></span>
      <div class="hero-inner">
        <div class="hero-top">
          <div class="eyebrow">Palo Alto Networks · Unified Telemetry · Executive Report</div>
          <span class="${heroBadgeClass}">Posture ${level}</span>
        </div>
        <h1>${product}</h1>
        <div class="hero-meta">
          <span class="hero-meta-chip">Generated ${generated}</span>
          <span class="hero-meta-chip">Tenant ${exportEscape(tenantDisplay.value)}</span>
          <span class="hero-meta-chip">${exportEscape(regionDisplay.value)} · ${exportEscape(envDisplay.value)}</span>
          <span class="hero-meta-chip">v${exportEscape(platform.value.version || "1")}</span>
        </div>
      </div>
    </header>

    ${alertHtml}

    <section class="kpi-grid">
      <div class="kpi-tile kpi-tile--score ${kpiLevelClass}">
        <div class="kpi-value">${score}<span class="kpi-value-sub"> /100</span></div>
        <div class="kpi-label">Landscape score</div>
        <span class="kpi-hint">Unified posture · ${level}</span>
      </div>
      <div class="kpi-tile kpi-brand">
        <div class="kpi-value">${exportEscape(kpis.value.total)}</div>
        <div class="kpi-label">Queue depth</div>
      </div>
      <div class="kpi-tile ${kpis.value.critical > 0 ? "kpi-critical" : "kpi-ok"}">
        <div class="kpi-value">${exportEscape(kpis.value.critical)}</div>
        <div class="kpi-label">Priority events</div>
      </div>
      <div class="kpi-tile kpi-brand">
        <div class="kpi-value">${exportEscape(kpis.value.avgRisk)}</div>
        <div class="kpi-label">Mean risk</div>
      </div>
      <div class="kpi-tile kpi-brand">
        <div class="kpi-value" style="font-size:20px;line-height:1.2">${exportEscape(kpis.value.legacy)}<span class="kpi-value-sub"> / </span>${exportEscape(kpis.value.live)}</div>
        <div class="kpi-label">Ingest mix</div>
        <span class="kpi-hint">Legacy API · live stream</span>
      </div>
      <div class="kpi-tile ${containmentStatus.value === "CONTAINED" ? "kpi-ok" : "kpi-warn"}">
        <div class="kpi-value" style="font-size:17px">${exportEscape(containmentStatus.value)}</div>
        <div class="kpi-label">Response state</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-accent" aria-hidden="true"></div>
      <div class="panel-body">
        <div class="panel-head">
          <div>
            <h2>Executive brief</h2>
            <p>Leadership narrative synthesized from normalized telemetry (12-event minimized context).</p>
          </div>
          <span class="pill pill-mode">${exportEscape(briefMode.value === "llm" ? "AI enriched" : "Deterministic")}</span>
        </div>
        <p class="brief-body">${exportEscape(briefText.value || displayedBrief.value || "No brief available.")}</p>
        <div class="meta-row">
          <span class="meta-chip">Confidence ${confidencePct.value}%</span>
          <span class="meta-chip">Posture <span class="pill ${pillLevelClass}">${level}</span></span>
          ${briefUpdatedAt.value ? `<span class="meta-chip">Updated ${exportEscape(briefUpdatedAt.value)}</span>` : ""}
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-accent panel-accent--playbook" aria-hidden="true"></div>
      <div class="panel-body">
        <div class="panel-head">
          <div>
            <h2>Playbook — ${exportEscape(aiInsights.value.playbook_name || "SecOps response")}</h2>
            <p>Prioritized actions aligned to current landscape and ingest posture.</p>
          </div>
        </div>
        <p class="playbook-rationale">${exportEscape(aiInsights.value.playbook_rationale || "")}</p>
        ${recList}
        ${focal}
      </div>
    </section>

    <footer class="footer">
      <div class="footer-bar" aria-hidden="true"></div>
      <strong>${product}</strong> · ThreatEvent schema v1 · Deterministic scoring with optional LLM enrichment.<br />
      Generated for leadership review — not a substitute for full SOC incident records.
    </footer>
  </div>
</body>
</html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        URL.revokeObjectURL(url);
        return;
      }
      const triggerPrint = () => {
        try {
          win.focus();
          win.print();
        } catch {
          /* noop */
        }
      };
      win.addEventListener("load", triggerPrint, { once: true });
      setTimeout(triggerPrint, 800);
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    }

    const aiStatusLabel = computed(() => {
      if (llmConfigured.value && briefMode.value === "llm") {
        return `AI enriched · ${aiInsights.value.model || "LLM"}`;
      }
      if (llmConfigured.value) {
        return "AI service ready";
      }
      return "Deterministic intelligence";
    });

    const confidencePct = computed(() =>
      Math.round((aiInsights.value.confidence ?? 0.75) * 100)
    );

    function prependFeed(item) {
      feed.value = [item, ...feed.value].slice(0, MAX_FEED);
      const key =
        item.event?.event_id ||
        `${item.event?.attack_type || "evt"}-${Date.now()}`;
      feedHighlightKey.value = key;
      setTimeout(() => {
        if (feedHighlightKey.value === key) feedHighlightKey.value = null;
      }, 1400);
    }

    function feedKey(row, idx) {
      return row.event?.event_id || `${row.event?.attack_type}-${idx}`;
    }

    function applyState(state) {
      bridgeSendsAlarm.value = typeof state.critical_alarm === "boolean";
      criticalAlarm.value = !!state.critical_alarm;
      globalScore.value = state.global_score ?? 0;
      pushScore(globalScore.value);
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
        const [stateRes, briefRes, platformRes] = await Promise.all([
          fetch("/api/state"),
          fetch("/api/brief"),
          fetch("/api/platform"),
        ]);
        if (stateRes.ok) applyState(await stateRes.json());
        if (briefRes.ok) {
          applyBriefPayload(await briefRes.json());
        }
        if (platformRes.ok) {
          const plat = await platformRes.json();
          platform.value = { ...platform.value, ...plat };
          llmConfigured.value = !!plat.ai?.llm_configured;
          aiCapabilities.value = plat.ai?.capabilities ?? [];
        }
      } catch {
        /* starting */
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
        const item = {
          event: msg.payload.event,
          risk_score: msg.payload.risk_score,
          threat_level: msg.payload.threat_level,
        };
        prependFeed(item);
        globeEvent(item);
        globalScore.value = msg.payload.global_score ?? globalScore.value;
        pushScore(globalScore.value);
        globalLevel.value = msg.payload.global_threat_level ?? globalLevel.value;
        if (typeof msg.payload.critical_alarm === "boolean") {
          bridgeSendsAlarm.value = true;
          criticalAlarm.value = msg.payload.critical_alarm;
        }
      } else if (msg.type === "state") {
        applyState(msg.payload);
      } else if (msg.type === "health") {
        health.value = msg.payload;
      } else if (msg.type === "brief") {
        applyBriefPayload(msg.payload);
      } else if (msg.type === "system") {
        prependFeed({
          event: {
            attack_type: "CONTAINMENT",
            source_ip: "SOC-CONSOLE",
            source: "soc_console",
            raw_severity: 1,
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
        reconnectTimer = setTimeout(async () => {
          await hydrateFromRest();
          connectWs();
        }, 2000);
      };
      ws.onmessage = (evt) => handleMessage(evt.data);
    }

    // Control actions can be refused by the bridge's guard (rate limit / operator token):
    // only update the UI on success, and tell the operator why otherwise.
    const controlNotice = ref("");
    let controlNoticeTimer = null;
    function controlOk(res) {
      if (res.ok) return true;
      controlNotice.value =
        res.status === 429
          ? "Too many control actions. Try again in a few seconds."
          : res.status === 401
            ? "Operator token required for control actions."
            : `Control action failed (HTTP ${res.status}).`;
      if (controlNoticeTimer) clearTimeout(controlNoticeTimer);
      controlNoticeTimer = setTimeout(() => (controlNotice.value = ""), 6000);
      return false;
    }

    async function runScenario() {
      runningScenario.value = true;
      try {
        const res = await fetch("/api/demo/scenario", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario: selectedScenario.value }),
        });
        if (!controlOk(res)) return;
        contained.value = false;
        containmentStatus.value = "ACTIVE";
        goTab("executive");
      } finally {
        runningScenario.value = false;
      }
    }

    async function containThreat() {
      if (containing.value || contained.value) return;
      containing.value = true;
      try {
        const res = await fetch("/api/contain", { method: "POST" });
        if (!controlOk(res)) return; // refused: stay ACTIVE, alarm keeps going
        contained.value = true;
        containmentStatus.value = "CONTAINED";
      } finally {
        containing.value = false;
      }
    }

    async function regenerateBrief() {
      briefRefreshing.value = true;
      try {
        const res = await fetch("/api/ai/brief/regenerate", { method: "POST" });
        if (controlOk(res)) applyBriefPayload(await res.json());
      } finally {
        briefRefreshing.value = false;
      }
    }

    async function askExecutive() {
      const q = executiveQuestion.value.trim();
      if (q.length < 3 || askLoading.value) return;
      askLoading.value = true;
      askAnswer.value = "";
      try {
        const res = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
        });
        if (res.ok) {
          const data = await res.json();
          askAnswer.value = data.answer ?? "";
          askMode.value = data.mode ?? "";
        } else {
          askAnswer.value = "Unable to reach AI copilot — verify bridge is online.";
        }
      } finally {
        askLoading.value = false;
      }
    }

    const currentTourStep = computed(() => tourSteps.value[tourIndex.value] || null);

    async function loadTour() {
      tourSteps.value = await fetchTourSteps();
      if (tourSteps.value.length) {
        prefetchNarration(tourSteps.value[0]);
      } else {
        voiceError.value =
          "Tour scripts unavailable — check that the analytics bridge is running, then hard refresh.";
      }
    }

    async function loadCopilotIntro() {
      try {
        const res = await fetch("/api/narration/intro");
        if (res.ok) {
          copilotIntro.value = { ...copilotIntro.value, ...(await res.json()) };
          return;
        }
      } catch {
        /* try static fallback */
      }
      try {
        const res = await fetch("/static/copilot-intro.json");
        if (res.ok) {
          copilotIntro.value = { ...copilotIntro.value, ...(await res.json()) };
          return;
        }
      } catch {
        /* noop */
      }
      if (!copilotIntro.value.problem && !copilotIntro.value.text) {
        copilotIntro.value.problem =
          "Legacy telemetry and live attack streams rarely share one contract — queues split, scores disagree, and executive reporting lags the SOC.";
        copilotIntro.value.narration =
          "Threat Command Center bridges both paths through one analytics layer and one console. Next, a full product walkthrough and inject-to-contain workflow.";
      }
    }

    function copilotIntroProblemText() {
      const c = copilotIntro.value;
      return c.problem || c.text || "";
    }

    function copilotIntroVoiceStep() {
      const c = copilotIntro.value;
      const text =
        c.voice ||
        [copilotIntroProblemText(), c.narration].filter(Boolean).join(" ") ||
        c.text ||
        "";
      return { ...c, text };
    }

    /**
     * Every intro / tour run owns a token. User actions start a new run; delayed continuations
     * (auto-advance timers, step actions, audio callbacks) bail out when their run is stale, so an
     * old tour chain can never talk over a replayed overview.
     */
    function newGuideRun() {
      guideRun += 1;
      tourAdvanceLock = false;
      return guideRun;
    }

    function isGuideRun(run) {
      return run === guideRun;
    }

    function haltVoice() {
      stopNarration();
      voiceSpeaking.value = false;
      voiceLoading.value = false;
      introSpeaking.value = false;
      introLoading.value = false;
    }

    function skipCopilotIntro() {
      newGuideRun();
      showCopilotIntro.value = false;
      haltVoice();
    }

    async function speakCopilotIntro(options = {}) {
      const chainTourOnEnd = options.chainTourOnEnd === true;
      const step = copilotIntroVoiceStep();
      if (!step.text) return;
      const run = newGuideRun();
      haltVoice();
      if (!voiceEnabled.value) {
        introVoiceHint.value =
          "Voice is off — enable narration below, then use Replay overview or Start feature walkthrough.";
        return;
      }
      introLoading.value = true;
      introVoiceHint.value = "";
      voiceError.value = "";
      await playNarration(
        step,
        {
          onStart: () => {
            if (!isGuideRun(run)) return;
            introLoading.value = false;
            introSpeaking.value = true;
            introAutoplayBlocked.value = false;
            introVoiceHint.value = "";
          },
          onEnd: () => {
            if (!isGuideRun(run)) return;
            introSpeaking.value = false;
            introLoading.value = false;
            if (chainTourOnEnd && voiceEnabled.value && showCopilotIntro.value && tourSteps.value.length) {
              startDashboardTourFromIntro();
            }
          },
          onError: (err) => {
            if (!isGuideRun(run)) return;
            introLoading.value = false;
            introSpeaking.value = false;
            introAutoplayBlocked.value = true;
            const msg = err?.message || "";
            const blocked = /NotAllowed|autoplay|gesture/i.test(msg) || err?.name === "NotAllowedError";
            if (blocked) {
              introVoiceHint.value =
                "Click Play overview again — your browser needs a direct tap on that button for audio.";
            } else {
              introVoiceHint.value =
                "Voice clip did not play — hard refresh, or run ./scripts/generate-narration.sh and restart the demo.";
            }
          },
        },
        { fromStart: true }
      );
      if (isGuideRun(run) && !introSpeaking.value) {
        introLoading.value = false;
      }
    }

    /** Play / Replay overview: stop everything (including a running tour) and restart the clip from 0:00. */
    async function replayCopilotIntro() {
      if (lumiGuideActive.value) {
        endLumiTour();
      }
      introTourHandoff = false;
      tourAutoPlay.value = false;
      await speakCopilotIntro({ chainTourOnEnd: true });
    }

    async function openCopilotIntroFlow() {
      newGuideRun();
      haltVoice();
      introTourHandoff = false;
      tourAutoPlay.value = false;
      if (!copilotIntroProblemText()) await loadCopilotIntro();
      prefetchNarration(copilotIntroVoiceStep());
      showCopilotIntro.value = true;
      if (voiceEnabled.value) {
        introAutoplayBlocked.value = true;
        introVoiceHint.value =
          "Overview audio does not auto-start on refresh — click Play overview (highlighted) to hear the problem and architecture from the beginning.";
      }
    }

    async function startDashboardTourFromIntro() {
      if (introTourHandoff) return;
      introTourHandoff = true;
      introAutoplayBlocked.value = false;
      introVoiceHint.value = "";
      unlockNarrationAudio(); // use the click gesture before the tour's awaits
      skipCopilotIntro();
      await beginLumiDashboardTour();
    }

    async function executeTourStepAction(step) {
      if (!step?.action) return;
      try {
        if (step.action === "inject_critical") {
          selectedScenario.value = "critical";
          await runScenario();
          await new Promise((r) => setTimeout(r, 1800));
        } else if (step.action === "refresh_brief") {
          await regenerateBrief();
        } else if (step.action === "contain" && !contained.value && !containing.value) {
          await containThreat();
        }
      } catch {
        /* tour continues if an action fails */
      }
    }

    async function navigateToTourStep(step, run = guideRun) {
      if (!step || !isGuideRun(run)) return;
      const highlight = step.highlight || SECTION_TARGETS[step.tab] || null;
      if (step.tab) {
        activeTab.value = step.tab;
      }
      if (step.id === "lumi") {
        copilotOpen.value = true;
      } else if (step.highlight !== "lumi-fab-anchor") {
        copilotOpen.value = false;
      }
      await nextTick();
      if (!isGuideRun(run)) return;
      tourHighlightId.value = highlight;
      await executeTourStepAction(step);
      if (!isGuideRun(run)) return;
      if (step.tab) {
        activeTab.value = step.tab;
      }
      await nextTick();
      if (!isGuideRun(run)) return;
      tourHighlightId.value = highlight;
      requestAnimationFrame(() => scrollTourTarget(highlight));
    }

    function endLumiTour() {
      newGuideRun();
      lumiGuideActive.value = false;
      tourAutoPlay.value = false;
      tourHighlightId.value = null;
      copilotOpen.value = false;
      haltVoice();
    }

    async function advanceTourAuto(run) {
      if (tourAdvanceLock || !isGuideRun(run) || !lumiGuideActive.value || !tourAutoPlay.value) return;
      if (tourIndex.value >= tourSteps.value.length - 1) {
        endLumiTour();
        return;
      }
      tourAdvanceLock = true;
      await new Promise((r) => setTimeout(r, 700));
      if (!isGuideRun(run) || !lumiGuideActive.value || !tourAutoPlay.value) return;
      tourIndex.value += 1;
      await navigateToTourStep(currentTourStep.value, run);
      if (!isGuideRun(run)) return;
      const upcoming = tourSteps.value[tourIndex.value + 1];
      if (upcoming) prefetchNarration(upcoming);
      tourAdvanceLock = false;
      await speakCurrentTour(run);
    }

    async function beginLumiDashboardTour() {
      const run = newGuideRun();
      haltVoice();
      showCopilotIntro.value = false;
      lumiGuideActive.value = true;
      tourAutoPlay.value = true;
      tourIndex.value = 0;
      voiceError.value = "";
      if (!tourSteps.value.length) await loadTour();
      if (!isGuideRun(run)) return;
      await navigateToTourStep(currentTourStep.value, run);
      if (!isGuideRun(run)) return;
      await speakCurrentTour(run);
    }

    function pauseLumiTour() {
      newGuideRun();
      tourAutoPlay.value = false;
      haltVoice();
    }

    async function resumeLumiTour() {
      if (!lumiGuideActive.value) return;
      const run = newGuideRun();
      haltVoice();
      tourAutoPlay.value = true;
      await speakCurrentTour(run);
    }

    async function stepLumiTour(delta) {
      const run = newGuideRun();
      haltVoice();
      const next = tourIndex.value + delta;
      if (next < 0) return;
      if (next > tourSteps.value.length - 1) {
        endLumiTour();
        return;
      }
      tourIndex.value = next;
      await navigateToTourStep(currentTourStep.value, run);
      if (isGuideRun(run) && tourAutoPlay.value) {
        await speakCurrentTour(run);
      }
    }

    function skipLumiTourStep() {
      return stepLumiTour(1);
    }

    function prevLumiTourStep() {
      return stepLumiTour(-1);
    }

    async function enableGuideVoiceAndContinue() {
      voiceEnabled.value = true;
      voiceError.value = "";
      const run = newGuideRun();
      haltVoice();
      tourAutoPlay.value = true;
      await speakCurrentTour(run);
    }

    /** Voice checkbox: turning it off stops audio; a running tour keeps advancing silently. */
    function onVoiceToggle() {
      if (voiceEnabled.value) return;
      const run = newGuideRun();
      haltVoice();
      if (lumiGuideActive.value && tourAutoPlay.value) {
        speakCurrentTour(run);
      }
    }

    async function speakCurrentTour(run) {
      const chain = (delayMs = 0) => {
        setTimeout(() => {
          if (isGuideRun(run) && lumiGuideActive.value && tourAutoPlay.value) advanceTourAuto(run);
        }, delayMs);
      };
      if (!isGuideRun(run)) return;
      if (!voiceEnabled.value) {
        voiceError.value = "Voice off — enable voice or use Next to step through.";
        chain(5500);
        return;
      }
      if (!currentTourStep.value) {
        voiceError.value = "No tour step loaded — click Voice tour again or restart ./scripts/start-demo.sh";
        return;
      }
      voiceLoading.value = true;
      voiceError.value = "";
      await playNarration(currentTourStep.value, {
        onStart: () => {
          if (!isGuideRun(run)) return;
          voiceLoading.value = false;
          voiceSpeaking.value = true;
        },
        onEnd: () => {
          if (!isGuideRun(run)) return;
          voiceSpeaking.value = false;
          voiceLoading.value = false;
          chain();
        },
        onError: (err) => {
          if (!isGuideRun(run)) return;
          voiceLoading.value = false;
          voiceSpeaking.value = false;
          const msg = err?.message || "";
          if (/NotAllowed|autoplay|gesture/i.test(msg) || err?.name === "NotAllowedError") {
            voiceError.value =
              "Tap Read aloud or Enable voice — your browser requires a click before Lumi can speak.";
          } else {
            voiceError.value =
              "Voice unavailable — hard refresh (Cmd+Shift+R). If it persists, run ./scripts/generate-narration.sh and restart ./scripts/start-demo.sh.";
          }
          chain(4500);
        },
      });
      if (isGuideRun(run) && !voiceSpeaking.value && voiceLoading.value) {
        voiceLoading.value = false;
      }
    }

    async function openVoiceTour() {
      endLumiTour();
      tourIndex.value = 0;
      await openCopilotIntroFlow();
    }

    let sectionObserver;

    function bindSectionObserver() {
      if (sectionObserver) sectionObserver.disconnect();
      const ids = [...new Set(Object.values(SECTION_TARGETS))];
      sectionObserver = new IntersectionObserver(
        (entries) => {
          if (lumiGuideActive.value) return;
          const hit = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (!hit?.target?.id) return;
          const tab = Object.entries(SECTION_TARGETS).find(
            ([, sectionId]) => sectionId === hit.target.id
          )?.[0];
          if (tab) activeTab.value = tab;
        },
        { rootMargin: "-12% 0px -58% 0px", threshold: [0.05, 0.15, 0.35] }
      );
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) sectionObserver.observe(el);
      });
    }

    onMounted(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      await hydrateFromRest();
      await resolveLumiAvatar();
      await loadCopilotIntro();
      await loadTour();
      connectWs();
      briefTimer = setInterval(hydrateFromRest, 15000);
      const tickClock = () => {
        const d = new Date();
        alarmNow.value = d.getTime();
        runSiren(); // no-op while already sounding; (re)starts it when it should be
        clock.value = `${d.toISOString().slice(11, 19)}Z · ${d.toISOString().slice(0, 10)}`;
      };
      tickClock();
      clockTimer = setInterval(tickClock, 1000);
      window.addEventListener("keydown", onGlobalKeydown);
      document.body.classList.add("tcc-ready");
      requestAnimationFrame(() => {
        uiReady.value = true;
        bindSectionObserver();
        nextTick(initGlobe);
        setTimeout(() => {
          openCopilotIntroFlow();
        }, 900);
      });
    });

    onUnmounted(() => {
      globe?.destroy();
      if (ws) ws.close();
      if (briefTimer) clearInterval(briefTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (clockTimer) clearInterval(clockTimer);
      if (typewriterTimer) clearInterval(typewriterTimer);
      if (sectionObserver) sectionObserver.disconnect();
      window.removeEventListener("keydown", onGlobalKeydown);
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
      aiInsights,
      aiCapabilities,
      llmConfigured,
      aiStatusLabel,
      confidencePct,
      executiveQuestion,
      askAnswer,
      askMode,
      askLoading,
      briefRefreshing,
      briefPulse,
      regenerateBrief,
      askExecutive,
      healthRows,
      selectedScenario,
      runningScenario,
      containing,
      isCritical,
      postureAlerts,
      gaugeOffset,
      globeCanvas,
      protectedRegions,
      regionHits,
      mapOrigins,
      mapStats,
      controlNotice,
      alarmActive,
      alarmElapsed,
      alarmAcked,
      alarmSound,
      alarmSoundBlocked,
      alarmSnoozeSecs,
      toggleAlarmSound,
      acknowledgeAlarm,
      pieHover,
      techniqueByAttack,
      setPieHover,
      togglePieHover,
      pieFocus,
      METER_TRACK,
      METER_TICKS,
      meterLit,
      meterNeedle,
      meterDelta,
      meterTrend,
      scenarios,
      kpis,
      attackMix,
      threatLevelPie,
      severityPie,
      severityBars,
      telemetryShare,
      topSourceIps,
      postureDelta,
      executiveRiskKpis,
      landscapeChart,
      sparkPath,
      clock,
      platform,
      envDisplay,
      missionLine,
      narrativeSteps,
      executiveHighlights,
      selectedScenarioPreview,
      displayScore,
      feedHighlightKey,
      feedKey,
      sevClass,
      healthClass,
      attackAbbr,
      runScenario,
      containThreat,
      activeTab,
      dashTabs,
      goTab,
      displayedBrief,
      briefUpdatedAt,
      riskSummary,
      regionDisplay,
      tenantDisplay,
      briefTyping,
      exportBoardSummary,
      showCopilotIntro,
      copilotIntro,
      copilotIntroProblemText,
      introSpeaking,
      introLoading,
      introVoiceHint,
      introAutoplayBlocked,
      architectureDiagramSvg: ARCHITECTURE_DIAGRAM_SVG,
      skipCopilotIntro,
      startDashboardTourFromIntro,
      speakCopilotIntro,
      replayCopilotIntro,
      onVoiceToggle,
      tourSteps,
      tourIndex,
      currentTourStep,
      voiceLoading,
      voiceSpeaking,
      voiceError,
      voiceEnabled,
      openVoiceTour,
      lumiGuideActive,
      tourHighlightId,
      tourAutoPlay,
      endLumiTour,
      pauseLumiTour,
      resumeLumiTour,
      skipLumiTourStep,
      prevLumiTourStep,
      enableGuideVoiceAndContinue,
      stopNarration,
      uiReady,
      copilotOpen,
      copilotInput,
      copilotPrompts,
      toggleCopilot,
      closeCopilot,
      useCopilotPrompt,
      lumiAvatarSrc,
      onLumiAvatarError,
      chartPalette,
    };
  },
  template: `
  <div
    class="app-shell app-shell--prod app-shell--chic"
    :class="{ critical: isCritical, 'is-ready': uiReady, 'app-shell--guide-active': lumiGuideActive }"
  >
    <div
      v-if="showCopilotIntro"
      class="copilot-intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="copilot-intro-title"
    >
      <div class="copilot-intro-card">
        <div class="intro-brandbar">
          <img class="intro-brand-logo" src="/static/assets/palo-alto-networks-logo-light.png" alt="Palo Alto Networks" width="150" height="28" />
          <span class="intro-brand-divider" aria-hidden="true"></span>
          <div class="intro-brand-product">
            <strong>Threat Command Center</strong>
            <span>Unified Telemetry Platform</span>
          </div>
          <div class="intro-brand-chips">
            <span class="intro-chip intro-chip--live"><i aria-hidden="true"></i>Live demo</span>
            <span class="intro-chip">ThreatEvent v1</span>
            <span class="intro-chip">Deterministic scoring + AI</span>
          </div>
        </div>
        <header class="copilot-intro-head">
          <img class="copilot-intro-avatar" :src="lumiAvatarSrc" alt="" width="48" height="48" @error="onLumiAvatarError" />
          <div>
            <p class="copilot-intro-eyebrow">Lumi · AI Copilot</p>
            <h2 id="copilot-intro-title" class="copilot-intro-title">{{ copilotIntro.title }}</h2>
          </div>
        </header>
        <div class="copilot-intro-grid">
          <div class="copilot-intro-copy">
            <h3 class="copilot-intro-h3">The problem</h3>
            <p class="copilot-intro-lead">{{ copilotIntroProblemText() }}</p>
            <h3 class="copilot-intro-h3">How we solve it</h3>
            <ul class="copilot-intro-list">
              <li>Legacy API and live stream adapters emit <strong>ThreatEvent v1</strong></li>
              <li>Bridge normalizes, deduplicates, and scores with explainable rules</li>
              <li>Single WebSocket feed powers posture, analytics, and SOC queue</li>
              <li>Executive brief and playbook use minimized telemetry context</li>
              <li>Containment and campaign inject close the operational loop</li>
            </ul>
            <div
              class="copilot-intro-narration"
              :class="{
                speaking: introSpeaking,
                loading: introLoading,
                blocked: introAutoplayBlocked,
              }"
            >
              <span class="copilot-intro-narration-label">
                {{
                  introSpeaking
                    ? 'Lumi is speaking…'
                    : introLoading
                      ? 'Loading voice…'
                      : introAutoplayBlocked
                        ? 'Click Play overview to start voice'
                        : 'Voice overview ready — Replay overview restarts from the beginning'
                }}
              </span>
            </div>
            <p v-if="introVoiceHint" class="copilot-intro-voice-hint" role="status">{{ introVoiceHint }}</p>
          </div>
          <figure class="copilot-intro-diagram">
            <div
              class="copilot-arch-svg"
              v-html="architectureDiagramSvg"
              aria-label="Architecture: Legacy API and AttackSim through Analytics Bridge to Vue Command Center"
            ></div>
            <figcaption>Reference architecture · ThreatEvent v1</figcaption>
          </figure>
        </div>
        <ul class="intro-stack" aria-label="Technology stack">
          <li><b>ASP.NET 8</b> legacy API</li>
          <li><b>PowerShell 7</b> AttackSim</li>
          <li><b>Python · FastAPI</b> analytics bridge</li>
          <li><b>Vue 3</b> command center</li>
          <li><b>WebSocket</b> live feed</li>
        </ul>
        <div class="copilot-intro-actions">
          <button
            id="copilot-intro-play-overview"
            type="button"
            class="copilot-intro-btn"
            :class="{
              'copilot-intro-btn--primary': introAutoplayBlocked,
              'copilot-intro-btn--voice-spotlight': introAutoplayBlocked && !introSpeaking && !introLoading,
            }"
            @click="replayCopilotIntro()"
          >
            {{ introAutoplayBlocked ? 'Play overview' : 'Replay overview' }}
          </button>
          <button
            type="button"
            class="copilot-intro-btn"
            :class="{ 'copilot-intro-btn--primary': !introAutoplayBlocked }"
            @click="startDashboardTourFromIntro"
          >
            {{ introAutoplayBlocked ? 'Start walkthrough' : 'Start feature walkthrough' }}
          </button>
          <button type="button" class="copilot-intro-btn ghost" @click="skipCopilotIntro">Skip to dashboard</button>
        </div>
        <label class="copilot-intro-voice">
          <input type="checkbox" v-model="voiceEnabled" @change="onVoiceToggle" />
          Voice narration (continues into product walkthrough when overview finishes)
        </label>
      </div>
    </div>
    <header class="app-header" id="app-header" role="banner" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'app-header' }">
      <div class="app-header-inner">
        <a
          class="pan-logo-shelf mobile-header-logo"
          href="/"
          aria-label="palo alto networks"
          nav-track="true"
          nav-track-breadcrumb="nav:logo"
        ></a>
        <div class="pan-topbar-center">
          <span class="pan-product-eyebrow">{{ platform.edition || 'Unified Telemetry Platform' }}</span>
          <h2 class="pan-product-title">{{ platform.product }}</h2>
          <p class="pan-product-sub">Tenant {{ tenantDisplay }} · Region {{ regionDisplay }} · ThreatEvent schema v1</p>
        </div>
        <div class="pan-topbar-meta">
          <span class="pan-status-chip pan-ai-badge" :class="{ live: llmConfigured && briefMode === 'llm' }">{{ aiStatusLabel }}</span>
          <span class="pan-status-chip pan-status-chip--live">Live ingest</span>
          <span class="pan-status-chip">{{ envDisplay }} · v{{ platform.version }}</span>
        </div>
      </div>
    </header>

    <div class="app-dashboard" role="main">
      <div class="dashboard-fx" aria-hidden="true">
        <div class="grid-bg"></div>
        <div class="scanline"></div>
        <div class="fx-sweep"></div>
        <div class="fx-noise"></div>
        <div class="vignette"></div>
      </div>

      <div class="dashboard-container">
      <div class="platform-value-strip" id="platform-capabilities" role="list" aria-label="Platform capabilities" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'platform-capabilities' }">
        <span role="listitem">Unified ingest</span>
        <span role="listitem">Deterministic scoring</span>
        <span role="listitem">AI-driven SecOps brief</span>
        <span role="listitem">Real-time response</span>
      </div>
      <div class="dashboard-toolbar dashboard-toolbar--prod" id="dashboard-toolbar" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'dashboard-toolbar' }">
        <div class="dashboard-toolbar-title">
          <span class="pan-product-eyebrow pan-product-eyebrow--toolbar">Operations overview</span>
          <p class="dashboard-page-sub dashboard-page-sub--lead">
            Landscape posture, telemetry queue, and executive intelligence — one console for leadership and SOC.
          </p>
        </div>
        <div class="dashboard-toolbar-actions">
          <button type="button" class="ghost-btn ghost-btn--prod" @click="regenerateBrief">Refresh brief</button>
          <button type="button" id="export-summary-btn" class="ghost-btn ghost-btn--prod" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'export-summary-btn' }" @click="exportBoardSummary">Export summary</button>
          <button type="button" class="ghost-btn ghost-btn--quiet ghost-btn--copilot-guide" @click="openVoiceTour">AI Copilot guide</button>
        </div>
        <div class="dashboard-toolbar-status" id="dashboard-toolbar-status" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'dashboard-toolbar-status' }">
          <span class="pill" :class="connected ? 'live' : 'warn'">
            <span class="pill-dot"></span>
            {{ connected ? 'Stream connected' : (reconnecting ? 'Reconnecting' : 'Offline') }}
          </span>
          <span class="pill" :class="isCritical ? 'critical' : ''">
            <span class="pill-dot"></span>
            Posture {{ globalLevel }}
          </span>
          <span class="pill" :class="containmentStatus === 'CONTAINED' ? 'contained' : ''">
            <span class="pill-dot"></span>
            Response {{ containmentStatus }}
          </span>
          <span class="pill ops-clock"><span class="pill-dot"></span> {{ clock }}</span>
        </div>
      </div>

      <div class="section-jump-sticky">
      <nav class="section-jump" id="section-jump-nav" aria-label="Jump to section" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-jump-nav' }">
        <button
          v-for="t in dashTabs"
          :key="t.id"
          type="button"
          class="section-jump-btn"
          :class="{
            active: activeTab === t.id,
            'section-jump-btn--alert': t.id === 'executive' && isCritical,
          }"
          @click="goTab(t.id)"
        >
          {{ t.label }}<kbd>{{ t.shortcut }}</kbd>
        </button>
      </nav>
      </div>

      <div class="unified-dashboard">
      <transition name="alarm-strip">
        <div v-if="alarmActive" class="alarm-strip" :class="{ 'alarm-strip--acked': alarmAcked }" role="alert" aria-live="assertive">
          <span class="alarm-shield" aria-hidden="true">
            <span class="alarm-ping"></span>
            <span class="alarm-ping alarm-ping--late"></span>
            <svg viewBox="0 0 48 48">
              <defs>
                <linearGradient id="alarmShieldFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#ff6a5c" />
                  <stop offset="100%" stop-color="#c81e1e" />
                </linearGradient>
              </defs>
              <path class="alarm-shield-body" d="M24 3.5 L40.5 9.5 V22.5 C40.5 33.2 33.6 41.2 24 44.5 C14.4 41.2 7.5 33.2 7.5 22.5 V9.5 Z" fill="url(#alarmShieldFill)" />
              <path d="M24 3.5 L40.5 9.5 V22.5 C40.5 33.2 33.6 41.2 24 44.5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.2" />
              <rect x="21.6" y="13" width="4.8" height="15" rx="2.4" fill="#fff" />
              <circle cx="24" cy="34" r="2.7" fill="#fff" />
            </svg>
          </span>
          <div class="alarm-copy">
            <strong>Threat landscape in CRITICAL zone</strong>
            <span>Initiate containment to stop the active campaign.</span>
            <span v-if="alarmSound && alarmSoundBlocked" class="alarm-hint">🔈 Click anywhere to enable the siren</span>
          </div>
          <span class="alarm-timer tabular" :title="'Critical for ' + alarmElapsed">{{ alarmElapsed }}<small>in critical</small></span>
          <button type="button" class="alarm-btn alarm-btn--contain" @click="containThreat">Initiate containment</button>
          <button
            type="button"
            class="alarm-btn alarm-btn--icon"
            :class="{ 'is-on': alarmSound }"
            :aria-pressed="alarmSound"
            :title="alarmSound ? 'Siren on: click to mute' : 'Siren muted: click to turn on'"
            @click="toggleAlarmSound"
          >{{ alarmSound ? '🔔' : '🔕' }}</button>
          <button v-if="!alarmAcked" type="button" class="alarm-btn alarm-btn--ghost" @click="acknowledgeAlarm">Acknowledge</button>
          <span v-else class="alarm-snooze tabular" role="status">Snoozed · buzzing again in {{ alarmSnoozeSecs }} s</span>
        </div>
      </transition>
      <section class="command-deck command-deck--unified" id="command-deck" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'command-deck', 'command-deck--alarm': alarmActive }">
        <div class="command-deck-main">
          <p class="command-eyebrow">Global posture</p>
          <h2 class="command-headline">{{ riskSummary }}</h2>
          <p class="command-subline">{{ missionLine }}</p>
          <ol class="narrative-stepper narrative-stepper--deck">
            <li
              v-for="step in narrativeSteps"
              :key="step.id"
              class="narrative-step"
              :class="{ done: step.done, active: step.active && !step.done }"
            >
              <span class="narrative-step-label">{{ step.label }}</span>
              <span class="narrative-step-detail">{{ step.detail }}</span>
            </li>
          </ol>
          <div class="command-kpis">
            <div class="command-kpi"><span>Queue depth</span><strong class="tabular">{{ kpis.total }}</strong></div>
            <div class="command-kpi command-kpi--risk"><span>Priority</span><strong class="tabular">{{ kpis.critical }}</strong></div>
            <div class="command-kpi"><span>Mean risk</span><strong class="tabular">{{ kpis.avgRisk }}</strong></div>
            <div class="command-kpi"><span>Ingest</span><strong class="tabular">{{ kpis.legacy }} API · {{ kpis.live }} stream</strong></div>
          </div>
          <div class="command-cta-row" id="command-cta-row" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'command-cta-row' }">
            <button
              id="contain-primary-btn"
              type="button"
              class="cta cta--contain"
              :class="{ 'tcc-tour-spotlight': tourHighlightId === 'contain-primary-btn', 'cta--alarm': alarmActive }"
              :disabled="contained || containing"
              @click="containThreat"
            >
              {{ contained ? 'Contained' : (containing ? 'Executing…' : 'Initiate containment') }}
            </button>
            <button type="button" class="cta cta--ai" @click="toggleCopilot">Ask Lumi</button>
          </div>
        </div>

        <div
          id="threat-meter"
          class="command-deck-gauge panel gauge-panel gauge-panel--hero threat-meter"
          :class="['threat-meter--' + globalLevel.toLowerCase(), { 'gauge-panel--hot': isCritical, 'threat-meter--alarm': alarmActive, 'tcc-tour-spotlight': tourHighlightId === 'threat-meter' }]"
        >
          <div class="threat-meter-head">
            <span class="threat-meter-title">Threat landscape</span>
            <span class="threat-meter-live"><i aria-hidden="true"></i>Live</span>
          </div>
          <div class="threat-meter-dial" :class="{ 'gauge-wrap--pulse': isCritical }">
            <svg
              viewBox="0 0 240 132"
              class="threat-meter-svg"
              role="img"
              :aria-label="'Threat landscape ' + Math.round(displayScore) + ' of 100, ' + globalLevel"
            >
              <path v-for="z in METER_TRACK" :key="'t-' + z.level" :d="z.d" class="tm-track" :class="'tm-zone--' + z.level.toLowerCase()" />
              <path v-for="z in meterLit" :key="'l-' + z.level" :d="z.d" class="tm-lit" :class="'tm-zone--' + z.level.toLowerCase()" />
              <g v-for="t in METER_TICKS" :key="'k-' + t.v">
                <line :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" class="tm-tick" />
                <text :x="t.lx" :y="t.ly" class="tm-tick-label" text-anchor="middle" dominant-baseline="middle">{{ t.v }}</text>
              </g>
              <text x="28" y="130" class="tm-end-label" text-anchor="middle">0</text>
              <text x="212" y="130" class="tm-end-label" text-anchor="middle">100</text>
              <line :x1="meterNeedle.xi" :y1="meterNeedle.yi" :x2="meterNeedle.x" :y2="meterNeedle.y" class="tm-needle" />
              <circle :cx="meterNeedle.x" :cy="meterNeedle.y" r="6.5" class="tm-marker" />
            </svg>
            <div class="threat-meter-readout">
              <span class="tm-score tabular">{{ Math.round(displayScore) }}<small>/100</small></span>
              <span class="tm-level">{{ globalLevel }}</span>
            </div>
          </div>
          <div class="threat-meter-foot">
            <span
              class="tm-delta"
              :class="meterDelta == null ? '' : meterDelta > 0 ? 'tm-delta--up' : meterDelta < 0 ? 'tm-delta--down' : 'tm-delta--flat'"
            >
              <template v-if="meterDelta == null">Collecting trend…</template>
              <template v-else-if="meterDelta === 0">Steady vs 1 min ago</template>
              <template v-else>{{ meterDelta > 0 ? '▲ +' : '▼ ' }}{{ Math.abs(meterDelta) }} vs 1 min ago</template>
            </span>
            <div class="tm-trend">
              <svg viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
                <line v-if="meterTrend" x1="0" x2="240" :y1="meterTrend.critY" :y2="meterTrend.critY" class="tm-trend-crit" />
                <path v-if="meterTrend" :d="meterTrend.area" class="tm-trend-area" />
                <path v-if="meterTrend" :d="meterTrend.line" class="tm-trend-line" />
              </svg>
              <div class="tm-trend-labels"><span>{{ meterTrend ? meterTrend.label : 'Trend' }}</span><span class="tm-trend-crit-label">Critical ≥ 78</span></div>
            </div>
          </div>
        </div>
      </section>

      <div
        id="posture-alerts"
        class="posture-alerts-anchor"
        :class="{ 'tcc-tour-spotlight': tourHighlightId === 'posture-alerts' }"
      >
        <div
          v-if="postureAlerts.length"
          class="ops-status-banner"
          role="status"
          aria-label="Posture alerts"
        >
          <button
            v-for="(alert, idx) in postureAlerts"
            :key="'alert-' + idx"
            type="button"
            :class="'ops-alert-chip ' + alert.type"
            @click="alert.section && goTab(alert.section)"
          >
            <strong v-if="alert.count">{{ alert.count }}</strong>
            {{ alert.text }}
          </button>
        </div>
        <p v-else-if="lumiGuideActive && tourHighlightId === 'posture-alerts'" class="posture-alerts-empty">
          No active posture alerts — landscape is within tolerance for this session.
        </p>
      </div>

      <section class="panel attack-map" id="section-map" aria-label="Global attack map" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-map' }">
        <div class="attack-map-head">
          <div>
            <span class="panel-eyebrow">Threat intelligence</span>
            <h2>Global attack map</h2>
            <p class="attack-map-sub">
              Live arcs from attack origins to the region of the asset each event targeted:
              <template v-for="(r, i) in protectedRegions" :key="r.region"><strong>{{ r.city }}</strong><span v-if="i < protectedRegions.length - 1"> and </span></template>.
              Drag the globe to rotate.
            </p>
          </div>
          <ul class="attack-map-legend" aria-label="Arc colour by threat level">
            <li><i class="lvl-low"></i>Low</li>
            <li><i class="lvl-elevated"></i>Elevated</li>
            <li><i class="lvl-high"></i>High</li>
            <li><i class="lvl-critical"></i>Critical</li>
          </ul>
        </div>
        <div class="attack-map-body">
          <div class="attack-map-stage">
            <canvas ref="globeCanvas" class="attack-globe" role="img" aria-label="3D globe with live attack arcs from origins to the protected region"></canvas>
            <span v-if="contained" class="attack-map-badge">Contained · arcs halted</span>
          </div>
          <aside class="attack-map-side">
            <div class="attack-map-stats">
              <div><strong class="tabular">{{ mapStats.origins }}</strong><span>Attack origins</span></div>
              <div><strong class="tabular">{{ mapStats.countries }}</strong><span>Countries</span></div>
              <div><strong class="tabular">{{ mapStats.internal }}</strong><span>Internal events</span></div>
            </div>
            <h3 class="attack-map-h3">Protected regions</h3>
            <ul class="attack-map-regions">
              <li v-for="r in regionHits" :key="r.region">
                <span class="attack-map-region-dot" :class="{ 'is-primary': r.primary }"></span>
                <div>
                  <strong>{{ r.city }}</strong>
                  <em>{{ (r.assets || []).join(' · ') || 'primary region' }}</em>
                </div>
                <span class="tabular" :title="r.ext + ' external · ' + r.internal + ' internal events targeting this region'">{{ r.ext + r.internal }}</span>
              </li>
            </ul>
            <h3 class="attack-map-h3">Top origins</h3>
            <ol class="attack-map-origins">
              <li v-for="o in mapOrigins" :key="o.city + o.country">
                <div class="attack-map-origin-row">
                  <span>
                    {{ o.city }} <em>{{ o.country }}</em>
                    <span
                      v-if="o.technique"
                      class="mitre-chip mitre-chip--inline"
                      :title="'Most frequent: MITRE ATT&CK ' + o.technique.id + ' · ' + o.technique.name + ' · ' + o.technique.tactic"
                    >{{ o.technique.id }}</span>
                  </span>
                  <span class="tabular">{{ o.count }}</span>
                </div>
                <div class="attack-map-bar"><span :style="{ width: o.pct + '%' }"></span></div>
              </li>
              <li v-if="!mapOrigins.length" class="attack-map-empty">Waiting for external traffic…</li>
            </ol>
            <p class="attack-map-note">
              Geo positions are illustrative: the challenge's telemetry uses simulated addresses, so origins are placed
              by address range. Production would resolve them with a geo-IP service behind the same enrichment stage.
            </p>
          </aside>
        </div>
      </section>

      <section class="unified-analytics panel" id="section-analytics" aria-label="Threat analytics" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-analytics' }">
        <div class="panel-head panel-head--compact">
          <div>
            <span class="panel-eyebrow">Analytics</span>
            <h2>Exposure &amp; composition</h2>
          </div>
          <span class="chip" :class="'chip-trend--' + postureDelta.dir">{{ postureDelta.label }}</span>
        </div>
        <div class="ops-section-band">
          <p class="ops-section-band__desc">
            Executive-readable composition — KPI strip, accent chart panels, and legends sized for 100% browser zoom.
          </p>
        </div>
        <div class="exec-risk-kpis exec-risk-kpis--inline">
          <div
            v-for="k in executiveRiskKpis"
            :key="k.label"
            class="exec-risk-kpi"
            :class="k.tone ? 'exec-risk-kpi--' + k.tone : ''"
          >
            <span class="exec-risk-kpi-label">{{ k.label }}</span>
            <strong class="exec-risk-kpi-value">{{ k.value }}</strong>
            <small v-if="k.hint" class="exec-risk-kpi-hint">{{ k.hint }}</small>
          </div>
        </div>
        <div class="unified-analytics-grid">
          <div class="viz-tile viz-tile--trend viz-tile--accent-orange">
            <h3 class="chart-title">Landscape trend</h3>
            <p class="viz-sub">Session trajectory · unified 0–100 score</p>
            <div class="trend-chart-wrap trend-chart-wrap--hero">
              <svg class="trend-chart trend-chart--hero" :viewBox="'0 0 ' + landscapeChart.w + ' ' + landscapeChart.h" preserveAspectRatio="none">
                <line
                  v-for="g in landscapeChart.grid"
                  :key="g.label"
                  :x1="0"
                  :y1="g.y"
                  :x2="landscapeChart.w"
                  :y2="g.y"
                  class="trend-grid"
                />
                <path v-if="landscapeChart.area" class="trend-area" :d="landscapeChart.area" />
                <path v-if="landscapeChart.line" class="trend-line" :d="landscapeChart.line" />
              </svg>
              <div class="trend-y-labels">
                <span v-for="g in landscapeChart.grid.slice().reverse()" :key="'y'+g.label">{{ g.label }}</span>
              </div>
            </div>
            <p v-if="landscapeChart.empty" class="viz-empty">Trend populates as live scores arrive…</p>
            <p v-else class="viz-foot tabular">Current {{ landscapeChart.last }}/100 · {{ globalLevel }}</p>
          </div>

          <div class="viz-tile viz-tile--accent-red">
            <h3 class="chart-title">Threat level</h3>
            <p class="viz-sub">Scored level mix</p>
            <div class="pie-block pie-block--tile pie-block--interactive" @mouseleave="setPieHover('level', null)">
              <svg viewBox="0 0 100 100" class="pie-svg pie-svg--tile" role="img" aria-label="Threat level distribution">
                <circle v-if="!threatLevelPie.slices.length" cx="50" cy="50" r="40" class="pie-empty-ring" />
                <path
                  v-for="s in threatLevelPie.slices"
                  :key="s.label"
                  :d="s.path"
                  :fill="s.color"
                  class="pie-slice"
                  :class="{ 'is-active': pieFocus('level', threatLevelPie)?.label === s.label, 'is-dim': pieFocus('level', threatLevelPie) && pieFocus('level', threatLevelPie).label !== s.label }"
                  :style="pieFocus('level', threatLevelPie)?.label === s.label ? { transform: 'translate(' + s.dx + 'px, ' + s.dy + 'px)' } : null"
                  tabindex="0"
                  @mouseenter="setPieHover('level', s.label)"
                  @focus="setPieHover('level', s.label)"
                  @blur="setPieHover('level', null)"
                  @click="togglePieHover('level', s.label)"
                ><title>{{ s.label }}: {{ s.value }} events ({{ s.pct }}%)</title></path>
                <circle cx="50" cy="50" r="26" class="pie-hole" />
                <template v-if="pieFocus('level', threatLevelPie)">
                  <text x="50" y="50" text-anchor="middle" class="pie-center-num" :style="{ fill: pieFocus('level', threatLevelPie).color }">{{ pieFocus('level', threatLevelPie).pct }}%</text>
                  <text x="50" y="60" text-anchor="middle" class="pie-center-lbl">{{ pieFocus('level', threatLevelPie).value }} {{ pieFocus('level', threatLevelPie).value === 1 ? 'event' : 'events' }}</text>
                </template>
                <template v-else>
                  <text x="50" y="50" text-anchor="middle" class="pie-center-num">{{ threatLevelPie.total }}</text>
                  <text x="50" y="60" text-anchor="middle" class="pie-center-lbl">events</text>
                </template>
              </svg>
              <ul class="legend legend--exec">
                <li
                  v-for="s in threatLevelPie.slices"
                  :key="'tl-'+s.label"
                  :class="{ 'is-active': pieFocus('level', threatLevelPie)?.label === s.label, 'is-dim': pieFocus('level', threatLevelPie) && pieFocus('level', threatLevelPie).label !== s.label }"
                  @mouseenter="setPieHover('level', s.label)"
                  @click="togglePieHover('level', s.label)"
                >
                  <span class="legend-swatch" :style="{ background: s.color }"></span>
                  <span>{{ s.label }}</span>
                  <span class="tabular">{{ s.pct }}%</span>
                </li>
              </ul>
            </div>
            <p class="pie-caption" :class="{ 'pie-caption--active': pieFocus('level', threatLevelPie) }">
              <template v-if="pieFocus('level', threatLevelPie)">
                <span class="pie-caption-swatch" :style="{ background: pieFocus('level', threatLevelPie).color }"></span>
                <strong>{{ pieFocus('level', threatLevelPie).label }}</strong> · {{ pieFocus('level', threatLevelPie).value }} of {{ threatLevelPie.total }} events · {{ pieFocus('level', threatLevelPie).pct }}%
              </template>
              <template v-else>Hover a slice to break down the queue</template>
            </p>
          </div>

          <div class="viz-tile viz-tile--accent-cyan">
            <h3 class="chart-title">Attack vectors</h3>
            <p class="viz-sub">Technique composition</p>
            <div class="pie-block pie-block--tile pie-block--interactive" @mouseleave="setPieHover('attack', null)">
              <svg viewBox="0 0 100 100" class="pie-svg pie-svg--tile" role="img" aria-label="Attack vector distribution">
                <circle v-if="!attackMix.slices.length" cx="50" cy="50" r="40" class="pie-empty-ring" />
                <path
                  v-for="s in attackMix.slices"
                  :key="s.label"
                  :d="s.path"
                  :fill="s.color"
                  class="pie-slice"
                  :class="{ 'is-active': pieFocus('attack', attackMix)?.label === s.label, 'is-dim': pieFocus('attack', attackMix) && pieFocus('attack', attackMix).label !== s.label }"
                  :style="pieFocus('attack', attackMix)?.label === s.label ? { transform: 'translate(' + s.dx + 'px, ' + s.dy + 'px)' } : null"
                  tabindex="0"
                  @mouseenter="setPieHover('attack', s.label)"
                  @focus="setPieHover('attack', s.label)"
                  @blur="setPieHover('attack', null)"
                  @click="togglePieHover('attack', s.label)"
                ><title>{{ s.label }}: {{ s.value }} events ({{ s.pct }}%)</title></path>
                <circle cx="50" cy="50" r="26" class="pie-hole" />
                <template v-if="pieFocus('attack', attackMix)">
                  <text x="50" y="50" text-anchor="middle" class="pie-center-num" :style="{ fill: pieFocus('attack', attackMix).color }">{{ pieFocus('attack', attackMix).pct }}%</text>
                  <text x="50" y="60" text-anchor="middle" class="pie-center-lbl">{{ pieFocus('attack', attackMix).value }} {{ pieFocus('attack', attackMix).value === 1 ? 'event' : 'events' }}</text>
                </template>
                <template v-else>
                  <text x="50" y="50" text-anchor="middle" class="pie-center-num">{{ attackMix.slices[0]?.pct || 0 }}%</text>
                  <text x="50" y="60" text-anchor="middle" class="pie-center-lbl">top vector</text>
                </template>
              </svg>
              <ul class="legend legend--exec">
                <li
                  v-for="s in attackMix.slices"
                  :key="'atk-'+s.label"
                  :class="{ 'is-active': pieFocus('attack', attackMix)?.label === s.label, 'is-dim': pieFocus('attack', attackMix) && pieFocus('attack', attackMix).label !== s.label }"
                  @mouseenter="setPieHover('attack', s.label)"
                  @click="togglePieHover('attack', s.label)"
                >
                  <span class="legend-swatch" :style="{ background: s.color }"></span>
                  <span>{{ s.label }}</span>
                  <span class="tabular">{{ s.pct }}%</span>
                </li>
              </ul>
            </div>
            <p class="pie-caption" :class="{ 'pie-caption--active': pieFocus('attack', attackMix) }">
              <template v-if="pieFocus('attack', attackMix)">
                <span class="pie-caption-swatch" :style="{ background: pieFocus('attack', attackMix).color }"></span>
                <strong>{{ pieFocus('attack', attackMix).label }}</strong><span v-if="techniqueByAttack[pieFocus('attack', attackMix).label]" class="mitre-chip mitre-chip--inline">{{ techniqueByAttack[pieFocus('attack', attackMix).label].id }}</span> · {{ pieFocus('attack', attackMix).value }} of {{ attackMix.total }} events · {{ pieFocus('attack', attackMix).pct }}%
              </template>
              <template v-else>Hover a slice to see each technique</template>
            </p>
          </div>

          <div class="viz-tile viz-tile--stack viz-tile--accent-amber">
            <h3 class="chart-title">Severity &amp; ingest</h3>
            <div class="stacked-bar stacked-bar--tile" role="img" aria-label="Severity distribution">
              <div v-for="bar in severityBars" :key="bar.label" class="stacked-seg" :style="{ width: bar.pct + '%', background: bar.color }"></div>
            </div>
            <ul class="stacked-legend stacked-legend--compact">
              <li v-for="bar in severityBars" :key="'sev-'+bar.label">
                <span class="legend-swatch" :style="{ background: bar.color }"></span>
                {{ bar.label }} {{ Math.round(bar.pct) }}%
              </li>
            </ul>
            <div class="stacked-bar stacked-bar--sources stacked-bar--tile">
              <div class="stacked-seg" :style="{ width: telemetryShare.legacyPct + '%', background: chartPalette.ingestApi }"></div>
              <div class="stacked-seg" :style="{ width: telemetryShare.livePct + '%', background: chartPalette.ingestStream }"></div>
            </div>
            <p class="viz-sub viz-sub--tight">API {{ telemetryShare.legacyPct }}% · Stream {{ telemetryShare.livePct }}%</p>
          </div>

          <div class="viz-tile viz-tile--actors viz-tile--accent-green">
            <h3 class="chart-title">Top actors</h3>
            <p class="viz-sub">Source IP concentration</p>
            <div v-for="row in topSourceIps" :key="row.label" class="hbar-row">
              <span class="hbar-label tabular">{{ row.label }}</span>
              <div class="hbar-track">
                <div class="hbar-fill" :style="{ width: row.pct + '%' }"></div>
              </div>
              <span class="hbar-val tabular">{{ row.value }}</span>
            </div>
            <p v-if="!topSourceIps.length" class="viz-empty">No actors in queue.</p>
          </div>
        </div>
      </section>

      <div class="unified-main">
        <section class="panel panel-feed unified-col" id="section-live" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-live' }">
            <div class="panel-head">
              <div>
                <span class="panel-eyebrow">Telemetry</span>
                <h2>Live threat queue</h2>
              </div>
              <span class="chip">{{ feed.length }} events</span>
            </div>
            <div class="ops-section-band">
              <p class="ops-section-band__desc">
                The live queue scrolls independently; landscape, response state, and platform health sit in the panel below.
              </p>
            </div>
            <div class="telemetry-queue-stack">
              <div class="feed-scroll">
                <ul class="feed-list feed-list--unified">
                  <li
                    v-for="(row, idx) in feed"
                    :key="feedKey(row, idx)"
                    class="feed-item"
                    :class="{
                      pulse: (row.event?.raw_severity || 0) >= 8,
                      'feed-item--new': feedHighlightKey === feedKey(row, idx),
                    }"
                  >
                    <div class="feed-icon" :class="sevClass(row.event?.raw_severity || 1)">
                      {{ attackAbbr(row.event?.attack_type) }}
                    </div>
                    <div>
                      <div class="feed-type">
                        {{ row.event?.attack_type || 'Unknown' }}
                        <a
                          v-if="row.event?.technique"
                          class="mitre-chip"
                          :href="row.event.technique.url"
                          target="_blank"
                          rel="noopener"
                          :title="'MITRE ATT&CK ' + row.event.technique.id + ' · ' + row.event.technique.name + ' · ' + row.event.technique.tactic"
                          @click.stop
                        >{{ row.event.technique.id }}</a>
                      </div>
                      <div class="feed-meta">
                        <span>{{ row.event?.source_ip }}</span>
                        <span>{{ row.event?.source }}</span>
                        <span>Risk {{ row.risk_score }}</span>
                      </div>
                    </div>
                    <span class="sev-badge" :class="sevClass(row.event?.raw_severity || 1)">
                      SEV {{ row.event?.raw_severity || '?' }}
                    </span>
                  </li>
                </ul>
                <p v-if="!feed.length" class="feed-empty">Awaiting normalized events from enterprise API and live stream…</p>
              </div>
              <p class="telemetry-queue-divider" role="presentation">
                <span>Posture snapshot &amp; platform health</span>
              </p>
              <div class="telemetry-queue-foot" id="telemetry-health" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'telemetry-health' }">
                <div class="exec-highlights exec-highlights--compact">
                  <div v-for="h in executiveHighlights" :key="h.label" class="exec-highlight" :class="'exec-highlight--' + h.tone">
                    <span class="exec-highlight-label">{{ h.label }}</span>
                    <strong class="exec-highlight-value">{{ h.value }}</strong>
                  </div>
                </div>
                <div class="health-grid health-grid--compact">
                  <div v-for="row in healthRows" :key="row.label" class="health-row">
                    <div class="health-left">
                      <span class="status-dot" :class="healthClass(row.status)"></span>
                      {{ row.label }}
                    </div>
                    <div class="health-right">
                      <strong>{{ row.status }}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
        </section>

        <div class="unified-col unified-col--intel" id="section-intelligence" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-intelligence' }">
          <section v-if="aiCapabilities.length" class="ai-capability-strip ai-capability-strip--compact">
            <span v-for="cap in aiCapabilities" :key="cap" class="ai-cap-chip">{{ cap }}</span>
          </section>
          <section class="panel panel-brief" id="panel-brief" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'panel-brief' }">
            <div class="panel-head">
              <div>
                <span class="panel-eyebrow">Intelligence</span>
                <h2>Executive brief</h2>
              </div>
              <span class="chip">{{ briefMode === 'llm' ? 'AI enriched' : 'Deterministic narrative' }} · {{ globalLevel }}</span>
            </div>
            <div class="brief-terminal brief-terminal--unified" :class="{ 'brief-terminal--pulse': briefPulse }">
              <div class="brief-terminal-head">
                <span class="term-dot r"></span>
                <span class="term-dot y"></span>
                <span class="term-dot g"></span>
                <span>Telemetry → leadership narrative</span>
                <button type="button" class="brief-regen" :disabled="briefRefreshing" @click="regenerateBrief">
                  {{ briefRefreshing ? 'Refreshing…' : 'Refresh' }}
                </button>
              </div>
              <p class="brief-body brief-body--prod">
                {{ displayedBrief || 'Synthesizing executive narrative from normalized telemetry…' }}<span v-if="briefTyping" class="brief-cursor" aria-hidden="true"></span>
              </p>
              <div class="brief-actions">
                <span class="brief-tag">Minimized context</span>
                <span class="brief-tag">12-event window</span>
                <span class="brief-tag">{{ briefMode === 'llm' ? 'LLM enriched' : 'Deterministic narrative' }}</span>
                <span class="brief-tag">Confidence {{ confidencePct }}%</span>
                <span v-if="briefUpdatedAt" class="brief-tag">Updated {{ briefUpdatedAt }}</span>
              </div>
            </div>
          </section>

        <div class="intel-side">
          <section class="panel panel-ai" id="panel-playbook" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'panel-playbook' }">
            <div class="panel-head">
              <div>
                <span class="panel-eyebrow">AI copilot</span>
                <h2>Recommendations & playbook</h2>
              </div>
              <span class="chip chip-ai">{{ aiInsights.playbook_name }}</span>
            </div>
            <p class="ai-playbook-rationale">{{ aiInsights.playbook_rationale }}</p>
            <ul class="ai-rec-list">
              <li v-for="(rec, i) in aiInsights.recommendations" :key="i">{{ rec }}</li>
            </ul>
            <div class="ai-focal">
              <span class="ai-focal-label">Focal event analysis</span>
              <p>{{ aiInsights.focal_insight || 'Awaiting scored events…' }}</p>
            </div>
            <p class="lumi-hint">
              Executive Q&amp;A lives in <strong>Lumi</strong> — use the assistant icon at the bottom-right.
            </p>
          </section>
        </div>
        </div>

        <aside class="unified-col unified-col--side" id="section-scenario" :class="{ 'tcc-tour-spotlight': tourHighlightId === 'section-scenario' }">
          <section
            class="panel panel-scenario"
            id="panel-campaign-injection"
            :class="{ 'tcc-tour-spotlight': tourHighlightId === 'panel-campaign-injection' }"
          >
            <div class="panel-head">
              <div>
                <span class="panel-eyebrow">Response</span>
                <h2>Campaign injection</h2>
              </div>
            </div>
            <p class="scenario-preview">{{ selectedScenarioPreview }}</p>
            <div class="scenario-grid scenario-grid--stack">
              <label
                v-for="opt in scenarios"
                :key="opt.id"
                class="scenario-opt"
                :class="{ active: selectedScenario === opt.id }"
              >
                <input type="radio" v-model="selectedScenario" :value="opt.id" />
                <div>
                  <strong>{{ opt.label }}</strong>
                  <small>{{ opt.desc }}</small>
                </div>
              </label>
            </div>
            <button class="run-btn run-btn--compact" :disabled="runningScenario" @click="runScenario">
              {{ runningScenario ? 'Injecting…' : 'Inject campaign' }}
            </button>
          </section>
        </aside>
      </div>
      </div>

      <footer class="prod-footer">
        <p class="footer-note footer-note--prod">
          {{ platform.product }} · Tenant {{ tenantDisplay }} · {{ regionDisplay }} · {{ envDisplay }} · v{{ platform.version }}
        </p>
        <p class="footer-note footer-note--brand">
          <a href="https://www.paloaltonetworks.in/" target="_blank" rel="noopener noreferrer">Palo Alto Networks</a>
          · Platformization for AI-ready security operations
        </p>
      </footer>
      </div>
    </div>

    <div
      v-if="lumiGuideActive && uiReady"
      class="copilot-page-guide"
      role="dialog"
      aria-labelledby="tcc-copilot-guide-title"
      aria-live="polite"
    >
      <div class="copilot-guide-bar copilot-guide-bar--lumi">
        <div class="copilot-guide-bar-top">
          <span class="copilot-guide-step-label">
            <img class="copilot-guide-avatar-mini" :src="lumiAvatarSrc" alt="" width="22" height="22" @error="onLumiAvatarError" />
            AI Copilot · Step {{ tourIndex + 1 }} of {{ tourSteps.length }}
          </span>
          <div class="copilot-guide-dots" aria-hidden="true">
            <span
              v-for="(s, idx) in tourSteps"
              :key="'guide-dot-' + s.id"
              class="copilot-guide-dot"
              :class="{ 'is-active': idx === tourIndex, 'is-done': idx < tourIndex }"
            ></span>
          </div>
          <button type="button" class="copilot-guide-close" aria-label="Exit AI Copilot guide" @click="endLumiTour">×</button>
        </div>
        <h6 id="tcc-copilot-guide-title" class="copilot-guide-title">{{ currentTourStep?.title || 'Guide' }}</h6>
        <p class="copilot-guide-message">{{ currentTourStep?.text }}</p>
        <p v-if="voiceError" class="copilot-guide-voice-error">{{ voiceError }}</p>
        <div class="copilot-guide-bar-actions">
          <button type="button" class="copilot-guide-btn copilot-guide-btn-secondary" :disabled="tourIndex === 0" @click="prevLumiTourStep">Back</button>
          <button
            v-if="voiceError && /blocked|Enable voice/i.test(voiceError)"
            type="button"
            class="copilot-guide-btn copilot-guide-btn-read is-active"
            @click="enableGuideVoiceAndContinue"
          >
            Enable voice
          </button>
          <button
            v-else-if="voiceSpeaking || voiceLoading"
            type="button"
            class="copilot-guide-btn copilot-guide-btn-read is-active"
            @click="pauseLumiTour"
          >
            {{ voiceLoading ? '…' : 'Pause' }}
          </button>
          <button
            v-else
            type="button"
            class="copilot-guide-btn copilot-guide-btn-read"
            @click="resumeLumiTour"
          >
            Read aloud
          </button>
          <button type="button" class="copilot-guide-btn copilot-guide-btn-primary" @click="skipLumiTourStep">
            {{ tourIndex >= tourSteps.length - 1 ? 'Finish' : 'Next highlight' }}
          </button>
        </div>
        <label class="copilot-guide-voice-toggle">
          <input type="checkbox" v-model="voiceEnabled" @change="onVoiceToggle" />
          Auto-advance with voice narration
        </label>
      </div>
    </div>

    <template v-if="uiReady">
      <div
        v-if="copilotOpen"
        class="copilot-backdrop"
        aria-hidden="true"
        @click="closeCopilot"
      ></div>
      <aside
        v-show="copilotOpen"
        id="copilot-panel"
        class="copilot-panel copilot-panel--open"
        :class="{ 'tcc-tour-spotlight': tourHighlightId === 'copilot-panel' }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-panel-title"
      >
        <header class="copilot-panel-head">
          <div class="copilot-panel-brand">
            <span class="copilot-panel-icon copilot-panel-icon--lumi" aria-hidden="true">
              <img
                class="lumi-avatar"
                :src="lumiAvatarSrc"
                alt=""
                width="40"
                height="40"
                @error="onLumiAvatarError"
              />
            </span>
            <div>
              <h2 id="copilot-panel-title" class="copilot-panel-title">Lumi</h2>
              <p class="copilot-panel-sub">Security copilot · {{ llmConfigured ? 'LLM + deterministic fallback' : 'Template mode' }}</p>
            </div>
          </div>
          <button type="button" class="copilot-panel-close" aria-label="Close copilot" @click="closeCopilot">×</button>
        </header>
        <div class="copilot-panel-body">
          <p class="copilot-panel-lead">Ask about posture, containment, ingest, or executive messaging.</p>
          <div class="copilot-prompts">
            <button
              v-for="(p, i) in copilotPrompts"
              :key="i"
              type="button"
              class="copilot-prompt-chip"
              @click="useCopilotPrompt(p)"
            >
              {{ p }}
            </button>
          </div>
          <label class="ai-ask-label" for="exec-ask-copilot">Your question</label>
          <textarea
            id="exec-ask-copilot"
            ref="copilotInput"
            v-model="executiveQuestion"
            class="ai-ask-input copilot-panel-input"
            rows="4"
            placeholder="e.g. Should we contain now?"
            @keydown.meta.enter.prevent="askExecutive"
            @keydown.ctrl.enter.prevent="askExecutive"
          ></textarea>
          <button type="button" class="ai-ask-btn copilot-panel-submit" :disabled="askLoading" @click="askExecutive">
            {{ askLoading ? 'Analyzing telemetry…' : 'Ask copilot' }}
          </button>
          <div v-if="askAnswer" class="ai-ask-answer copilot-panel-answer">
            <span class="ai-ask-mode">{{ askMode === 'llm' ? 'LLM answer' : 'Template answer' }}</span>
            <p>{{ askAnswer }}</p>
          </div>
        </div>
      </aside>
      <button
        id="lumi-fab-anchor"
        type="button"
        class="copilot-fab copilot-fab--lumi"
        :class="{
          'copilot-fab--open': copilotOpen,
          'copilot-fab--busy': askLoading,
          'tcc-tour-spotlight': tourHighlightId === 'lumi-fab-anchor',
        }"
        :aria-expanded="copilotOpen"
        aria-controls="exec-ask-copilot"
        :aria-label="copilotOpen ? 'Close Lumi security copilot' : 'Open Lumi security copilot'"
        @click="toggleCopilot"
      >
        <img
          v-if="!copilotOpen"
          class="lumi-avatar lumi-avatar--fab"
          :src="lumiAvatarSrc"
          alt=""
          width="100"
          height="100"
          @error="onLumiAvatarError"
        />
        <svg v-else class="copilot-fab-icon copilot-fab-icon--close" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <span class="copilot-fab-label">Lumi security copilot</span>
      </button>
    </template>

    <transition name="alarm-strip">
      <div v-if="controlNotice" class="control-notice" role="status">{{ controlNotice }}</div>
    </transition>
    <nav
      v-if="uiReady"
      id="action-dock"
      class="action-dock"
      :class="{ 'tcc-tour-spotlight': tourHighlightId === 'action-dock' }"
      aria-label="Quick actions"
    >
      <button type="button" class="action-dock-btn" @click="goTab('platform')">Inject</button>
      <span class="action-dock-divider" aria-hidden="true"></span>
      <button type="button" class="action-dock-btn action-dock-btn--accent" @click="goTab('intelligence')">Brief</button>
      <span class="action-dock-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="action-dock-btn"
        :class="{ 'action-dock-btn--alarm': alarmActive }"
        :disabled="contained || containing"
        @click="containThreat"
      >
        {{ contained ? 'Contained' : 'Contain' }}
      </button>
    </nav>
  </div>
  `,
}).mount("#app");
