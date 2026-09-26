"""
FastAPI app: projects and overlaps for any number of utilities, plus dataset uploads.

Run from the repo root:
    uvicorn api.main:app --reload
Interactive docs: http://localhost:8000/docs
If a frontend is added later at web/index.html, it is served at http://localhost:8000/ automatically.

Environment:
    DATABASE_URL  Postgres connection (default: local docker-compose database)
    ADMIN_TOKEN   optional; lets an admin delete any user-submitted dataset
"""
import hashlib
import hmac
import io
import json
import os
import secrets
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from api.db import engine
from api.ingest import IngestError, ingest, rows_from_csv
from api.models import (STANDARD_COLUMNS, UTILITY_ID_PATTERN, DatasetOut, LiveOverlap, NearbyProject,
                        OverlapDetail, OverlapOut, ProjectOut, ProjectRef, UploadReport, UtilityOut)

ROOT = Path(__file__).resolve().parent.parent
METERS_PER_MILE = 1609.344
CONF_LEVELS = ["none", "low", "medium", "high"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
SHAREABLE = {
    "touching/crossing": "Coordinate outages and crossing structures",
    "under 1.6 km": "Share right-of-way, access roads, permits",
    "under 8 km": "Share laydown yards, deliveries, site logistics",
    "under 25 mi": "Share crews, cranes, contractors",
}

app = FastAPI(title="StreetVision: transmission project overlap finder", version="2.0",
              description="Compare planned transmission projects across any number of utilities.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["*"])

MinConf = Literal["none", "low", "medium", "high"]
Source = Literal["all", "official", "user"]


@app.exception_handler(IngestError)
def ingest_error(_, exc: IngestError):
    return JSONResponse(status_code=exc.status,
                        content={"detail": str(exc), "errors": [e.model_dump() for e in exc.errors]})


# ---------------------------------------------------------------- helpers

def allowed(min_conf: str) -> list[str]:
    return CONF_LEVELS[CONF_LEVELS.index(min_conf):]


def utility_list(utilities: Optional[str]) -> Optional[list[str]]:
    if not utilities:
        return None
    return [u.strip().upper() for u in utilities.split(",") if u.strip()]


def kinds(source: Source) -> list[str]:
    return {"all": ["official", "user_submitted"], "official": ["official"], "user": ["user_submitted"]}[source]


PROJECT_SELECT = """
    SELECT p.utility_id, p.project_id, p.name, p.description, p.status, p.region, p.kv,
           p.in_service_date, p.in_service_date_updated, p.build_start, p.build_end,
           p.location_confidence, p.is_override, p.confidence_note,
           COALESCE(p.in_service_date < current_date, false) AS in_service_passed,
           p.dataset_id, d.kind AS source_kind, ST_X(p.center) AS lon, ST_Y(p.center) AS lat
    FROM projects p JOIN datasets d USING (dataset_id)
"""

# Stored overlaps joined to both projects. Pair filter: one utility listed -> pairs involving it;
# several -> pairs between them.
OVERLAP_SELECT = """
    SELECT o.*, ST_AsGeoJSON(o.connector) AS connector_json,
           pa.name AS name_a, pa.in_service_date AS isd_a, pa.build_start AS bs_a, pa.build_end AS be_a, da.kind AS kind_a,
           pb.name AS name_b, pb.in_service_date AS isd_b, pb.build_start AS bs_b, pb.build_end AS be_b, db.kind AS kind_b,
           COALESCE(pa.in_service_date < current_date, false) OR COALESCE(pb.in_service_date < current_date, false)
               AS either_already_in_service
    FROM overlap_pairs o
    JOIN projects pa ON (pa.utility_id, pa.project_id) = (o.utility_a, o.project_id_a)
    JOIN datasets da ON da.dataset_id = pa.dataset_id
    JOIN projects pb ON (pb.utility_id, pb.project_id) = (o.utility_b, o.project_id_b)
    JOIN datasets db ON db.dataset_id = pb.dataset_id
    WHERE da.kind = ANY(:kinds) AND db.kind = ANY(:kinds)
      AND (CAST(:utils AS TEXT[]) IS NULL
           OR (cardinality(CAST(:utils AS TEXT[])) = 1 AND (o.utility_a = ANY(:utils) OR o.utility_b = ANY(:utils)))
           OR (o.utility_a = ANY(:utils) AND o.utility_b = ANY(:utils)))
"""


def window(start, end):
    return f"{start}-{end}" if start is not None or end is not None else None


def project_out(row) -> ProjectOut:
    r = dict(row)
    r["center"] = (r.pop("lon"), r.pop("lat"))
    r.pop("geometry", None)
    return ProjectOut(**r)


def overlap_out(r, rank: int, land_cost: Optional[float]) -> OverlapOut:
    acres = r["shared_row_acres"]
    return OverlapOut(
        overlap_id=r["overlap_id"], rank=rank, label=f"OVL_{rank}",
        a=ProjectRef(utility_id=r["utility_a"], project_id=r["project_id_a"], name=r["name_a"],
                     in_service_date=r["isd_a"], build_window=window(r["bs_a"], r["be_a"]), source_kind=r["kind_a"]),
        b=ProjectRef(utility_id=r["utility_b"], project_id=r["project_id_b"], name=r["name_b"],
                     in_service_date=r["isd_b"], build_window=window(r["bs_b"], r["be_b"]), source_kind=r["kind_b"]),
        center_distance_mi=round(r["center_distance_mi"], 2), closest_distance_km=round(r["closest_distance_km"], 2),
        proximity_tier=r["proximity_tier"], shareable=SHAREABLE.get(r["proximity_tier"], ""),
        in_service_gap_days=r["in_service_gap_days"], build_windows_overlap=r["build_windows_overlap"],
        either_already_in_service=r["either_already_in_service"], location_confidence=r["location_confidence"],
        override_involved=r["override_involved"], user_data_involved="user_submitted" in (r["kind_a"], r["kind_b"]),
        score=r["score"], shared_row_acres_upper_bound=acres,
        shared_row_value_usd=round(acres * land_cost) if acres is not None and land_cost else None,
        connector=[tuple(c) for c in json.loads(r["connector_json"])["coordinates"]])


def dataset_out(conn, dataset_id: int) -> DatasetOut:
    r = conn.execute(text("""
        SELECT d.*, (SELECT count(*) FROM projects p WHERE p.dataset_id = d.dataset_id) AS projects
        FROM datasets d WHERE dataset_id = :id"""), {"id": dataset_id}).mappings().first()
    if not r:
        raise HTTPException(404, f"No dataset {dataset_id}")
    return DatasetOut(**{k: r[k] for k in DatasetOut.model_fields})


# ---------------------------------------------------------------- read endpoints

@app.get("/api/health")
def health():
    with engine.connect() as conn:
        counts = conn.execute(text("""SELECT (SELECT count(*) FROM utilities) u, (SELECT count(*) FROM datasets) d,
                                             (SELECT count(*) FROM projects) p, (SELECT count(*) FROM overlap_pairs) o""")).one()
    return {"status": "ok", "utilities": counts.u, "datasets": counts.d, "projects": counts.p, "overlaps": counts.o}


@app.get("/api/utilities", response_model=list[UtilityOut])
def utilities():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT u.utility_id, u.name,
                   (SELECT count(*) FROM projects p WHERE p.utility_id = u.utility_id) AS projects,
                   (SELECT count(*) FROM datasets d WHERE d.utility_id = u.utility_id) AS datasets,
                   EXISTS (SELECT 1 FROM datasets d WHERE d.utility_id = u.utility_id AND d.kind = 'official')
                       AS has_official_data
            FROM utilities u ORDER BY u.utility_id""")).mappings().all()
    return [UtilityOut(**r) for r in rows]


@app.get("/api/projects")
def projects(utilities: Optional[str] = Query(None, description="Comma-separated utility ids, e.g. DESC,GPC"),
             source: Source = "all", min_confidence: MinConf = "none", hide_in_service: bool = False):
    """All mapped projects as a GeoJSON FeatureCollection (MapLibre reads it directly)."""
    sql = text(f"""
        {PROJECT_SELECT.replace("FROM projects p", ", ST_AsGeoJSON(p.geom) AS geometry FROM projects p")}
        WHERE (CAST(:utils AS TEXT[]) IS NULL OR p.utility_id = ANY(:utils))
          AND d.kind = ANY(:kinds) AND p.location_confidence = ANY(:conf)
          AND (NOT :hide OR NOT COALESCE(p.in_service_date < current_date, false))
        ORDER BY p.utility_id, p.project_id""")
    with engine.connect() as conn:
        rows = conn.execute(sql, {"utils": utility_list(utilities), "kinds": kinds(source),
                                  "conf": allowed(min_confidence), "hide": hide_in_service}).mappings().all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": json.loads(r["geometry"]),
         "properties": project_out(r).model_dump(mode="json")} for r in rows]}


@app.get("/api/overlaps", response_model=list[OverlapOut])
def overlaps(utilities: Optional[str] = Query(None, description="One id: pairs involving it. Several: pairs between them."),
             source: Source = "all", max_distance_mi: float = Query(25, gt=0, le=25),
             min_confidence: MinConf = "none", hide_in_service: bool = False, tier: Optional[str] = None,
             land_cost_per_acre: Optional[float] = Query(None, gt=0, description="For the shared right-of-way value"),
             limit: int = Query(200, ge=1, le=2000)):
    """The ranked coordination list (rank = position within this filtered result)."""
    sql = text(f"""{OVERLAP_SELECT}
        AND o.center_distance_mi <= :max_mi AND o.location_confidence = ANY(:conf)
        AND (NOT :hide OR NOT (COALESCE(pa.in_service_date < current_date, false)
                               OR COALESCE(pb.in_service_date < current_date, false)))
        AND (CAST(:tier AS TEXT) IS NULL OR o.proximity_tier = :tier)
        ORDER BY o.score DESC, o.center_distance_mi, o.overlap_id LIMIT :limit""")
    with engine.connect() as conn:
        rows = conn.execute(sql, {"kinds": kinds(source), "utils": utility_list(utilities), "max_mi": max_distance_mi,
                                  "conf": allowed(min_confidence), "hide": hide_in_service, "tier": tier,
                                  "limit": limit}).mappings().all()
    return [overlap_out(r, i + 1, land_cost_per_acre) for i, r in enumerate(rows)]


@app.get("/api/overlaps/live", response_model=list[LiveOverlap])
def overlaps_live(max_distance_mi: float = Query(25, gt=0, le=100),
                  utilities: Optional[str] = None, source: Source = "all", hide_in_service: bool = False,
                  limit: int = Query(500, ge=1, le=5000)):
    """The overlap engine run on request at any radius (e.g. 40 km = 24.85 mi crew-staging distance)."""
    sql = text(f"""
        WITH f AS (SELECT * FROM find_overlaps(:mi))
        {OVERLAP_SELECT.replace("o.*, ST_AsGeoJSON(o.connector)", "o.*, ST_AsGeoJSON(o.connector)")
                       .replace("FROM overlap_pairs o", "FROM f o")}
          AND (NOT :hide OR NOT (COALESCE(pa.in_service_date < current_date, false)
                                 OR COALESCE(pb.in_service_date < current_date, false)))
        ORDER BY o.score DESC, o.center_distance_mi LIMIT :limit""")
    with engine.connect() as conn:
        rows = conn.execute(sql, {"mi": max_distance_mi, "kinds": kinds(source), "utils": utility_list(utilities),
                                  "hide": hide_in_service, "limit": limit}).mappings().all()
    return [LiveOverlap(
        rank=i + 1,
        a=ProjectRef(utility_id=r["utility_a"], project_id=r["project_id_a"], name=r["name_a"],
                     in_service_date=r["isd_a"], build_window=window(r["bs_a"], r["be_a"]), source_kind=r["kind_a"]),
        b=ProjectRef(utility_id=r["utility_b"], project_id=r["project_id_b"], name=r["name_b"],
                     in_service_date=r["isd_b"], build_window=window(r["bs_b"], r["be_b"]), source_kind=r["kind_b"]),
        center_distance_mi=round(r["center_distance_mi"], 2), closest_distance_km=round(r["closest_distance_km"], 2),
        in_service_gap_days=r["in_service_gap_days"], score=r["score"],
        connector=[tuple(c) for c in json.loads(r["connector_json"])["coordinates"]]) for i, r in enumerate(rows)]


@app.get("/api/overlaps/{overlap_id}", response_model=OverlapDetail)
def overlap_detail(overlap_id: int, land_cost_per_acre: Optional[float] = Query(None, gt=0)):
    """One overlap with both full projects. rank = position among all stored overlaps."""
    sql = text(f"""
        WITH ranked AS ({OVERLAP_SELECT}),
             numbered AS (SELECT *, row_number() OVER (ORDER BY score DESC, center_distance_mi, overlap_id) AS pos
                          FROM ranked)
        SELECT * FROM numbered WHERE overlap_id = :id""")
    with engine.connect() as conn:
        r = conn.execute(sql, {"kinds": kinds("all"), "utils": None, "id": overlap_id}).mappings().first()
        if not r:
            raise HTTPException(404, f"No overlap {overlap_id}")
        pair = conn.execute(text(f"""{PROJECT_SELECT}
            WHERE (p.utility_id, p.project_id) IN ((:ua, :pa), (:ub, :pb))"""),
            {"ua": r["utility_a"], "pa": r["project_id_a"], "ub": r["utility_b"], "pb": r["project_id_b"]}).mappings().all()
    by_key = {(p["utility_id"], p["project_id"]): project_out(p) for p in pair}
    base = overlap_out(r, r["pos"], land_cost_per_acre)
    return OverlapDetail(**base.model_dump(), project_a=by_key[(r["utility_a"], r["project_id_a"])],
                         project_b=by_key[(r["utility_b"], r["project_id_b"])])


@app.get("/api/projects/near", response_model=list[NearbyProject])
def projects_near(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                  radius_mi: float = Query(25, gt=0, le=100), utilities: Optional[str] = None):
    """Everything within radius_mi of a clicked point: an indexed ST_DWithin lookup."""
    sql = text("""
        WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography AS pt)
        SELECT utility_id, project_id, name, ST_X(center) AS lon, ST_Y(center) AS lat,
               ST_Distance(center::geography, q.pt, false) / :mpm AS distance_mi
        FROM projects, q
        WHERE ST_DWithin(center::geography, q.pt, :radius_m, false)
          AND (CAST(:utils AS TEXT[]) IS NULL OR utility_id = ANY(:utils))
        ORDER BY distance_mi""")
    with engine.connect() as conn:
        rows = conn.execute(sql, {"lat": lat, "lon": lon, "radius_m": radius_mi * METERS_PER_MILE,
                                  "mpm": METERS_PER_MILE, "utils": utility_list(utilities)}).mappings().all()
    return [NearbyProject(utility_id=r["utility_id"], project_id=r["project_id"], name=r["name"],
                          distance_mi=round(r["distance_mi"], 2), center=(r["lon"], r["lat"])) for r in rows]


# ---------------------------------------------------------------- datasets (uploads)

@app.get("/api/datasets", response_model=list[DatasetOut])
def datasets(utilities: Optional[str] = None, source: Source = "all"):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT d.*, (SELECT count(*) FROM projects p WHERE p.dataset_id = d.dataset_id) AS projects
            FROM datasets d
            WHERE (CAST(:utils AS TEXT[]) IS NULL OR d.utility_id = ANY(:utils)) AND d.kind = ANY(:kinds)
            ORDER BY d.created_at DESC"""), {"utils": utility_list(utilities), "kinds": kinds(source)}).mappings().all()
    return [DatasetOut(**{k: r[k] for k in DatasetOut.model_fields}) for r in rows]


@app.get("/api/datasets/template", response_class=StreamingResponse)
def dataset_template():
    """CSV template for uploads, with two EXAMPLE rows (replace them)."""
    buf = io.StringIO()
    buf.write(",".join(STANDARD_COLUMNS) + "\n")
    example = {"utility_id": "EXAMPLE", "project_id": "EX-001", "name": "Example A - Example B 230 kV rebuild",
               "in_service_date": "2028-06-01", "build_start": "2027", "build_end": "2028", "kv": "230",
               "endpoint_a": "Example A", "lat_a": "32.30", "lon_a": "-81.00",
               "endpoint_b": "Example B", "lat_b": "32.40", "lon_b": "-81.10", "location_confidence": "medium"}
    point = {"utility_id": "EXAMPLE", "project_id": "EX-002", "name": "Example C substation expansion",
             "in_service_date": "2029-12-31", "endpoint_a": "Example C", "lat_a": "32.50", "lon_a": "-81.20"}
    for row in (example, point):
        buf.write(",".join(f'"{row.get(c, "")}"' if "," in row.get(c, "") else row.get(c, "")
                           for c in STANDARD_COLUMNS) + "\n")
    buf.seek(0)
    return StreamingResponse(buf, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=projects_template.csv"})


@app.post("/api/datasets", response_model=UploadReport, status_code=201)
async def upload_dataset(
        file: UploadFile = File(..., description="CSV in the template format"),
        utility_id: str = Form(..., pattern=UTILITY_ID_PATTERN),
        source_name: str = Form(..., min_length=3, max_length=200,
                                description="Where the data comes from; re-using a name replaces your earlier upload"),
        public_attestation: bool = Form(..., description="I confirm this is public data and contains no CEII"),
        utility_name: Optional[str] = Form(None, max_length=200),
        submitted_by: Optional[str] = Form(None, max_length=200),
        notes: Optional[str] = Form(None, max_length=2000)):
    """Upload a utility's planned projects. Valid rows are saved as a user-submitted dataset and
    overlaps with every other utility are computed immediately; invalid rows are reported per row."""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File over {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    rows = rows_from_csv(content)
    token = secrets.token_urlsafe(24)
    with engine.begin() as conn:
        res = ingest(conn, rows, utility_id=utility_id, utility_name=utility_name, source_name=source_name,
                     kind="user_submitted", submitted_by=submitted_by, notes=notes,
                     public_attestation=public_attestation,
                     delete_token_hash=hashlib.sha256(token.encode()).hexdigest())
        ds = dataset_out(conn, res.dataset_id)
    return UploadReport(dataset=ds, delete_token=token, rows_received=res.rows_received,
                        rows_accepted=res.rows_accepted, rows_rejected=len(res.errors), errors=res.errors,
                        new_overlaps=res.new_overlaps)


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, x_delete_token: Optional[str] = Header(None),
                   x_admin_token: Optional[str] = Header(None)):
    """Remove a user-submitted dataset, its projects, and their overlaps. Needs the token returned
    at upload (X-Delete-Token) or the server's ADMIN_TOKEN (X-Admin-Token). Official data can't be deleted here."""
    with engine.begin() as conn:
        d = conn.execute(text("SELECT kind, delete_token_hash FROM datasets WHERE dataset_id = :id"),
                         {"id": dataset_id}).mappings().first()
        if not d:
            raise HTTPException(404, f"No dataset {dataset_id}")
        if d["kind"] == "official":
            raise HTTPException(403, "Official datasets are managed by the loader, not the API")
        admin = os.getenv("ADMIN_TOKEN")
        owner_ok = bool(x_delete_token and d["delete_token_hash"] and hmac.compare_digest(
            hashlib.sha256(x_delete_token.encode()).hexdigest(), d["delete_token_hash"]))
        admin_ok = bool(admin and x_admin_token and hmac.compare_digest(x_admin_token, admin))
        if not (owner_ok or admin_ok):
            raise HTTPException(403, "Wrong or missing X-Delete-Token")
        removed = conn.execute(text("""
            SELECT (SELECT count(*) FROM projects WHERE dataset_id = :id) AS p,
                   (SELECT count(*) FROM overlap_pairs o JOIN projects x
                      ON (x.utility_id, x.project_id) IN ((o.utility_a, o.project_id_a), (o.utility_b, o.project_id_b))
                    WHERE x.dataset_id = :id) AS o"""), {"id": dataset_id}).one()
        util = conn.execute(text("DELETE FROM datasets WHERE dataset_id = :id RETURNING utility_id"),
                            {"id": dataset_id}).scalar_one()
        conn.execute(text("""DELETE FROM utilities u WHERE u.utility_id = :u
                             AND NOT EXISTS (SELECT 1 FROM datasets d WHERE d.utility_id = u.utility_id)"""),
                     {"u": util})   # drop a utility left with no data
    return {"deleted": dataset_id, "projects_removed": removed.p, "overlaps_removed": removed.o}


# Optional frontend: mounted last so /api/* routes win. Skipped until web/index.html exists.
if (ROOT / "web" / "index.html").exists():
    app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
