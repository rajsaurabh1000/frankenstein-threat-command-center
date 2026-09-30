"""Origin geolocation enrichment for the 3D attack map.

The challenge's telemetry uses *simulated* addresses (AttackSim picks random 103.25.12.x), so a
real geo-IP database would be meaningless. Instead each address is mapped deterministically to a
plausible location for its range, and every result is marked ``illustrative=True`` - the UI says so.
Private / loopback addresses are internal activity: no attack arc, flagged ``internal=True``.

In production this module would call a geo-IP service (e.g. MaxMind) behind the same interface.
"""

from __future__ import annotations

import hashlib
import ipaddress
import os

from models import GeoLocation, ThreatEvent

# (city, country, lat, lon)
APAC = [
    ("Singapore", "SG", 1.35, 103.82),
    ("Hong Kong", "HK", 22.32, 114.17),
    ("Jakarta", "ID", -6.21, 106.85),
    ("Hanoi", "VN", 21.03, 105.85),
    ("Manila", "PH", 14.60, 120.98),
    ("Mumbai", "IN", 19.08, 72.88),
    ("Seoul", "KR", 37.57, 126.98),
    ("Bangkok", "TH", 13.76, 100.50),
]
WORLD = [
    ("São Paulo", "BR", -23.55, -46.63),
    ("Lagos", "NG", 6.52, 3.38),
    ("London", "GB", 51.51, -0.13),
    ("Moscow", "RU", 55.76, 37.62),
    ("Istanbul", "TR", 41.01, 28.98),
    ("Bucharest", "RO", 44.43, 26.10),
    ("Tehran", "IR", 35.69, 51.39),
    ("Kyiv", "UA", 50.45, 30.52),
    ("Buenos Aires", "AR", -34.60, -58.38),
    ("Johannesburg", "ZA", -26.20, 28.05),
    ("Amsterdam", "NL", 52.37, 4.90),
    ("Sydney", "AU", -33.87, 151.21),
]
# Known ranges seen in this demo's telemetry -> region
PREFIXES: list[tuple[ipaddress.IPv4Network, list[tuple[str, str, float, float]]]] = [
    (ipaddress.ip_network("103.0.0.0/8"), APAC),  # APNIC space (AttackSim's 103.25.12.x)
    (ipaddress.ip_network("185.220.101.0/24"), [("Frankfurt", "DE", 50.11, 8.68)]),  # well-known Tor exit range
    (ipaddress.ip_network("45.33.0.0/17"), [("Newark", "US", 40.74, -74.17)]),  # cloud hosting (Linode)
]

# Where the protected assets live: the tenant's region.
REGION_TARGETS = {
    "us-west-2": ("Oregon (us-west-2)", "US", 45.84, -119.70),
    "us-east-1": ("N. Virginia (us-east-1)", "US", 38.95, -77.45),
    "eu-west-1": ("Ireland (eu-west-1)", "IE", 53.35, -6.26),
    "ap-southeast-1": ("Singapore (ap-southeast-1)", "SG", 1.35, 103.82),
}


# RFC 5737 documentation ranges. Python classes them as "private", but the demo's scenario packs
# use them as *external* attackers, so they must not be treated as the internal network.
DOCUMENTATION_NETS = [ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")]


def is_internal(ip: str) -> bool:
    """True for the protected network itself (RFC 1918, loopback, link-local); False for attackers."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.version == 4 and any(addr in net for net in DOCUMENTATION_NETS):
        return False
    return addr.is_private or addr.is_loopback or addr.is_link_local


def _pick(options: list, ip: str) -> tuple[str, str, float, float]:
    digest = int(hashlib.sha256(ip.encode()).hexdigest()[:8], 16)
    return options[digest % len(options)]


def locate(ip: str) -> GeoLocation | None:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if is_internal(ip):
        return GeoLocation(city="Internal network", country="LAN", lat=0.0, lon=0.0, internal=True, illustrative=True)
    for net, cities in PREFIXES:
        if addr.version == 4 and addr in net:
            city, country, lat, lon = _pick(cities, ip)
            return GeoLocation(city=city, country=country, lat=lat, lon=lon, internal=False, illustrative=True)
    city, country, lat, lon = _pick(WORLD, ip)
    return GeoLocation(city=city, country=country, lat=lat, lon=lon, internal=False, illustrative=True)


def target_location(region: str | None = None) -> GeoLocation:
    region = (region or os.environ.get("TCC_REGION", "us-west-2")).strip().lower()
    city, country, lat, lon = REGION_TARGETS.get(region, REGION_TARGETS["us-west-2"])
    return GeoLocation(city=city, country=country, lat=lat, lon=lon, internal=False, illustrative=False)


# Which region each protected asset (ThreatEvent.destination) runs in. The modern web tier is in
# the tenant's primary region; the legacy ASP.NET core still runs in the original datacenter.
DEFAULT_ASSET_REGIONS = "web-app-01=us-west-2,legacy-saas-core=us-east-1"


def asset_regions(spec: str | None = None) -> dict[str, str]:
    spec = spec if spec is not None else os.environ.get("TCC_ASSET_REGIONS", DEFAULT_ASSET_REGIONS)
    mapping: dict[str, str] = {}
    for part in spec.split(","):
        asset, _, region = part.partition("=")
        asset, region = asset.strip(), region.strip().lower()
        if asset and region in REGION_TARGETS:
            mapping[asset] = region
    return mapping


def region_for(destination: str, spec: str | None = None) -> str:
    """Region of the asset an event targeted; unknown assets fall back to the primary region."""
    primary = os.environ.get("TCC_REGION", "us-west-2").strip().lower()
    return asset_regions(spec).get(destination, primary if primary in REGION_TARGETS else "us-west-2")


def protected_regions(spec: str | None = None) -> list[dict]:
    """Every protected region with its assets, for the attack map (primary region first)."""
    primary = os.environ.get("TCC_REGION", "us-west-2").strip().lower()
    by_region: dict[str, list[str]] = {}
    for asset, region in asset_regions(spec).items():
        by_region.setdefault(region, []).append(asset)
    by_region.setdefault(primary if primary in REGION_TARGETS else "us-west-2", [])
    out = []
    for region in sorted(by_region, key=lambda r: (r != primary, r)):
        loc = target_location(region)
        out.append({"region": region, "city": loc.city, "country": loc.country, "lat": loc.lat, "lon": loc.lon,
                    "assets": sorted(by_region[region]), "primary": region == primary})
    return out


def enrich(event: ThreatEvent) -> ThreatEvent:
    if event.geo is not None:
        return event
    geo = locate(event.source_ip)
    return event.model_copy(update={"geo": geo}) if geo else event
