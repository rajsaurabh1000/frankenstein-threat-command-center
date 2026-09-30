#!/usr/bin/env python3
"""Build the dot-matrix land mask used by the 3D attack globe.

Samples an approximately equal-area lat/lon grid and keeps points that fall on land in
Natural Earth's 1:110m land polygons (public domain, https://www.naturalearthdata.com/).
Output: dashboard/assets/geo/land-dots.json  {"step": deg, "points": [lat*10, lon*10, ...]}

    python3 scripts/generate_land_dots.py            # downloads the GeoJSON if needed
    python3 scripts/generate_land_dots.py land.geojson
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "dashboard" / "assets" / "geo" / "land-dots.json"
SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"
STEP = 1.6  # degrees of latitude between rows


def load(path: str | None) -> dict:
    if path:
        return json.loads(Path(path).read_text())
    with urllib.request.urlopen(SOURCE, timeout=30) as resp:  # noqa: S310 - fixed public URL
        return json.loads(resp.read())


def rings(geojson: dict):
    for feature in geojson["features"]:
        geom = feature["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in polys:
            outer, holes = poly[0], poly[1:]
            xs = [p[0] for p in outer]
            ys = [p[1] for p in outer]
            yield (min(xs), min(ys), max(xs), max(ys)), outer, holes


def inside(lon: float, lat: float, ring: list) -> bool:
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def on_land(lon: float, lat: float, polys: list) -> bool:
    for (x0, y0, x1, y1), outer, holes in polys:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and inside(lon, lat, outer):
            if not any(inside(lon, lat, h) for h in holes):
                return True
    return False


def main() -> None:
    polys = list(rings(load(sys.argv[1] if len(sys.argv) > 1 else None)))
    points: list[int] = []
    lat = -56.0
    while lat <= 83.0:
        lon_step = STEP / max(0.2, math.cos(math.radians(lat)))  # widen spacing toward the poles
        lon = -180.0 + (lon_step / 2)
        while lon < 180.0:
            if on_land(lon, lat, polys):
                points += [round(lat * 10), round(lon * 10)]
            lon += lon_step
        lat += STEP
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "Natural Earth 1:110m land (public domain)", "step": STEP, "points": points}, separators=(",", ":")))
    print(f"{len(points) // 2} land dots -> {OUT.relative_to(REPO)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
