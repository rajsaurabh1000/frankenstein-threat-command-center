from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"


class ThreatLevel(str, Enum):
    LOW = "LOW"
    ELEVATED = "ELEVATED"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TelemetrySource(str, Enum):
    LEGACY_API = "legacy_api"
    LIVE_STREAM = "live_stream"
    SOC_CONSOLE = "soc_console"


class HealthStatus(str, Enum):
    ONLINE = "ONLINE"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"
    STOPPED = "STOPPED"
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"
    READY = "READY"
    DISABLED = "DISABLED"


class ThreatEvent(BaseModel):
    """Canonical security-event contract (v1). Adapters map upstream sources here."""

    schema_version: str = Field(default=SCHEMA_VERSION)
    event_id: str
    timestamp: datetime
    source: TelemetrySource
    attack_type: str
    source_ip: str
    destination: str = "corp-perimeter"
    status: str = "Detected"
    raw_severity: int = Field(ge=1, le=10, default=5)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScoredEvent(BaseModel):
    event: ThreatEvent
    risk_score: float
    threat_level: ThreatLevel


class ComponentHealth(BaseModel):
    component: str
    status: HealthStatus
    detail: str = ""


class SystemHealth(BaseModel):
    legacy_api: ComponentHealth
    attack_stream: ComponentHealth
    analytics_bridge: ComponentHealth
    websocket: ComponentHealth
    ai_enrichment: ComponentHealth


class ThreatState(BaseModel):
    schema_version: str = SCHEMA_VERSION
    global_score: float
    threat_level: ThreatLevel
    recent_events: list[ScoredEvent]
    contained: bool
    containment_status: Literal["ACTIVE", "CONTAINED"]
    event_count: int
    health: SystemHealth


class AiInsights(BaseModel):
    recommendations: list[str] = Field(default_factory=list, max_length=5)
    playbook_name: str = "Monitor & baseline"
    playbook_rationale: str = ""
    confidence: float = Field(default=0.72, ge=0.0, le=1.0)
    focal_attack: str | None = None
    focal_insight: str = ""
    llm_active: bool = False
    model: str | None = None


class BriefResponse(BaseModel):
    text: str
    mode: Literal["llm", "template"]
    updated_at: datetime
    insights: AiInsights | None = None


class ExecutiveAskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class ExecutiveAskResponse(BaseModel):
    answer: str
    mode: Literal["llm", "template"]
    model: str | None = None


class NarrationSpeakRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class ScenarioRequest(BaseModel):
    scenario: Literal["normal", "port_scan", "brute_force", "critical"]


class ContainResponse(BaseModel):
    ok: bool
    contained: bool
    containment_status: Literal["CONTAINED"]
