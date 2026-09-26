"""
Adapter: turn the PDF extractions + reviewed coordinates into the STANDARD project format
(the same CSV shape a user uploads through POST /api/datasets).

Inputs : data/processed/desc_projects.csv, data/processed/gpc_projects.csv,
         data/substations.csv (reviewed), data/overrides.csv
Output : data/processed/projects_standard.csv

Usage: python -m pipeline.build_projects [--dates baseline|updated]
  baseline (default): overlap math uses the organizers' 2024-2028 DESC dates
  updated           : uses the newer DESC edition's dates where one exists
Either way both dates are kept (in_service_date / in_service_date_updated).
"""
import json
import sys

import pandas as pd
from pydantic import ValidationError
from shapely.geometry import LineString, MultiLineString, MultiPoint, Point

from api.models import STANDARD_COLUMNS, ProjectIn
from pipeline.method import parse_date

OUT = "data/processed/projects_standard.csv"
CONF_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}
SOURCE_NAMES = {"GPC": "Georgia Power 2025 IRP Vol. 3, 10 Year Plan (Table 2)"}


def weakest(values):
    return min(values, key=lambda c: CONF_RANK.get(c, 0)) if values else "none"


def s(v):
    return v if isinstance(v, str) and v.strip() else None


def load_sources() -> pd.DataFrame:
    desc = pd.read_csv("data/processed/desc_projects.csv", dtype=str)
    gpc = pd.read_csv("data/processed/gpc_projects.csv", dtype=str)
    gpc = gpc[gpc["utility"] == "GPC"]       # GTC / MEAG / DU rows are other utilities
    df = pd.concat([desc, gpc], ignore_index=True)
    region = df["zone"].where(df["utility"] == "GPC", "SC")
    df["region"] = region.where(region.isin(["SC", "215", "219"]), "GA")
    return df


def coordinate_lookup():
    subs = pd.read_csv("data/substations.csv", dtype=str)
    subs = subs[subs["lat"].notna() & (subs["confirmed"].fillna("").str.lower() != "no")]
    out = {}
    for r in subs.itertuples():
        conf = "high" if str(r.confirmed).lower() in ("yes", "manual") else (r.confidence or "low")
        out[(r.utility, r.region, r.name)] = ((float(r.lon), float(r.lat)), conf)
    return out


def desc_source_name(df: pd.DataFrame) -> str:
    """One dataset for all DESC rows, named after the editions it was built from."""
    d = df[df.utility == "DESC"]
    base = d.loc[~d.get("new_in_update", pd.Series(False, index=d.index)).astype(str).str.lower().eq("true"), "edition"]
    name = f"SCRTP $2M+ planned transmission projects {base.mode().iloc[0] if len(base) else 'unknown edition'}"
    upd = sorted(d["edition_updated"].dropna().unique()) if "edition_updated" in d else []
    return name + (f" + {', '.join(upd)} updates" if upd else "")


def build(dates_mode="baseline"):
    df = load_sources()
    lookup = coordinate_lookup()
    overrides = pd.read_csv("data/overrides.csv", dtype=str).set_index(["utility", "project_id"])
    source_names = {"DESC": desc_source_name(df), **SOURCE_NAMES}

    rows, skipped = [], []
    for r in df.itertuples():
        segs = json.loads(r.segments)
        note, typed, override_conf = s(getattr(r, "data_note", None)), {}, None
        is_override = (r.utility, r.project_id) in overrides.index
        if is_override:
            ov = overrides.loc[(r.utility, r.project_id)]
            segs = [[s(ov.endpoint_a), s(ov.endpoint_b)]]
            note, override_conf = ov.note, ov.confidence
            for n, la, lo in ((ov.endpoint_a, ov.lat_a, ov.lon_a), (ov.endpoint_b, ov.lat_b, ov.lon_b)):
                if s(la) and s(lo):
                    typed[n] = ((float(lo), float(la)), "high")

        coord_segs, confs = [], []
        for a, b in segs:
            pair = []
            for n in (a, b):
                hit = (typed.get(n) or lookup.get((r.utility, r.region, n))) if n else None
                pair.append(hit[0] if hit else None)
                if n:
                    confs.append(hit[1] if hit else "none")
            coord_segs.append(pair)
        located = [c for c in confs if c != "none"]
        if not located:
            skipped.append(r.project_id)
            continue
        conf = weakest(located)
        if len(located) < len(confs):
            conf = weakest([conf, "low"])            # a named endpoint is still unplaced
        if override_conf:
            conf = weakest([conf, override_conf])

        # geometry: first segment as A/B columns; several segments -> geometry_wkt
        lines = [LineString(p) for p in coord_segs if p[0] and p[1]]
        points = [p for seg in coord_segs for p in seg if p]
        wkt = None
        if len(segs) > 1:
            if lines:
                wkt = (lines[0] if len(lines) == 1 else MultiLineString(lines)).wkt
            else:
                uniq = list(dict.fromkeys(points))
                wkt = (Point(uniq[0]) if len(uniq) == 1 else MultiPoint(uniq)).wkt
        first = next((p for p in coord_segs if p[0] or p[1]), [None, None])
        a_pt, b_pt = (first[0] or first[1]), (first[1] if first[0] else None)

        base = parse_date(r.in_service_raw)
        upd = parse_date(r.in_service_raw_updated) if s(getattr(r, "in_service_raw_updated", None)) else None
        use_upd = dates_mode == "updated" and upd is not None
        eff = upd if use_upd or base is None else base
        bs = r.build_start_updated if (use_upd or base is None) and s(getattr(r, "build_start_updated", None)) else r.build_start
        be = r.build_end_updated if (use_upd or base is None) and s(getattr(r, "build_end_updated", None)) else r.build_end

        rec = {
            "utility_id": r.utility, "project_id": r.project_id, "name": r.name,
            "description": s(r.description), "status": s(r.status),
            "kv": int(float(r.kv)) if s(r.kv) else None,
            "in_service_date": eff, "in_service_date_updated": upd,
            "build_start": int(float(bs)) if s(bs) else None, "build_end": int(float(be)) if s(be) else None,
            "endpoint_a": segs[0][0] if first[0] else segs[0][1], "endpoint_b": segs[0][1] if first[0] else None,
            "lon_a": a_pt[0], "lat_a": a_pt[1],
            "lon_b": b_pt[0] if b_pt else None, "lat_b": b_pt[1] if b_pt else None,
            "geometry_wkt": wkt, "region": r.region, "location_confidence": conf,
            "confidence_note": note, "is_override": is_override,
            "corridor_group": s(getattr(r, "corridor_group", None)),
            "source_name": source_names[r.utility],
        }
        try:
            ProjectIn(**rec)                       # same validation a user upload gets
        except ValidationError as e:
            raise SystemExit(f"{r.utility} {r.project_id}: {e}") from None
        rows.append(rec)

    out = pd.DataFrame(rows, columns=STANDARD_COLUMNS)
    out.to_csv(OUT, index=False)
    print(f"{len(out)} projects with coordinates -> {OUT} ({dates_mode} dates)")
    print(f"  by utility: {out.utility_id.value_counts().to_dict()}")
    print(f"  skipped (no confirmed coordinates yet): {len(skipped)}")


if __name__ == "__main__":
    build(sys.argv[sys.argv.index("--dates") + 1] if "--dates" in sys.argv else "baseline")
