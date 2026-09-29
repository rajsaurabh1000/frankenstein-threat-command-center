from __future__ import annotations

import os
import re
import time
from collections import Counter
from datetime import datetime, timezone

import httpx

from models import AiInsights, ScoredEvent, ThreatLevel

BRIEF_MIN_INTERVAL = 20.0
# A posture change (e.g. HIGH -> CRITICAL) regenerates immediately, so the brief never quotes a
# different level than the gauge; this floor only guards against flapping at a threshold.
BRIEF_LEVEL_CHANGE_MIN_INTERVAL = 3.0


class BriefGenerator:
    def __init__(self) -> None:
        self._cached_text = (
            "Monitoring network telemetry. Awaiting elevated threat activity "
            "for automated executive briefing."
        )
        self._cached_mode: str = "template"
        self._cached_insights = AiInsights(
            recommendations=[
                "Maintain standard monitoring cadence across unified ingest.",
                "Validate legacy API poll latency stays within SLA.",
                "Keep deterministic scoring as source of truth for automation.",
            ],
            playbook_name="Baseline monitoring",
            playbook_rationale="Landscape score and priority queue are within normal bounds.",
            confidence=0.78,
            focal_insight="No focal campaign — awaiting correlated activity across sources.",
            llm_active=False,
        )
        self._last_generated = 0.0
        self._generated_at = datetime.now(timezone.utc)
        self._brief_level: ThreatLevel | None = None
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
    def insights(self) -> AiInsights:
        return self._cached_insights

    @property
    def is_ready(self) -> bool:
        return True

    @property
    def llm_active(self) -> bool:
        return self._llm_enabled

    @property
    def model_name(self) -> str | None:
        return self._model if self._llm_enabled else None

    @property
    def updated_at(self) -> datetime:
        return self._generated_at

    async def maybe_refresh(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> None:
        if global_level is ThreatLevel.LOW and global_score < 35:
            self._cached_text = (
                "Posture nominal. Legacy authentication and file-access logs show "
                "no coordinated campaign. Continue standard monitoring."
            )
            self._cached_mode = "template"
            self._cached_insights = self._template_insights(
                events, global_level, global_score
            )
            if self._brief_level is not ThreatLevel.LOW:
                self._generated_at = datetime.now(timezone.utc)
            self._brief_level = ThreatLevel.LOW
            return

        elapsed = time.time() - self._last_generated
        level_changed = global_level is not self._brief_level
        min_interval = BRIEF_LEVEL_CHANGE_MIN_INTERVAL if level_changed else BRIEF_MIN_INTERVAL
        if elapsed < min_interval:
            return

        await self._refresh(events, global_level, global_score)

    async def force_refresh(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> None:
        self._last_generated = 0.0
        await self._refresh(events, global_level, global_score)

    async def _refresh(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> None:
        self._last_generated = time.time()
        self._generated_at = datetime.now(timezone.utc)
        self._brief_level = global_level
        self._cached_insights = self._template_insights(
            events, global_level, global_score
        )

        if self._llm_enabled:
            brief = await self._llm_brief(events, global_level, global_score)
            if brief:
                self._cached_text = brief
                self._cached_mode = "llm"
                self._cached_insights.llm_active = True
                self._cached_insights.model = self._model
                recs = await self._llm_recommendations(
                    events, global_level, global_score
                )
                if recs:
                    self._cached_insights.recommendations = recs
                return

        self._cached_text = self._template_brief(events, global_level, global_score)
        self._cached_mode = "template"
        self._cached_insights.llm_active = False
        self._cached_insights.model = None

    def _template_brief(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> str:
        if not events:
            return self._cached_text

        recent = events[-20:]
        types = Counter(item.event.attack_type for item in recent)
        top = types.most_common(3)
        origins = Counter(item.event.source_ip for item in recent if item.event.source_ip)
        top_origin = origins.most_common(1)[0][0] if origins else "unknown"
        severity_peak = max(item.event.raw_severity for item in recent)
        campaign = ", ".join(f"{name} ({count})" for name, count in top)

        return (
            f"Executive brief — global posture {global_level.value} "
            f"(landscape score {global_score:.0f}/100). "
            f"Active techniques: {campaign}. "
            f"Primary external origin cluster: {top_origin}; peak severity {severity_peak}/10. "
            f"Recommend blocking suspicious egress, forcing step-up auth on admin paths, "
            f"and isolating affected segments until ingestion normalizes."
        )

    def _template_insights(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> AiInsights:
        if not events:
            return AiInsights(
                recommendations=[
                    "Confirm unified ingest health before enabling automated response.",
                    "Keep ThreatEvent v1 validation on all new adapters.",
                    "Schedule executive brief refresh on landscape transitions.",
                ],
                playbook_name="Baseline monitoring",
                playbook_rationale="Insufficient correlated events for playbook escalation.",
                confidence=0.75,
                focal_insight="Awaiting telemetry to establish a focal campaign.",
                llm_active=self._llm_enabled,
                model=self._model if self._llm_enabled else None,
            )

        recent = events[-20:]
        types = Counter(item.event.attack_type for item in recent)
        top_type, top_count = types.most_common(1)[0]
        critical = [
            e
            for e in recent
            if e.event.raw_severity >= 8 or e.threat_level == ThreatLevel.CRITICAL
        ]
        focal = max(critical, key=lambda x: x.risk_score, default=recent[-1])
        focal_attack = focal.event.attack_type
        origins = Counter(e.event.source_ip for e in recent if e.event.source_ip)
        top_origin = origins.most_common(1)[0][0] if origins else "unknown"

        if global_level in (ThreatLevel.CRITICAL, ThreatLevel.HIGH):
            playbook = "Critical containment & identity hardening"
            rationale = (
                f"Landscape {global_score:.0f}/100 with {len(critical)} priority events "
                f"warrants isolation and identity controls before reinjection."
            )
            recs = [
                f"Block or rate-limit egress from cluster {top_origin} pending verification.",
                "Force step-up authentication on privileged paths and admin consoles.",
                "Isolate affected segments and replay deduplicated events into SIEM export.",
            ]
        elif global_level is ThreatLevel.ELEVATED:
            playbook = "Elevated hunt & tighten"
            rationale = "Mixed techniques detected — expand hunt queries before auto-containment."
            recs = [
                f"Prioritize hunt for {top_type} patterns ({top_count} recent hits).",
                "Enable temporary geo-fencing on authentication endpoints.",
                "Refresh executive brief and validate AI recommendations with tier-2 analyst.",
            ]
        else:
            playbook = "Baseline monitoring"
            rationale = "Posture within expected demo noise; maintain unified ingest observability."
            recs = [
                "Continue dual-source normalization with dedup metrics enabled.",
                "Sample legacy API jitter tests to validate adapter resilience.",
                "Keep LLM brief on standby for landscape transitions above 35/100.",
            ]

        confidence = min(
            0.96,
            0.55 + (global_score / 200.0) + (0.08 if len(critical) else 0),
        )

        focal_insight = (
            f"AI read: {focal_attack} from {focal.event.source_ip} "
            f"(risk {int(focal.risk_score)}, sev {focal.event.raw_severity}/10) "
            f"aligns with dominant {top_type} activity — likely coordinated probing "
            f"against perimeter assets."
        )

        return AiInsights(
            recommendations=recs,
            playbook_name=playbook,
            playbook_rationale=rationale,
            confidence=round(confidence, 2),
            focal_attack=focal_attack,
            focal_insight=focal_insight,
            llm_active=self._llm_enabled,
            model=self._model if self._llm_enabled else None,
        )

    def _minimal_context(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> str:
        lines = []
        for item in events[-12:]:
            event = item.event
            lines.append(
                f"{event.attack_type}|{event.source_ip}|sev{event.raw_severity}|"
                f"risk{int(item.risk_score)}|{item.threat_level.value}"
            )
        return (
            f"level={global_level.value};score={int(global_score)};"
            + ";".join(lines)
        )

    async def _llm_brief(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> str | None:
        context = self._minimal_context(events, global_level, global_score)
        user_content = (
            f"Normalized telemetry summary (no PII beyond IPs): {context}\n\n"
            "Write a 3-4 sentence CISO attack brief: campaign assessment, "
            "likely objective, one recommended action. No bullet lists."
        )
        return await self._chat(
            system=(
                "You are a senior SOC analyst briefing a CISO at Palo Alto Networks. "
                "Be concise, authoritative, and actionable. No markdown."
            ),
            user=user_content,
            max_tokens=220,
        )

    async def _llm_recommendations(
        self, events: list[ScoredEvent], global_level: ThreatLevel, global_score: float
    ) -> list[str] | None:
        context = self._minimal_context(events, global_level, global_score)
        raw = await self._chat(
            system=(
                "Return exactly three short SOC action items, one per line, "
                "no numbering, no bullets, no markdown."
            ),
            user=f"Telemetry: {context}\nPosture {global_level.value} score {global_score:.0f}.",
            max_tokens=180,
        )
        if not raw:
            return None
        lines = [ln.strip("-• ").strip() for ln in raw.splitlines() if ln.strip()]
        return lines[:3] if lines else None

    async def answer_executive(
        self,
        question: str,
        events: list[ScoredEvent],
        global_level: ThreatLevel,
        global_score: float,
    ) -> tuple[str, str]:
        cleaned = re.sub(r"\s+", " ", question.strip())
        if self._llm_enabled:
            context = self._minimal_context(events, global_level, global_score)
            prompt = (
                f"Current brief: {self._cached_text}\n"
                f"Telemetry: {context}\n"
                f"Executive question: {cleaned}\n"
                "Answer in 2-3 sentences for a CISO. Be direct."
            )
            answer = await self._chat(
                system=(
                    "You are an AI security copilot in a SOC command center demo. "
                    "Answer using only the provided telemetry context."
                ),
                user=prompt,
                max_tokens=200,
            )
            if answer:
                return answer, "llm"

        return self._template_ask(cleaned, events, global_level, global_score), "template"

    def _template_ask(
        self,
        question: str,
        events: list[ScoredEvent],
        global_level: ThreatLevel,
        global_score: float,
    ) -> str:
        q = question.lower()
        if "contain" in q or "respond" in q or "mitigate" in q:
            return (
                f"At landscape {global_score:.0f}/100 ({global_level.value}), "
                "recommended response is tier-1 containment: isolate live telemetry feed, "
                "block suspicious egress on the top origin cluster, and force step-up auth "
                "while the executive brief refreshes from deduplicated events."
            )
        if "ai" in q or "llm" in q or "model" in q:
            if self._llm_enabled:
                return (
                    f"Generative enrichment is active ({self._model}) for executive briefs, "
                    "recommended actions, and this Q&A channel. Deterministic scoring remains "
                    "the automation source of truth — AI narrates and prioritizes, it does not "
                    "replace validated risk math."
                )
            return (
                "Template intelligence is active: deterministic briefs, playbook matching, "
                "and focal-event analysis run locally without an API key. Set OPENAI_API_KEY "
                "to enable live LLM enrichment for leadership demos."
            )
        if "legacy" in q or "integrat" in q:
            return (
                "Legacy ASP.NET telemetry and the live attack stream both normalize to "
                "ThreatEvent v1 before deduplication and scoring — the dashboard and AI "
                "layers consume one contract, so new sources plug in without redesigning "
                "briefing or response workflows."
            )
        return (
            f"Current posture is {global_level.value} at {global_score:.0f}/100 with "
            f"{len(events)} recent scored events in context. "
            f"{self._cached_insights.focal_insight} "
            "Ask about containment, integrations, or AI enrichment for deeper detail."
        )

    async def _chat(self, system: str, user: str, max_tokens: int) -> str | None:
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
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "max_tokens": max_tokens,
                        "temperature": 0.35,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
        except (httpx.HTTPError, KeyError, IndexError):
            return None
