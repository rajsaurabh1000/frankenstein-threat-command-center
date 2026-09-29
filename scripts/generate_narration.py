#!/usr/bin/env python3
"""Pre-generate Jenny neural MP3s into dashboard/assets/narration for deploy."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bridge"))

from narration import cache_paths, get_narration_mp3, normalize_text, text_digest  # noqa: E402
from narration_scripts import COPILOT_INTRO, NARRATION_TOUR  # noqa: E402


def main() -> None:
    data = REPO / "data"
    out = REPO / "dashboard" / "assets" / "narration"
    out.mkdir(parents=True, exist_ok=True)

    index: dict = {}

    def write_step(step: dict) -> None:
        text = normalize_text(step["text"])
        get_narration_mp3(data, text)
        mp3_src, _meta = cache_paths(data, text)
        digest = text_digest(text)
        dest_name = f"narr_{digest}.mp3"
        shutil.copy2(mp3_src, out / dest_name)
        index[step["id"]] = {
            "file": dest_name,
            "digest": digest,
            "title": step["title"],
            "tab": step.get("tab"),
        }
        print(f"  ok {dest_name} ({step['id']})")

    write_step(COPILOT_INTRO)
    for step in NARRATION_TOUR:
        write_step(step)

    manifest = {"voice": "en-US-JennyNeural", "intro": COPILOT_INTRO["id"], "steps": index}
    (out / "index.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {len(index)} clips to {out}")


if __name__ == "__main__":
    main()
