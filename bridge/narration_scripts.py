"""AI Copilot (Lumi) — production-oriented narration for Threat Command Center."""

from __future__ import annotations

COPILOT_INTRO = {
    "id": "copilot-intro",
    "title": "Problem, architecture, and approach",
    "problem": (
        "Our legacy SaaS telemetry is reliable but visually static — and in today's market, static does not sell. "
        "CISO buyers need to see threats handled in real time, not only in slides. Yet most teams still operate two "
        "paths in parallel: ASP.NET raw logs and a high-velocity AttackSim-style live stream. Without one shared contract, "
        "scores diverge, queues fragment, and the story on the glass never matches what the SOC already knows."
    ),
    "narration": (
        "That is the gap this demo closes. Threat Command Center bridges ASP.NET raw logs and the AttackSim stream through "
        "a Python analytics layer, normalizes both to ThreatEvent version one, scores deterministically, and drives one "
        "command center — posture, queue, brief, and containment back to the simulator. "
        "The diagram shows sources, bridge, console, and the response loop. "
        "Next I will cover each product surface, then run a critical campaign inject through contain end to end."
    ),
}
# Spoken overview = problem statement followed by the approach, so the voice starts at the beginning.
COPILOT_INTRO["voice"] = f"{COPILOT_INTRO['problem']} {COPILOT_INTRO['narration']}"

NARRATION_TOUR = [
    {
        "id": "welcome",
        "title": "Threat Command Center",
        "tab": "executive",
        "highlight": "command-deck",
        "text": (
            "This is the Threat Command Center production console. "
            "I am Lumi, embedded security copilot. "
            "I will explain how the application is organized, how data flows through it, and how operators use it day to day."
        ),
    },
    {
        "id": "header",
        "title": "Tenant and environment context",
        "tab": "executive",
        "highlight": "app-header",
        "text": (
            "The header carries product identity, tenant, and region. "
            "Status chips report AI enrichment availability, live ingest, and build version — "
            "the same signals an operator checks before trusting posture on screen."
        ),
    },
    {
        "id": "capabilities",
        "title": "Platform capabilities",
        "tab": "executive",
        "highlight": "platform-capabilities",
        "text": (
            "The capability strip states what the platform guarantees: unified ingest, deterministic scoring, "
            "AI-assisted SecOps narrative, and real-time response integration."
        ),
    },
    {
        "id": "toolbar",
        "title": "Operator toolbar",
        "tab": "executive",
        "highlight": "dashboard-toolbar",
        "text": (
            "Refresh brief re-synthesizes the executive narrative from the latest telemetry window. "
            "Export summary produces a printable record of posture, brief, and playbook. "
            "AI Copilot guide replays this product orientation."
        ),
    },
    {
        "id": "status-pills",
        "title": "Connection and posture status",
        "tab": "executive",
        "highlight": "dashboard-toolbar-status",
        "text": (
            "These pills reflect runtime state: WebSocket connectivity, current threat level, "
            "containment status, and coordinated UTC time for audit alignment."
        ),
    },
    {
        "id": "section-nav",
        "title": "Primary navigation",
        "tab": "executive",
        "highlight": "section-jump-nav",
        "text": (
            "Posture, Telemetry, Intelligence, and Response align to how teams work the queue. "
            "Keyboard shortcuts one through four jump directly; scroll position keeps the active tab in sync."
        ),
    },
    {
        "id": "posture",
        "title": "Global posture deck",
        "tab": "executive",
        "highlight": "command-deck",
        "text": (
            "Landscape score and threat level aggregate normalized events into a zero-to-one-hundred posture. "
            "The stepper reflects pipeline stages; KPIs show queue depth, priority count, mean risk, and ingest mix across API and stream."
        ),
    },
    {
        "id": "threat-meter",
        "title": "Threat landscape meter",
        "tab": "executive",
        "highlight": "threat-meter",
        "text": (
            "The threat meter shows the live landscape score against the real zones: low, elevated from "
            "thirty-five, high from fifty-eight, and critical from seventy-eight. The needle tracks the score, "
            "the arrow shows the change against a minute ago, and the trend marks the critical threshold."
        ),
    },
    {
        "id": "contain",
        "title": "Response controls",
        "tab": "executive",
        "highlight": "command-cta-row",
        "text": (
            "Initiate containment executes the orchestrated response path when policy requires it. "
            "Ask Lumi opens conversational analysis over minimized telemetry without leaving the console."
        ),
    },
    {
        "id": "alerts",
        "title": "Posture alerts",
        "tab": "executive",
        "highlight": "posture-alerts",
        "text": (
            "Alert chips surface when posture rules fire — priority depth, executive thresholds, or response state. "
            "Each chip navigates to the relevant workspace."
        ),
    },
    {
        "id": "attack-map",
        "title": "Global attack map",
        "tab": "executive",
        "highlight": "section-map",
        "text": (
            "The global attack map plots every event on a live 3D globe. Arcs fly from each origin to the region "
            "of the asset it targeted: the web tier in Oregon and the legacy core in North Virginia, coloured by "
            "threat level. The side panel ranks top origins with their dominant ATT&CK technique. Positions are "
            "illustrative, because the telemetry uses simulated addresses."
        ),
    },
    {
        "id": "analytics",
        "title": "Exposure analytics",
        "tab": "executive",
        "highlight": "section-analytics",
        "text": (
            "Analytics decompose the unified queue: landscape trend, threat-level mix, attack vectors, severity "
            "and ingest composition, and top actors. Hover or tap any donut slice to see its share, event count, "
            "and MITRE ATT&CK technique."
        ),
    },
    {
        "id": "telemetry",
        "title": "Live threat queue",
        "tab": "operations",
        "highlight": "section-live",
        "text": (
            "Every row is a ThreatEvent with technique, source, ingest path, severity, and computed risk, plus a "
            "MITRE ATT&CK chip such as T1190 for SQL injection that links to the official technique page. The "
            "feed updates over the WebSocket as the bridge normalizes and enriches new events."
        ),
    },
    {
        "id": "health",
        "title": "Posture snapshot and integration health",
        "tab": "operations",
        "highlight": "telemetry-health",
        "text": (
            "The foot panel separates rolling queue metrics from integration health — legacy API, live stream, "
            "bridge, WebSocket, and AI services — so operators see data and platform state together."
        ),
    },
    {
        "id": "intelligence",
        "title": "Executive brief",
        "tab": "intelligence",
        "highlight": "panel-brief",
        "text": (
            "The brief converts recent events into leadership language. "
            "Regeneration uses the same minimized context window; LLM enrichment applies when configured, "
            "with deterministic narrative as the always-available fallback."
        ),
    },
    {
        "id": "playbook",
        "title": "Playbook and recommendations",
        "tab": "intelligence",
        "highlight": "panel-playbook",
        "text": (
            "Playbooks map posture to ordered recommendations, rationale, and focal-event analysis — "
            "the standard output SOC and governance teams expect alongside the narrative."
        ),
    },
    {
        "id": "lumi",
        "title": "Lumi copilot panel",
        "tab": "intelligence",
        "highlight": "copilot-panel",
        "text": (
            "This is the Lumi copilot panel — natural-language questions on posture, containment, ingest health, and executive messaging. "
            "Suggested prompts and answers stay grounded in minimized telemetry context. "
            "The assistant icon at the bottom-right reopens this panel anytime."
        ),
    },
    {
        "id": "response",
        "title": "Campaign injection workspace",
        "tab": "platform",
        "highlight": "panel-campaign-injection",
        "text": (
            "Operators select a campaign profile and inject synthetic pressure into the live pipeline — "
            "the same control used in integration testing and operator training environments."
        ),
    },
    {
        "id": "action-dock",
        "title": "Quick actions",
        "tab": "platform",
        "highlight": "action-dock",
        "text": (
            "The action dock mirrors the standard operator path: Inject opens this campaign workspace, "
            "Brief jumps to the executive narrative, and Contain runs the response hook. "
            "Next I will run that inject-to-contain path live on this dashboard."
        ),
    },
    {
        "id": "ops-inject",
        "title": "Demo — inject critical campaign",
        "tab": "platform",
        "highlight": "panel-campaign-injection",
        "action": "inject_critical",
        "text": (
            "Injecting a critical campaign now — profile selected, stream pressure applied. "
            "This is how we simulate coordinated attack traffic against the same bridge production uses."
        ),
    },
    {
        "id": "ops-queue",
        "title": "Demo — normalized events in queue",
        "tab": "operations",
        "highlight": "section-live",
        "text": (
            "Watch the live threat queue: each row is a ThreatEvent after bridge normalization — "
            "technique, severity, ingest path, and computed risk updating over the WebSocket."
        ),
    },
    {
        "id": "ops-posture",
        "title": "Demo — posture and landscape shift",
        "tab": "executive",
        "highlight": "command-deck",
        "text": (
            "The landscape is now critical, so the alarm fires instantly: the red alarm strip, a siren, a timer, "
            "and a pulsing containment button. A single high-severity hit only flashes the gauge; a critical "
            "landscape raises the alarm. Acknowledge snoozes the siren for fifteen seconds, and only containment "
            "clears it."
        ),
    },
    {
        "id": "ops-map",
        "title": "Campaign on the attack map",
        "tab": "executive",
        "highlight": "section-map",
        "text": (
            "On the attack map, the campaign converges from three continents, Asia-Pacific, Europe, and the "
            "Americas, on the protected web tier in Oregon. The globe swings to face critical arcs so the impact "
            "is visible."
        ),
    },
    {
        "id": "ops-brief",
        "title": "Demo — refresh executive brief",
        "tab": "intelligence",
        "highlight": "panel-brief",
        "action": "refresh_brief",
        "text": (
            "Refreshing the executive brief pulls the updated telemetry window into the leadership narrative "
            "and refreshes playbook recommendations for governance and SOC review."
        ),
    },
    {
        "id": "ops-contain",
        "title": "Demo — initiate containment",
        "tab": "executive",
        "highlight": "contain-primary-btn",
        "action": "contain",
        "text": (
            "Initiating containment from the posture deck: the simulator stops, the alarm clears, arcs on the "
            "attack map halt behind a shield ring, and the landscape decays, completing the detect-to-respond "
            "path."
        ),
    },
    {
        "id": "export",
        "title": "Executive export",
        "tab": "executive",
        "highlight": "export-summary-btn",
        "text": (
            "Export summary archives posture KPIs, brief text, and playbook recommendations for governance or incident records."
        ),
    },
    {
        "id": "complete",
        "title": "Orientation complete",
        "tab": "executive",
        "highlight": "command-deck",
        "text": (
            "You have seen the architecture, the threat meter and alarm, the global attack map with MITRE ATT&CK "
            "context, and a full inject-to-contain workflow. Replay this guide from the toolbar any time, and use "
            "Lumi for ad-hoc questions during operations."
        ),
    },
]
