"""
Load the pipeline's output into PostGIS.

  1. Runs db/schema.sql (drops and recreates tables with keys and spatial indexes).
  2. Inserts projects.geojson and overlaps.geojson.
  3. Cross-checks: the live PostGIS spatial join must reproduce the pipeline's overlap pairs.

The pipeline stays the source of truth; PostGIS is the serving and query layer.

Usage: python -m db.load_to_postgis        (needs `docker compose up -d db` or Postgres.app)
"""
import json
import sys
from pathlib import Path

from sqlalchemy import text

from api.db import engine

ROOT = Path(__file__).resolve().parent.parent
PROJECT_COLS = ["utility", "project_id", "name", "description", "status", "zone", "kv",
                "in_service_date", "in_service_date_updated", "in_service_effective",
                "build_start", "build_end", "window_source", "location_confidence", "is_override",
                "confidence_note", "corridor_group", "in_service_passed", "name_a", "name_b"]
OVERLAP_COLS = ["overlap_id", "rank", "desc_id", "gpc_id", "desc_name", "gpc_name", "desc_in_service",
                "gpc_in_service", "center_distance_mi", "closest_distance_km", "proximity_tier", "shareable",
                "in_service_gap_days", "build_windows_overlap", "desc_window", "gpc_window",
                "either_already_in_service", "location_confidence", "override_involved", "score",
                "shared_row_acres_upper_bound", "shared_row_value_usd"]


def features(name):
    return json.loads((ROOT / "data" / "processed" / name).read_text())["features"]


def clean(v):
    return None if v in ("", "None", "nan") else v


def main():
    projects, overlaps = features("projects.geojson"), features("overlaps.geojson")
    with engine.begin() as conn:
        conn.exec_driver_sql((ROOT / "db" / "schema.sql").read_text())

        insert_p = text(f"""
            INSERT INTO projects ({", ".join(PROJECT_COLS)}, geom, center)
            VALUES ({", ".join(":" + c for c in PROJECT_COLS)},
                    ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326),
                    ST_SetSRID(ST_MakePoint(:center_lon, :center_lat), 4326))""")
        conn.execute(insert_p, [
            {**{c: clean(f["properties"].get(c)) for c in PROJECT_COLS},
             "is_override": bool(f["properties"].get("is_override")),
             "in_service_passed": bool(f["properties"].get("in_service_passed")),
             "geom": json.dumps(f["geometry"]),
             "center_lon": f["properties"]["center_lon"], "center_lat": f["properties"]["center_lat"]}
            for f in projects])

        insert_o = text(f"""
            INSERT INTO overlap_pairs ({", ".join(OVERLAP_COLS)}, connector)
            VALUES ({", ".join(":" + c for c in OVERLAP_COLS)}, ST_SetSRID(ST_GeomFromGeoJSON(:connector), 4326))""")
        if overlaps:
            conn.execute(insert_o, [
                {**{c: clean(f["properties"].get(c)) for c in OVERLAP_COLS},
                 "connector": json.dumps(f["geometry"])} for f in overlaps])

        conn.exec_driver_sql("ANALYZE projects; ANALYZE overlap_pairs;")  # fresh stats -> planner uses the spatial index
        live = conn.execute(text((ROOT / "db" / "live_overlaps.sql").read_text()),
                            {"max_mi": 25.0, "max_m": 25 * 1609.344, "hide_in_service": False}).mappings().all()

    stored = {(o["properties"]["desc_id"], o["properties"]["gpc_id"]): o["properties"]["center_distance_mi"]
              for o in overlaps}
    live_pairs = {(r["desc_id"], r["gpc_id"]): r["center_distance_mi"] for r in live}
    worst = max((abs(live_pairs[k] - v) for k, v in stored.items() if k in live_pairs), default=0.0)
    print(f"loaded {len(projects)} projects, {len(overlaps)} overlaps into PostGIS")
    if set(stored) == set(live_pairs):
        print(f"cross-check OK: live ST_DWithin query reproduces all {len(stored)} pipeline pairs "
              f"(max distance difference {worst:.3f} mi)")
    else:
        print(f"cross-check MISMATCH: pipeline-only {sorted(set(stored) - set(live_pairs))}, "
              f"PostGIS-only {sorted(set(live_pairs) - set(stored))}")
        sys.exit(1)


if __name__ == "__main__":
    main()
