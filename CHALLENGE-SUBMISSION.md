# Application Engineer Challenge — Submission Map

**Internal project name:** Project Frankenstein’s Dashboard  
**Deliverable:** Public repo + working Threat Command Center demo

---

## Deliverable checklist (§4)

| # | Requirement | Where in this repo | How to verify in 60s |
|---|-------------|-------------------|----------------------|
| 1 | **Analytics Bridge (Python)** watches `live_stream.log` + Legacy API, scores events | `bridge/ingest.py`, `bridge/scorer.py`, `bridge/main.py` | `./scripts/start-demo.sh` → events in feed with `risk_score` |
| 2 | **Command Center (HTML5/JS)** dark mode, live feed, global gauge red on high severity | `dashboard/app.mjs`, `dashboard/styles.css` | Open http://127.0.0.1:8000 → inject **Critical** → gauge CRITICAL |
| 3 | **“Sales” edge** (jaw-drop feature) | **AI Threat Brief** (`bridge/brief.py`), **Contain** stops AttackSim (`POST /api/contain`), **Lumi** guided tour + voice, **Export summary**, campaign inject | Toolbar **AI Copilot guide** or Response → Inject → Contain |
| 4 | **Public GitHub repository** | See [Publish](#publish-public-github) below | Clone URL in challenge reply email |

---

## Evaluation rubric (§5)

### Aesthetic (40%)

- Dark **executive SOC** aesthetic (Palo Alto Networks–aligned), not a 2010 internal tool
- Live telemetry queue, landscape gauge, analytics tiles, integration health
- Intro modal: problem + reference architecture + operator workflow on diagram
- **Files:** `dashboard/world-ui.css`, `dashboard/leadership-layout.css`, `LEADERSHIP-DEMO.md`

### Architecture (40%)

- **Legacy:** ASP.NET minimal API `GET /api/raw-logs` on `:5080` — `legacy/Program.cs`
- **Chaos:** `chaos/AttackSim.ps1` appends JSON to `data/live_stream.log`
- **Bridge:** normalize → dedup → score → WebSocket + REST — `bridge/`
- **UI:** single origin `:8000`, contain closes the loop via `.attack_stop`
- **Diagram:** README mermaid + `dashboard/architecture-diagram.mjs`

### The Vibe (20%)

- **[VIBE.md](VIBE.md)** — explicit AI orchestration vs human architecture decisions

---

## Run the demo (reviewers)

```bash
chmod +x scripts/start-demo.sh
bash ./scripts/start-demo.sh
```

Open **http://127.0.0.1:8000** (use **zsh/bash** from repo root, not PowerShell for the start script).

1. Intro modal → **Start voice and walkthrough** (one click unlocks browser audio)
2. Or manually: Response → **Inject campaign** (Critical) → Posture rises → Intelligence brief → **Initiate containment**

Optional voice assets:

```bash
./scripts/generate-narration.sh
```

---

## Publish (public GitHub)

From repo root (after [GitHub CLI](https://cli.github.com/) `gh auth login`):

```bash
git add -A
git status   # confirm no .env or secrets
git commit -m "Threat Command Center — Frankenstein challenge submission"
gh repo create frankenstein-threat-command-center --public --source=. --remote=origin --push
```

Without `gh`: create an empty public repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USER/frankenstein-threat-command-center.git
git push -u origin main
```

---

## Suggested reply email (challenge intro thread)

**Subject:** Application Engineer Challenge — Threat Command Center (Project Frankenstein)

Hi,

Please find my submission for the **Bridge Builder** challenge:

**Repository:** `https://github.com/YOUR_USER/frankenstein-threat-command-center`

**Run locally:** `./scripts/start-demo.sh` → http://127.0.0.1:8000

**What it does:**

- Ingests **ASP.NET** raw logs (`:5080`) and **PowerShell** AttackSim tail into one **ThreatEvent v1** pipeline
- **Python bridge** scores risk and landscape posture; **Vue command center** updates over WebSocket
- **Sales edge:** AI executive brief (optional LLM), **Contain** stops the attack simulator, **Lumi** AI copilot walks problem → architecture → live inject-to-contain demo

**AI usage:** documented in [VIBE.md](VIBE.md) in the repo.

Happy to walk through a 5-minute live demo on the next interview.

Thanks,  
[Your name]

---

## Known demo notes (not architecture gaps)

- Browsers block autoplay until one click — use **Start voice and walkthrough** on the intro modal
- Run only **one** `start-demo.sh` instance (ports 5080 and 8000)
- Apple Silicon: if Python wheels mismatch, `rm -rf bridge/.venv && ./scripts/start-demo.sh`
