# Leadership demo script (5 minutes)

Use this when presenting to Palo Alto Networks leadership. The UI is a **demonstration environment**; architecture and outcomes are the message.

## Before you start

```bash
bash ./scripts/start-demo.sh
```

Open http://127.0.0.1:8000 — **Lumi** intro opens on refresh. Click **Start voice and walkthrough** (one tap for browser audio), or **Skip to dashboard** and use toolbar **AI Copilot guide** later.

## Opening (30 seconds)

> “This is **Threat Command Center** — one console for **landscape posture**, **live telemetry**, and **executive intelligence**. Two ingest paths, one **ThreatEvent** contract.”

Point to: **Command deck** (landscape gauge + KPIs), section jump **Posture / Telemetry / Intelligence / Response**.

## Act 1 — Dual ingestion (60 seconds)

1. **Telemetry** tab → **Live threat queue** (legacy API + live stream sources on rows).
2. **Posture snapshot & platform health** under the queue — Legacy API, Attack Stream, Bridge, WebSocket.
3. Say:

> “Ingest is **at-least-once**. The bridge deduplicates before scoring, so the SOC sees one normalized stream.”

## Act 2 — Executive posture (90 seconds)

1. **Response** → select **Critical** → **Inject campaign** (or use bottom **Inject** on the action dock).
2. **Posture** tab → landscape score and **CRITICAL** level; **Exposure analytics** tiles update.
3. **Intelligence** → **Executive brief** — **Refresh** if needed; open **Recommendations & playbook**.
4. Optional: **Lumi** FAB → ask “Should we contain now?”

> “Per-event **risk score** is deterministic. **Landscape** reflects the recent environment and decays. AI narrates and recommends — it does not replace scoring.”

## Act 3 — Response workflow (60 seconds)

1. **Initiate containment** on the posture deck (or **Contain** on the action dock).
2. Show **CONTAINED**, AttackSim **stopped**, gauge decaying.

> “In production this hook connects to orchestration — Cortex/XSOAR-style playbooks. Here it stops the local simulator to complete the story.”

## Close — Architecture (30 seconds)

Intro modal diagram or README mermaid:

> “New sources only need a **ThreatEvent v1** adapter. Scoring, brief, and this console stay unchanged.”

## Anticipated leadership questions

| Question | Answer |
|----------|--------|
| Is this production? | Demo sandbox with production-minded patterns (validation, fixed paths, LLM optional). |
| Why not LLM for scoring? | Explainable deterministic rules; LLM enriches narrative only. |
| Legacy integration? | ASP.NET `/api/raw-logs` adapter maps into the same contract as the PowerShell log tail. |
| What's next? | AuthN/Z, SIEM export, real playbook integration, bridge as a managed service. |

## Quick reference

| Control | Location |
|---------|----------|
| AI Copilot full tour | Toolbar or intro **Start voice and walkthrough** |
| Inject critical | Response panel or action dock **Inject** |
| Executive brief | Intelligence panel or action dock **Brief** |
| Contain | Posture **Initiate containment** or action dock **Contain** |
| Export board | Toolbar **Export summary** |
