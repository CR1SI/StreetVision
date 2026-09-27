"""
What kind of work a project is, from its name (and description as a fallback).

The source PDFs don't label project types, so this is a keyword rule, checked in order;
the first match wins. Uploads can set project_type themselves; blank means "classify it".

  line_rebuild   Line rebuild / upgrade   existing line: rebuild, reconductor, upgrade, replace poles/structures
  new_line       New line or tap          construct a new line, tap, or added circuit
  substation     Substation work          equipment inside a substation: reactor, transformer, bank, relays
  area_package   Area package             several upgrades bundled under one name ("strategic solution")
  other          Other / unspecified      nothing in the text says which
"""
import re

PROJECT_TYPES = {
    "line_rebuild": "Line rebuild / upgrade",
    "new_line": "New line or tap",
    "substation": "Substation work",
    "area_package": "Area package",
    "other": "Other / unspecified",
}

# Order matters: a series reactor on a line is substation equipment, not a line rebuild;
# "Rebuild line from Santee Substation" is a rebuild, so the generic "substation" test comes last.
RULES = [
    ("area_package", r"strategic solution|area strategic|network improvements"),
    ("substation", r"reactor|transformer|autobank|\bbanks?\b|relay|sw(itch)?\.? ?house|capacitor|breaker|statcom"),
    ("new_line", r"\bconstruct|\bnew\b.*\bline\b|\badd\b.*\bline\b|second circuit"),
    ("line_rebuild", r"rebuild|\brebld\b|reconductor|upgrade|replace|\bpol(e|l)s?\b|structures|angles|uprate"),
    ("substation", r"substation|\bsub\b|fold-?in"),
    ("new_line", r"\btap\b|interconnection|\bline\b"),
]


def classify(name: str | None, description: str | None = None) -> str:
    """Project type key from the name, falling back to the description."""
    for text in (name, description):
        t = (text or "").lower()
        for kind, pattern in RULES:
            if re.search(pattern, t):
                return kind
    return "other"
