"""WebSocket contract: what the dashboard relies on from /ws/threats."""

from fastapi.testclient import TestClient

import main

STATE_KEYS = {"schema_version", "global_score", "threat_level", "recent_events", "contained",
              "containment_status", "event_count", "health", "critical_alarm"}
EVENT_KEYS = {"event", "risk_score", "threat_level", "global_score", "global_threat_level", "critical_alarm"}
THREAT_EVENT_KEYS = {"schema_version", "event_id", "timestamp", "source", "attack_type", "source_ip",
                     "destination", "status", "raw_severity", "metadata", "technique", "geo"}


def test_ws_threats_message_contract():
    with TestClient(main.app) as client, client.websocket_connect("/ws/threats") as ws:
        first = ws.receive_json()
        assert first["type"] == "state" and STATE_KEYS <= first["payload"].keys()
        second = ws.receive_json()
        assert second["type"] == "brief" and {"text", "mode", "insights"} <= second["payload"].keys()

        # A scenario no other test injects: identical events within the same second are
        # (correctly) deduplicated, which would otherwise make this test depend on timing.
        client.post("/api/demo/scenario", json={"scenario": "brute_force"})
        ev = None
        for _ in range(20):  # state/brief/health also arrive; an event follows within ~1 s
            msg = ws.receive_json()
            if msg["type"] == "event":
                ev = msg["payload"]
                break
        assert ev is not None, "no event message after injecting a scenario"
        assert EVENT_KEYS <= ev.keys()
        assert THREAT_EVENT_KEYS <= ev["event"].keys()
        assert ev["event"]["technique"]["id"] in {"T1110", "T1110.004"}  # Brute Force / Credential Stuffing
        assert isinstance(ev["critical_alarm"], bool)
