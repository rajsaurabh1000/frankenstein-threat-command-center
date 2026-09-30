"""MITRE ATT&CK (Enterprise) enrichment.

Pipeline stage after normalization and dedup: every ThreatEvent whose attack type we recognize
gets its ATT&CK technique (ID, name, tactic, reference URL) - the vocabulary SOC teams and
XDR/XSIAM consoles use to describe adversary behaviour. Unknown types pass through unchanged.
"""

from __future__ import annotations

from models import AttackTechnique, ThreatEvent

# attack_type -> (technique ID, technique name, primary tactic)
ATTACK_TECHNIQUES: dict[str, tuple[str, str, str]] = {
    "SQL Injection": ("T1190", "Exploit Public-Facing Application", "Initial Access"),
    "Brute Force": ("T1110", "Brute Force", "Credential Access"),
    "Credential Stuffing": ("T1110.004", "Brute Force: Credential Stuffing", "Credential Access"),
    "Port Scan": ("T1046", "Network Service Discovery", "Discovery"),
    "Admin Escalation": ("T1068", "Exploitation for Privilege Escalation", "Privilege Escalation"),
    "SSH Connection": ("T1021.004", "Remote Services: SSH", "Lateral Movement"),
    "Login Attempt": ("T1078", "Valid Accounts", "Initial Access"),
    "File Access": ("T1083", "File and Directory Discovery", "Discovery"),
    "DNS Query": ("T1071.004", "Application Layer Protocol: DNS", "Command and Control"),
}

# Tactic-aware response guidance used by the playbook.
TACTIC_ACTIONS: dict[str, str] = {
    "Initial Access": "Apply WAF virtual patching on exposed web apps and block the exploit source at the perimeter.",
    "Credential Access": "Enforce MFA and account lockout on targeted identities; reset any credentials seen in stuffing lists.",
    "Discovery": "Block the scanning sources and tighten segmentation so reconnaissance cannot map internal services.",
    "Privilege Escalation": "Isolate affected hosts and revoke elevated sessions pending forensic review.",
    "Lateral Movement": "Restrict SSH to bastion hosts and rotate keys on systems touched by the source.",
    "Command and Control": "Sinkhole suspicious domains and alert on anomalous DNS egress.",
}


def technique_url(technique_id: str) -> str:
    return "https://attack.mitre.org/techniques/" + technique_id.replace(".", "/") + "/"


def technique_for(attack_type: str) -> AttackTechnique | None:
    entry = ATTACK_TECHNIQUES.get(attack_type)
    if not entry:
        return None
    tid, name, tactic = entry
    return AttackTechnique(id=tid, name=name, tactic=tactic, url=technique_url(tid))


def enrich(event: ThreatEvent) -> ThreatEvent:
    if event.technique is not None:
        return event
    technique = technique_for(event.attack_type)
    return event.model_copy(update={"technique": technique}) if technique else event
