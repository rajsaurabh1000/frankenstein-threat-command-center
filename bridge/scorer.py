from __future__ import annotations

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
}

LEGACY_EVENT_WEIGHTS: dict[str, float] = {
    "Login Attempt": 0.5,
    "SSH Connection": 0.8,
    "File Access": 0.75,
    "DNS Query": 0.45,
    "Admin Escalation": 0.95,
}


class ThreatScorer:
    """Deterministic 0–100 scoring with velocity bonus and global EMA."""

    def __init__(self, ema_alpha: float = 0.25) -> None:
        self._ema_alpha = ema_alpha
        self._global_score = 0.0
        self._event_times: deque[float] = deque(maxlen=200)
        self._mitigated_until: float = 0.0

    @property
    def global_score(self) -> float:
        if time.time() < self._mitigated_until:
            decay = self._mitigated_until - time.time()
            return max(0.0, self._global_score * (decay / 10.0))
        return self._global_score

    def apply_mitigation_decay(self, seconds: float = 10.0) -> None:
        self._mitigated_until = time.time() + seconds
        self._global_score = min(self._global_score, 25.0)

    def score_event(self, event: ThreatEvent) -> tuple[float, ThreatLevel]:
        weight = ATTACK_WEIGHTS.get(event.event_type) or LEGACY_EVENT_WEIGHTS.get(
            event.event_type, 0.5
        )
        base = weight * (event.severity / 10.0) * 100.0

        if event.status in ("Failed", "Denied", "Blocked"):
            base += 15.0

        now = time.time()
        self._event_times.append(now)
        cutoff = now - 60.0
        while self._event_times and self._event_times[0] < cutoff:
            self._event_times.popleft()
        velocity = len(self._event_times)
        velocity_bonus = min(20.0, velocity * 2.0)
        base += velocity_bonus

        score = min(100.0, max(0.0, base))
        level = self._level_for(score, event.severity)

        self._global_score = (
            self._ema_alpha * score + (1.0 - self._ema_alpha) * self._global_score
        )
        global_level = self._level_for(self.global_score, event.severity)
        if level == ThreatLevel.CRITICAL or global_level == ThreatLevel.CRITICAL:
            level = ThreatLevel.CRITICAL

        return round(score, 1), level

    def global_threat_level(self) -> ThreatLevel:
        return self._level_for(self.global_score, 1)

    @staticmethod
    def _level_for(score: float, severity: int) -> ThreatLevel:
        if severity >= 8 or score >= 85:
            return ThreatLevel.CRITICAL
        if score >= 65:
            return ThreatLevel.HIGH
        if score >= 40:
            return ThreatLevel.ELEVATED
        return ThreatLevel.LOW
