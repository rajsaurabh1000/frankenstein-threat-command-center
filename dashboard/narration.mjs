const SCRIPT_VERSION = "v1";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

let activeAudio = null;
let activeRequest = 0;
const blobCache = new Map();
let staticIndex = null;
let audioUnlocked = false;

function normalizeText(text) {
  return (text || "").trim().replace(/\s+/g, " ");
}

export function unlockNarrationAudio() {
  if (audioUnlocked || typeof window === "undefined") {
    return Promise.resolve();
  }
  const probe = new Audio(SILENT_WAV);
  probe.volume = 0.001;
  return probe
    .play()
    .then(() => {
      audioUnlocked = true;
    })
    .catch(() => {
      /* still try main audio on same gesture chain */
    });
}

export async function textDigest(text) {
  const normalized = normalizeText(text);
  const payload = `${SCRIPT_VERSION}:${normalized}`;
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

async function loadStaticIndex() {
  if (staticIndex !== null) return staticIndex;
  try {
    const res = await fetch("/static/assets/narration/index.json");
    if (!res.ok) {
      staticIndex = {};
      return staticIndex;
    }
    staticIndex = await res.json();
    return staticIndex;
  } catch {
    staticIndex = {};
    return staticIndex;
  }
}

function stopAudio() {
  if (!activeAudio) return;
  activeAudio.onended = null;
  activeAudio.onerror = null;
  activeAudio.onpause = null;
  activeAudio.onplay = null;
  try {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio.removeAttribute("src");
    activeAudio.load();
  } catch {
    /* ignore teardown errors */
  }
  activeAudio = null;
}

export function stopNarration() {
  activeRequest += 1;
  stopAudio();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Start `url` from 0:00 on a fresh element. Resolves { ok, error } once play() settles;
 * a superseded request resolves { ok: false, superseded: true } so callers never hang.
 * onStart fires once real playback begins; errors after that go to callbacks.onError.
 */
function startAudio(url, callbacks, requestId) {
  return new Promise((resolve) => {
    stopAudio();
    const audio = new Audio(url);
    audio.preload = "auto";
    activeAudio = audio;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const current = () => requestId === activeRequest && activeAudio === audio;
    audio.onended = () => {
      if (!current()) return;
      activeAudio = null;
      callbacks.onEnd?.();
    };
    audio.onerror = () => {
      if (!current()) {
        finish({ ok: false, superseded: true });
        return;
      }
      activeAudio = null;
      const error = new Error("Audio playback failed");
      if (settled) {
        callbacks.onError?.(error);
      } else {
        finish({ ok: false, error });
      }
    };
    const attempt = audio.play();
    if (!attempt || typeof attempt.then !== "function") {
      callbacks.onStart?.();
      finish({ ok: true });
      return;
    }
    attempt
      .then(() => {
        if (!current()) {
          finish({ ok: false, superseded: true });
          return;
        }
        callbacks.onStart?.();
        finish({ ok: true });
      })
      .catch((error) => {
        if (current()) activeAudio = null;
        finish({ ok: false, error, superseded: requestId !== activeRequest });
      });
  });
}

async function resolveStaticUrl({ text, stepId, audioFile }) {
  if (audioFile) {
    return `/static/assets/narration/${audioFile}`;
  }
  const digest = await textDigest(text);
  const index = await loadStaticIndex();
  const steps = index?.steps || {};
  // A step-id match only counts if the clip was generated from this exact text — otherwise an
  // outdated clip plays after the script changes.
  const byId = stepId ? steps[stepId] : null;
  if (byId?.file && byId.digest === digest) {
    return `/static/assets/narration/${byId.file}`;
  }
  for (const meta of Object.values(steps)) {
    if (meta.digest === digest && meta.file) {
      return `/static/assets/narration/${meta.file}`;
    }
  }
  return `/static/assets/narration/narr_${digest}.mp3`;
}

async function fetchLiveMp3(text) {
  const key = normalizeText(text);
  if (blobCache.has(key)) return blobCache.get(key);
  const res = await fetch("/api/narration/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: key }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  blobCache.set(key, url);
  return url;
}

function waitForVoices(timeoutMs = 1200) {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => resolve(window.speechSynthesis.getVoices()), timeoutMs);
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(timer);
      resolve(window.speechSynthesis.getVoices());
    };
  });
}

async function speechSynthesisFallback(text, callbacks, requestId) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    callbacks.onError?.(new Error("No voice fallback"));
    return false;
  }
  const voices = await waitForVoices();
  const utter = new SpeechSynthesisUtterance(normalizeText(text));
  utter.rate = 0.95;
  utter.pitch = 1.05;
  const preferred =
    voices.find((v) => /jenny|samantha|karen|female|zira|aria/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith("en"));
  if (preferred) utter.voice = preferred;
  utter.onstart = () => {
    if (requestId === activeRequest && callbacks.onStart) callbacks.onStart();
  };
  utter.onend = () => {
    if (requestId !== activeRequest) return;
    if (callbacks.onEnd) callbacks.onEnd();
  };
  utter.onerror = () => {
    if (requestId !== activeRequest) return;
    callbacks.onError?.(new Error("Speech synthesis failed"));
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  return true;
}

export function prefetchNarration(step) {
  const text = typeof step === "string" ? step : step?.text;
  const key = normalizeText(text);
  if (!key) return Promise.resolve(false);
  return resolveStaticUrl({
    text: key,
    stepId: step?.id,
    audioFile: step?.audioFile,
  })
    .then(() => true)
    .catch(() => false);
}

export async function playNarration(textOrStep, callbacks = {}, options = {}) {
  const { fromStart = false } = options;
  const step =
    typeof textOrStep === "object" && textOrStep !== null ? textOrStep : { text: textOrStep };
  const key = normalizeText(step.text);
  if (!key) {
    callbacks.onError?.(new Error("Missing narration text"));
    return false;
  }

  if (fromStart) {
    stopNarration();
  }

  // Claim the request before any await so the most recent call always wins.
  const requestId = activeRequest + 1;
  activeRequest = requestId;

  await unlockNarrationAudio();
  if (requestId !== activeRequest) return false;

  try {
    const staticUrl = await resolveStaticUrl({
      text: key,
      stepId: step.id,
      audioFile: step.audioFile,
    });
    if (requestId !== activeRequest) return false;

    const result = await startAudio(staticUrl, callbacks, requestId);
    if (result.ok) return true;
    if (result.superseded || requestId !== activeRequest) return false;
    if (result.error && isAutoplayBlocked(result.error)) {
      callbacks.onError?.(result.error);
      return false;
    }
  } catch {
    /* fall through */
  }

  try {
    const blobUrl = await fetchLiveMp3(key);
    if (requestId !== activeRequest) return false;
    const result = await startAudio(blobUrl, callbacks, requestId);
    if (result.ok) return true;
    if (result.superseded || requestId !== activeRequest) return false;
    if (result.error && isAutoplayBlocked(result.error)) {
      callbacks.onError?.(result.error);
      return false;
    }
  } catch {
    /* fall through */
  }

  if (requestId !== activeRequest) return false;
  const spoke = await speechSynthesisFallback(key, callbacks, requestId);
  if (!spoke) {
    callbacks.onError?.(new Error("Voice unavailable"));
  }
  return spoke;
}

function isAutoplayBlocked(err) {
  const name = err?.name || "";
  const msg = String(err?.message || err || "");
  return (
    name === "NotAllowedError" ||
    /notallowed|autoplay|user didn't interact|gesture/i.test(msg)
  );
}

async function loadFallbackTour() {
  try {
    const res = await fetch("/static/tour-fallback.json");
    if (!res.ok) return [];
    const data = await res.json();
    return data.steps || [];
  } catch {
    return [];
  }
}

export async function fetchTourSteps() {
  try {
    const res = await fetch("/api/narration/tour");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.steps) && data.steps.length) {
        return data.steps;
      }
    }
  } catch {
    /* offline */
  }
  return loadFallbackTour();
}
