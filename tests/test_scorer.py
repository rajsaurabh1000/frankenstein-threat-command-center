from datetime import datetime, timezone

import pytest

from models import TelemetrySource, ThreatEvent, ThreatLevel
from scorer import ThreatScorer


def make_event(attack: str, severity: int, status: str = "Detected") -> ThreatEvent:
    return ThreatEvent(
        event_id="evt-test",
        timestamp=datetime.now(timezone.utc),
        source=TelemetrySource.LIVE_STREAM,
        attack_type=attack,
        source_ip="103.25.12.1",
        status=status,
        raw_severity=severity,
    )


@pytest.mark.parametrize(
    ("attack", "severity", "expected_risk", "expected_level"),
    [
        ("SQL Injection", 10, 100.0, ThreatLevel.CRITICAL),
        ("SQL Injection", 9, 90.0, ThreatLevel.CRITICAL),
        ("Brute Force", 7, 59.5, ThreatLevel.HIGH),  # severity >= 7 is HIGH even below risk 72
        ("Credential Stuffing", 5, 45.0, ThreatLevel.ELEVATED),
        ("Port Scan", 3, 19.5, ThreatLevel.LOW),
        ("Something New", 4, 20.0, ThreatLevel.LOW),  # unknown technique falls back to weight 0.5
    ],
)
def test_event_risk_and_level(attack, severity, expected_risk, expected_level):
    risk, level = ThreatScorer().score_event(make_event(attack, severity))
    assert risk == pytest.approx(expected_risk)
    assert level is expected_level


def test_failed_status_adds_fifteen_and_caps_at_100():
    scorer = ThreatScorer()
    base, _ = scorer.score_event(make_event("SSH Connection", 6))
    failed, _ = scorer.score_event(make_event("SSH Connection", 6, status="Failed"))
    assert failed == pytest.approx(base + 15)
    capped, _ = scorer.score_event(make_event("SQL Injection", 10, status="Denied"))
    assert capped == 100.0


def test_single_critical_hit_turns_gauge_critical():
    scorer = ThreatScorer()
    assert scorer.global_threat_level() is ThreatLevel.LOW
    scorer.score_event(make_event("SQL Injection", 10))
    assert scorer.global_score >= 78
    assert scorer.global_threat_level() is ThreatLevel.CRITICAL


def test_low_noise_stays_low():
    scorer = ThreatScorer()
    for _ in range(3):
        scorer.score_event(make_event("DNS Query", 2))
    assert scorer.global_threat_level() is ThreatLevel.LOW


def test_containment_decays_landscape():
    scorer = ThreatScorer()
    scorer.score_event(make_event("SQL Injection", 10))
    before = scorer.global_score
    scorer.apply_containment(12.0)
    assert scorer.global_score < before
