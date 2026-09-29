from __future__ import annotations

import os
import time
from collections import Counter
from datetime import datetime, timezone

import httpx

from models import ScoredEvent, ThreatLevel

BRIEF_MIN_INTERVAL = 25.0


class BriefGenerator:
    def __init__(self) -> None:
        self._cached_text = (
            "Monitoring network telemetry. Awaiting elevated threat activity "
            "for automated executive briefing."
        )
        self._cached_mode: str = "template"
        self._last_generated = 0.0
        self._api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        self._model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        enabled = os.environ.get("LLM_BRIEF_ENABLED", "true").lower()
        self._llm_enabled = enabled in ("1", "true", "yes") and bool(self._api_key)

    @property
    def text(self) -> str:
        return self._cached_text

    @property
    def mode(self) -> str:
        return self._cached_mode

    @property
    def updated_at(self) -> datetime:
        return datetime.now(timezone.utc)

    async def maybe_refresh(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> None:
        if global_level in (ThreatLevel.LOW,) and global_score < 35:
            self._cached_text = (
                "Posture nominal. Legacy authentication and file-access logs show "
                "no coordinated campaign. Continue standard monitoring."
            )
            self._cached_mode = "template"
            return

        now = time.time()
        if now - self._last_generated < BRIEF_MIN_INTERVAL:
            return

        self._last_generated = now
        if self._llm_enabled:
            brief = await self._llm_brief(events, global_level, global_score)
            if brief:
                self._cached_text = brief
                self._cached_mode = "llm"
                return

        self._cached_text = self._template_brief(events, global_level, global_score)
        self._cached_mode = "template"

    def _template_brief(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> str:
        if not events:
            return self._cached_text

        recent = events[-20:]
        types = Counter(e.event.event_type for e in recent)
        top = types.most_common(3)
        origins = Counter(e.event.origin for e in recent if e.event.origin)
        top_origin = origins.most_common(1)[0][0] if origins else "unknown"

        campaign = ", ".join(f"{name} ({count})" for name, count in top)
        severity_peak = max(e.event.severity for e in recent)

        return (
            f"Executive brief — global posture {global_level.value} "
            f"(score {global_score:.0f}/100). "
            f"Active techniques: {campaign}. "
            f"Primary external origin cluster: {top_origin}; peak severity {severity_peak}/10. "
            f"Recommend blocking suspicious egress, forcing step-up auth on admin paths, "
            f"and isolating affected segments until ingestion normalizes."
        )

    async def _llm_brief(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> str | None:
        lines = []
        for se in events[-15:]:
            e = se.event
            lines.append(
                f"- {e.event_type} from {e.origin} severity {e.event.severity} "
                f"score {se.score} ({se.threat_level.value})"
            )
        user_content = (
            f"Threat level: {global_level.value}, global score: {global_score:.0f}/100.\n"
            "Recent events:\n" + "\n".join(lines) + "\n\n"
            "Write a 3-4 sentence CISO attack brief: campaign assessment, "
            "likely objective, one recommended action. No bullet lists."
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are a senior SOC analyst briefing a CISO. "
                                    "Be concise, authoritative, and actionable."
                                ),
                            },
                            {"role": "user", "content": user_content},
                        ],
                        "max_tokens": 220,
                        "temperature": 0.4,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
        except (httpx.HTTPError, KeyError, IndexError):
            return None
