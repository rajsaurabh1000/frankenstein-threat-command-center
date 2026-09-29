<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  text: { type: String, default: "" },
  mode: { type: String, default: "template" },
  level: { type: String, default: "LOW" },
});

const displayed = ref("");
const typing = ref(false);

watch(
  () => props.text,
  (next) => {
    if (!next) {
      displayed.value = "";
      return;
    }
    typing.value = true;
    let i = 0;
    displayed.value = "";
    const timer = window.setInterval(() => {
      displayed.value = next.slice(0, i);
      i += 3;
      if (i > next.length) {
        displayed.value = next;
        typing.value = false;
        clearInterval(timer);
      }
    }, 12);
  },
  { immediate: true }
);

const modeLabel = computed(() => (props.mode === "llm" ? "LLM" : "TEMPLATE"));
</script>

<template>
  <section class="panel brief">
    <div class="panel-head">
      <h2>AI Threat Brief</h2>
      <span class="chip">{{ modeLabel }} · {{ level }}</span>
    </div>
    <p class="body" :class="{ typing }">{{ displayed || "Generating executive narrative…" }}</p>
    <p class="footnote">
      Enrichment uses minimal normalized fields only (attack type, IP, severity, score) — not full raw history.
    </p>
  </section>
</template>

<style scoped>
.brief {
  padding: 1rem;
  min-height: 420px;
}

.body {
  margin: 0;
  line-height: 1.6;
  font-size: 0.82rem;
  color: #dbeafe;
  min-height: 220px;
  white-space: pre-wrap;
}

.body.typing::after {
  content: "▌";
  animation: blink 1s step-end infinite;
  color: var(--cyan);
}

.footnote {
  margin: 1rem 0 0;
  font-size: 0.62rem;
  color: var(--muted);
  line-height: 1.45;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
