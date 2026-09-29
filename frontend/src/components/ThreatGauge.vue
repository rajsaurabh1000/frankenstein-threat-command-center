<script setup>
import { computed } from "vue";

const props = defineProps({
  score: { type: Number, default: 0 },
  level: { type: String, default: "LOW" },
  contained: { type: Boolean, default: false },
  containing: { type: Boolean, default: false },
});

defineEmits(["contain"]);

const circumference = 2 * Math.PI * 88;
const dashOffset = computed(() => {
  const clamped = Math.max(0, Math.min(100, props.score));
  return circumference - (clamped / 100) * circumference;
});

const levelClass = computed(() => props.level.toLowerCase());
</script>

<template>
  <section class="panel gauge-panel">
    <div class="panel-head">
      <h2>Global Threat Landscape</h2>
      <span class="chip">{{ level }}</span>
    </div>

    <div class="gauge-wrap">
      <svg viewBox="0 0 200 200" class="gauge" aria-hidden="true">
        <circle cx="100" cy="100" r="88" class="track" />
        <circle
          cx="100"
          cy="100"
          r="88"
          class="value"
          :class="levelClass"
          :style="{ strokeDashoffset: dashOffset }"
        />
      </svg>
      <div class="center">
        <strong>{{ Math.round(score) }}</strong>
        <small>/ 100</small>
      </div>
    </div>

    <p class="hint">
      Landscape score decays over time — one critical event does not permanently lock the gauge.
    </p>

    <button
      class="contain-btn"
      :disabled="contained || containing"
      @click="$emit('contain')"
    >
      {{ contained ? "STATUS: CONTAINED" : containing ? "CONTAINING..." : "CONTAIN THREAT" }}
    </button>
    <p class="contain-note">Demo containment · halts AttackSim + decays global score</p>
  </section>
</template>

<style scoped>
.gauge-panel {
  padding: 1rem;
}

.gauge-wrap {
  position: relative;
  width: min(300px, 100%);
  margin: 0.25rem auto 0.75rem;
}

.gauge {
  width: 100%;
  transform: rotate(-90deg);
}

.track {
  fill: none;
  stroke: rgba(148, 163, 184, 0.15);
  stroke-width: 14;
}

.value {
  fill: none;
  stroke: var(--cyan);
  stroke-width: 14;
  stroke-linecap: round;
  stroke-dasharray: 553;
  transition: stroke 0.45s ease, stroke-dashoffset 0.6s ease;
  filter: drop-shadow(0 0 10px rgba(34, 211, 238, 0.45));
}

.value.elevated {
  stroke: var(--amber);
  filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.35));
}

.value.high,
.value.critical {
  stroke: var(--red);
  filter: drop-shadow(0 0 16px var(--red-glow));
}

.center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  font-family: var(--font-ui);
}

.center strong {
  font-size: 2.6rem;
  line-height: 1;
}

.center small {
  color: var(--muted);
  font-size: 0.75rem;
}

.hint,
.contain-note {
  margin: 0;
  text-align: center;
  color: var(--muted);
  font-size: 0.64rem;
  line-height: 1.45;
}

.contain-btn {
  width: 100%;
  margin-top: 0.85rem;
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.35), rgba(69, 10, 10, 0.45));
  color: #fecaca;
  border-radius: 10px;
  padding: 0.9rem 1rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}

.contain-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 22px var(--red-glow);
}

.contain-btn:disabled {
  cursor: not-allowed;
  opacity: 0.75;
  border-color: rgba(52, 211, 153, 0.45);
  color: #bbf7d0;
  background: linear-gradient(180deg, rgba(6, 78, 59, 0.35), rgba(4, 47, 46, 0.45));
}

.contain-note {
  margin-top: 0.55rem;
}
</style>
