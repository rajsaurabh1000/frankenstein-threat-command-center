from datetime import datetime, timezone

from dedup import EventDeduplicator, assign_event_id, deterministic_event_id
from models import TelemetrySource, ThreatEvent


def test_event_id_is_deterministic_and_field_sensitive():
    a = deterministic_event_id("live_stream", "2026-09-30T01:00:00+00:00", "Port Scan", "1.2.3.4", "web-app-01")
    b = deterministic_event_id("live_stream", "2026-09-30T01:00:00+00:00", "Port Scan", "1.2.3.4", "web-app-01")
    c = deterministic_event_id("live_stream", "2026-09-30T01:00:00+00:00", "Port Scan", "1.2.3.5", "web-app-01")
    assert a == b
    assert a != c
    assert a.startswith("evt-") and len(a) == len("evt-") + 12


def test_same_observation_gets_same_id():
    ts = datetime(2026, 9, 30, 1, 0, tzinfo=timezone.utc)
    event = ThreatEvent(
        event_id="pending",
        timestamp=ts,
        source=TelemetrySource.LEGACY_API,
        attack_type="SSH Connection",
        source_ip="45.33.22.11",
        destination="legacy-saas-core",
        status="Failed",
        raw_severity=6,
    )
    assert assign_event_id(event).event_id == assign_event_id(event).event_id


def test_duplicate_is_dropped_once_seen():
    dedup = EventDeduplicator()
    assert dedup.is_duplicate("evt-1") is False
    assert dedup.is_duplicate("evt-1") is True
    assert dedup.is_duplicate("evt-2") is False


def test_cache_is_bounded():
    dedup = EventDeduplicator(max_size=2)
    for eid in ("evt-1", "evt-2", "evt-3"):
        dedup.is_duplicate(eid)
    assert dedup.is_duplicate("evt-1") is False  # evicted, oldest first
