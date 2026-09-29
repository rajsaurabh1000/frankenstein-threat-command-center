<script setup>
import { computed } from "vue";

const props = defineProps({
  health: { type: Object, default: null },
});

const rows = computed(() => {
  if (!props.health) {
    return [
      { label: "Legacy API", status: "DEGRADED", detail: "Loading…" },
      { label: "Attack Stream", status: "DEGRADED", detail: "Loading…" },
      { label: "Analytics Bridge", status: "ONLINE", detail: "Starting" },
      { label: "WebSocket", status: "DISCONNECTED", detail: "Connecting" },
      { label: "AI Enrichment", status: "READY", detail: "Template mode" },
    ];
  }
  const h = props.health;
  return [
    h.legacy_api,
    h.attack_stream,
    h.analytics_bridge,
    h.websocket,
    h.ai_enrichment,
  ].map((item) => ({
    label: item?.component ?? "Component",
    status: item?.status ?? "DEGRADED",
    detail: item?.detail ?? "",
  }));
});

function statusClass(status) {
  const good = ["ONLINE", "CONNECTED", "READY"];
  const warn = ["DEGRADED", "DISCONNECTED", "STOPPED"];
  if (good.includes(status)) return "ok";
  if (warn.includes(status)) return "warn";
  return "bad";
}
</script>

<template>
  <section class="panel health">
    <div class="panel-head">
      <h2>System Status</h2>
      <span class="chip">Observable integration</span>
    </div>
    <ul class="list">
      <li v-for="row in rows" :key="row.label" class="item">
        <div class="left">
          <span class="dot" :class="statusClass(row.status)" />
          <span class="label">{{ row.label }}</span>
        </div>
        <div class="right">
          <strong>{{ row.status }}</strong>
          <small>{{ row.detail }}</small>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.health {
  padding: 1rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
}

.item {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.55rem 0.65rem;
  background: rgba(0, 0, 0, 0.18);
}

.left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
  box-shadow: 0 0 0 rgba(0, 0, 0, 0);
}

.dot.ok {
  background: var(--green);
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.55);
}

.dot.warn {
  background: var(--amber);
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.45);
}

.dot.bad {
  background: var(--red);
}

.label {
  font-size: 0.72rem;
}

.right {
  text-align: right;
  min-width: 0;
}

.right strong {
  display: block;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
}

.right small {
  display: block;
  color: var(--muted);
  font-size: 0.58rem;
  margin-top: 0.15rem;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
