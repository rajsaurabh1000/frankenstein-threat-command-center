"""Control-plane guard for state-changing endpoints (inject, contain, AI, text-to-speech).

- Per-client rate limit (CONTROL_RATE_LIMIT, e.g. "30/60" = 30 requests per 60 s; "off" disables).
  Keeps a public demo URL from being hammered; normal demo use never comes close.
- Optional operator token (CONTROL_TOKEN). When set, callers must send X-Control-Token. Off by
  default so the public demo stays clickable; production would put real AuthN/Z here.
"""

from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def parse_rate(spec: str | None) -> tuple[int, float] | None:
    spec = (spec or "").strip().lower()
    if spec in ("", "0", "off", "none", "false"):
        return None
    count, _, period = spec.partition("/")
    return int(count), float(period or 60)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()  # first hop = the real client behind the proxy
    return request.client.host if request.client else "unknown"


class ControlGuard:
    def __init__(self, rate: str | None = "30/60", token: str | None = "") -> None:
        self.rate = parse_rate(rate)
        self.token = (token or "").strip()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, request: Request) -> None:
        if self.token:
            provided = request.headers.get("x-control-token", "")
            if not hmac.compare_digest(provided.encode(), self.token.encode()):
                raise HTTPException(status_code=401, detail="Operator token required for control actions")
        if not self.rate:
            return
        limit, period = self.rate
        now = time.monotonic()
        hits = self._hits[client_ip(request)]
        while hits and now - hits[0] > period:
            hits.popleft()
        if len(hits) >= limit:
            retry = max(1, int(period - (now - hits[0])) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"Too many control actions; retry in {retry} s",
                headers={"Retry-After": str(retry)},
            )
        hits.append(now)


control_guard = ControlGuard(
    rate=os.environ.get("CONTROL_RATE_LIMIT", "30/60"),
    token=os.environ.get("CONTROL_TOKEN", ""),
)
