"""Browser smoke test of the real dashboard (Playwright + Chromium).

Runs only when E2E_URL points at a running stack (CI runs it against the all-in-one container):
    E2E_URL=http://127.0.0.1:8000 python -m pytest tests/e2e -q
Locally you can reuse an installed Chrome instead of downloading Chromium: E2E_CHANNEL=chrome.
"""

import os
import re

import pytest

E2E_URL = os.environ.get("E2E_URL")
pytestmark = pytest.mark.skipif(not E2E_URL, reason="set E2E_URL to run the browser smoke test")


@pytest.fixture()
def page():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        channel = os.environ.get("E2E_CHANNEL") or None
        browser = p.chromium.launch(channel=channel, args=["--mute-audio"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda exc: errors.append(str(exc)))
        pg.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        pg.console_errors = errors
        yield pg
        browser.close()


def test_intro_inject_alarm_contain(page):
    from playwright.sync_api import expect

    page.goto(E2E_URL)

    # Lumi intro with Palo Alto branding
    expect(page.locator(".copilot-intro-card")).to_be_visible(timeout=20000)
    expect(page.get_by_alt_text("Palo Alto Networks").first).to_be_visible()
    expect(page.locator("#copilot-intro-title")).to_contain_text("Problem, architecture")
    page.get_by_role("button", name="Skip to dashboard").click()

    # Dashboard is live
    expect(page.get_by_text("Stream connected", exact=False).first).to_be_visible(timeout=20000)
    expect(page.locator(".threat-meter")).to_be_visible()

    # Inject a critical campaign through the real Response panel
    page.locator("#action-dock").get_by_role("button", name="Inject").click()
    page.locator("#panel-campaign-injection").get_by_text("Critical Attack").click()
    page.get_by_role("button", name="Inject campaign").click()

    expect(page.locator(".tm-level")).to_have_text("CRITICAL", timeout=15000)
    expect(page.locator(".alarm-strip")).to_be_visible(timeout=15000)
    expect(page).to_have_title(re.compile("CRITICAL"))

    # 3D attack map: arcs launched from the injected campaign's origins, leaderboard populated
    page.wait_for_function("() => +(document.querySelector('.attack-globe')?.dataset.arcs || 0) > 0", timeout=10000)
    expect(page.locator(".attack-map-origins li").first).not_to_have_text(re.compile("Waiting"), timeout=10000)

    # MITRE ATT&CK enrichment is visible in the live queue
    expect(page.locator(".mitre-chip").first).to_have_text(re.compile(r"^T\d{4}(\.\d{3})?$"), timeout=10000)

    # Contain from the alarm strip: the alarm clears and the button reflects it
    page.locator(".alarm-btn--contain").click()
    expect(page.locator(".alarm-strip")).to_have_count(0, timeout=10000)
    expect(page.locator("#contain-primary-btn")).to_have_text(re.compile("Contained"), timeout=10000)
    expect(page).not_to_have_title(re.compile("CRITICAL"))
    expect(page.locator(".attack-map-badge")).to_contain_text("Contained")

    assert page.console_errors == [], page.console_errors
