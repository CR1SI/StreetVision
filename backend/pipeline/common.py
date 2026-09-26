"""
Shared helpers: PDF text and project-title -> endpoint parsing.

A project can name one substation (a point), two (a line), a chain (A - B - C), or
several line items joined by '&', '/', or 'and'. split_endpoints returns every segment.
"""
import json
import re

import pdfplumber

NOISE = re.compile(
    r"\b(transmission|lines?|tie|sub|substation|switching|station|sw sta|tap|fold-in|dep|spdc|spsc|"
    r"rebuilds?|rebld|construct|reconductor|reactors?|relay|panel|upgrades?|modernization|new|auto|"
    r"transformers?|second|bank(?: [a-z])?|replacement|strategic|project|conversion|section|sect|"
    r"single circuit|circuit|\d+[a-z]?\s*kv|\d{3,4})\b|#\s*\d+",
    re.I)
KV = re.compile(r"(\d{2,3})(?:\.\d)?(?:\s*[-/]\s*\d{2,3}(?:\.\d)?)?\s*kv", re.I)
# spaced hyphen, en/em dash, or a hyphen joining two names (Okatie-Bluffton, ECHECONNEE-WELLSTON)
DASH = re.compile(r"\s*[–—]\s*|\s+-\s+|(?<=[A-Za-z0-9])-(?=[A-Z])")
SAV_MARK = "SAVTAGX"   # keeps "Goshen (SAV)" distinct from the Augusta-area "Goshen"


def pdf_text(path: str) -> str:
    with pdfplumber.open(path) as pdf:
        return "\n".join((p.extract_text() or "") for p in pdf.pages)


def clean_name(name: str) -> str | None:
    name = NOISE.sub(" ", name)
    name = re.sub(r"[()]", " ", name)
    name = " ".join(name.split()).strip(" -–—,.")
    if not name:
        return None
    return name.title().replace(SAV_MARK.title(), "(SAV)").strip()


def _chain_segments(item: str) -> list[list]:
    names = [n for n in (clean_name(p) for p in DASH.split(item)) if n]
    if len(names) >= 2:
        return [[a, b] for a, b in zip(names, names[1:])]
    return [[names[0], None]] if names else []


def _from_description(desc: str, known: str | None) -> list[list]:
    """Tap projects often name their endpoints only in the description.
    Only accept a pair that includes the title's own name, so a tapped host line
    ("Tap off the Edmund - Owens Corning line") is not mistaken for the project."""
    if not desc or not known:
        return []
    stop = r"(?:[.,;]| \d| approximately| to | sub\b| substation\b| terminal)"
    pats = [rf"\bfrom (?:the )?(.+?) to (?:the )?(.+?){stop}",
            rf"\bbetween (?:the )?(.+?) (?:and|&) (?:the )?(.+?){stop}",
            rf"\bconstruct (.+?)\s[–—-]\s(.+?){stop}"]
    for pat in pats:
        for a, b in re.findall(pat, desc, re.I):
            a, b = clean_name(KV.sub(" ", a)), clean_name(KV.sub(" ", b))
            if a and b and known.lower() in (a.lower(), b.lower()):
                return [[a, b]]
    return []


def split_endpoints(title: str, description: str = "") -> dict:
    """
    'Urquhart – Toolebeck 115kV line: Rebuild'          -> [[Urquhart, Toolebeck]]
    'Okatie 230-115kV Substation, Jasper – Yemassee ...' -> [[Okatie, None]]   (ratio stripped first)
    'VCS1-Denny Terrace 230kV & VCS1-Pineland 230kV'    -> [[Vcs1, Denny Terrace], [Vcs1, Pineland]]
    'Church Creek – Faber Place – Charleston Transm.'   -> [[Church Creek, Faber Place], [Faber Place, Charleston]]
    'SAV: GOSHEN (SAV) - MCINTOSH 115KV LINE REBUILD'   -> [[Goshen (SAV), Mcintosh]]
    'Cainhoy 115 kV Tap' + 'tap from Cainhoy to Clements Ferry' -> [[Cainhoy, Clements Ferry]]
    """
    t = re.sub(r"^(?:[A-Z]{2,5}:\s*|GRID\s*-\s*)", "", title.strip())
    t = re.sub(r"\s*\(SAV\)", f" {SAV_MARK}", t)
    t = re.sub(r"\([^)]*\)", " ", t)                   # owner tags and asides: (USA), (1.4 miles), ...
    kv_m = KV.search(t)
    kv = int(kv_m.group(1)) if kv_m else None
    t = KV.sub(" ", t)                                  # voltage ratios gone BEFORE splitting on dashes
    t = t.split(":")[0].split(",")[0]

    segments = []
    for item in re.split(r"&|/|\band\b", t, flags=re.I):
        segments += _chain_segments(item)

    source = "title" if segments else "none"
    named = {n for seg in segments for n in seg if n}
    if len(named) < 2:
        found = _from_description(description, next(iter(named), None))
        if found:
            segments, source = found, "description"

    first = segments[0] if segments else [None, None]
    return {"a": first[0], "b": first[1], "kv": kv,
            "segments": json.dumps(segments), "source": source}
