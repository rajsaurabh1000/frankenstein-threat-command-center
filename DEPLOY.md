# Deploy Threat Command Center (public demo URL)

Share a **single HTTPS URL** with Palo Alto leadership. The UI includes **Jenny neural voice** narration when static MP3s are bundled (recommended for production hosts).

**UI layout:** IAM ops console pattern — **KPI strip → accent-topped analytics charts → telemetry queue separated from posture/health foot**. **Lumi** auto-advances an 11-step voice tour for leadership demos.

## Before you deploy (voice + UX)

```bash
./scripts/start-demo.sh   # verify locally
chmod +x scripts/generate-narration.sh
./scripts/generate-narration.sh   # creates dashboard/assets/narration/*.mp3
git add dashboard/assets/narration/
```

Commit the narration folder so Render/Fly/Docker **do not** need `edge-tts` at runtime. Without MP3s, the UI falls back to live TTS (if installed) or browser speech.

Optional: set `OPENAI_API_KEY` on the bridge for **LLM** brief + copilot Q&A.

---

## Option A — Fastest interview link (ngrok)

```bash
./scripts/start-demo.sh
ngrok http 8000
```

Share the `https://*.ngrok-free.app` URL. Runs full stack locally (legacy + bridge + AttackSim).

---

## Option B — Docker Compose (VM / cloud instance)

```bash
docker compose up --build -d
```

Open **http://YOUR_HOST:8000**. Ensure security group allows **8000** (and **5080** only if debugging legacy directly).

For sustained demos, use a small VM (AWS Lightsail, DigitalOcean) with compose + optional Caddy reverse proxy for HTTPS.

---

## Option C — Render (Blueprint)

1. Push repo to GitHub.
2. [Render Dashboard](https://dashboard.render.com/) → **New Blueprint** → connect repo (`render.yaml`).
3. Set **OPENAI_API_KEY** on `tcc-bridge` (optional).
4. Set **LEGACY_API_URL** if auto-link fails — use `https://tcc-legacy.onrender.com` (no trailing path).
5. Public URL is the **tcc-bridge** service (`https://tcc-bridge.onrender.com`).

**Note:** Render free tier sleeps; first load may take ~30s. Use **Demo Scenario** in the UI (no PowerShell required).

---

## Option D — Fly.io (single region)

```bash
fly launch --no-deploy   # from repo root, follow prompts
fly deploy
```

Use `docker-compose.yml` as reference; many teams run **bridge + legacy** as two Fly apps or one machine with compose.

---

## Environment variables (bridge)

| Variable | Purpose |
|----------|---------|
| `LEGACY_API_URL` | e.g. `http://legacy:5080` (compose) or public legacy URL |
| `DATA_DIR` | Writable path for `live_stream.log` |
| `DASHBOARD_DIR` | `/dashboard` in Docker |
| `OPENAI_API_KEY` | LLM brief + Q&A |
| `EDGE_TTS_VOICE` | Default `en-US-JennyNeural` |
| `DEPLOY_ENV` | Shown in UI badge (`production-demo`) |

---

## Production hardening (post-demo)

- Auth on `/api/contain`, `/api/demo/scenario`, `/api/narration/speak`
- Rate limits + HTTPS only
- Do not commit `.env` or API keys

---

## Leadership demo checklist

1. Hard refresh the deployed URL at `/`.
2. **Start voice tour** (or press **Voice tour** in toolbar).
3. **Platform & demo** → Critical campaign → **AI intelligence** → **Executive command** → Contain.
4. **Board summary** for a printable takeaway.
