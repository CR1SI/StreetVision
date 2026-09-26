# StreetVision: Gridlock Challenge backend (DESC x Georgia Power)

Pipeline (pdfplumber + GeoPandas + Pydantic) -> PostGIS -> FastAPI.
The pipeline is the source of truth; PostGIS is the serving and live-query layer.

## Setup
    python3.12 -m venv .venv && source .venv/bin/activate     # 3.12 recommended; 3.14 may lack wheels
    pip install -r requirements.txt
    docker compose up -d db            # or Postgres.app (bundles PostGIS): db/user/password all "gridlock"

Put the PDFs in data/raw/:
- 2024-2028-2million-and-above-project-descriptions.pdf  (DESC baseline, organizers' edition)
- 2026-2030-2million-and-above-project-descriptions.pdf  (optional "updated dates" pass, from scrtp.com)
- 2025_IRP_Volume_3_PUBLIC_DISCLOSURE.pdf                 (Georgia Power)

## Run (from the repo root; scripts run as modules)
    python -m pipeline.extract_desc data/raw/2024-2028-...pdf [data/raw/2026-2030-...pdf] data/processed/desc_projects.csv
    python -m pipeline.extract_gpc_irp data/raw/2025_IRP_Volume_3_PUBLIC_DISCLOSURE.pdf data/processed/gpc_projects.csv
    python -m pipeline.geocode_osm                 # queries Overpass; needs internet
    #   review data/substations.csv (priority rows first): confirmed=yes / no, or type lat/lon + confirmed=manual
    #   new substations not in OSM: data/overrides.csv (lat_a/lon_a columns accept typed coordinates)
    python -m pipeline.geocode_osm --offline       # re-run after review; keeps reviewed rows
    python -m pipeline.overlap [--dates baseline|updated] [--land-cost-per-acre N]
    python -m db.load_to_postgis                   # loads + cross-checks PostGIS against the pipeline
    uvicorn api.main:app --reload                  # http://localhost:8000/docs

Tests:
    python -m pytest tests/test_pipeline.py        # no database needed
    python -m pytest tests/test_api.py             # needs PostGIS loaded
    python -m tests.check_answer_key data/raw/Projects_Overlaps.xlsx   # organizers' worked example

## API (the contract for the frontend)
| Endpoint | Returns |
|---|---|
| GET /api/health | row counts |
| GET /api/projects?utility=&min_confidence=&hide_in_service= | GeoJSON FeatureCollection (MapLibre reads it directly) |
| GET /api/overlaps?max_distance_mi=&min_confidence=&hide_in_service=&tier=&limit= | ranked list; `connector` = [[lon,lat],[lon,lat]] |
| GET /api/overlaps/{overlap_id} | one overlap + both full projects |
| GET /api/overlaps/live?max_distance_mi=&hide_in_service= | overlaps recomputed by PostGIS (ST_DWithin), radius up to 100 mi |
| GET /api/projects/near?lat=&lon=&radius_mi=&utility= | projects near a clicked point |
Response shapes: api/models.py (ProjectOut, OverlapOut, OverlapDetail, LiveOverlap, NearbyProject).

## Outputs (data/processed/)
desc_projects.csv, gpc_projects.csv, projects.geojson, overlaps.geojson, overlaps.csv,
projects_overlaps.xlsx (organizers' column layout: name_a/lat_a/lon_a, name_b/..., lat_center/lon_center,
overlap_count, overlap_1..n).

## Method (organizer guide, Part 3)
- Center = midpoint of a project's two endpoints (one located -> that point; multi-segment -> mean of endpoints).
- Haversine between centers; overlap if under 25 miles. Time gap = days between in-service dates.
- Score = 0.7 x (1 - distance/25 mi) + 0.3 x (1 - gap/1095 days, capped). Higher = better.
- Extras: closest-point distance (UTM 17N) + tier, build-window overlap, already-in-service flag,
  shared right-of-way estimate for two lines within 1.6 km.

## Scale
The live query uses a GiST index on center::geography. Tested with 10,000 synthetic projects
(25M candidate pairs): index scan, ~0.4 s, 142k pairs within 25 mi.

## Assumptions to state in the demo
- Lines are straight segments between endpoint substations.
- DESC build window = years with > $500k planned spend; GPC = detail-page Start Date -> Need Date.
- 2024-2028 is the DESC baseline; newer-edition dates are shown alongside (*_updated), never overwriting.
- Impossible DESC dates (04/31/26) are clamped to month end.
- GPC + SAV sponsors = Georgia Power (SAV = former Savannah Electric); GTC/MEAG/DU excluded.
- GPC Bay Creek - Conyers lists a start date after its need date in the PDF; flagged (data_note), window estimated.
- Shared right-of-way = shorter line x 100 ft corridor (upper bound) x a sourced land cost.
- Low-confidence OSM matches get no coordinates until confirmed. Public data only; redacted costs never estimated.
