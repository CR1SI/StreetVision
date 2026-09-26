"""
Parse DESC SCRTP "Planned Transmission Projects $2M and above" PDFs.

The first PDF is the BASELINE (the organizers' 2024-2028 edition, which their answer key
was built from). Any later PDFs are an "updated dates" pass: their dates go into
*_updated columns next to the baseline -- never overwriting it -- and projects that only
exist in the newer edition are added with new_in_update=True.

Usage:
  python -m pipeline.extract_desc data/raw/2024-2028-...pdf [data/raw/2026-2030-...pdf] data/processed/desc_projects.csv
"""
import json
import re
import sys

import pandas as pd

from api.models import ProjectRecord
from pipeline.common import pdf_text, split_endpoints

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


def merge_editions(baseline: pd.DataFrame, updates: list[pd.DataFrame]) -> pd.DataFrame:
    out = baseline.copy()
    for col in ("in_service_raw_updated", "build_start_updated", "build_end_updated", "edition_updated"):
        out[col] = None
    out["new_in_update"] = False
    out["id_norm"] = out["project_id"].map(id_key)

    for upd in updates:
        upd = upd.assign(id_norm=upd["project_id"].map(id_key))
        for r in upd.itertuples():
            hit = out.index[out["id_norm"] == r.id_norm]
            if len(hit):
                out.loc[hit, "in_service_raw_updated"] = r.in_service_raw
                out.loc[hit, "build_start_updated"] = r.build_start
                out.loc[hit, "build_end_updated"] = r.build_end
                out.loc[hit, "edition_updated"] = r.edition
            else:  # only in the newer edition (e.g. Okatie - McIntosh series reactor)
                row = {**r._asdict(), "in_service_raw_updated": r.in_service_raw,
                       "build_start_updated": r.build_start, "build_end_updated": r.build_end,
                       "edition_updated": r.edition, "new_in_update": True}
                row.pop("Index", None)
                out = pd.concat([out, pd.DataFrame([row])], ignore_index=True)
    return out.drop(columns="id_norm")


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
    df = merge_editions(base, [parse_text(pdf_text(p)) for p in pdfs[1:]])
    df["corridor_group"] = corridor_groups(df)

    df = df.astype(object).where(pd.notna(df), None)
    for rec in df.to_dict("records"):  # fail loudly on a bad row instead of shipping it
        ProjectRecord(**{k: v for k, v in rec.items() if k in ProjectRecord.model_fields})
    df.to_csv(out, index=False)

    print(f"{len(df)} DESC projects -> {out}  (baseline {base['edition'].iloc[0]})")
    if len(pdfs) > 1:
        print(f"  updated dates from newer edition: {df['edition_updated'].notna().sum()}, "
              f"new projects: {int(df['new_in_update'].sum())}")
    print(f"  endpoints from description: {(df['endpoints_from'] == 'description').sum()}, "
          f"shared corridors: {df['corridor_group'].nunique()}")
