"""MITRE ATT&CK enrichment: every attack type the sources emit maps to a real technique."""

import re
from datetime import datetime, timezone

from mitre import ATTACK_TECHNIQUES, TACTIC_ACTIONS, enrich, technique_for, technique_url
from models import TelemetrySource, ThreatEvent
from scenario import SCENARIO_PACKS

ATTACKSIM_TYPES = {"Brute Force", "SQL Injection", "Port Scan", "Credential Stuffing"}  # chaos/AttackSim.ps1
LEGACY_TYPES = {"Login Attempt", "SSH Connection", "File Access", "DNS Query", "Admin Escalation"}  # legacy/Program.cs


def test_every_emitted_attack_type_is_mapped():
    scenario_types = {e["type"] for pack in SCENARIO_PACKS.values() for e in pack}
    assert (ATTACKSIM_TYPES | LEGACY_TYPES | scenario_types) <= set(ATTACK_TECHNIQUES)


def test_technique_ids_and_tactics_are_well_formed():
    for tid, _name, tactic in ATTACK_TECHNIQUES.values():
        assert re.fullmatch(r"T\d{4}(\.\d{3})?", tid)
        assert tactic in TACTIC_ACTIONS


def test_known_mappings_and_sub_technique_url():
    assert technique_for("SQL Injection").id == "T1190"
    assert technique_for("Brute Force").tactic == "Credential Access"
    assert technique_url("T1110.004") == "https://attack.mitre.org/techniques/T1110/004/"
    assert technique_for("Something New") is None


def test_enrich_tags_event_and_leaves_unknown_untouched():
    def ev(attack):
        return ThreatEvent(
            event_id="evt-x",
            timestamp=datetime.now(timezone.utc),
            source=TelemetrySource.LIVE_STREAM,
            attack_type=attack,
            source_ip="103.25.12.9",
        )

    tagged = enrich(ev("Credential Stuffing"))
    assert tagged.technique.id == "T1110.004" and tagged.technique.tactic == "Credential Access"
    assert enrich(ev("CONTAINMENT")).technique is None
