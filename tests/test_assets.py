"""Guard against mojibake: a broken encoding round-trip turns characters like '·' or '—' into U+FFFD."""

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".ico"}


def test_no_replacement_characters_in_text_files():
    files = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    corrupted = [
        f for f in files
        if Path(f).suffix.lower() not in BINARY
        and "�" in (REPO / f).read_bytes().decode("utf-8", errors="replace")
    ]
    assert corrupted == [], f"U+FFFD replacement characters found in: {corrupted}"
