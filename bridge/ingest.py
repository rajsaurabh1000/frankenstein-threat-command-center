from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Awaitable

import httpx

from models import ThreatEvent

JSON_OBJECT_PATTERN = re.compile(r"\{[^{}]*\}")


def parse_log_chunk(chunk: str) -> list[dict[str, Any]]:
    chunk = chunk.strip()
    if not chunk:
        return []
    objects: list[dict[str, Any]] = []
    for match in JSON_OBJECT_PATTERN.finditer(chunk):
        try:
            objects.append(json.loads(match.group()))
        except json.JSONDecodeError:
            continue
    if not objects and chunk.startswith("{"):
        normalized = re.sub(r"\}\s*\{", "}|{", chunk)
        for part in normalized.split("|"):
            try:
                objects.append(json.loads(part))
            except json.JSONDecodeError:
                continue
    return objects


def live_entry_to_event(data: dict[str, Any]) -> ThreatEvent | None:
    try:
        severity = int(data.get("severity", 5))
        severity = max(1, min(10, severity))
    except (TypeError, ValueError):
        severity = 5

    time_str = str(data.get("time", ""))
    today = datetime.now(timezone.utc).date()
    try:
        ts = datetime.strptime(time_str, "%H:%M:%S").replace(
            year=today.year, month=today.month, day=today.day, tzinfo=timezone.utc
        )
    except ValueError:
        ts = datetime.now(timezone.utc)

    return ThreatEvent(
        id=str(uuid.uuid4()),
        timestamp=ts,
        source="live",
        event_type=str(data.get("type", "Unknown")),
        origin=str(data.get("origin", "0.0.0.0")),
        severity=severity,
        raw=data,
    )


def _row_field(row: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        if key in row and row[key] is not None:
            return str(row[key])
    return default


def legacy_row_to_event(row: dict[str, Any]) -> ThreatEvent:
    ts_raw = row.get("Timestamp") or row.get("timestamp")
    if isinstance(ts_raw, str):
        ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
    elif isinstance(ts_raw, datetime):
        ts = ts_raw if ts_raw.tzinfo else ts_raw.replace(tzinfo=timezone.utc)
    else:
        ts = datetime.now(timezone.utc)

    event_name = _row_field(row, "Event", "event", default="Unknown")
    status = _row_field(row, "Status", "status")
    severity = 6 if status in ("Failed", "Denied", "Blocked") else 4

    return ThreatEvent(
        id=str(uuid.uuid4()),
        timestamp=ts,
        source="legacy",
        event_type=event_name,
        origin=_row_field(row, "Source", "source", default="unknown"),
        severity=severity,
        status=status or None,
        raw=row,
    )


class LogTailer:
    def __init__(self, log_path: Path, on_events: Callable[[list[ThreatEvent]], Awaitable[None]]) -> None:
        self._path = log_path
        self._on_events = on_events
        self._offset = 0
        if self._path.exists():
            self._offset = self._path.stat().st_size

    async def poll(self) -> None:
        if not self._path.exists():
            return
        size = self._path.stat().st_size
        if size <= self._offset:
            return
        with self._path.open("r", encoding="utf-8", errors="replace") as f:
            f.seek(self._offset)
            chunk = f.read()
            self._offset = f.tell()

        parsed = parse_log_chunk(chunk)
        events = [live_entry_to_event(p) for p in parsed]
        events = [e for e in events if e is not None]
        if events:
            await self._on_events(events)


class LegacyPoller:
    def __init__(
        self,
        base_url: str,
        on_events: Callable[[list[ThreatEvent]], Awaitable[None]],
        interval: float = 5.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._on_events = on_events
        self._interval = interval
        self._seen: set[str] = set()
        self._bootstrapped = False
        self._last_jitter_emit = 0.0

    async def run_loop(self, stop: Callable[[], bool]) -> None:
        import time

        async with httpx.AsyncClient(timeout=10.0) as client:
            while not stop():
                try:
                    use_jitter = self._bootstrapped
                    params = {"jitter": "1"} if use_jitter else None
                    resp = await client.get(
                        f"{self._base_url}/api/raw-logs", params=params
                    )
                    resp.raise_for_status()
                    rows = resp.json()
                    new_events: list[ThreatEvent] = []

                    if not self._bootstrapped:
                        for row in rows:
                            key = json.dumps(row, sort_keys=True, default=str)
                            if key in self._seen:
                                continue
                            self._seen.add(key)
                            new_events.append(legacy_row_to_event(row))
                        self._bootstrapped = True
                    else:
                        now = time.time()
                        if rows and now - self._last_jitter_emit >= 8.0:
                            self._last_jitter_emit = now
                            new_events.append(legacy_row_to_event(rows[0]))

                    if new_events:
                        await self._on_events(new_events)
                except httpx.HTTPError:
                    pass
                await asyncio_sleep(self._interval)


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)
