<script setup>
defineProps({
  items: { type: Array, default: () => [] },
});

function sevClass(sev) {
  if (sev >= 8) return "high";
  if (sev >= 5) return "mid";
  return "low";
}
</script>

<template>
  <section class="panel feed">
    <div class="panel-head">
      <h2>Live Threat Feed</h2>
      <span class="chip">{{ items.length }} events</span>
    </div>

    <TransitionGroup name="fade" tag="ul" class="list">
      <li
        v-for="(row, idx) in items"
        :key="row.event?.event_id ?? `${row.event?.attack_type}-${idx}`"
        class="row"
        :class="{ pulse: (row.event?.raw_severity ?? 0) >= 8 }"
      >
        <div class="top">
          <span class="type">{{ row.event?.attack_type ?? "Unknown" }}</span>
          <span class="sev" :class="sevClass(row.event?.raw_severity ?? 1)">
            SEV {{ row.event?.raw_severity ?? "?" }}
          </span>
        </div>
        <div class="meta">
          <span>{{ row.event?.source_ip ?? "—" }}</span>
          <span>{{ row.event?.source ?? row.event?.source_ip }}</span>
          <span>Risk {{ row.risk_score ?? 0 }}</span>
          <span>{{ row.threat_level ?? "LOW" }}</span>
        </div>
      </li>
    </TransitionGroup>

    <p v-if="!items.length" class="empty">Awaiting normalized telemetry from legacy API and live stream…</p>
  </section>
</template>

<style scoped>
.feed {
  padding: 1rem;
  min-height: 360px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
  max-height: 420px;
  overflow: auto;
}

.row {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  background: rgba(0, 0, 0, 0.22);
}

.row.pulse {
  animation: pulse 0.85s ease;
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
}

.type {
  font-weight: 600;
}

.meta {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  color: var(--muted);
  font-size: 0.64rem;
}

.sev {
  font-size: 0.62rem;
  padding: 0.12rem 0.4rem;
  border-radius: 999px;
}

.sev.low {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.sev.mid {
  background: rgba(251, 191, 36, 0.12);
  color: var(--amber);
}

.sev.high {
  background: rgba(248, 113, 113, 0.15);
  color: var(--red);
}

.empty {
  margin: 1rem 0 0;
  color: var(--muted);
  font-size: 0.72rem;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 rgba(248, 113, 113, 0);
  }
  50% {
    box-shadow: 0 0 18px var(--red-glow);
  }
  100% {
    box-shadow: 0 0 0 rgba(248, 113, 113, 0);
  }
}
</style>
