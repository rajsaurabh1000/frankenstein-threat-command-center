from __future__ import annotations

import asyncio
import json
import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from brief import BriefGenerator
from ingest import LegacyPoller, LogTailer
from models import BriefResponse, ScoredEvent, ThreatEvent, ThreatState
from scorer import ThreatScorer

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", REPO_ROOT / "data")).resolve()
if not DATA_DIR.is_absolute():
    DATA_DIR = (Path(__file__).resolve().parent / DATA_DIR).resolve()

LOG_PATH = DATA_DIR / "live_stream.log"
STOP_PATH = DATA_DIR / ".attack_stop"
LEGACY_URL = os.environ.get("LEGACY_API_URL", "http://127.0.0.1:5080")
DASHBOARD_DIR = Path(
    os.environ.get("DASHBOARD_DIR", str(REPO_ROOT / "dashboard"))
).resolve()

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Frankenstein Analytics Bridge")

scorer = ThreatScorer()
brief_gen = BriefGenerator()
recent_scored: deque[ScoredEvent] = deque(maxlen=50)
mitigated_flag = False
_ws_clients: set[WebSocket] = set()
_stop_background = False


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


async def handle_new_events(events: list[ThreatEvent]) -> None:
    global mitigated_flag
    for event in events:
        score, level = scorer.score_event(event)
        scored = ScoredEvent(event=event, score=score, threat_level=level)
        recent_scored.append(scored)
        await broadcast(
            {
                "type": "event",
                "payload": {
                    "event": scored.event.model_dump(mode="json"),
                    "score": scored.score,
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
    await broadcast(
        {
            "type": "brief",
            "payload": {"text": brief_gen.text, "mode": brief_gen.mode},
        }
    )
    await broadcast_state()


def build_state() -> ThreatState:
    return ThreatState(
        global_score=round(scorer.global_score, 1),
        threat_level=scorer.global_threat_level(),
        recent_events=list(recent_scored),
        mitigated=mitigated_flag,
        event_count=len(recent_scored),
    )


async def broadcast_state() -> None:
    state = build_state()
    await broadcast(
        {
            "type": "state",
            "payload": state.model_dump(mode="json"),
        }
    )


async def background_ingest() -> None:
    tailer = LogTailer(LOG_PATH, handle_new_events)
    legacy = LegacyPoller(LEGACY_URL, handle_new_events)

    async def legacy_wrapper() -> None:
        await legacy.run_loop(lambda: _stop_background)

    async def tail_loop() -> None:
        while not _stop_background:
            await tailer.poll()
            await asyncio.sleep(0.4)

    await asyncio.gather(legacy_wrapper(), tail_loop())


@app.on_event("startup")
async def on_startup() -> None:
    asyncio.create_task(background_ingest())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    global _stop_background
    _stop_background = True


@app.get("/api/state")
async def get_state() -> ThreatState:
    return build_state()


@app.get("/api/brief")
async def get_brief() -> BriefResponse:
    return BriefResponse(
        text=brief_gen.text,
        mode=brief_gen.mode,  # type: ignore[arg-type]
        updated_at=brief_gen.updated_at,
    )


@app.post("/api/mitigate")
async def mitigate() -> dict:
    global mitigated_flag
    STOP_PATH.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    mitigated_flag = True
    scorer.apply_mitigation_decay(10.0)

    system_event = ThreatEvent(
        id="mitigate-system",
        timestamp=datetime.now(timezone.utc),
        source="live",
        event_type="MITIGATION",
        origin="SOC-CONSOLE",
        severity=1,
        status="Neutralized",
        raw={"action": "mitigate"},
    )
    scored = ScoredEvent(
        event=system_event,
        score=0.0,
        threat_level=scorer.global_threat_level(),
    )
    recent_scored.append(scored)

    await broadcast(
        {
            "type": "system",
            "payload": {
                "message": "Attack simulation neutralized. Threat decay initiated.",
                "mitigated": True,
            },
        }
    )
    await broadcast_state()
    return {"ok": True, "mitigated": True}


@app.websocket("/ws/threats")
async def ws_threats(websocket: WebSocket) -> None:
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        await websocket.send_text(
            json.dumps(
                {"type": "state", "payload": build_state().model_dump(mode="json")},
                default=str,
            )
        )
        await websocket.send_text(
            json.dumps(
                {
                    "type": "brief",
                    "payload": {
                        "text": brief_gen.text,
                        "mode": brief_gen.mode,
                    },
                },
                default=str,
            )
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(DASHBOARD_DIR / "index.html")


if DASHBOARD_DIR.exists():
    app.mount("/static", StaticFiles(directory=DASHBOARD_DIR), name="static")
