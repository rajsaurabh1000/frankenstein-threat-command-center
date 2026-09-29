from __future__ import annotations

import hashlib
import time
from collections import OrderedDict

from models import ThreatEvent


def deterministic_event_id(
    source: str,
    timestamp_iso: str,
    attack_type: str,
    source_ip: str,
    destination: str,
) -> str:
    payload = "|".join([source, timestamp_iso, attack_type, source_ip, destination])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    return f"evt-{digest}"


def assign_event_id(event: ThreatEvent) -> ThreatEvent:
    ts = event.timestamp.isoformat()
    eid = deterministic_event_id(
        event.source.value,
        ts,
        event.attack_type,
        event.source_ip,
        event.destination,
    )
    return event.model_copy(update={"event_id": eid})


class EventDeduplicator:
    """Bounded cache for at-least-once ingestion (poll + tail)."""

    def __init__(self, max_size: int = 2000, ttl_seconds: float = 3600.0) -> None:
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._seen: OrderedDict[str, float] = OrderedDict()

    def is_duplicate(self, event_id: str) -> bool:
        now = time.time()
        self._evict_expired(now)
        if event_id in self._seen:
            return True
        self._seen[event_id] = now
        while len(self._seen) > self._max_size:
            self._seen.popitem(last=False)
        return False

    def _evict_expired(self, now: float) -> None:
        expired = [k for k, ts in self._seen.items() if now - ts > self._ttl]
        for key in expired:
            del self._seen[key]
