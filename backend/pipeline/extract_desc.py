"""
Parse DESC SCRTP "Planned Transmission Projects $2M and above" PDFs.

The first PDF is the BASELINE (the organizers' 2024-2028 edition, which their answer key
was built from). Any later PDFs are an "updated dates" pass: their dates go into
*_updated columns next to the baseline -- never overwriting it -- and projects that only
exist in the newer edition are added with new_in_update=True.

Usage:
  python -m pipeline.extract_desc data/raw/2024-2028-...pdf [data/raw/2026-2030-...pdf] data/processed/desc_projects.csv
"""
import difflib
import json
import re
import sys

import pandas as pd

from api.models import ProjectRecord
from pipeline.common import KV, NOISE, pdf_text, split_endpoints

MONEY = r"\$?[\d,]+(?:\.\d+)?"
BUILD_THRESHOLD = 500_000  # a year counts as a construction year above this planned spend


def id_key(pid) -> str:
    """'0139 M,N' and '139 M, N' -> '139M,N'. Formats drift between editions."""
    return re.sub(r"\s+", "", str(pid)).lstrip("0").upper()


def field(block, label, next_label):
    m = re.search(rf"{label}\s*\n(.*?)\n\s*{next_label}", block, re.S)
    return " ".join(m.group(1).split()) if m else ""


def parse_block(block, years, edition):
    name = field(block, r"5 Year Budget", r"Project ID")
    description = field(block, r"Project Description", r"Project Need")
    in_service_raw = field(block, r"Planned In-Service Date", r"Estimated Project Cost")

    # Some dates are impossible (04/31/26, 06/31/2026): keep the raw text, take the last year.
    found = re.findall(r"/(\d{4}|\d{2})\b", in_service_raw)
    in_service_year = None
    if found:
        y = found[-1]
        in_service_year = int(y) if len(y) == 4 else 2000 + int(y)

    spend = {}
    row = re.search(r"Previous(?: \d{4}){5} Total\*?\s*\n(.+)", block)
    if row:
        nums = [float(v.replace("$", "").replace(",", "")) for v in re.findall(MONEY, row.group(1))]
        if len(nums) >= 7:
            spend = dict(zip(years, nums[1:6]))
            spend["total"] = nums[6]

    build_years = [y for y in years if spend.get(y, 0) > BUILD_THRESHOLD]
    if build_years:
        start, end, src = min(build_years), max(build_years), "spend"
    elif in_service_year:
        start, end, src = in_service_year - 1, in_service_year, "estimated"
    else:
        start = end = None
        src = "unknown"

    ep = split_endpoints(name, description)
    return {
        "utility": "DESC", "project_id": field(block, r"Project ID", r"Project Description"),
        "name": name, "description": description,
        "need": field(block, r"Project Need", r"Project Status"),
        "status": field(block, r"Project Status", r"Planned In-Service Date"),
        "in_service_raw": in_service_raw, "in_service_year": in_service_year,
        "build_start": start, "build_end": end, "window_source": src,
        "total_cost": spend.get("total"), "kv": ep["kv"],
        "endpoint_a": ep["a"], "endpoint_b": ep["b"], "segments": ep["segments"],
        "endpoints_from": ep["source"], "edition": edition,
    }


def parse_text(text):
    header = re.search(r"Previous((?: \d{4}){5}) Total", text)
    years = [int(y) for y in header.group(1).split()]
    edition = f"{years[0]}-{years[-1]}"
    blocks = re.split(r"Project \d+ of \d+", text)[1:]
    return pd.DataFrame([parse_block(b, years, edition) for b in blocks])


NAME_MATCH = 0.6      # an ID match is trusted only if the names agree at least this much
NAME_ONLY_MATCH = 0.85  # a name match alone (ID changed between editions) needs this much


def name_key(name: str) -> str:
    """Comparable project name: title before the colon, without voltages and filler words."""
    t = KV.sub(" ", str(name).split(":")[0])
    t = NOISE.sub(" ", t)
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", t.lower()).split())


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, name_key(a), name_key(b)).ratio()


def merge_editions(baseline: pd.DataFrame, updates: list[pd.DataFrame]) -> tuple[pd.DataFrame, dict]:
    """Layer newer editions onto the baseline. The newer PDF reuses and changes IDs
    (6809 G is Stevens Creek - Hooks in 2024-2028 but Hooks - Modoc in 2026-2030; 6809 M appears
    twice in 2026-2030; Riverport moved from 06367 A - C, H to 6367 D), so a match needs the
    names to agree. Returns the merged table and a report of every decision that wasn't a clean ID match."""
    out = baseline.copy()
    for col in ("in_service_raw_updated", "build_start_updated", "build_end_updated", "edition_updated",
                "project_id_updated", "match_note"):
        out[col] = None
    out["new_in_update"] = False
    out["id_norm"] = out["project_id"].map(id_key)
    report = {"by_id": 0, "by_name": [], "id_reused": [], "new": []}

    def apply(i, r, note=None):
        out.loc[i, ["in_service_raw_updated", "build_start_updated", "build_end_updated", "edition_updated",
                    "project_id_updated"]] = [r.in_service_raw, r.build_start, r.build_end, r.edition, r.project_id]
        if note:
            out.loc[i, "match_note"] = note

    for upd in updates:
        upd = upd.assign(id_norm=upd["project_id"].map(id_key))
        done = set()
        for r in upd.itertuples():
            base_rows = out.index[~out["new_in_update"]]
            same_id = [i for i in base_rows if out.at[i, "id_norm"] == r.id_norm and i not in done]
            best = max(same_id, key=lambda i: similarity(out.at[i, "name"], r.name), default=None)
            if best is not None and similarity(out.at[best, "name"], r.name) >= NAME_MATCH:
                apply(best, r); done.add(best); report["by_id"] += 1
                continue
            id_taken = (out["id_norm"] == r.id_norm).any()

            # ID changed between editions: match on name, only if clearly one candidate
            cands = sorted(((similarity(out.at[i, "name"], r.name), i) for i in base_rows if i not in done), reverse=True)
            if cands and cands[0][0] >= NAME_ONLY_MATCH and (len(cands) == 1 or cands[0][0] - cands[1][0] >= 0.05):
                i = cands[0][1]
                apply(i, r, f"matched by name: ID {out.at[i, 'project_id']} -> {r.project_id} in {r.edition}")
                done.add(i); report["by_name"].append((out.at[i, "project_id"], r.project_id, r.name))
                continue

            # genuinely new in the newer edition (e.g. Okatie - McIntosh series reactor)
            pid, note = r.project_id, None
            if id_taken:   # the source reuses this ID for a different project: keep both, distinguishable
                pid = f"{r.project_id} ({name_key(r.name).title()[:30]})"
                note = f"source PDF reuses ID {r.project_id} for a different project"
                report["id_reused"].append((r.project_id, r.name))
            row = {**r._asdict(), "project_id": pid, "id_norm": id_key(pid),
                   "in_service_raw_updated": r.in_service_raw, "build_start_updated": r.build_start,
                   "build_end_updated": r.build_end, "edition_updated": r.edition,
                   "project_id_updated": r.project_id, "match_note": note, "new_in_update": True}
            row.pop("Index", None)
            out = pd.concat([out, pd.DataFrame([row])], ignore_index=True)
            report["new"].append((pid, r.name))
    return out.drop(columns="id_norm"), report


def corridor_groups(df: pd.DataFrame) -> pd.Series:
    """Separate budget items on the same endpoints (e.g. Stevens Creek - Hooks, 6809 E and
    6809 G) are kept as distinct projects but share a corridor id so the UI can group them."""
    def key(seg_json):
        segs = json.loads(seg_json)
        if not segs or segs[0][1] is None:
            return None
        return " | ".join(sorted(segs[0]))
    keys = df["segments"].map(key)
    counts = keys.value_counts()
    return keys.where(keys.map(counts).fillna(0) > 1)


if __name__ == "__main__":
    *pdfs, out = sys.argv[1:]
    base = parse_text(pdf_text(pdfs[0]))
    df, report = merge_editions(base, [parse_text(pdf_text(p)) for p in pdfs[1:]])
    df["corridor_group"] = corridor_groups(df)

    df = df.astype(object).where(pd.notna(df), None)
    for rec in df.to_dict("records"):  # fail loudly on a bad row instead of shipping it
        ProjectRecord(**{k: v for k, v in rec.items() if k in ProjectRecord.model_fields})
    df.to_csv(out, index=False)

    print(f"{len(df)} DESC projects -> {out}  (baseline {base['edition'].iloc[0]})")
    if len(pdfs) > 1:
        print(f"  newer edition: {report['by_id']} matched by ID, {len(report['by_name'])} by name (ID changed), "
              f"{len(report['new'])} new, {len(report['id_reused'])} reused IDs")
        for old, new, name in report["by_name"]:
            print(f"    ID changed  {old} -> {new}: {name}")
        for pid, name in report["id_reused"]:
            print(f"    ID reused   {pid} also names a different project: {name}")
        stale = df[~df["new_in_update"].astype(bool) & df["edition_updated"].isna()]
        print(f"  baseline projects not in the newer edition (likely completed): {len(stale)}")
    print(f"  endpoints from description: {(df['endpoints_from'] == 'description').sum()}, "
          f"shared corridors: {df['corridor_group'].nunique()}")
