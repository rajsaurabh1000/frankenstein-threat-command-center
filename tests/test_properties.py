"""Property-based tests: scoring invariants hold for any event the sources could send."""

from datetime import datetime, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from models import TelemetrySource, ThreatEvent, ThreatLevel
from scorer import ATTACK_WEIGHTS, LEGACY_EVENT_WEIGHTS, ThreatScorer

ATTACK_TYPES = sorted(set(ATTACK_WEIGHTS) | set(LEGACY_EVENT_WEIGHTS) | {"Something Unseen"})
STATUSES = ["Detected", "Success", "Failed", "Denied", "Blocked", "Observed"]
LEVEL_ORDER = [ThreatLevel.LOW, ThreatLevel.ELEVATED, ThreatLevel.HIGH, ThreatLevel.CRITICAL]

attack = st.sampled_from(ATTACK_TYPES)
status = st.sampled_from(STATUSES)
severity = st.integers(min_value=1, max_value=10)


def event(a, sev, stat="Detected"):
    return ThreatEvent(
        event_id="evt-p",
        timestamp=datetime.now(timezone.utc),
        source=TelemetrySource.LIVE_STREAM,
        attack_type=a,
        source_ip="103.25.12.1",
        status=stat,
        raw_severity=sev,
    )


@given(attack, severity, status)
def test_event_risk_is_always_0_to_100(a, sev, stat):
    risk, _ = ThreatScorer().score_event(event(a, sev, stat))
    assert 0.0 <= risk <= 100.0


@given(attack, status, severity, severity)
def test_higher_severity_never_lowers_risk_or_level(a, stat, s1, s2):
    lo, hi = sorted((s1, s2))
    r_lo, l_lo = ThreatScorer().score_event(event(a, lo, stat))
    r_hi, l_hi = ThreatScorer().score_event(event(a, hi, stat))
    assert r_hi >= r_lo
    assert LEVEL_ORDER.index(l_hi) >= LEVEL_ORDER.index(l_lo)


@settings(max_examples=150)
@given(st.lists(st.tuples(attack, severity, status), min_size=1, max_size=40))
def test_landscape_stays_in_range_and_alarm_implies_critical(stream):
    scorer = ThreatScorer()
    for a, sev, stat in stream:
        scorer.score_event(event(a, sev, stat))
        assert 0.0 <= scorer.global_score <= 100.0
        if scorer.critical_alarm:
            assert scorer.global_threat_level() is ThreatLevel.CRITICAL
