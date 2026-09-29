# The Vibe — AI-assisted delivery (Project Frankenstein)

This challenge optimizes for **velocity over perfection**. Below is how AI tooling was used to skip boilerplate and spend time on **architecture, theatrics, and demo narrative**—the “Demo Engineering Trifecta.”

## Tools used

| Tool | Role |
|------|------|
| **Cursor (Agent + Composer)** | Repo scaffold, bridge/dashboard iteration, copilot tour, CSS/layout, README and submission docs |
| **Claude / GPT (via Cursor)** | Pydantic models, FastAPI routes, Vue template structure, narration scripts, executive copy |
| **edge-tts / Jenny neural** | Pre-generated Lumi voice clips (`./scripts/generate-narration.sh`) so demos work without live TTS |
| **Mermaid + inline SVG** | Architecture diagrams for reviewers and intro modal |

## What AI handled (boilerplate)

- Initial **monorepo layout** (`legacy/`, `chaos/`, `bridge/`, `dashboard/`, `scripts/`)
- **FastAPI** wiring: static mount, WebSocket fan-out, CORS to legacy, health snapshots
- **Vue 3 ESM** shell without a heavy build step (vendor Vue + single `app.mjs`)
- **Narration tour** step definitions and PAN-aligned copilot copy
- **Export summary** HTML/CSS for leadership PDF-style output
- Iterative **dark-theme CSS** (motion, leadership layout, world-ui)

## What a human owned (architecture & correctness)

- **ThreatEvent v1** contract and adapter boundaries (legacy JSON vs PowerShell log lines)
- **Deterministic scoring** and separate **landscape** decay (explainable, not LLM-gated)
- **Deduplication** for at-least-once ingest (poll + tail)
- **Containment loop**: `POST /api/contain` → `data/.attack_stop` → AttackSim exits
- **Security posture**: fixed paths under `data/`, no secrets in repo, minimized LLM context
- **Demo script** alignment with CISO story (inject → posture → brief → contain)
- **Graceful degradation** matrix (legacy down, LLM off, WS reconnect)

## 24-hour mindset

| Hour block | Focus |
|------------|--------|
| 0–4 | Legacy + AttackSim + bridge ingest/score + minimal dark UI |
| 4–10 | WebSocket feed, gauge, brief, contain hook |
| 10–18 | Production-style UX, analytics, health, scenarios |
| 18–24 | Lumi copilot tour, voice assets, leadership docs, submission polish |

## Reviewer takeaway

AI removed **typing cost**; engineering judgment went into **bridging three runtimes** (C#, PowerShell, Python) through one contract and one console—the exact “Bridge Builder” mission.
