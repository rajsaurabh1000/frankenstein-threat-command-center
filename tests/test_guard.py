"""Control-plane guard: rate limiting per client and the optional operator token."""

import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from guard import ControlGuard, client_ip, parse_rate


def request(ip="203.0.113.7", headers=None):
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": "POST", "path": "/api/contain", "headers": raw, "client": (ip, 5555)})


def call(guard, req):
    asyncio.run(guard(req))


def test_parse_rate():
    assert parse_rate("30/60") == (30, 60.0)
    assert parse_rate("off") is None and parse_rate("") is None


def test_rate_limit_blocks_after_quota_per_client():
    guard = ControlGuard(rate="3/60")
    for _ in range(3):
        call(guard, request())
    with pytest.raises(HTTPException) as exc:
        call(guard, request())
    assert exc.value.status_code == 429 and int(exc.value.headers["Retry-After"]) >= 1
    call(guard, request(ip="198.51.100.9"))  # a different client has its own quota


def test_forwarded_for_identifies_the_real_client():
    assert client_ip(request(headers={"X-Forwarded-For": "103.25.12.200, 10.0.0.1"})) == "103.25.12.200"


def test_operator_token_when_configured():
    guard = ControlGuard(rate="off", token="s3cret")
    with pytest.raises(HTTPException) as exc:
        call(guard, request())
    assert exc.value.status_code == 401
    call(guard, request(headers={"X-Control-Token": "s3cret"}))


def test_open_by_default_for_the_demo():
    call(ControlGuard(rate="off", token=""), request())
