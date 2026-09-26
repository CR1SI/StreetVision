"""
Regression test against the organizers' worked example (Projects_Overlaps.xlsx:
10 projects DESC_1-5 / GPC_1-5 -> 6 overlaps OVL_1-6).

It feeds THEIR coordinates through OUR overlap method (pipeline.method, the reference the
PostGIS engine is cross-checked against),
so it tests the method independently of our geocoding. Pass = same set of overlapping
pairs, and distances within 0.3 mi when their overlaps sheet lists a distance.

Their file's quirks are handled on purpose: McIntosh has two slightly different longitudes,
and Hooks/Purrysburg have no coordinates, so the center falls back to the other endpoint.

Usage: python -m tests.check_answer_key data/raw/Projects_Overlaps.xlsx
"""
import re
import sys

import pandas as pd

from pipeline.method import compute_overlaps, parse_date

ID = re.compile(r"^(DESC|GPC)_\d+$", re.I)
TOLERANCE_MI = 0.3


def find_col(df, pattern):
    return next((c for c in df.columns if re.search(pattern, str(c), re.I)), None)


def load_key(path):
    sheets = pd.read_excel(path, sheet_name=None)
    proj_name = next(n for n in sheets if "project" in n.lower())
    proj = sheets[proj_name]
    id_col = next(c for c in proj.columns if proj[c].astype(str).str.match(ID).mean() > 0.8)
    date_col = find_col(proj, r"service|need|date")
    rows = []
    for r in proj.to_dict("records"):
        a = (r.get("lon_a"), r.get("lat_a"))
        b = (r.get("lon_b"), r.get("lat_b"))
        a = a if pd.notna(a[0]) and pd.notna(a[1]) else None
        b = b if pd.notna(b[0]) and pd.notna(b[1]) else None
        if pd.notna(r.get("lat_center")) and pd.notna(r.get("lon_center")):
            center = (r["lon_center"], r["lat_center"])
        else:
            pts = [p for p in (a, b) if p]
            center = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None
        if center is None:
            continue
        pid = str(r[id_col])
        when = parse_date(pd.to_datetime(r[date_col]).strftime("%m/%d/%Y")) if date_col and pd.notna(r.get(date_col)) else None
        rows.append({"utility_id": pid.split("_")[0].upper(), "project_id": pid,
                     "center_lon": center[0], "center_lat": center[1], "in_service_date": when})
    projects = pd.DataFrame(rows)

    ovl_cols = [c for c in proj.columns if re.match(r"overlap_\d+$", str(c))]
    members = {}
    for r in proj.to_dict("records"):
        for c in ovl_cols:
            if pd.notna(r[c]):
                members.setdefault(str(r[c]), set()).add(str(r[id_col]))
    expected = {oid: tuple(sorted(m)) for oid, m in members.items() if len(m) == 2}

    distances = {}
    ov_name = next((n for n in sheets if "overlap" in n.lower()), None)
    if ov_name:
        ov = sheets[ov_name]
        oid_col = next((c for c in ov.columns if ov[c].astype(str).str.match(r"^OVL_\d+$").mean() > 0.8), None)
        dist_col = find_col(ov, r"dist")
        if oid_col and dist_col:
            distances = {str(k): float(v) for k, v in zip(ov[oid_col], ov[dist_col]) if pd.notna(v)}
    return projects, expected, distances


def main(path):
    projects, expected, distances = load_key(path)
    ours = compute_overlaps(projects)
    got = {tuple(sorted((a, b))): mi for a, b, mi in zip(ours.project_id_a, ours.project_id_b, ours.center_distance_mi)}

    exp_pairs = set(expected.values())
    missing, extra = exp_pairs - set(got), set(got) - exp_pairs
    print(f"answer key: {len(projects)} projects, {len(exp_pairs)} overlaps; ours: {len(got)} overlaps")
    bad = []
    for oid, pair in sorted(expected.items()):
        if pair in got and oid in distances:
            diff = abs(got[pair] - distances[oid])
            status = "ok" if diff <= TOLERANCE_MI else "DIST MISMATCH"
            if diff > TOLERANCE_MI:
                bad.append(oid)
            print(f"  {oid} {pair}: theirs {distances[oid]:.2f} mi, ours {got[pair]:.2f} mi  {status}")
        elif pair in got:
            print(f"  {oid} {pair}: ours {got[pair]:.2f} mi (no distance in their sheet)")
    for p in sorted(missing):
        print(f"  MISSING  {p}")
    for p in sorted(extra):
        print(f"  EXTRA    {p}  ({got[p]:.2f} mi)")
    ok = not missing and not extra and not bad
    print("PASS" if ok else "FAIL")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1]) else 1)
