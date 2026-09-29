"""AI Copilot (Lumi) — production-oriented narration for Threat Command Center."""

from __future__ import annotations

COPILOT_INTRO = {
    "id": "copilot-intro",
    "title": "Problem, architecture, and approach",
    "text": (
        "Organizations often operate two parallel telemetry paths: a legacy enterprise API and a high-velocity live stream. "
        "Without a shared contract, scoring diverges, queues fragment, and executive reporting lags the SOC. "
        "Threat Command Center ingests both sources through the analytics bridge, normalizes to ThreatEvent version one, "
        "deduplicates and scores deterministically, maintains a single landscape posture, enriches an executive brief, "
        "and exposes containment hooks back to the simulator. "
        "The diagram mirrors a Lucidchart or Excalidraw reference topology: sources, bridge, console, response loop. "
        "Next I will cover each product surface, then run a standard critical-campaign workflow end to end."
    ),
}

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
        "id": "analytics",
        "title": "Exposure analytics",
        "tab": "executive",
        "highlight": "section-analytics",
        "text": (
            "Analytics decompose the unified queue: landscape trend, threat-level mix, attack vectors, "
            "severity and ingest composition, and top actors — formatted for executive and SOC review."
        ),
    },
    {
        "id": "telemetry",
        "title": "Live threat queue",
        "tab": "operations",
        "highlight": "section-live",
        "text": (
            "Every row is a ThreatEvent with technique, source, ingest path, severity, and computed risk. "
            "The feed updates over the WebSocket as the bridge normalizes new events."
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
            "Landscape score and threat level now reflect the injected campaign. "
            "Analytics and KPIs move with the unified queue — ingest, score, aggregate, publish to the console."
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
            "Initiating containment from the posture deck — simulator stop, contained state, and landscape decay — "
            "completing the detect-to-respond path you expect from this dashboard."
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
            "You have seen the architecture context, product surfaces, and a full inject-to-contain workflow. "
            "Replay this guide from the toolbar any time; use Lumi for ad-hoc questions during operations."
        ),
    },
]
