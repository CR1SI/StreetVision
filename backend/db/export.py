"""
Export from PostGIS (the source of truth) to files:
  data/processed/projects.geojson, overlaps.geojson, overlaps.csv,
  data/processed/projects_overlaps.xlsx  -- the organizers' layout (name_a/lat_a/lon_a, name_b/...,
                                            lat_center/lon_center, overlap_count, overlap_1..n)

Usage: python -m db.export [--official-only]
"""
import json
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from api.db import engine

OUT = Path(__file__).resolve().parent.parent / "data" / "processed"

PROJECTS_SQL = """
    SELECT p.utility_id, p.project_id, p.name AS project_name, p.project_type, p.name_a, p.name_b,
           ST_Y(f.pa) AS lat_a, ST_X(f.pa) AS lon_a, ST_Y(f.pb) AS lat_b, ST_X(f.pb) AS lon_b,
           ST_Y(p.center) AS lat_center, ST_X(p.center) AS lon_center,
           p.in_service_date, p.location_confidence, d.kind AS source_kind,
           ST_AsGeoJSON(p.geom) AS geometry
    FROM projects p JOIN datasets d USING (dataset_id)
    CROSS JOIN LATERAL (SELECT CASE GeometryType(p.geom) WHEN 'LINESTRING' THEN p.geom
                                    WHEN 'MULTILINESTRING' THEN ST_GeometryN(p.geom, 1) END AS first_line) l
    CROSS JOIN LATERAL (SELECT CASE GeometryType(p.geom) WHEN 'POINT' THEN p.geom
                                    WHEN 'MULTIPOINT' THEN ST_GeometryN(p.geom, 1)
                                    ELSE ST_StartPoint(l.first_line) END AS pa,
                               CASE WHEN GeometryType(p.geom) = 'MULTIPOINT' THEN ST_GeometryN(p.geom, 2)
                                    ELSE ST_EndPoint(l.first_line) END AS pb) f
    WHERE NOT :official_only OR d.kind = 'official'
    ORDER BY p.utility_id, p.project_id
"""
OVERLAPS_SQL = """
    SELECT 'OVL_' || row_number() OVER (ORDER BY o.score DESC, o.center_distance_mi) AS overlap_label,
           o.utility_a, o.project_id_a, pa.name AS name_a, o.utility_b, o.project_id_b, pb.name AS name_b,
           round(o.center_distance_mi::numeric, 2)::float AS center_distance_mi,
           round(o.closest_distance_mi::numeric, 2)::float AS closest_distance_mi, o.proximity_tier,
           o.in_service_gap_days, o.build_windows_overlap, o.location_confidence, o.override_involved,
           o.score, o.shared_row_acres, ST_AsGeoJSON(o.connector) AS geometry
    FROM overlap_pairs o
    JOIN projects pa ON (pa.utility_id, pa.project_id) = (o.utility_a, o.project_id_a)
    JOIN projects pb ON (pb.utility_id, pb.project_id) = (o.utility_b, o.project_id_b)
    JOIN datasets da ON da.dataset_id = pa.dataset_id
    JOIN datasets db ON db.dataset_id = pb.dataset_id
    WHERE NOT :official_only OR (da.kind = 'official' AND db.kind = 'official')
    ORDER BY o.score DESC, o.center_distance_mi
"""


def feature_collection(df: pd.DataFrame) -> dict:
    feats = []
    for rec in df.to_dict("records"):
        geom = json.loads(rec.pop("geometry") or "null")
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": {k: (None if pd.isna(v) else (str(v) if hasattr(v, "isoformat") else v))
                                     for k, v in rec.items()}})
    return {"type": "FeatureCollection", "features": feats}


def main():
    official_only = "--official-only" in sys.argv
    with engine.connect() as conn:
        projects = pd.DataFrame(conn.execute(text(PROJECTS_SQL), {"official_only": official_only}).mappings().all())
        overlaps = pd.DataFrame(conn.execute(text(OVERLAPS_SQL), {"official_only": official_only}).mappings().all())

    (OUT / "projects.geojson").write_text(json.dumps(feature_collection(projects.copy())), encoding="utf-8")
    (OUT / "overlaps.geojson").write_text(json.dumps(feature_collection(overlaps.copy())), encoding="utf-8")
    overlaps.drop(columns="geometry", errors="ignore").to_csv(OUT / "overlaps.csv", index=False)

    # organizers' workbook: each project lists the overlaps it takes part in
    members = {}
    for o in overlaps.itertuples():
        members.setdefault((o.utility_a, o.project_id_a), []).append(o.overlap_label)
        members.setdefault((o.utility_b, o.project_id_b), []).append(o.overlap_label)
    width = max((len(v) for v in members.values()), default=0)
    sheet = projects.drop(columns="geometry", errors="ignore").copy()
    ids = [members.get(k, []) for k in zip(sheet.utility_id, sheet.project_id)]
    sheet["overlap_count"] = [len(x) for x in ids]
    for i in range(width):
        sheet[f"overlap_{i + 1}"] = [x[i] if i < len(x) else None for x in ids]
    with pd.ExcelWriter(OUT / "projects_overlaps.xlsx") as xl:
        sheet.to_excel(xl, sheet_name="projects", index=False)
        overlaps.drop(columns="geometry", errors="ignore").to_excel(xl, sheet_name="overlaps", index=False)

    print(f"exported {len(projects)} projects, {len(overlaps)} overlaps"
          f"{' (official only)' if official_only else ''} -> {OUT}")


if __name__ == "__main__":
    main()
