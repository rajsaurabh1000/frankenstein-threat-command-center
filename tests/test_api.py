"""End-to-end through the FastAPI app: inject -> ingest -> score -> contain -> stop flag."""

import time

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:  # runs startup, including the log tailer
        yield c


def wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def test_state_and_health_respond(client):
    state = client.get("/api/state").json()
    assert {"global_score", "threat_level", "recent_events", "health"} <= state.keys()
    assert client.get("/api/health").status_code == 200


def test_critical_scenario_flows_through_real_ingest_path(client):
    res = client.post("/api/demo/scenario", json={"scenario": "critical"})
    assert res.status_code == 200 and res.json()["events_injected"] == 3
    assert wait_for(lambda: client.get("/api/state").json()["threat_level"] == "CRITICAL")
    events = client.get("/api/state").json()["recent_events"]
    assert any(e["event"]["attack_type"] == "SQL Injection" and e["event"]["source"] == "live_stream" for e in events)


def test_unknown_scenario_is_rejected(client):
    assert client.post("/api/demo/scenario", json={"scenario": "rm -rf"}).status_code == 422


def test_contain_writes_stop_flag_for_attacksim(client):
    main.STOP_PATH.unlink(missing_ok=True)
    body = client.post("/api/contain").json()
    assert body["contained"] is True and body["containment_status"] == "CONTAINED"
    assert main.STOP_PATH.exists()  # AttackSim.ps1 exits when it sees this file
    assert client.get("/api/state").json()["containment_status"] == "CONTAINED"


def test_mitigate_alias_matches_contain(client):
    assert client.post("/api/mitigate").json()["contained"] is True


def test_template_brief_without_llm(client):
    brief = client.get("/api/brief").json()
    assert brief["mode"] == "template" and brief["text"]
