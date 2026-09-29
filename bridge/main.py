from __future__ import annotations

import asyncio
import json
import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from brief import BriefGenerator
from dedup import EventDeduplicator, assign_event_id
from health import HealthMonitor
from ingest import LegacyPoller, LogTailer
from narration import get_narration_mp3, normalize_text, text_digest, tts_available
from narration_scripts import COPILOT_INTRO, NARRATION_TOUR
from models import (
    AiInsights,
    BriefResponse,
    ContainResponse,
    ExecutiveAskRequest,
    ExecutiveAskResponse,
    NarrationSpeakRequest,
    ScenarioRequest,
    ScoredEvent,
    TelemetrySource,
    ThreatEvent,
    ThreatState,
)
from scenario import inject_scenario
from scorer import ThreatScorer

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", REPO_ROOT / "data")).resolve()
if not DATA_DIR.is_absolute():
    DATA_DIR = (Path(__file__).resolve().parent / DATA_DIR).resolve()

LOG_PATH = DATA_DIR / "live_stream.log"
STOP_PATH = DATA_DIR / ".attack_stop"
LEGACY_URL = os.environ.get("LEGACY_API_URL", "http://127.0.0.1:5080")

_dist = REPO_ROOT / "dashboard" / "dist"
_legacy_ui = REPO_ROOT / "dashboard"
_env_dashboard = os.environ.get("DASHBOARD_DIR")
if _env_dashboard:
    DASHBOARD_DIR = Path(_env_dashboard).resolve()
    if not (DASHBOARD_DIR / "index.html").is_file():
        DASHBOARD_DIR = _legacy_ui.resolve()
else:
    DASHBOARD_DIR = (
        _dist if (_dist / "index.html").is_file() else _legacy_ui
    ).resolve()

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Frankenstein Analytics Bridge", version="1.0.0")

scorer = ThreatScorer()
brief_gen = BriefGenerator()
deduplicator = EventDeduplicator()
health = HealthMonitor()
recent_scored: deque[ScoredEvent] = deque(maxlen=50)
contained_flag = False
_ws_clients: set[WebSocket] = set()
_stop_background = False


def refresh_attack_sim_health() -> None:
    health.set_attack_sim_stopped(STOP_PATH.exists())


async def broadcast(message: dict) -> None:
    dead: list[WebSocket] = []
    payload = json.dumps(message, default=str)
    for ws in list(_ws_clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _ws_clients.discard(ws)


async def ingest_pipeline(events: list[ThreatEvent]) -> None:
    global contained_flag
    accepted: list[ThreatEvent] = []
    for event in events:
        if deduplicator.is_duplicate(event.event_id):
            continue
        accepted.append(event)

    if not accepted:
        return

    for event in accepted:
        risk_score, event_level = scorer.score_event(event)
        scored = ScoredEvent(event=event, risk_score=risk_score, threat_level=event_level)
        recent_scored.append(scored)
        await broadcast(
            {
                "type": "event",
                "payload": {
                    "event": scored.event.model_dump(mode="json"),
                    "risk_score": scored.risk_score,
                    "threat_level": scored.threat_level.value,
                    "global_score": round(scorer.global_score, 1),
                    "global_threat_level": scorer.global_threat_level().value,
                },
            }
        )

    await brief_gen.maybe_refresh(
        list(recent_scored),
        scorer.global_threat_level(),
        scorer.global_score,
    )
    _sync_ai_health()
    await broadcast_brief()
    await broadcast_state()


def _sync_ai_health() -> None:
    extra = (
        f"Model {brief_gen.model_name}"
        if brief_gen.llm_active
        else "Template + playbook intelligence"
    )
    health.set_ai(True, brief_gen.mode, extra)


def _brief_payload() -> dict:
    return {
        "text": brief_gen.text,
        "mode": brief_gen.mode,
        "insights": brief_gen.insights.model_dump(mode="json"),
    }


async def broadcast_brief() -> None:
    await broadcast({"type": "brief", "payload": _brief_payload()})


def build_state() -> ThreatState:
    refresh_attack_sim_health()
    _sync_ai_health()
    return ThreatState(
        global_score=round(scorer.global_score, 1),
        threat_level=scorer.global_threat_level(),
        recent_events=list(recent_scored),
        contained=contained_flag,
        containment_status="CONTAINED" if contained_flag else "ACTIVE",
        event_count=len(recent_scored),
        health=health.snapshot(),
    )


async def broadcast_state() -> None:
    await broadcast({"type": "state", "payload": build_state().model_dump(mode="json")})


async def broadcast_health() -> None:
    refresh_attack_sim_health()
    await broadcast({"type": "health", "payload": health.snapshot().model_dump(mode="json")})


async def background_ingest() -> None:
    tailer = LogTailer(LOG_PATH, health, ingest_pipeline)
    legacy = LegacyPoller(LEGACY_URL, health, ingest_pipeline)

    async def legacy_wrapper() -> None:
        await legacy.run_loop(lambda: _stop_background)

    async def tail_loop() -> None:
        while not _stop_background:
            await tailer.poll()
            await asyncio.sleep(0.35)

    async def health_loop() -> None:
        while not _stop_background:
            health.set_ws_connected(len(_ws_clients) > 0)
            await broadcast_health()
            await asyncio.sleep(5.0)

    async def posture_loop() -> None:
        """The landscape decays between events (e.g. after containment); keep gauge and brief in step."""
        global contained_flag
        while not _stop_background:
            await asyncio.sleep(2.0)
            if contained_flag and not STOP_PATH.exists():
                contained_flag = False  # stop flag cleared (hosted demo auto-resume)
            stamp = brief_gen.updated_at
            await brief_gen.maybe_refresh(
                list(recent_scored), scorer.global_threat_level(), scorer.global_score
            )
            if brief_gen.updated_at != stamp:
                await broadcast_brief()
            await broadcast_state()

    await asyncio.gather(legacy_wrapper(), tail_loop(), health_loop(), posture_loop())


@app.on_event("startup")
async def on_startup() -> None:
    _sync_ai_health()
    asyncio.create_task(background_ingest())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    global _stop_background
    _stop_background = True


@app.get("/api/platform")
async def get_platform() -> dict:
    deploy_env = os.environ.get("DEPLOY_ENV", "enterprise").strip() or "enterprise"
    region = os.environ.get("TCC_REGION", "us-west-2").strip() or "us-west-2"
    tenant = os.environ.get("TCC_TENANT", "primary").strip() or "primary"
    return {
        "product": "Threat Command Center",
        "edition": "Unified Telemetry Platform",
        "version": os.environ.get("TCC_VERSION", "1.0.0"),
        "schema_version": "1.0",
        "environment": deploy_env,
        "region": region,
        "tenant": tenant,
        "build": os.environ.get("TCC_BUILD", "release"),
        "codename": "Project Frankenstein",
        "ai": {
            "llm_configured": brief_gen.llm_active,
            "model": brief_gen.model_name,
            "capabilities": [
                "Executive threat brief",
                "AI playbook matching",
                "Prioritized recommendations",
                "Focal event analysis",
                "Natural-language executive Q&A",
            ],
        },
        "narration": {
            "voice": "en-US-JennyNeural",
            "tts_available": tts_available(),
            "tour_steps": len(NARRATION_TOUR),
        },
    }


@app.get("/api/narration/tour")
async def get_narration_tour() -> dict:
    return {
        "voice": "en-US-JennyNeural",
        "steps": NARRATION_TOUR,
    }


@app.get("/api/narration/intro")
async def get_narration_intro() -> dict:
    return COPILOT_INTRO


@app.post("/api/narration/speak")
async def narration_speak(body: NarrationSpeakRequest) -> Response:
    if not tts_available():
        return Response(status_code=503, content="TTS not available on server")
    try:
        audio, _engine, _hit = get_narration_mp3(DATA_DIR, body.text)
    except ValueError as exc:
        return Response(status_code=400, content=str(exc))
    except Exception:
        return Response(status_code=500, content="TTS synthesis failed")
    digest = text_digest(normalize_text(body.text))
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"X-Narration-Digest": digest, "X-Narration-Voice": "en-US-JennyNeural"},
    )


@app.get("/api/health")
async def get_health():
    refresh_attack_sim_health()
    return health.snapshot()


@app.get("/api/state")
async def get_state() -> ThreatState:
    return build_state()


@app.get("/api/brief")
async def get_brief() -> BriefResponse:
    return BriefResponse(
        text=brief_gen.text,
        mode=brief_gen.mode,  # type: ignore[arg-type]
        updated_at=brief_gen.updated_at,
        insights=brief_gen.insights,
    )


@app.get("/api/ai/insights")
async def get_ai_insights() -> AiInsights:
    return brief_gen.insights


@app.post("/api/ai/brief/regenerate")
async def regenerate_brief() -> BriefResponse:
    await brief_gen.force_refresh(
        list(recent_scored),
        scorer.global_threat_level(),
        scorer.global_score,
    )
    _sync_ai_health()
    await broadcast_brief()
    return BriefResponse(
        text=brief_gen.text,
        mode=brief_gen.mode,  # type: ignore[arg-type]
        updated_at=brief_gen.updated_at,
        insights=brief_gen.insights,
    )


@app.post("/api/ai/ask")
async def executive_ask(body: ExecutiveAskRequest) -> ExecutiveAskResponse:
    answer, mode = await brief_gen.answer_executive(
        body.question,
        list(recent_scored),
        scorer.global_threat_level(),
        scorer.global_score,
    )
    return ExecutiveAskResponse(
        answer=answer,
        mode=mode,  # type: ignore[arg-type]
        model=brief_gen.model_name if mode == "llm" else None,
    )


@app.post("/api/demo/scenario")
async def run_demo_scenario(body: ScenarioRequest) -> dict:
    count = inject_scenario(LOG_PATH, body.scenario, clear_stop=True, stop_path=STOP_PATH)
    contained_flag_local = False
    global contained_flag
    if contained_flag:
        contained_flag_local = True
        contained_flag = False
    return {
        "ok": True,
        "scenario": body.scenario,
        "events_injected": count,
        "containment_reset": contained_flag_local,
    }


@app.post("/api/contain")
async def contain_threat() -> ContainResponse:
    return await _execute_containment()


@app.post("/api/mitigate")
async def mitigate_legacy_alias() -> ContainResponse:
    return await _execute_containment()


async def _execute_containment() -> ContainResponse:
    global contained_flag
    STOP_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    contained_flag = True
    scorer.apply_containment(12.0)
    refresh_attack_sim_health()

    event = assign_event_id(
        ThreatEvent(
            event_id="pending",
            timestamp=datetime.now(timezone.utc),
            source=TelemetrySource.SOC_CONSOLE,
            attack_type="CONTAINMENT",
            source_ip="SOC-CONSOLE",
            destination="demo-environment",
            status="Contained",
            raw_severity=1,
            metadata={"action": "contain", "demo": True},
        )
    )
    scored = ScoredEvent(
        event=event,
        risk_score=0.0,
        threat_level=scorer.global_threat_level(),
    )
    recent_scored.append(scored)

    await broadcast(
        {
            "type": "system",
            "payload": {
                "message": "Demo containment applied. Attack simulator stopped; threat landscape decaying.",
                "contained": True,
                "containment_status": "CONTAINED",
            },
        }
    )
    await brief_gen.force_refresh(
        list(recent_scored),
        scorer.global_threat_level(),
        scorer.global_score,
    )
    _sync_ai_health()
    await broadcast_brief()
    await broadcast_state()
    return ContainResponse(ok=True, contained=True, containment_status="CONTAINED")


@app.websocket("/ws/threats")
async def ws_threats(websocket: WebSocket) -> None:
    await websocket.accept()
    _ws_clients.add(websocket)
    health.set_ws_connected(True)
    try:
        await websocket.send_text(
            json.dumps(
                {"type": "state", "payload": build_state().model_dump(mode="json")},
                default=str,
            )
        )
        await websocket.send_text(
            json.dumps({"type": "brief", "payload": _brief_payload()}, default=str)
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)
        health.set_ws_connected(len(_ws_clients) > 0)


@app.get("/")
async def index() -> FileResponse:
    index_path = DASHBOARD_DIR / "index.html"
    return FileResponse(index_path)


@app.get("/favicon.ico", include_in_schema=False, response_model=None)
async def favicon():
    icon_path = DASHBOARD_DIR / "assets" / "favicon.png"
    if icon_path.is_file():
        return FileResponse(icon_path, media_type="image/png")
    return Response(status_code=404)


@app.get("/assets/architecture-tcc.svg", include_in_schema=False, response_model=None)
async def architecture_svg():
    """Always serve diagram from source dashboard assets (even if DASHBOARD_DIR is dist)."""
    path = _legacy_ui / "assets" / "architecture-tcc.svg"
    if path.is_file():
        return FileResponse(path, media_type="image/svg+xml")
    return Response(status_code=404)


def _mount_dashboard_static() -> None:
    """Serve UI assets without /static vs /assets conflicts (logo folder broke /static before)."""
    if not DASHBOARD_DIR.is_dir():
        return

    # Default dashboard: app.mjs + styles.css live alongside index.html
    if (DASHBOARD_DIR / "app.mjs").exists():
        app.mount(
            "/static",
            StaticFiles(directory=DASHBOARD_DIR),
            name="dashboard-static",
        )
        return

    # Vite build output (dashboard/dist)
    vite_assets = DASHBOARD_DIR / "assets"
    if vite_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=vite_assets), name="vite-assets")


_mount_dashboard_static()
