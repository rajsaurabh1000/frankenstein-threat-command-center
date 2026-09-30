from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

ScenarioName = Literal["normal", "port_scan", "brute_force", "critical"]

SCENARIO_PACKS: dict[ScenarioName, list[dict[str, int | str]]] = {
    "normal": [
        {"type": "Port Scan", "severity": 3, "origin": "198.51.100.22"},
        {"type": "DNS Query", "severity": 2, "origin": "10.0.0.8"},
    ],
    "port_scan": [
        {"type": "Port Scan", "severity": 5, "origin": "203.0.113.44"},
        {"type": "Port Scan", "severity": 6, "origin": "203.0.113.44"},
        {"type": "Port Scan", "severity": 5, "origin": "203.0.113.91"},
    ],
    "brute_force": [
        {"type": "Brute Force", "severity": 7, "origin": "185.220.101.12"},
        {"type": "Credential Stuffing", "severity": 8, "origin": "185.220.101.12"},
        {"type": "Brute Force", "severity": 7, "origin": "185.220.101.55"},
    ],
    "critical": [
        # coordinated multi-region campaign: Asia-Pacific, Europe and the Americas converge on the target
        {"type": "SQL Injection", "severity": 10, "origin": "103.25.12.200"},
        {"type": "SQL Injection", "severity": 9, "origin": "185.220.101.77"},
        {"type": "Admin Escalation", "severity": 9, "origin": "45.33.22.60"},
    ],
}


def inject_scenario(log_path: Path, scenario: ScenarioName, clear_stop: bool, stop_path: Path) -> int:
    if clear_stop and stop_path.exists():
        stop_path.unlink()

    entries = SCENARIO_PACKS[scenario]
    written = 0
    with log_path.open("a", encoding="utf-8") as handle:
        for entry in entries:
            payload = {
                "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "ts": datetime.now(timezone.utc).isoformat(),
                "type": entry["type"],
                "severity": entry["severity"],
                "origin": entry.get("origin") or f"103.25.12.{random.randint(1, 254)}",
                "scenario": scenario,
            }
            handle.write(json.dumps(payload, separators=(",", ":")) + "\n")
            written += 1
    return written
