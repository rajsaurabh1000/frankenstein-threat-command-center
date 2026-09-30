"""Origin geolocation enrichment for the attack map (illustrative, deterministic)."""

from datetime import datetime, timezone

import geo
from models import TelemetrySource, ThreatEvent
from scenario import SCENARIO_PACKS


def test_every_scenario_origin_gets_a_valid_location():
    for pack in SCENARIO_PACKS.values():
        for entry in pack:
            loc = geo.locate(entry["origin"])
            assert loc is not None
            assert -90 <= loc.lat <= 90 and -180 <= loc.lon <= 180
            assert loc.illustrative is True  # simulated addresses: the UI labels positions as illustrative
            # every scenario origin is an external attacker, except the "normal" pack's internal DNS host
            assert loc.internal == geo.is_internal(entry["origin"])
    attackers = [e["origin"] for name in ("port_scan", "brute_force", "critical") for e in SCENARIO_PACKS[name]]
    assert not any(geo.locate(ip).internal for ip in attackers)


def test_attacksim_range_maps_to_asia_pacific_and_is_deterministic():
    first = geo.locate("103.25.12.200")
    assert first.country in {c for _, c, _, _ in geo.APAC}
    assert geo.locate("103.25.12.200") == first


def test_internal_addresses_are_not_attack_origins():
    for ip in ("192.168.1.1", "10.0.0.5", "172.16.4.88", "127.0.0.1"):
        assert geo.is_internal(ip) and geo.locate(ip).internal
    for ip in ("198.51.100.22", "203.0.113.44", "103.25.12.9"):  # RFC 5737 ranges are external attackers here
        assert not geo.is_internal(ip)
    assert geo.locate("not-an-ip") is None


def test_target_follows_the_tenant_region():
    assert geo.target_location("us-west-2").city.startswith("Oregon")
    assert geo.target_location("eu-west-1").country == "IE"
    assert geo.target_location("unknown-region").city.startswith("Oregon")


def test_enrich_adds_geo_to_the_event():
    event = ThreatEvent(
        event_id="evt-g",
        timestamp=datetime.now(timezone.utc),
        source=TelemetrySource.LIVE_STREAM,
        attack_type="Port Scan",
        source_ip="185.220.101.12",
    )
    assert geo.enrich(event).geo.city == "Frankfurt"
