from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
from pathlib import Path

NEURAL_VOICE = os.environ.get("EDGE_TTS_VOICE", "en-US-JennyNeural").strip() or "en-US-JennyNeural"
TTS_ENGINE = "edge"
SCRIPT_VERSION = "v1"
MAX_TEXT_LEN = 2000


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def text_digest(text: str) -> str:
    normalized = normalize_text(text)
    payload = f"{SCRIPT_VERSION}:{normalized}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def cache_dir(data_dir: Path) -> Path:
    path = data_dir / "narration_audio"
    path.mkdir(parents=True, exist_ok=True)
    return path


def cache_paths(data_dir: Path, text: str) -> tuple[Path, Path]:
    digest = text_digest(text)
    base = cache_dir(data_dir)
    return base / f"narr_{digest}.mp3", base / f"narr_{digest}.json"


def _read_meta(meta_path: Path) -> dict:
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def tts_available() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except ImportError:
        return False


def _edge_mp3(text: str) -> bytes:
    import edge_tts  # type: ignore

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(text, NEURAL_VOICE)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        data = buf.getvalue()
        if not data:
            raise RuntimeError("edge-tts returned empty audio")
        return data

    return asyncio.run(_run())


def get_narration_mp3(data_dir: Path, text: str) -> tuple[bytes, str, bool]:
    normalized = normalize_text(text)
    if not normalized:
        raise ValueError("Narration text is required")
    if len(normalized) > MAX_TEXT_LEN:
        raise ValueError("Narration text is too long")

    mp3_path, meta_path = cache_paths(data_dir, normalized)
    meta = _read_meta(meta_path)
    if (
        mp3_path.is_file()
        and mp3_path.stat().st_size > 0
        and meta.get("voice") == NEURAL_VOICE
    ):
        return mp3_path.read_bytes(), TTS_ENGINE, True

    audio = _edge_mp3(normalized)
    mp3_path.write_bytes(audio)
    meta_path.write_text(
        json.dumps(
            {
                "engine": TTS_ENGINE,
                "voice": NEURAL_VOICE,
                "digest": text_digest(normalized),
                "chars": len(normalized),
            }
        ),
        encoding="utf-8",
    )
    return audio, TTS_ENGINE, False
