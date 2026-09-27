"""
Lightweight zero-dependency server for StreetVision.
Serves the pre-computed processed datasets (GeoJSON/CSV) at the FastAPI-compatible endpoints:
  - /api/health
  - /api/utilities
  - /api/projects
  - /api/projects/near
  - /api/overlaps
  - /api/overlaps/<id>
  - /api/overlaps/live
  - /api/datasets
  - /api/datasets/template
And serves the production frontend static web build from frontend/web.
"""
import csv
import json
import math
import mimetypes
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "processed"
WEB_DIR = BASE_DIR.parent / "frontend" / "web"

# Load projects_standard.csv
projects_by_key = {}
if (DATA_DIR / "projects_standard.csv").exists():
    with open(DATA_DIR / "projects_standard.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = (row["utility_id"], row["project_id"])
            projects_by_key[key] = row

# Load projects.geojson
raw_projects_geojson = {"type": "FeatureCollection", "features": []}
if (DATA_DIR / "projects.geojson").exists():
    with open(DATA_DIR / "projects.geojson", encoding="utf-8") as f:
        raw_projects_geojson = json.load(f)

projects_features = []
for feat in raw_projects_geojson["features"]:
    props = dict(feat["properties"])
    props["name"] = props.get("project_name", "")
    props["center"] = [props.get("lon_center", 0), props.get("lat_center", 0)]
    props["in_service_passed"] = False
    props["dataset_id"] = 1 if props.get("utility_id") == "DESC" else 2
    props["is_override"] = False
    projects_features.append({
        "type": "Feature",
        "geometry": feat["geometry"],
        "properties": props
    })

# Load overlaps.geojson
raw_overlaps_geojson = {"type": "FeatureCollection", "features": []}
if (DATA_DIR / "overlaps.geojson").exists():
    with open(DATA_DIR / "overlaps.geojson", encoding="utf-8") as f:
        raw_overlaps_geojson = json.load(f)

SHAREABLE = {
    "touching/crossing": "Coordinate outages and crossing structures",
    "under 1 mi": "Share right-of-way, access roads, permits",
    "under 5 mi": "Share laydown yards, deliveries, site logistics",
    "under 25 mi": "Share crews, cranes, contractors",
}

def get_window(proj):
    if not proj:
        return None
    s, e = proj.get("build_start"), proj.get("build_end")
    if s or e:
        return f"{s}-{e}"
    return None

def haversine_mi(lat1, lon1, lat2, lon2):
    r = 3958.8  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

overlaps_list = []
for i, feat in enumerate(raw_overlaps_geojson["features"]):
    p = feat["properties"]
    pa = projects_by_key.get((p["utility_a"], p["project_id_a"]), {})
    pb = projects_by_key.get((p["utility_b"], p["project_id_b"]), {})
    
    overlap_item = {
        "overlap_id": i + 1,
        "rank": i + 1,
        "label": p.get("overlap_label", f"OVL_{i+1}"),
        "a": {
            "utility_id": p["utility_a"],
            "project_id": p["project_id_a"],
            "name": p["name_a"],
            "in_service_date": pa.get("in_service_date"),
            "build_window": get_window(pa),
            "source_kind": "official"
        },
        "b": {
            "utility_id": p["utility_b"],
            "project_id": p["project_id_b"],
            "name": p["name_b"],
            "in_service_date": pb.get("in_service_date"),
            "build_window": get_window(pb),
            "source_kind": "official"
        },
        "center_distance_mi": float(p["center_distance_mi"]),
        "closest_distance_mi": float(p["closest_distance_mi"]),
        "proximity_tier": p["proximity_tier"],
        "shareable": SHAREABLE.get(p["proximity_tier"], ""),
        "in_service_gap_days": p.get("in_service_gap_days"),
        "build_windows_overlap": bool(p.get("build_windows_overlap")),
        "either_already_in_service": False,
        "location_confidence": p.get("location_confidence", "low"),
        "override_involved": bool(p.get("override_involved")),
        "user_data_involved": False,
        "score": float(p["score"]),
        "shared_row_acres_upper_bound": p.get("shared_row_acres"),
        "shared_row_value_usd": None,
        "connector": feat["geometry"]["coordinates"]
    }
    overlaps_list.append(overlap_item)

TEMPLATE_CSV = """utility_id,project_id,name,description,status,kv,in_service_date,in_service_date_updated,build_start,build_end,endpoint_a,lat_a,lon_a,endpoint_b,lat_b,lon_b,geometry_wkt,region,location_confidence,confidence_note,is_override,corridor_group,source_name
EXAMPLE,EX-001,Example A - Example B 230 kV rebuild,,,230,2028-06-01,,2027,2028,Example A,32.30,-81.00,Example B,32.40,-81.10,,SC,medium,,False,,Example Utility 2028 Filing
EXAMPLE,EX-002,Example C substation expansion,,,115,2029-12-31,,,Example C,32.50,-81.20,,,,,,SC,medium,,False,,Example Utility 2028 Filing
""".encode("utf-8")

def _project_out(csv_row, ref):
    """Build a ProjectOut-compatible dict from a projects_standard.csv row and a ProjectRef."""
    return {
        "utility_id": ref["utility_id"],
        "project_id": ref["project_id"],
        "name": csv_row.get("name", ref.get("name", "")),
        "description": csv_row.get("description"),
        "status": csv_row.get("status"),
        "region": csv_row.get("region"),
        "kv": int(float(csv_row["kv"])) if csv_row.get("kv") else None,
        "in_service_date": csv_row.get("in_service_date") or None,
        "in_service_date_updated": csv_row.get("in_service_date_updated") or None,
        "build_start": int(csv_row["build_start"]) if csv_row.get("build_start") else None,
        "build_end": int(csv_row["build_end"]) if csv_row.get("build_end") else None,
        "location_confidence": csv_row.get("location_confidence", "low"),
        "is_override": str(csv_row.get("is_override", "")).lower() in ("true", "1", "yes"),
        "confidence_note": csv_row.get("confidence_note"),
        "in_service_passed": False,
        "dataset_id": 1 if ref["utility_id"] == "DESC" else 2,
        "source_kind": ref.get("source_kind", "official"),
        "center": [
            float(csv_row.get("lon_a", 0) or 0),
            float(csv_row.get("lat_a", 0) or 0),
        ],
    }

CONF_LEVELS = ["none", "low", "medium", "high"]

def allowed_conf(min_conf: str) -> list[str]:
    if min_conf not in CONF_LEVELS:
        return CONF_LEVELS
    return CONF_LEVELS[CONF_LEVELS.index(min_conf):]

class ApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        self.send_header("Access-Control-Allow-Headers", "*")

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, rel_path):
        clean_path = unquote(rel_path).lstrip("/")
        target = WEB_DIR / clean_path
        if not clean_path or target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            # Fallback to index.html for client-side routing if exists
            target = WEB_DIR / "index.html"
        if not target.is_file():
            self.send_json({"detail": "Not found"}, 404)
            return

        mime_type, _ = mimetypes.guess_type(str(target))
        mime_type = mime_type or "application/octet-stream"
        try:
            with open(target, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_json({"detail": str(e)}, 500)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        if not path.startswith("/api"):
            self.serve_static(path)
            return

        if path == "/api/health":
            self.send_json({
                "status": "ok",
                "utilities": 2,
                "datasets": 2,
                "projects": len(projects_features),
                "overlaps": len(overlaps_list)
            })
        elif path == "/api/utilities":
            self.send_json([
                {
                    "utility_id": "DESC",
                    "name": "Dominion Energy South Carolina",
                    "projects": sum(1 for p in projects_features if p["properties"]["utility_id"] == "DESC"),
                    "datasets": 1,
                    "has_official_data": True
                },
                {
                    "utility_id": "GPC",
                    "name": "Georgia Power Company",
                    "projects": sum(1 for p in projects_features if p["properties"]["utility_id"] == "GPC"),
                    "datasets": 1,
                    "has_official_data": True
                }
            ])
        elif path == "/api/projects":
            utils_param = qs.get("utilities", [None])[0]
            selected_utils = [u.strip().upper() for u in utils_param.split(",") if u.strip()] if utils_param else []
            min_conf = qs.get("min_confidence", ["none"])[0]
            hide_in_service = qs.get("hide_in_service", ["false"])[0].lower() in ("true", "1")

            feats = projects_features
            if selected_utils:
                feats = [f for f in feats if f["properties"]["utility_id"] in selected_utils]
            if min_conf and min_conf != "none":
                valid_confs = allowed_conf(min_conf)
                feats = [f for f in feats if f["properties"].get("location_confidence", "none") in valid_confs]
            if hide_in_service:
                feats = [f for f in feats if not f["properties"].get("in_service_passed", False)]

            self.send_json({
                "type": "FeatureCollection",
                "features": feats
            })
        elif path == "/api/projects/near":
            lat = float(qs.get("lat", [0])[0])
            lon = float(qs.get("lon", [0])[0])
            radius_mi = float(qs.get("radius_mi", [25])[0])
            utils_param = qs.get("utilities", [None])[0]
            selected_utils = [u.strip().upper() for u in utils_param.split(",") if u.strip()] if utils_param else []

            results = []
            for f in projects_features:
                p = f["properties"]
                if selected_utils and p["utility_id"] not in selected_utils:
                    continue
                clon, clat = p["center"]
                if not clat or not clon:
                    continue
                dist = haversine_mi(lat, lon, clat, clon)
                if dist <= radius_mi:
                    results.append({
                        "utility_id": p["utility_id"],
                        "project_id": p["project_id"],
                        "name": p["name"],
                        "distance_mi": round(dist, 2),
                        "center": [clon, clat]
                    })
            results.sort(key=lambda r: r["distance_mi"])
            self.send_json(results)
        elif path in ("/api/overlaps", "/api/overlaps/live"):
            tier = qs.get("tier", [None])[0]
            max_dist = float(qs.get("max_distance_mi", [25])[0])
            utils_param = qs.get("utilities", [None])[0]
            selected_utils = [u.strip().upper() for u in utils_param.split(",") if u.strip()] if utils_param else []
            min_conf = qs.get("min_confidence", [None])[0]
            hide_in_service = qs.get("hide_in_service", ["false"])[0].lower() in ("true", "1")
            limit = int(qs.get("limit", [500])[0])

            results = list(overlaps_list)
            if selected_utils:
                if len(selected_utils) == 1:
                    results = [o for o in results if o["a"]["utility_id"] in selected_utils or o["b"]["utility_id"] in selected_utils]
                else:
                    results = [o for o in results if o["a"]["utility_id"] in selected_utils and o["b"]["utility_id"] in selected_utils]
            if tier:
                results = [o for o in results if o["proximity_tier"] == tier]
            if max_dist < 25:
                results = [o for o in results if o["center_distance_mi"] <= max_dist]
            if min_conf and min_conf != "none":
                valid_confs = allowed_conf(min_conf)
                results = [o for o in results if o.get("location_confidence", "none") in valid_confs]
            if hide_in_service:
                results = [o for o in results if not o["either_already_in_service"]]

            if path == "/api/overlaps/live":
                results = [{**o, "live": True} for o in results]

            results = results[:limit]
            for rank, item in enumerate(results, start=1):
                item["rank"] = rank
                item["label"] = f"OVL_{rank}"

            self.send_json(results)
        elif path.startswith("/api/overlaps/"):
            try:
                oid = int(path.split("/")[-1])
                match = next((o for o in overlaps_list if o["overlap_id"] == oid), None)
                if match:
                    detail = dict(match)
                    pa = projects_by_key.get((match["a"]["utility_id"], match["a"]["project_id"]), {})
                    pb = projects_by_key.get((match["b"]["utility_id"], match["b"]["project_id"]), {})
                    detail["project_a"] = _project_out(pa, match["a"])
                    detail["project_b"] = _project_out(pb, match["b"])
                    self.send_json(detail)
                else:
                    self.send_json({"detail": "Not found"}, 404)
            except Exception:
                self.send_json({"detail": "Invalid ID"}, 400)
        elif path == "/api/datasets":
            source = qs.get("source", ["all"])[0]
            all_datasets = [
                {
                    "dataset_id": 1,
                    "utility_id": "DESC",
                    "utility_name": "Dominion Energy South Carolina",
                    "source_name": "SCRTP $2M+ planned transmission projects 2024-2028 + 2026-2030 updates",
                    "kind": "official",
                    "submitted_by": "System",
                    "notes": "Extracted from official SCRTP PDF filings",
                    "created_at": "2026-09-26T00:00:00Z",
                    "projects": 46
                },
                {
                    "dataset_id": 2,
                    "utility_id": "GPC",
                    "utility_name": "Georgia Power Company",
                    "source_name": "Georgia Power 2025 IRP Volume 3 Public Disclosure",
                    "kind": "official",
                    "submitted_by": "System",
                    "notes": "Extracted from Georgia Power 2025 IRP",
                    "created_at": "2026-09-26T00:00:00Z",
                    "projects": 22
                }
            ]
            if source == "user":
                res = [d for d in all_datasets if d["kind"] == "user_submitted"]
            elif source == "official":
                res = [d for d in all_datasets if d["kind"] == "official"]
            else:
                res = all_datasets
            self.send_json(res)
        elif path == "/api/datasets/template":
            self.send_response(200)
            self.send_header("Content-Type", "text/csv")
            self.send_header("Content-Disposition", "attachment; filename=projects_template.csv")
            self.send_header("Content-Length", str(len(TEMPLATE_CSV)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(TEMPLATE_CSV)
        else:
            self.send_json({"detail": "Not found"}, 404)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    server = HTTPServer(("0.0.0.0", port), ApiHandler)
    print(f"StreetVision mock API running on http://127.0.0.1:{port}/ (bound to 0.0.0.0)")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
