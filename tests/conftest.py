"""Shared test setup: import bridge modules and isolate runtime state in a temp DATA_DIR."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "bridge"))

# Must be set before bridge.main is imported (it reads env at import time).
# load_dotenv() does not override variables that are already set, so a local .env is ignored.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="tcc-test-data-")
os.environ["LEGACY_API_URL"] = "http://127.0.0.1:9"  # unreachable on purpose
os.environ["OPENAI_API_KEY"] = ""
os.environ["LLM_BRIEF_ENABLED"] = "false"
