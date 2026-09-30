from ingest import legacy_row_to_event, live_entry_to_event, parse_log_chunk
from models import TelemetrySource


def test_parse_json_lines():
    chunk = '{"time":"01:00:00","type":"Port Scan","severity":3,"origin":"103.25.12.9"}\n' \
            '{"time":"01:00:02","type":"SQL Injection","severity":9,"origin":"103.25.12.10"}\n'
    assert [e["type"] for e in parse_log_chunk(chunk)] == ["Port Scan", "SQL Injection"]


def test_parse_concatenated_and_partial_writes():
    chunk = '{"type":"Brute Force","severity":7}{"type":"Port Scan","severity":2}\n{"type":"SQL Inj'
    parsed = parse_log_chunk(chunk)
    assert [e["type"] for e in parsed] == ["Brute Force", "Port Scan"]  # truncated tail ignored
    assert parse_log_chunk("   ") == []


def test_powershell_entry_maps_to_threat_event():
    event = live_entry_to_event(
        {"time": "01:02:03", "type": "SQL Injection", "severity": 9, "origin": "103.25.12.200"}
    )
    assert event.source is TelemetrySource.LIVE_STREAM
    assert event.attack_type == "SQL Injection"
    assert event.source_ip == "103.25.12.200"
    assert event.raw_severity == 9
    assert event.status == "Detected"
    assert event.timestamp.strftime("%H:%M:%S") == "01:02:03"
    assert event.event_id.startswith("evt-")


def test_powershell_severity_is_clamped_and_defaults():
    assert live_entry_to_event({"type": "Port Scan", "severity": 42}).raw_severity == 10
    assert live_entry_to_event({"type": "Port Scan", "severity": "junk"}).raw_severity == 5


def test_aspnet_row_maps_to_threat_event():
    event = legacy_row_to_event(
        {"timestamp": "2026-09-30T00:47:50.198388+05:30", "source": "45.33.22.11",
         "event": "SSH Connection", "status": "Failed"}
    )
    assert event.source is TelemetrySource.LEGACY_API
    assert event.attack_type == "SSH Connection"
    assert event.source_ip == "45.33.22.11"
    assert event.destination == "legacy-saas-core"
    assert event.raw_severity == 6  # Failed/Denied/Blocked => 6, otherwise 4
    assert legacy_row_to_event(
        {"Timestamp": "2026-09-30T00:47:55Z", "Source": "192.168.1.1", "Event": "Login Attempt", "Status": "Success"}
    ).raw_severity == 4


def test_live_entry_prefers_full_iso_timestamp():
    event = live_entry_to_event(
        {"time": "01:02:03", "ts": "2026-09-30T01:02:03.4567890Z", "type": "Port Scan", "severity": 3, "origin": "1.2.3.4"}
    )
    assert event.timestamp.isoformat().startswith("2026-09-30T01:02:03")


def test_live_entry_iso_with_offset_and_bad_iso_falls_back():
    assert live_entry_to_event({"ts": "2026-09-30T06:32:03+05:30", "type": "Port Scan"}).timestamp.utcoffset().total_seconds() == 19800
    fallback = live_entry_to_event({"ts": "not-a-date", "time": "01:02:03", "type": "Port Scan"})
    assert fallback.timestamp.strftime("%H:%M:%S") == "01:02:03"
