#!/usr/bin/env python3
"""Render the system architecture diagram (diagram-as-code, explicit layout).

    python3 docs/architecture/generate_architecture.py
    -> docs/architecture/architecture.svg

Three bands (Sources -> Analytics Bridge -> Command Center), orthogonal connectors, and three
edge styles: data flow (grey), the scoring hot path (orange) and the response loop (green, dashed).
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent / "architecture.svg"
W, H = 1200, 1000

ORANGE = "#fa582d"
GREEN = "#3dd68c"
GREY = "#8a97aa"
FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

parts: list[str] = []


def text(x, y, s, size=15, color="#e2e8f0", weight=400, anchor="middle", spacing=0, italic=False):
    style = "font-style:italic;" if italic else ""
    parts.append(
        f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" '
        f'text-anchor="{anchor}" letter-spacing="{spacing}" style="{style}">{escape(s)}</text>'
    )


def band(x, y, w, h, label, sub="", label_dx=0):
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="#0b1120" '
        f'stroke="#263244" stroke-width="1.5"/>'
    )
    text(x + 22 + label_dx, y + 30, label, size=14, color=ORANGE, weight=800, anchor="start", spacing=1.6)
    if sub:  # right after the label, so no connector ever crosses it
        text(x + 22 + label_dx + len(label) * 10.6 + 16, y + 30, "· " + sub, size=13, color="#64748b", weight=600, anchor="start")


def box(x, y, w, h, title, lines=(), key=False):
    fill, stroke, tcol = ("#2a1208", ORANGE, "#fed7aa") if key else ("#141c2b", "#3b4a60", "#f1f5f9")
    parts.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="11" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{2 if key else 1.4}"/>'
    )
    n = 1 + len(lines)
    top = y + h / 2 - (n - 1) * 10.5 + 6
    text(x + w / 2, top, title, size=17, color=tcol, weight=700)
    for i, line in enumerate(lines):
        text(x + w / 2, top + 21 * (i + 1), line, size=14, color="#94a3b8")


def store(x, y, w, h, title, sub):
    ry = 11
    parts.append(
        f'<path d="M{x},{y + ry} a{w / 2},{ry} 0 0,1 {w},0 v{h - 2 * ry} a{w / 2},{ry} 0 0,1 {-w},0 z" '
        f'fill="#111827" stroke="#52627a" stroke-width="1.4"/>'
    )
    parts.append(
        f'<path d="M{x},{y + ry} a{w / 2},{ry} 0 0,0 {w},0" fill="none" stroke="#52627a" stroke-width="1.4"/>'
    )
    text(x + w / 2, y + h / 2 + 8, title, size=16, color="#e2e8f0", weight=700)
    text(x + w / 2, y + h / 2 + 28, sub, size=13, color="#94a3b8")


def edge(points, kind="flow", label=None, label_at=None, label_anchor="middle"):
    color, width, dash, marker = {
        "flow": (GREY, 2, "", "grey"),
        "hot": (ORANGE, 3, "", "orange"),
        "respond": (GREEN, 2.6, 'stroke-dasharray="8 6"', "green"),
    }[kind]
    d = "M" + " L".join(f"{px},{py}" for px, py in points)
    parts.append(
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" {dash} '
        f'stroke-linejoin="round" marker-end="url(#arrow-{marker})"/>'
    )
    if label:
        lx, ly = label_at
        pad = 6
        est = len(label) * 7.1
        bx = lx - est / 2 if label_anchor == "middle" else (lx if label_anchor == "start" else lx - est)
        parts.append(
            f'<rect x="{bx - pad}" y="{ly - 15}" width="{est + 2 * pad}" height="22" rx="6" fill="#070b12" opacity="0.92"/>'
        )
        text(lx, ly, label, size=13, color={"flow": "#aab6c7", "hot": "#fdba74", "respond": "#86efac"}[kind],
             weight=600, anchor=label_anchor)


# ---------------------------------------------------------------- canvas + title
parts.append(f'<rect width="{W}" height="{H}" fill="#05080e"/>')
text(40, 44, "Threat Command Center · system architecture", size=24, color="#ffffff", weight=800, anchor="start")
# legend
lx = 700
for i, (kind, label) in enumerate((("flow", "data flow"), ("hot", "scoring hot path"), ("respond", "response loop"))):
    x0 = lx + i * 170
    color = {"flow": GREY, "hot": ORANGE, "respond": GREEN}[kind]
    dash = 'stroke-dasharray="7 5"' if kind == "respond" else ""
    parts.append(f'<line x1="{x0}" y1="38" x2="{x0 + 34}" y2="38" stroke="{color}" stroke-width="3" {dash}/>')
    text(x0 + 42, 43, label, size=13, color="#94a3b8", weight=600, anchor="start")

# ---------------------------------------------------------------- 1. sources
band(30, 70, 1140, 190, "SOURCES", "as provided by the challenge")
box(60, 118, 270, 112, "Legacy Core", ("ASP.NET 8 minimal API", "GET /api/raw-logs · :5080"))
store(380, 124, 150, 100, ".attack_stop", "stop flag")
box(575, 118, 280, 112, "Chaos Monkey", ("AttackSim.ps1 · PowerShell 7", "random attack every 1–3 s"))
store(905, 124, 230, 100, "live_stream.log", "JSON lines · ISO-8601 ts")
edge([(530, 174), (573, 174)], "respond")
text(551, 250, "checked every loop → exits", size=12, color="#86efac", weight=600)
edge([(855, 174), (903, 174)], "flow")
text(879, 162, "append", size=12, color="#aab6c7", weight=600)

# ---------------------------------------------------------------- 2. analytics bridge
band(30, 300, 1140, 420, "ANALYTICS BRIDGE", "Python · FastAPI · :8000")
box(60, 348, 270, 80, "LegacyPoller", ("HTTP poll · every 5 s",))
box(880, 348, 280 - 10, 80, "LogTailer", ("byte-offset tail · 350 ms",))
# pipeline row
PY, PH = 478, 104
box(60, PY, 250, PH, "Source adapters", ("→ ThreatEvent v1.1", "Pydantic validated"), key=True)
box(345, PY, 250, PH, "Deduplicator", ("sha256 event_id", "bounded TTL cache"))
box(630, PY, 250, PH, "Enrichment", ("MITRE ATT&CK technique", "origin geo · asset region"))
box(915, PY, 245, PH, "ThreatScorer", ("event risk · landscape", "critical_alarm"), key=True)
# row 3
box(60, 628, 270, 72, "Control-plane guard", ("rate limit · operator token",))
box(560, 628, 250, 72, "BriefGenerator", ("brief · playbook · Q&A",))
box(915, 628, 245, 72, "WebSocket hub", ("/ws/threats",))

edge([(195, 428), (195, 476)], "flow")
edge([(1015, 428), (1015, 452), (240, 452), (240, 476)], "flow")  # tailer -> adapters
edge([(310, PY + PH / 2), (343, PY + PH / 2)], "hot")
edge([(595, PY + PH / 2), (628, PY + PH / 2)], "hot")
edge([(880, PY + PH / 2), (913, PY + PH / 2)], "hot")
edge([(1037, PY + PH), (1037, 626)], "hot")
edge([(960, PY + PH), (960, 604), (685, 604), (685, 626)], "flow")
edge([(810, 664), (913, 664)], "flow")

# sources -> bridge
edge([(195, 230), (195, 346)], "flow")
text(205, 250, "raw JSON", size=12, color="#aab6c7", weight=600, anchor="start")
edge([(950, 224), (950, 346)], "flow")
text(960, 250, "new lines", size=12, color="#aab6c7", weight=600, anchor="start")

# ---------------------------------------------------------------- 3. command center
band(30, 780, 1140, 190, "THREAT COMMAND CENTER", "Vue 3 · no build step · same origin", label_dx=132)  # clear of the control edge
cards = [
    ("Threat meter", ("+ critical-zone alarm",), True),
    ("Live threat queue", ("ATT&CK chips · health",), False),
    ("3D attack globe", ("multi-region arcs",), False),
    ("Brief + playbook", ("executive view",), False),
    ("Lumi copilot", ("voice tour · Q&A",), False),
]
cw, gap, cx0 = 202, 20, 60
for i, (t, lines, key) in enumerate(cards):
    box(cx0 + i * (cw + gap), 830, cw, 108, t, lines, key=key)

# bridge -> UI (publish) and UI -> bridge (control)
edge([(1037, 700), (1037, 828)], "hot", "event · state · brief · health", (1037, 752))
edge([(160, 828), (160, 702)], "respond", "POST /api/contain · /api/demo/scenario", (170, 752), "start")

# response loop back to the sources: guard -> stop flag (contain) and -> log (inject)
edge([(60, 664), (44, 664), (44, 282), (455, 282), (455, 226)], "respond", "contain → write stop flag", (250, 276))
edge([(455, 282), (1090, 282), (1090, 226)], "respond", "inject → append attack pack", (760, 276))

defs = f"""<defs>
  <marker id="arrow-grey" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{GREY}"/></marker>
  <marker id="arrow-orange" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{ORANGE}"/></marker>
  <marker id="arrow-green" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{GREEN}"/></marker>
</defs>"""

svg = (
    f'<?xml version="1.0" encoding="UTF-8"?>\n'
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    f'font-family="{escape(FONT)}" role="img" aria-label="Threat Command Center system architecture">\n'
    f"{defs}\n" + "\n".join(parts) + "\n</svg>\n"
)
OUT.write_text(svg, encoding="utf-8")
print(f"wrote {OUT} ({len(svg) // 1024} KB)")
