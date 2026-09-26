"""
Organizer guide Part 3: the overlap table, with GeoPandas.

Official method (Finding_Real_Locations_Guide.docx):
  - Center = midpoint of a project's two named endpoints; one located endpoint -> that point.
    (Multi-segment projects: mean of all located endpoints, which reduces to the midpoint for one line.)
  - Haversine distance between centers; an overlap is any DESC x GPC pair under 25 miles.
  - Time gap = days between the two in-service dates (secondary signal).

Extras: closest-point distance (UTM 17N) + proximity tier, build-window overlap,
"already in service" flag, rank score, shared right-of-way estimate.

Usage:
  python -m pipeline.overlap [--dates baseline|updated] [--land-cost-per-acre N]
Outputs (data/processed/):
  projects.geojson, overlaps.geojson, overlaps.csv, projects_overlaps.xlsx (organizers' format)
"""
import calendar
import json
import re
import sys
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import (GeometryCollection, LineString, MultiLineString, MultiPoint,
                              Point)

from api.models import OverlapRecord

MAX_MILES = 25.0
TIMING_CAP_DAYS = 3 * 365
WGS84, UTM17N = "EPSG:4326", "EPSG:32617"   # UTM 17N covers the Savannah River corridor, meters
EARTH_RADIUS_MI = 3958.8
ROW_WIDTH_FT = 100                          # typical 115-230 kV corridor (varies ~75-150 ft)
CONF_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}
TIERS = [(0.1, "touching/crossing", "Coordinate outages and crossing structures"),
         (1.6, "under 1.6 km", "Share right-of-way, access roads, permits"),
         (8.0, "under 8 km", "Share laydown yards, deliveries, site logistics"),
         (np.inf, "under 25 mi", "Share crews, cranes, contractors")]


# ------------------------------------------------------------------ helpers

def parse_date(raw):
    """Last m/d/y in the text; impossible days are clamped (04/31 -> 04/30)."""
    found = re.findall(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", str(raw))
    if not found:
        return None
    m, d, y = (int(x) for x in found[-1])
    y = y + 2000 if y < 100 else y
    return date(y, m, min(d, calendar.monthrange(y, m)[1]))


def haversine_mi(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MI * np.arcsin(np.sqrt(a))


def weakest(values):
    return min(values, key=lambda c: CONF_RANK.get(c, 0)) if values else "none"


def geometry_from_segments(segments):
    """segments: [[(lon, lat) | None, (lon, lat) | None], ...] -> geometry, center, fully_located"""
    lines, points, located = [], [], []
    for a, b in segments:
        if a and b:
            lines.append(LineString([a, b]))
        for p in (a, b):
            if p:
                points.append(Point(p))
                located.append(p)
    if not located:
        return None, None
    uniq = list(dict.fromkeys(located))
    center = (float(np.mean([p[0] for p in uniq])), float(np.mean([p[1] for p in uniq])))
    if lines and len(lines) == len(segments):
        geom = lines[0] if len(lines) == 1 else MultiLineString(lines)
    elif lines:
        geom = GeometryCollection(lines + points)
    else:
        geom = Point(uniq[0]) if len(uniq) == 1 else MultiPoint(uniq)
    return geom, center


# ------------------------------------------------------------------ build project geometries

def load_projects(dates_mode="baseline") -> gpd.GeoDataFrame:
    desc = pd.read_csv("data/processed/desc_projects.csv", dtype=str)
    gpc = pd.read_csv("data/processed/gpc_projects.csv", dtype=str)
    gpc = gpc[gpc["utility"] == "GPC"]
    df = pd.concat([desc, gpc], ignore_index=True)
    df["region"] = np.where(df["utility"] == "DESC", "SC", df["zone"].fillna("GA"))
    df["region"] = df["region"].where(df["region"].isin(["SC", "215", "219"]), "GA")

    subs = pd.read_csv("data/substations.csv", dtype=str)
    subs = subs[subs["lat"].notna() & (subs["confirmed"].fillna("").str.lower() != "no")]
    lookup = {}
    for s in subs.itertuples():
        conf = "high" if str(s.confirmed).lower() in ("yes", "manual") else (s.confidence or "low")
        lookup[(s.utility, s.region, s.name)] = ((float(s.lon), float(s.lat)), conf)

    overrides = pd.read_csv("data/overrides.csv", dtype=str).set_index(["utility", "project_id"])

    rows = []
    for r in df.itertuples():
        segs = json.loads(r.segments)
        is_override = (r.utility, r.project_id) in overrides.index
        note = None
        typed = {}
        if is_override:
            ov = overrides.loc[(r.utility, r.project_id)]
            segs = [[ov.endpoint_a if isinstance(ov.endpoint_a, str) else None,
                     ov.endpoint_b if isinstance(ov.endpoint_b, str) else None]]
            note = ov.note
            for n, la, lo in ((ov.endpoint_a, ov.lat_a, ov.lon_a), (ov.endpoint_b, ov.lat_b, ov.lon_b)):
                if isinstance(la, str) and isinstance(lo, str):
                    typed[n] = ((float(lo), float(la)), "high")

        confs, coord_segs = [], []
        for a, b in segs:
            pair = []
            for n in (a, b):
                hit = typed.get(n) or lookup.get((r.utility, r.region, n)) if n else None
                pair.append(hit[0] if hit else None)
                if n:
                    confs.append(hit[1] if hit else "none")
            coord_segs.append(pair)
        geom, center = geometry_from_segments(coord_segs)
        if geom is None:
            continue
        located = [c for c in confs if c != "none"]
        conf = weakest(located)
        if len(located) < len(confs):
            conf = weakest([conf, "low"])            # some named endpoint still unplaced
        if is_override:
            conf = weakest([conf, overrides.loc[(r.utility, r.project_id)].confidence])

        base = parse_date(r.in_service_raw)
        upd = parse_date(r.in_service_raw_updated) if isinstance(getattr(r, "in_service_raw_updated", None), str) else None
        if dates_mode == "updated":
            eff, bs, be = upd or base, r.build_start_updated, r.build_end_updated
            if not isinstance(bs, str):
                bs, be = r.build_start, r.build_end
        else:
            eff, bs, be = base or upd, r.build_start, r.build_end
            if not isinstance(bs, str):
                bs, be = getattr(r, "build_start_updated", None), getattr(r, "build_end_updated", None)

        rows.append({
            "utility": r.utility, "project_id": r.project_id, "name": r.name,
            "description": r.description if isinstance(r.description, str) else None,
            "status": r.status if isinstance(r.status, str) else None,
            "zone": r.zone if isinstance(r.zone, str) else None, "region": r.region,
            "kv": int(float(r.kv)) if isinstance(r.kv, str) else None,
            "in_service_date": base, "in_service_date_updated": upd, "in_service_effective": eff,
            "build_start": int(float(bs)) if isinstance(bs, str) else None,
            "build_end": int(float(be)) if isinstance(be, str) else None,
            "window_source": r.window_source, "location_confidence": conf,
            "is_override": is_override, "confidence_note": note,
            "corridor_group": r.corridor_group if isinstance(r.corridor_group, str) else None,
            "in_service_passed": bool(eff and eff < date.today()),
            "name_a": segs[0][0], "name_b": segs[0][1],
            "lon_a": coord_segs[0][0][0] if coord_segs[0][0] else None,
            "lat_a": coord_segs[0][0][1] if coord_segs[0][0] else None,
            "lon_b": coord_segs[0][1][0] if coord_segs[0][1] else None,
            "lat_b": coord_segs[0][1][1] if coord_segs[0][1] else None,
            "center_lon": center[0], "center_lat": center[1],
            "geometry": geom,
        })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=WGS84)


# ------------------------------------------------------------------ the overlap method

def compute_overlaps(projects: gpd.GeoDataFrame, max_miles=MAX_MILES, land_cost=None) -> pd.DataFrame:
    """DESC x GPC cross join, vectorized. Works on any frame with the columns load_projects makes,
    which is how the answer-key regression test reuses it."""
    utm = projects.to_crs(UTM17N)
    projects = projects.assign(geom_m=utm.geometry.values)
    cols = ["utility", "project_id", "name", "center_lon", "center_lat", "in_service_effective",
            "build_start", "build_end", "in_service_passed", "location_confidence", "is_override",
            "geometry", "geom_m"]
    a = projects[projects.utility == "DESC"][cols].add_prefix("d_")
    b = projects[projects.utility == "GPC"][cols].add_prefix("g_")
    pairs = pd.DataFrame(a).merge(pd.DataFrame(b), how="cross")
    if pairs.empty:
        return pairs

    pairs["center_distance_mi"] = haversine_mi(pairs.d_center_lat, pairs.d_center_lon,
                                               pairs.g_center_lat, pairs.g_center_lon)
    pairs = pairs[pairs.center_distance_mi < max_miles].copy()   # most pairs stop here -- expected
    if pairs.empty:
        return pairs

    pairs["closest_distance_km"] = gpd.GeoSeries(pairs.d_geom_m.values, crs=UTM17N).distance(
        gpd.GeoSeries(pairs.g_geom_m.values, crs=UTM17N), align=False).values / 1000
    bins = [-1] + [t[0] for t in TIERS]
    tier_idx = pd.cut(pairs.closest_distance_km, bins=bins, labels=False)
    pairs["proximity_tier"] = [TIERS[i][1] for i in tier_idx]
    pairs["shareable"] = [TIERS[i][2] for i in tier_idx]

    def gap(d, g):
        return abs((d - g).days) if d and g else None
    pairs["in_service_gap_days"] = [gap(d, g) for d, g in zip(pairs.d_in_service_effective, pairs.g_in_service_effective)]
    pairs["build_windows_overlap"] = [
        bool(ds is not None and gs is not None and ds <= ge and gs <= de)
        for ds, de, gs, ge in zip(pairs.d_build_start, pairs.d_build_end, pairs.g_build_start, pairs.g_build_end)]
    pairs["either_already_in_service"] = pairs.d_in_service_passed | pairs.g_in_service_passed
    pairs["location_confidence"] = [weakest([x, y]) for x, y in zip(pairs.d_location_confidence, pairs.g_location_confidence)]
    pairs["override_involved"] = pairs.d_is_override | pairs.g_is_override

    # closeness = 1 - distance/25 (1 when touching, 0 at 25 mi); timing likewise on a 3-year cap
    closeness = 1 - pairs.center_distance_mi / max_miles
    timing = 1 - pairs.in_service_gap_days.fillna(TIMING_CAP_DAYS).clip(upper=TIMING_CAP_DAYS) / TIMING_CAP_DAYS
    pairs["score"] = (0.7 * closeness + 0.3 * timing).round(4)

    # bonus: two lines within 1.6 km could share corridor. Upper bound: shorter line x 100 ft.
    lines = lambda g: g.geom_type in ("LineString", "MultiLineString")
    acres = []
    for dm, gm, km in zip(pairs.d_geom_m, pairs.g_geom_m, pairs.closest_distance_km):
        acres.append(round(min(dm.length, gm.length) * 3.28084 * ROW_WIDTH_FT / 43560, 1)
                     if lines(dm) and lines(gm) and km <= 1.6 else None)
    pairs["shared_row_acres_upper_bound"] = acres
    pairs["shared_row_value_usd"] = [round(x * land_cost) if x is not None and land_cost else None for x in acres]

    pairs = pairs.sort_values(["score", "center_distance_mi"], ascending=[False, True]).reset_index(drop=True)
    pairs["rank"] = pairs.index + 1
    pairs["overlap_id"] = "OVL_" + pairs["rank"].astype(str)
    return pairs


def to_records(pairs: pd.DataFrame) -> list[dict]:
    recs = []
    for p in pairs.itertuples():
        rec = OverlapRecord(
            overlap_id=p.overlap_id, rank=p.rank,
            desc_id=p.d_project_id, desc_name=p.d_name, gpc_id=p.g_project_id, gpc_name=p.g_name,
            desc_in_service=p.d_in_service_effective, gpc_in_service=p.g_in_service_effective,
            center_distance_mi=round(p.center_distance_mi, 2), closest_distance_km=round(p.closest_distance_km, 2),
            proximity_tier=p.proximity_tier, shareable=p.shareable,
            in_service_gap_days=None if pd.isna(p.in_service_gap_days) else int(p.in_service_gap_days),
            build_windows_overlap=p.build_windows_overlap,
            desc_window=f"{p.d_build_start}-{p.d_build_end}", gpc_window=f"{p.g_build_start}-{p.g_build_end}",
            either_already_in_service=bool(p.either_already_in_service),
            location_confidence=p.location_confidence, override_involved=bool(p.override_involved),
            score=p.score, shared_row_acres_upper_bound=p.shared_row_acres_upper_bound,
            shared_row_value_usd=p.shared_row_value_usd,
        )
        recs.append({**rec.model_dump(mode="json"),
                     "connector": [[p.d_center_lon, p.d_center_lat], [p.g_center_lon, p.g_center_lat]]})
    return recs


# ------------------------------------------------------------------ outputs

def organizer_workbook(projects: gpd.GeoDataFrame, records: list[dict], path: str):
    """Match the organizers' Projects_Overlaps.xlsx layout so judges can line results up."""
    by_project = {}
    for r in records:
        by_project.setdefault(("DESC", r["desc_id"]), []).append(r["overlap_id"])
        by_project.setdefault(("GPC", r["gpc_id"]), []).append(r["overlap_id"])
    width = max((len(v) for v in by_project.values()), default=0)
    rows = []
    for p in projects.itertuples():
        ids = by_project.get((p.utility, p.project_id), [])
        row = {"project_id": p.project_id, "utility": p.utility, "project_name": p.name,
               "name_a": p.name_a, "lat_a": p.lat_a, "lon_a": p.lon_a,
               "name_b": p.name_b, "lat_b": p.lat_b, "lon_b": p.lon_b,
               "lat_center": p.center_lat, "lon_center": p.center_lon,
               "in_service_date": p.in_service_effective, "location_confidence": p.location_confidence,
               "overlap_count": len(ids)}
        row.update({f"overlap_{i + 1}": (ids[i] if i < len(ids) else None) for i in range(width)})
        rows.append(row)
    ov = pd.DataFrame([{k: v for k, v in r.items() if k != "connector"} for r in records])
    with pd.ExcelWriter(path) as xl:
        pd.DataFrame(rows).to_excel(xl, sheet_name="projects", index=False)
        ov.to_excel(xl, sheet_name="overlaps", index=False)


def main():
    dates_mode = sys.argv[sys.argv.index("--dates") + 1] if "--dates" in sys.argv else "baseline"
    land_cost = float(sys.argv[sys.argv.index("--land-cost-per-acre") + 1]) if "--land-cost-per-acre" in sys.argv else None

    projects = load_projects(dates_mode)
    print(f"{len(projects)} projects mapped ({dates_mode} dates)")
    pairs = compute_overlaps(projects, land_cost=land_cost)
    records = to_records(pairs) if len(pairs) else []

    out = projects.drop(columns=["region"]).copy()
    for c in ("in_service_date", "in_service_date_updated", "in_service_effective"):
        out[c] = out[c].astype(str).replace("None", None)
    out.to_file("data/processed/projects.geojson", driver="GeoJSON")

    gpd.GeoDataFrame([{k: v for k, v in r.items() if k != "connector"} for r in records],
                     geometry=[LineString(r["connector"]) for r in records], crs=WGS84) \
        .to_file("data/processed/overlaps.geojson", driver="GeoJSON")
    pd.DataFrame([{k: v for k, v in r.items() if k != "connector"} for r in records]) \
        .to_csv("data/processed/overlaps.csv", index=False)
    organizer_workbook(projects, records, "data/processed/projects_overlaps.xlsx")

    print(f"{len(records)} DESC x GPC pairs under {MAX_MILES:g} miles")
    for r in records[:10]:
        flag = "  (in service already)" if r["either_already_in_service"] else ""
        print(f"{r['rank']:>3}. {r['center_distance_mi']:>5} mi  gap {r['in_service_gap_days']} d  "
              f"[{r['location_confidence']}]  {r['desc_name'][:38]}  <->  {r['gpc_name'][:38]}{flag}")


if __name__ == "__main__":
    main()
