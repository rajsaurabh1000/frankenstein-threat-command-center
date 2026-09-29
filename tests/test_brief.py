"""The executive brief must never quote a different posture than the gauge."""

import asyncio
from datetime import datetime, timezone

import brief as brief_module
from brief import BriefGenerator
from models import ScoredEvent, TelemetrySource, ThreatEvent, ThreatLevel


def scored(attack: str, severity: int, risk: float, level: ThreatLevel) -> ScoredEvent:
    event = ThreatEvent(
        event_id=f"evt-{attack}-{severity}",
        timestamp=datetime.now(timezone.utc),
        source=TelemetrySource.LIVE_STREAM,
        attack_type=attack,
        source_ip="103.25.12.7",
        raw_severity=severity,
    )
    return ScoredEvent(event=event, risk_score=risk, threat_level=level)


def refresh(gen, events, level, score):
    asyncio.run(gen.maybe_refresh(events, level, score))


def test_level_change_bypasses_throttle(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(brief_module.time, "time", lambda: clock[0])
    gen = BriefGenerator()
    events = [scored("Brute Force", 7, 60, ThreatLevel.HIGH)]

    refresh(gen, events, ThreatLevel.HIGH, 66)
    assert "HIGH" in gen.text and "66/100" in gen.text

    clock[0] += 5  # well inside the 20 s throttle
    events.append(scored("SQL Injection", 10, 100, ThreatLevel.CRITICAL))
    refresh(gen, events, ThreatLevel.CRITICAL, 85)
    assert "CRITICAL" in gen.text and "85/100" in gen.text


def test_same_level_is_still_throttled(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(brief_module.time, "time", lambda: clock[0])
    gen = BriefGenerator()
    events = [scored("Brute Force", 7, 60, ThreatLevel.HIGH)]
    refresh(gen, events, ThreatLevel.HIGH, 66)
    stamp = gen.updated_at

    clock[0] += 5
    refresh(gen, events, ThreatLevel.HIGH, 70)
    assert "66/100" in gen.text  # unchanged: same posture, inside the throttle window
    assert gen.updated_at == stamp  # timestamp reflects generation, not "now"


def test_containment_marker_is_not_listed_as_a_technique():
    gen = BriefGenerator()
    events = [scored("SQL Injection", 10, 100, ThreatLevel.CRITICAL)]
    marker = ScoredEvent(
        event=ThreatEvent(
            event_id="evt-contain",
            timestamp=datetime.now(timezone.utc),
            source=TelemetrySource.SOC_CONSOLE,
            attack_type="CONTAINMENT",
            source_ip="SOC-CONSOLE",
            status="Contained",
            raw_severity=1,
        ),
        risk_score=0.0,
        threat_level=ThreatLevel.HIGH,
    )
    asyncio.run(gen.force_refresh(events + [marker], ThreatLevel.HIGH, 62))
    assert "CONTAINMENT" not in gen.text and "SOC-CONSOLE" not in gen.text
    assert "SQL Injection" in gen.text
