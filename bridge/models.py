from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ThreatLevel(str, Enum):
    LOW = "LOW"
    ELEVATED = "ELEVATED"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ThreatEvent(BaseModel):
    id: str
    timestamp: datetime
    source: Literal["legacy", "live"]
    event_type: str
    origin: str
    severity: int = Field(ge=1, le=10, default=5)
    status: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class ScoredEvent(BaseModel):
    event: ThreatEvent
    score: float
    threat_level: ThreatLevel


class ThreatState(BaseModel):
    global_score: float
    threat_level: ThreatLevel
    recent_events: list[ScoredEvent]
    mitigated: bool
    event_count: int


class WsMessage(BaseModel):
    type: Literal["event", "state", "system"]
    payload: dict[str, Any]


class BriefResponse(BaseModel):
    text: str
    mode: Literal["llm", "template"]
    updated_at: datetime
