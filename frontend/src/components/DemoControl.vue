<script setup>
const model = defineModel({ type: String, default: "critical" });

defineProps({
  running: { type: Boolean, default: false },
});

defineEmits(["run"]);

const scenarios = [
  { id: "normal", label: "Normal", desc: "Low-noise reconnaissance" },
  { id: "port_scan", label: "Port Scan", desc: "Repeated scanning pattern" },
  { id: "brute_force", label: "Brute Force", desc: "Credential pressure campaign" },
  { id: "critical", label: "Critical Attack", desc: "SQLi + escalation spike" },
];
</script>

<template>
  <section class="panel demo">
    <div class="panel-head">
      <h2>Demo Scenario</h2>
      <span class="chip">Sales control</span>
    </div>

    <div class="options">
      <label v-for="opt in scenarios" :key="opt.id" class="option" :class="{ active: model === opt.id }">
        <input v-model="model" type="radio" name="scenario" :value="opt.id" />
        <div>
          <strong>{{ opt.label }}</strong>
          <small>{{ opt.desc }}</small>
        </div>
      </label>
    </div>

    <button class="run-btn" :disabled="running" @click="$emit('run')">
      {{ running ? "INJECTING TELEMETRY…" : "RUN SCENARIO" }}
    </button>
  </section>
</template>

<style scoped>
.demo {
  padding: 1rem;
}

.options {
  display: grid;
  gap: 0.45rem;
}

.option {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.15);
  transition: border-color 0.2s ease, background 0.2s ease;
}

.option.active {
  border-color: rgba(34, 211, 238, 0.45);
  background: var(--cyan-dim);
}

.option input {
  margin-top: 0.15rem;
}

.option strong {
  display: block;
  font-size: 0.76rem;
}

.option small {
  display: block;
  margin-top: 0.15rem;
  color: var(--muted);
  font-size: 0.62rem;
}

.run-btn {
  width: 100%;
  margin-top: 0.75rem;
  border: 1px solid rgba(34, 211, 238, 0.45);
  background: linear-gradient(180deg, rgba(8, 47, 73, 0.55), rgba(12, 74, 110, 0.35));
  color: #cffafe;
  border-radius: 10px;
  padding: 0.8rem 1rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  cursor: pointer;
}

.run-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}
</style>
