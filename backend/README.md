# StreetVision: transmission project overlap finder (Gridlock Challenge backend)

Finds where planned transmission projects from **different utilities** are close enough to
coordinate on crews, equipment, and right-of-way. Built on DESC x Georgia Power, but any
utility can be added by uploading a CSV.

```
official PDFs --adapters--> standard CSV --+
                                           +--> ingest (validate) --> PostGIS --> find_overlaps() --> FastAPI
user uploads (standard CSV) ---------------+
```
- **One door in:** official data and user uploads use the same format, validation, and loader (`api/ingest.py`).
- **One engine:** the SQL function `find_overlaps` (`db/functions.sql`) computes overlaps for any pair of
  utilities, both when data is loaded and for live radius queries. `pipeline/method.py` is a plain-Python
  reference the loader cross-checks it against.
- **Trust:** datasets are `official` (loaded by the pipeline) or `user_submitted` (uploaded). Uploads need a
  public-data / no-CEII attestation, can't overwrite official projects, and can be deleted only with the
  token returned at upload (or `ADMIN_TOKEN`).

## Setup
    python3.12 -m venv .venv && source .venv/bin/activate     # 3.12 recommended; 3.14 may lack wheels
    pip install -r requirements.txt
    docker compose up -d db            # or Postgres.app (bundles PostGIS): db/user/password all "gridlock"

## Official data (DESC + Georgia Power)
Put the PDFs in `data/raw/`: `2024-2028-2million-and-above-project-descriptions.pdf` (DESC baseline),
optionally `2026-2030-2million-and-above-project-descriptions.pdf` (updated dates, from scrtp.com), and
`2025_IRP_Volume_3_PUBLIC_DISCLOSURE.pdf` (Georgia Power). Then, from the repo root:

    python -m pipeline.extract_desc data/raw/2024-2028-...pdf [data/raw/2026-2030-...pdf] data/processed/desc_projects.csv
    python -m pipeline.extract_gpc_irp data/raw/2025_IRP_Volume_3_PUBLIC_DISCLOSURE.pdf data/processed/gpc_projects.csv
    python -m pipeline.geocode_osm                 # OpenStreetMap lookup; needs internet
    #   review data/substations.csv, priority rows first: confirmed=yes / no, or type lat/lon + confirmed=manual
    #   substations not in OSM: data/overrides.csv (lat_a/lon_a accept typed coordinates)
    python -m pipeline.geocode_osm --offline       # re-run after review; keeps reviewed rows
    python -m pipeline.build_projects [--dates baseline|updated]   # -> data/processed/projects_standard.csv
    python -m db.load_to_postgis                   # loads official data, keeps user uploads, cross-checks
    python -m db.export                            # GeoJSON, CSV, organizers' projects_overlaps.xlsx
    uvicorn api.main:app --reload                  # http://localhost:8000/docs

`python -m db.load_to_postgis --reset` rebuilds the database from scratch (deletes user uploads).

## Frontend
The web app lives in `front/` (React + Vite + Tailwind + MapLibre); its build is committed to `web/`, which
this API serves at http://localhost:8000/. Pages: map + ranked list (`/`), overlap detail (`/overlap/?id=`),
data catalog (`/data/`), dataset (`/dataset/?id=`), contribute (`/contribute/`), address check (`/check/`),
about (`/about/`). Setup, dev server and design notes: [`front/README.md`](front/README.md).

    cd front && npm install && npm run build      # rebuild web/ after frontend changes
    cd front && npm run dev                       # hot reload on :5173, /api proxied to :8000

## Adding another utility (upload)
1. Download the template: `GET /api/datasets/template`.
2. One row per project. Required: `project_id`, `name`, and a location: `lat_a/lon_a` (a substation),
   `lat_a/lon_a` + `lat_b/lon_b` (a line between two), or `geometry_wkt` (any lon/lat LineString,
   MultiLineString, Point, or MultiPoint). Optional: dates, build years, kV, confidence, notes.
3. `POST /api/datasets` (multipart form): `file`, `utility_id` (e.g. `SANTEE`), `source_name`,
   `public_attestation=true`, optional `utility_name`, `submitted_by`, `notes`.
   Valid rows are saved; invalid rows come back with a reason each; overlaps with every other utility
   are computed immediately. Uploading again with the same `source_name` replaces the earlier version.
4. Keep the `delete_token` from the response: `DELETE /api/datasets/{id}` with header `X-Delete-Token`.

## API
| Endpoint | Returns |
|---|---|
| `GET /api/health` | counts |
| `GET /api/utilities` | every utility with project / dataset counts |
| `GET /api/projects?utilities=&source=&min_confidence=&hide_in_service=` | GeoJSON FeatureCollection |
| `GET /api/overlaps?utilities=&source=&max_distance_mi=&min_confidence=&hide_in_service=&tier=&land_cost_per_acre=&limit=` | ranked list |
| `GET /api/overlaps/{overlap_id}` | one overlap + both full projects |
| `GET /api/overlaps/live?max_distance_mi=&utilities=&source=` | engine run on request, radius up to 100 mi |
| `GET /api/projects/near?lat=&lon=&radius_mi=&utilities=` | projects near a point |
| `GET /api/datasets`, `GET /api/datasets/template`, `POST /api/datasets`, `DELETE /api/datasets/{id}` | datasets |

Filters: `utilities=DESC` -> pairs involving DESC; `utilities=DESC,GPC` -> pairs between them.
`source=all|official|user`. Response shapes are in `api/models.py`: an overlap has `a` and `b`
(each `utility_id`, `project_id`, `name`, `in_service_date`, `build_window`, `source_kind`), plus
distances, tier, score, `label` (`OVL_<rank>`), and `connector` `[[lon,lat],[lon,lat]]` for the map.

## Tests
    python -m pytest tests/test_pipeline.py        # no database needed
    python -m pytest tests/test_api.py             # needs PostGIS loaded; uploads + deletes a synthetic utility
    python -m tests.check_answer_key data/raw/Projects_Overlaps.xlsx   # organizers' worked example

## Method (organizer guide, Part 3)
- Center = midpoint of a project's two endpoints (one located -> that point; multi-segment -> mean of endpoints).
- Great-circle distance between centers; overlap if under 25 miles, between two different utilities.
- Time gap = days between in-service dates.
- Score = 0.7 x (1 - distance/25 mi) + 0.3 x (1 - gap/1095 days, capped). Higher = better.
- Extras: closest-point distance + tier, build-window overlap, already-in-service flag,
  shared right-of-way acres for two lines within 1.6 km (x `land_cost_per_acre` for a dollar figure).

## Scale
`find_overlaps` uses a GiST index on `center::geography`, and uploads compute only the pairs that
touch the new dataset. Tested with 10,000 synthetic projects (25M candidate pairs): index scan,
~0.4 s, 142k pairs within 25 mi.

## Assumptions to state in the demo
- Lines are straight segments between endpoint substations.
- DESC build window = years with > $500k planned spend; GPC = detail-page Start Date -> Need Date.
- 2024-2028 is the DESC baseline; newer-edition dates are kept alongside (`in_service_date_updated`).
- Impossible DESC dates (04/31/26) are clamped to month end.
- GPC + SAV sponsors = Georgia Power (SAV = former Savannah Electric); GTC/MEAG/DU excluded.
- GPC Bay Creek - Conyers lists a start date after its need date in the PDF; flagged, window estimated.
- Shared right-of-way = shorter line x 100 ft corridor (upper bound) x a sourced land cost.
- Low-confidence OSM matches get no coordinates until confirmed. Public data only; redacted costs never estimated.
- User-submitted data is labeled as such everywhere and can be filtered out with `source=official`.
