"""
FastAPI app: serves the PostGIS data as JSON / GeoJSON.

Run from the repo root:
    uvicorn api.main:app --reload
Interactive docs: http://localhost:8000/docs
If a frontend is added later at web/index.html, it is served at http://localhost:8000/ automatically.
"""
import json
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from api.db import engine
from api.models import LiveOverlap, NearbyProject, OverlapDetail, OverlapOut, ProjectOut

ROOT = Path(__file__).resolve().parent.parent
LIVE_SQL = (ROOT / "db" / "live_overlaps.sql").read_text()
METERS_PER_MILE = 1609.344
CONF_LEVELS = ["none", "low", "medium", "high"]

app = FastAPI(title="Gridlock: DESC x Georgia Power overlap finder", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

MinConf = Literal["none", "low", "medium", "high"]

PROJECT_SELECT = """
    SELECT utility, project_id, name, description, status, zone, kv,
           in_service_date, in_service_date_updated, build_start, build_end, window_source,
           location_confidence, is_override, confidence_note, in_service_passed,
           ST_X(center) AS lon, ST_Y(center) AS lat
    FROM projects
"""


def allowed(min_conf: str) -> list[str]:
    return CONF_LEVELS[CONF_LEVELS.index(min_conf):]


def project_out(row) -> ProjectOut:
    r = dict(row)
    r["center"] = (r.pop("lon"), r.pop("lat"))
    r.pop("geometry", None)
    return ProjectOut(**r)


# ---------------------------------------------------------------- endpoints

@app.get("/api/health")
def health():
    with engine.connect() as conn:
        p = conn.execute(text("SELECT count(*) FROM projects")).scalar()
        o = conn.execute(text("SELECT count(*) FROM overlap_pairs")).scalar()
    return {"status": "ok", "projects": p, "overlaps": o}


@app.get("/api/projects")
def projects(utility: Optional[Literal["DESC", "GPC"]] = None,
             min_confidence: MinConf = "none",
             hide_in_service: bool = False):
    """All mapped projects as a GeoJSON FeatureCollection (what MapLibre reads directly)."""
    sql = text(f"""
        {PROJECT_SELECT.replace("FROM projects", ", ST_AsGeoJSON(geom) AS geometry FROM projects")}
        WHERE (CAST(:utility AS TEXT) IS NULL OR utility = :utility)
          AND location_confidence = ANY(:conf)
          AND (NOT :hide OR NOT in_service_passed)
        ORDER BY utility, project_id
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"utility": utility, "conf": allowed(min_confidence),
                                  "hide": hide_in_service}).mappings().all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": json.loads(r["geometry"]),
         "properties": project_out(r).model_dump(mode="json")} for r in rows]}


@app.get("/api/overlaps", response_model=list[OverlapOut])
def overlaps(max_distance_mi: float = Query(25, gt=0, le=25),
             min_confidence: MinConf = "none",
             hide_in_service: bool = False,
             tier: Optional[str] = None,
             limit: int = Query(200, ge=1, le=1000)):
    """The ranked coordination list: stored pipeline results, filtered."""
    sql = text("""
        SELECT *, ST_AsGeoJSON(connector) AS connector_json FROM overlap_pairs
        WHERE center_distance_mi <= :max_mi
          AND location_confidence = ANY(:conf)
          AND (NOT :hide OR NOT either_already_in_service)
          AND (CAST(:tier AS TEXT) IS NULL OR proximity_tier = :tier)
        ORDER BY rank LIMIT :limit
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"max_mi": max_distance_mi, "conf": allowed(min_confidence),
                                  "hide": hide_in_service, "tier": tier, "limit": limit}).mappings().all()
    return [_overlap(r) for r in rows]


@app.get("/api/overlaps/live", response_model=list[LiveOverlap])
def overlaps_live(max_distance_mi: float = Query(25, gt=0, le=100),
                  hide_in_service: bool = False):
    """The overlap method recomputed on request by PostGIS (ST_DWithin spatial join).
    Lets the radius go past the 25-mile rule, e.g. 40 km crew-staging distance, and is the
    query that keeps working as the project table grows past this dataset."""
    params = {"max_mi": max_distance_mi, "max_m": max_distance_mi * METERS_PER_MILE,
              "hide_in_service": hide_in_service}
    with engine.connect() as conn:
        rows = conn.execute(text(LIVE_SQL), params).mappings().all()
    return [LiveOverlap(
        rank=i + 1, desc_id=r["desc_id"], desc_name=r["desc_name"], gpc_id=r["gpc_id"],
        gpc_name=r["gpc_name"], center_distance_mi=round(r["center_distance_mi"], 2),
        closest_distance_km=round(r["closest_distance_km"], 2), in_service_gap_days=r["in_service_gap_days"],
        score=r["score"], connector=[(r["d_lon"], r["d_lat"]), (r["g_lon"], r["g_lat"])])
        for i, r in enumerate(rows)]


@app.get("/api/overlaps/{overlap_id}", response_model=OverlapDetail)
def overlap_detail(overlap_id: str):
    with engine.connect() as conn:
        o = conn.execute(text("SELECT *, ST_AsGeoJSON(connector) AS connector_json FROM overlap_pairs "
                              "WHERE overlap_id = :id"), {"id": overlap_id}).mappings().first()
        if not o:
            raise HTTPException(404, f"No overlap {overlap_id}")
        pair = conn.execute(text(f"{PROJECT_SELECT} WHERE (utility, project_id) IN (('DESC', :d), ('GPC', :g))"),
                            {"d": o["desc_id"], "g": o["gpc_id"]}).mappings().all()
    by_util = {p["utility"]: project_out(p) for p in pair}
    return OverlapDetail(**_overlap(o).model_dump(), desc_project=by_util["DESC"], gpc_project=by_util["GPC"])


@app.get("/api/projects/near", response_model=list[NearbyProject])
def projects_near(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                  radius_mi: float = Query(25, gt=0, le=100),
                  utility: Optional[Literal["DESC", "GPC"]] = None):
    """Everything within radius_mi of a clicked point: an indexed ST_DWithin lookup."""
    sql = text("""
        WITH q AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography AS pt)
        SELECT utility, project_id, name, ST_X(center) AS lon, ST_Y(center) AS lat,
               ST_Distance(center::geography, q.pt, false) / :mpm AS distance_mi
        FROM projects, q
        WHERE ST_DWithin(center::geography, q.pt, :radius_m, false)
          AND (CAST(:utility AS TEXT) IS NULL OR utility = :utility)
        ORDER BY distance_mi
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"lat": lat, "lon": lon, "radius_m": radius_mi * METERS_PER_MILE,
                                  "mpm": METERS_PER_MILE, "utility": utility}).mappings().all()
    return [NearbyProject(utility=r["utility"], project_id=r["project_id"], name=r["name"],
                          distance_mi=round(r["distance_mi"], 2), center=(r["lon"], r["lat"])) for r in rows]


def _overlap(r) -> OverlapOut:
    d = {k: v for k, v in dict(r).items() if k in OverlapOut.model_fields}
    d["connector"] = [tuple(c) for c in json.loads(r["connector_json"])["coordinates"]]
    return OverlapOut(**d)


# Optional frontend: mounted last so /api/* routes win. Skipped until web/index.html exists.
if (ROOT / "web" / "index.html").exists():
    app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
