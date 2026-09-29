from __future__ import annotations

import math
import time
from collections import deque

from models import ThreatEvent, ThreatLevel

ATTACK_WEIGHTS: dict[str, float] = {
    "SQL Injection": 1.0,
    "Brute Force": 0.85,
    "Credential Stuffing": 0.9,
    "Port Scan": 0.65,
    "SSH Connection": 0.75,
    "Login Attempt": 0.55,
    "File Access": 0.7,
    "DNS Query": 0.4,
    "Admin Escalation": 0.95,
    "MITIGATION": 0.1,
    "CONTAINMENT": 0.1,
}

LEGACY_EVENT_WEIGHTS: dict[str, float] = {
    "Login Attempt": 0.5,
    "SSH Connection": 0.8,
    "File Access": 0.75,
    "DNS Query": 0.45,
    "Admin Escalation": 0.95,
}


class ThreatScorer:
    """
    Event risk_score: per-event deterministic 0–100.
    Global score: time-decayed landscape (frequency, diversity, recency) — not a single spike forever.
    """

    def __init__(self) -> None:
        self._landscape: deque[tuple[float, float, str]] = deque(maxlen=300)
        self._contained_until: float = 0.0
        self._contained_at: float = 0.0
        self._global_floor: float = 0.0

    def score_event(self, event: ThreatEvent) -> tuple[float, ThreatLevel]:
        weight = ATTACK_WEIGHTS.get(event.attack_type) or LEGACY_EVENT_WEIGHTS.get(
            event.attack_type, 0.5
        )
        base = weight * (event.raw_severity / 10.0) * 100.0

        if event.status in ("Failed", "Denied", "Blocked"):
            base += 15.0

        risk = min(100.0, max(0.0, base))
        event_level = self._event_level(risk, event.raw_severity)

        now = time.time()
        self._landscape.append((now, risk, event.attack_type))
        return round(risk, 1), event_level

    @property
    def global_score(self) -> float:
        now = time.time()
        # Events observed before containment are treated as contained: they fade out over the
        # containment window and then stop counting, so the gauge can't snap back to CRITICAL
        # once the window ends. Activity after containment (a new inject) counts normally.
        post = self._compute_landscape(now, since=self._contained_at)
        if now < self._contained_until:
            remaining = self._contained_until - now
            decay_factor = remaining / 12.0
            return max(post, self._compute_landscape(now) * decay_factor)

        landscape = post
        if landscape < self._global_floor:
            self._global_floor = max(0.0, self._global_floor - 0.5)
        return max(landscape, self._global_floor)

    def apply_containment(self, seconds: float = 12.0) -> None:
        self._contained_at = time.time()
        self._contained_until = self._contained_at + seconds
        self._global_floor = min(self.global_score, 18.0)

    def global_threat_level(self) -> ThreatLevel:
        return self._landscape_level(self.global_score)

    def _compute_landscape(self, now: float, since: float = 0.0) -> float:
        window_seconds = 120.0
        weighted_sum = 0.0
        weight_total = 0.0
        recent_types: set[str] = set()
        recent_count = 0

        for ts, risk, attack_type in self._landscape:
            age = now - ts
            if age > window_seconds or ts <= since:
                continue
            w = math.exp(-age / 45.0)
            weighted_sum += risk * w
            weight_total += w
            recent_types.add(attack_type)
            if age <= 60.0:
                recent_count += 1

        if weight_total == 0:
            return 0.0

        base = weighted_sum / weight_total
        diversity_bonus = min(12.0, len(recent_types) * 3.0)
        frequency_bonus = min(12.0, recent_count * 1.5)
        recent_risks = [r for ts, r, _ in self._landscape if now - ts <= 30 and ts > since]
        peak = max(recent_risks) if recent_risks else 0.0

        score = base + diversity_bonus + frequency_bonus
        if peak >= 85:
            score = max(score, peak * 0.85)

        return min(100.0, max(0.0, score))

    @staticmethod
    def _event_level(risk: float, raw_severity: int) -> ThreatLevel:
        if raw_severity >= 9 or risk >= 90:
            return ThreatLevel.CRITICAL
        if raw_severity >= 7 or risk >= 72:
            return ThreatLevel.HIGH
        if risk >= 42:
            return ThreatLevel.ELEVATED
        return ThreatLevel.LOW

    @staticmethod
    def _landscape_level(global_score: float) -> ThreatLevel:
        if global_score >= 78:
            return ThreatLevel.CRITICAL
        if global_score >= 58:
            return ThreatLevel.HIGH
        if global_score >= 35:
            return ThreatLevel.ELEVATED
        return ThreatLevel.LOW
