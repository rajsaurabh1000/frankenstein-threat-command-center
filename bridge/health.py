from __future__ import annotations

import time
from datetime import datetime, timezone

from models import ComponentHealth, HealthStatus, SystemHealth


class HealthMonitor:
    def __init__(self) -> None:
        self.legacy_last_ok: float | None = None
        self.legacy_last_error: str | None = None
        self.stream_last_activity: float | None = None
        self.attack_sim_stopped: bool = False
        self.ws_connected: bool = False
        self.ai_ready: bool = False
        self.ai_mode: str = "template"
        self.ai_detail_extra: str = ""

    def mark_legacy_ok(self) -> None:
        self.legacy_last_ok = time.time()
        self.legacy_last_error = None

    def mark_legacy_error(self, message: str) -> None:
        self.legacy_last_error = message

    def mark_stream_activity(self) -> None:
        self.stream_last_activity = time.time()

    def set_attack_sim_stopped(self, stopped: bool) -> None:
        self.attack_sim_stopped = stopped

    def set_ws_connected(self, connected: bool) -> None:
        self.ws_connected = connected

    def set_ai(self, ready: bool, mode: str, detail_extra: str = "") -> None:
        self.ai_ready = ready
        self.ai_mode = mode
        self.ai_detail_extra = detail_extra

    def _seconds_since(self, ts: float | None) -> float | None:
        if ts is None:
            return None
        return time.time() - ts

    def snapshot(self) -> SystemHealth:
        now = time.time()
        legacy_age = self._seconds_since(self.legacy_last_ok)
        if legacy_age is None:
            legacy_status = HealthStatus.DEGRADED
            legacy_detail = "Awaiting first successful poll"
        elif legacy_age > 15:
            legacy_status = HealthStatus.DEGRADED
            legacy_detail = f"Last event: {int(legacy_age)}s ago"
        elif self.legacy_last_error:
            legacy_status = HealthStatus.DEGRADED
            legacy_detail = self.legacy_last_error[:80]
        else:
            legacy_status = HealthStatus.ONLINE
            legacy_detail = f"Last poll: {int(legacy_age)}s ago"

        stream_age = self._seconds_since(self.stream_last_activity)
        if self.attack_sim_stopped:
            stream_status = HealthStatus.STOPPED
            stream_detail = "Attack simulator halted (containment)"
        elif stream_age is None:
            stream_status = HealthStatus.DEGRADED
            stream_detail = "No live_stream activity yet"
        elif stream_age > 20:
            stream_status = HealthStatus.DEGRADED
            stream_detail = f"Last line: {int(stream_age)}s ago"
        else:
            stream_status = HealthStatus.ONLINE
            stream_detail = f"Tail active · {int(stream_age)}s ago"

        ws_status = (
            HealthStatus.CONNECTED if self.ws_connected else HealthStatus.DISCONNECTED
        )
        ai_status = HealthStatus.READY if self.ai_ready else HealthStatus.DISABLED
        ai_detail = f"Mode: {self.ai_mode}"
        if self.ai_detail_extra:
            ai_detail = f"{ai_detail} · {self.ai_detail_extra}"

        return SystemHealth(
            legacy_api=ComponentHealth(
                component="Legacy API",
                status=legacy_status,
                detail=legacy_detail,
            ),
            attack_stream=ComponentHealth(
                component="Live Telemetry",
                status=stream_status,
                detail=stream_detail,
            ),
            analytics_bridge=ComponentHealth(
                component="Analytics Bridge",
                status=HealthStatus.ONLINE,
                detail=f"Bridge uptime OK · {datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC",
            ),
            websocket=ComponentHealth(
                component="WebSocket",
                status=ws_status,
                detail="Live threat channel",
            ),
            ai_enrichment=ComponentHealth(
                component="AI Enrichment",
                status=ai_status,
                detail=ai_detail,
            ),
        )
