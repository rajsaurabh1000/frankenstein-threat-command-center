<script setup>
import { useThreatCenter } from "./composables/useThreatCenter";
import ThreatGauge from "./components/ThreatGauge.vue";
import LiveFeed from "./components/LiveFeed.vue";
import AiBrief from "./components/AiBrief.vue";
import SystemHealth from "./components/SystemHealth.vue";
import DemoControl from "./components/DemoControl.vue";

const {
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
} = useThreatCenter();
</script>

<template>
  <div class="app-shell" :class="{ critical: isCritical }">
    <div class="vignette" aria-hidden="true" />

    <div class="partner-strip panel">
      <span class="partner-label">Application Engineer Challenge · Built for</span>
      <img
        class="partner-logo"
        src="/assets/palo-alto-partner-banner.png"
        alt="Palo Alto Networks"
      />
    </div>

    <header class="topbar panel">
      <div class="brand">
        <div class="logo">◈</div>
        <div>
          <h1>Frankenstein Threat Command Center</h1>
          <p>
            Canonical threat contract · deterministic scoring · AI-assisted narratives ·
            demo containment
          </p>
        </div>
      </div>
      <div class="topbar-meta">
        <span class="chip" :class="connected ? 'ok' : 'warn'">
          {{ connected ? "WS LIVE" : reconnecting ? "RECONNECTING" : "OFFLINE" }}
        </span>
        <span class="chip" :class="containmentStatus === 'CONTAINED' ? 'ok' : 'neutral'">
          {{ containmentStatus }}
        </span>
      </div>
    </header>

    <main class="layout">
      <section class="col left">
        <LiveFeed :items="feed" />
        <SystemHealth :health="health" />
      </section>

      <section class="col center">
        <ThreatGauge
          :score="globalScore"
          :level="globalLevel"
          :contained="contained"
          :containing="containing"
          @contain="containThreat"
        />
        <DemoControl
          v-model="selectedScenario"
          :running="runningScenario"
          @run="runScenario"
        />
      </section>

      <section class="col right">
        <AiBrief :text="briefText" :mode="briefMode" :level="globalLevel" />
      </section>
    </main>

    <footer class="footer">
      Demo note: containment stops the local AttackSim process only — not production blocking.
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  min-height: 100vh;
  padding: 1rem 1.25rem 1.5rem;
}

.partner-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 1rem;
  margin-bottom: 0.65rem;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.55), rgba(17, 24, 39, 0.75));
}

.partner-label {
  font-family: var(--font-ui);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  white-space: nowrap;
}

.partner-logo {
  height: 34px;
  width: auto;
  max-width: min(420px, 55vw);
  object-fit: contain;
  object-position: right center;
}

.vignette {
  pointer-events: none;
  position: fixed;
  inset: 0;
  opacity: 0;
  transition: opacity 0.5s ease;
  box-shadow: inset 0 0 140px rgba(248, 113, 113, 0.28);
}

.app-shell.critical .vignette {
  opacity: 1;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  margin-bottom: 1rem;
}

.brand {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.logo {
  color: var(--cyan);
  font-size: 1.6rem;
  text-shadow: 0 0 16px rgba(34, 211, 238, 0.65);
}

.brand h1 {
  margin: 0;
  font-family: var(--font-ui);
  font-size: clamp(1rem, 2vw, 1.25rem);
  letter-spacing: 0.04em;
}

.brand p {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.72rem;
  max-width: 62ch;
}

.topbar-meta {
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.chip.ok {
  border-color: rgba(52, 211, 153, 0.45);
  color: var(--green);
}

.chip.warn {
  border-color: rgba(251, 191, 36, 0.45);
  color: var(--amber);
}

.layout {
  display: grid;
  grid-template-columns: 1.15fr 0.95fr 1fr;
  gap: 1rem;
  align-items: start;
}

.col {
  display: grid;
  gap: 1rem;
}

.footer {
  margin-top: 0.85rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.65rem;
}

@media (max-width: 1180px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
