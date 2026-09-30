from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from dedup import assign_event_id, deterministic_event_id
from health import HealthMonitor
from models import TelemetrySource, ThreatEvent

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


def _parse_live_timestamp(data: dict[str, Any]) -> datetime:
    """Prefer the full ISO-8601 `ts` (AttackSim writes it); fall back to the original HH:mm:ss
    `time` field, which carries no date, so it is taken as today in UTC."""
    iso = data.get("ts")
    if iso:
        try:
            text = str(iso).replace("Z", "+00:00")
            text = re.sub(r"(\.\d{6})\d+", r"\1", text)  # .NET "o" has 7 fraction digits; Python wants <= 6
            parsed = datetime.fromisoformat(text)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    today = datetime.now(timezone.utc).date()
    try:
        return datetime.strptime(str(data.get("time", "")), "%H:%M:%S").replace(
            year=today.year, month=today.month, day=today.day, tzinfo=timezone.utc
        )
    except ValueError:
        return datetime.now(timezone.utc)


def live_entry_to_event(data: dict[str, Any]) -> ThreatEvent | None:
    try:
        severity = int(data.get("severity", 5))
        severity = max(1, min(10, severity))
    except (TypeError, ValueError):
        severity = 5

    ts = _parse_live_timestamp(data)

    attack_type = str(data.get("type", "Unknown"))
    source_ip = str(data.get("origin", "0.0.0.0"))
    destination = str(data.get("destination", "web-app-01"))

    event = ThreatEvent(
        event_id="pending",
        timestamp=ts,
        source=TelemetrySource.LIVE_STREAM,
        attack_type=attack_type,
        source_ip=source_ip,
        destination=destination,
        status="Detected",
        raw_severity=severity,
        metadata={"upstream": "live_stream.log", "raw": data},
    )
    return assign_event_id(event)


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

    attack_type = _row_field(row, "Event", "event", default="Unknown")
    status = _row_field(row, "Status", "status") or "Observed"
    source_ip = _row_field(row, "Source", "source", default="unknown")
    severity = 6 if status in ("Failed", "Denied", "Blocked") else 4

    event = ThreatEvent(
        event_id="pending",
        timestamp=ts,
        source=TelemetrySource.LEGACY_API,
        attack_type=attack_type,
        source_ip=source_ip,
        destination="legacy-saas-core",
        status=status,
        raw_severity=severity,
        metadata={"upstream": "legacy_api", "raw": row},
    )
    return assign_event_id(event)


def legacy_dedupe_key(row: dict[str, Any]) -> str:
    ts_raw = row.get("Timestamp") or row.get("timestamp") or ""
    attack = _row_field(row, "Event", "event", default="Unknown")
    source_ip = _row_field(row, "Source", "source", default="unknown")
    return deterministic_event_id(
        TelemetrySource.LEGACY_API.value,
        str(ts_raw),
        attack,
        source_ip,
        "legacy-saas-core",
    )


class LogTailer:
    def __init__(
        self,
        log_path: Path,
        health: HealthMonitor,
        on_events: Callable[[list[ThreatEvent]], Awaitable[None]],
    ) -> None:
        self._path = log_path
        self._health = health
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
        with self._path.open("r", encoding="utf-8", errors="replace") as handle:
            handle.seek(self._offset)
            chunk = handle.read()
            self._offset = handle.tell()

        parsed = parse_log_chunk(chunk)
        events = [live_entry_to_event(item) for item in parsed]
        events = [event for event in events if event is not None]
        if events:
            self._health.mark_stream_activity()
            await self._on_events(events)


class LegacyPoller:
    def __init__(
        self,
        base_url: str,
        health: HealthMonitor,
        on_events: Callable[[list[ThreatEvent]], Awaitable[None]],
        interval: float = 5.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._health = health
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
                    params = {"jitter": "true"} if use_jitter else None
                    resp = await client.get(
                        f"{self._base_url}/api/raw-logs", params=params
                    )
                    resp.raise_for_status()
                    rows = resp.json()
                    self._health.mark_legacy_ok()
                    new_events: list[ThreatEvent] = []

                    if not self._bootstrapped:
                        for row in rows:
                            key = legacy_dedupe_key(row)
                            if key in self._seen:
                                continue
                            self._seen.add(key)
                            new_events.append(legacy_row_to_event(row))
                        self._bootstrapped = True
                    else:
                        now = time.time()
                        if rows and now - self._last_jitter_emit >= 8.0:
                            self._last_jitter_emit = now
                            row = rows[0]
                            key = legacy_dedupe_key(row)
                            if key not in self._seen:
                                self._seen.add(key)
                                new_events.append(legacy_row_to_event(row))

                    if len(self._seen) > 800:
                        self._seen.clear()

                    if new_events:
                        await self._on_events(new_events)
                except httpx.HTTPError as exc:
                    self._health.mark_legacy_error(str(exc))
                await asyncio_sleep(self._interval)


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)
