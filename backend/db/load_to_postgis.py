"""
Load official data (data/processed/projects_standard.csv) into PostGIS through the same
ingest() path user uploads use, then cross-check PostGIS against the Python reference method.

  python -m db.load_to_postgis            # create tables on first run; replace official datasets; keep user uploads
  python -m db.load_to_postgis --reset    # drop and recreate everything (deletes user uploads too)
"""
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from api.db import engine
from api.ingest import IngestError, compute_overlaps, ingest
from pipeline.method import compute_overlaps as reference_overlaps

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "processed" / "projects_standard.csv"
UTILITY_NAMES = {"DESC": "Dominion Energy South Carolina", "GPC": "Georgia Power"}


def ensure_schema(conn, reset: bool):
    exists = conn.execute(text("SELECT to_regclass('public.projects') IS NOT NULL")).scalar()
    if reset or not exists:
        conn.exec_driver_sql((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
        print("schema created" + (" (reset: user uploads removed)" if reset and exists else ""))
    # Columns added after the first release, so an existing database keeps its user uploads.
    conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'other'")
    conn.exec_driver_sql((ROOT / "db" / "functions.sql").read_text(encoding="utf-8"))   # always refresh the engine


def cross_check(conn) -> bool:
    projects = pd.DataFrame(conn.execute(text("""
        SELECT utility_id, project_id, ST_X(center) AS center_lon, ST_Y(center) AS center_lat, in_service_date
        FROM projects""")).mappings().all())
    ref = reference_overlaps(projects)
    stored = pd.DataFrame(conn.execute(text(
        "SELECT utility_a, project_id_a, utility_b, project_id_b, center_distance_mi, score FROM overlap_pairs"
    )).mappings().all())
    key = ["utility_a", "project_id_a", "utility_b", "project_id_b"]
    ref_keys = set(map(tuple, ref[key].values)) if len(ref) else set()
    db_keys = set(map(tuple, stored[key].values)) if len(stored) else set()
    if ref_keys != db_keys:
        print(f"cross-check MISMATCH: reference-only {sorted(ref_keys - db_keys)[:5]}, "
              f"PostGIS-only {sorted(db_keys - ref_keys)[:5]}")
        return False
    if not ref_keys:
        print("cross-check: no overlaps yet (add confirmed coordinates for more border projects)")
        return True
    m = ref.merge(stored, on=key, suffixes=("_ref", "_db"))
    dist = (m.center_distance_mi_ref - m.center_distance_mi_db).abs().max()
    score = (m.score_ref - m.score_db).abs().max()
    ok = dist < 0.01 and score < 0.001
    print(f"cross-check {'OK' if ok else 'MISMATCH'}: PostGIS matches the reference method on all "
          f"{len(m)} pairs (max distance diff {dist:.4f} mi, max score diff {score:.4f})")
    return ok


def main():
    reset = "--reset" in sys.argv
    df = pd.read_csv(SOURCE, dtype=str).fillna("")
    with engine.begin() as conn:
        ensure_schema(conn, reset)
        # The pipeline owns official data: replace every official dataset of the utilities in this
        # file (even if its source name changed, e.g. a newer DESC edition). User uploads are kept.
        stale = conn.execute(text("DELETE FROM datasets WHERE kind = 'official' AND utility_id = ANY(:u) "
                                  "RETURNING source_name"), {"u": sorted(df.utility_id.unique())}).scalars().all()
        if stale:
            print(f"replacing official datasets: {', '.join(stale)}")
        for (utility, source), group in df.groupby(["utility_id", "source_name"]):
            try:
                res = ingest(conn, group.to_dict("records"), utility_id=utility,
                             utility_name=UTILITY_NAMES.get(utility), source_name=source, kind="official",
                             submitted_by="official pipeline", public_attestation=True, compute=False)
            except IngestError as e:
                raise SystemExit(f"{utility}: {e} {[x.model_dump() for x in e.errors[:5]]}") from None
            print(f"{utility}: {res.rows_accepted}/{res.rows_received} projects loaded as '{source}'")
            for err in res.errors[:10]:
                print(f"   rejected row {err.row} ({err.project_id}): {err.error}")
        n = compute_overlaps(conn)          # all pairs, including any user-uploaded utilities
        conn.exec_driver_sql("ANALYZE utilities; ANALYZE datasets; ANALYZE projects; ANALYZE overlap_pairs;")
        total = conn.execute(text("SELECT count(*) FROM overlap_pairs")).scalar()
        print(f"overlaps: {n} new, {total} stored")
        ok = cross_check(conn)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
