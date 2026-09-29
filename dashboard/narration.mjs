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

function playUrl(url, callbacks, requestId) {
  stopAudio();
  const audio = new Audio(url);
  audio.preload = "auto";
  activeAudio = audio;
  audio.onplay = () => {
    if (requestId === activeRequest && callbacks.onStart) callbacks.onStart();
  };
  audio.onended = () => {
    if (requestId !== activeRequest) return;
    activeAudio = null;
    if (callbacks.onEnd) callbacks.onEnd();
  };
  audio.onerror = () => {
    if (requestId !== activeRequest) return;
    activeAudio = null;
    if (callbacks.onError) callbacks.onError(new Error("Audio playback failed"));
  };
  const p = audio.play();
  if (p?.catch) {
    p.catch((err) => {
      if (requestId !== activeRequest) return;
      activeAudio = null;
      if (callbacks.onError) callbacks.onError(err);
    });
  }
}

async function resolveStaticUrl({ text, stepId, audioFile }) {
  if (audioFile) {
    return `/static/assets/narration/${audioFile}`;
  }
  if (stepId) {
    const index = await loadStaticIndex();
    const meta = index?.steps?.[stepId];
    if (meta?.file) {
      return `/static/assets/narration/${meta.file}`;
    }
  }
  const digest = await textDigest(text);
  const direct = `/static/assets/narration/narr_${digest}.mp3`;
  const index = await loadStaticIndex();
  const steps = index?.steps || {};
  for (const meta of Object.values(steps)) {
    if (meta.digest === digest && meta.file) {
      return `/static/assets/narration/${meta.file}`;
    }
  }
  return direct;
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

  await unlockNarrationAudio();

  const requestId = activeRequest + 1;
  activeRequest = requestId;

  try {
    let staticUrl = await resolveStaticUrl({
      text: key,
      stepId: step.id,
      audioFile: step.audioFile,
    });
    if (requestId !== activeRequest) return false;
    if (fromStart && staticUrl) {
      const sep = staticUrl.includes("?") ? "&" : "?";
      staticUrl = `${staticUrl}${sep}t=${Date.now()}`;
    }

    let staticPlayError = null;
    const staticOk = await tryPlayStaticUrl(staticUrl, {
      ...callbacks,
      onError: (err) => {
        staticPlayError = err;
      },
    }, requestId);
    if (staticOk) return true;
    if (staticPlayError && isAutoplayBlocked(staticPlayError)) {
      callbacks.onError?.(staticPlayError);
      return false;
    }
  } catch {
    /* fall through */
  }

  try {
    const blobUrl = await fetchLiveMp3(key);
    if (requestId !== activeRequest) return false;
    playUrl(blobUrl, callbacks, requestId);
    return true;
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

/** Play pre-generated MP3 from /static/assets/narration (no canplaythrough probe — flaky in Chrome). */
function tryPlayStaticUrl(url, callbacks, requestId) {
  return new Promise((resolve) => {
    stopAudio();
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.currentTime = 0;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    audio.onplay = () => {
      if (requestId === activeRequest && callbacks.onStart) callbacks.onStart();
    };
    audio.onended = () => {
      if (requestId !== activeRequest) return;
      activeAudio = null;
      if (callbacks.onEnd) callbacks.onEnd();
    };
    audio.onerror = () => {
      if (requestId !== activeRequest) return;
      activeAudio = null;
      finish(false);
    };
    activeAudio = audio;
    const attempt = audio.play();
    if (attempt && typeof attempt.then === "function") {
      attempt
        .then(() => {
          if (requestId === activeRequest && callbacks.onStart) {
            callbacks.onStart();
          }
          finish(true);
        })
        .catch((err) => {
          if (requestId !== activeRequest) return;
          activeAudio = null;
          callbacks.onError?.(err);
          finish(false);
        });
    } else {
      finish(true);
    }
  });
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
