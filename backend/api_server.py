"""
Lightweight zero-dependency dev server for StreetVision.
Serves the pre-computed processed datasets (GeoJSON/CSV) at the FastAPI-compatible endpoints:
  - /api/health
  - /api/utilities
  - /api/projects
  - /api/overlaps
  - /api/overlaps/<id>
  - /api/datasets
"""
import csv
import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "processed"

# Load projects_standard.csv
projects_by_key = {}
with open(DATA_DIR / "projects_standard.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        key = (row["utility_id"], row["project_id"])
        projects_by_key[key] = row

# Load projects.geojson
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
with open(DATA_DIR / "overlaps.geojson", encoding="utf-8") as f:
    raw_overlaps_geojson = json.load(f)

SHAREABLE = {
    "touching/crossing": "Coordinate outages and crossing structures",
    "under 1.6 km": "Share right-of-way, access roads, permits",
    "under 8 km": "Share laydown yards, deliveries, site logistics",
    "under 25 mi": "Share crews, cranes, contractors",
}

def get_window(proj):
    if not proj:
        return None
    s, e = proj.get("build_start"), proj.get("build_end")
    if s or e:
        return f"{s}-{e}"
    return None

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
        "closest_distance_km": float(p["closest_distance_km"]),
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


def _project_out(csv_row, ref):
    """Build a ProjectOut-compatible dict from a projects_standard.csv row and a ProjectRef."""
    return {
        "utility_id": ref["utility_id"],
        "project_id": ref["project_id"],
        "name": csv_row.get("name", ref.get("name", "")),
        "description": csv_row.get("description"),
        "status": csv_row.get("status"),
        "region": csv_row.get("region"),
        "kv": int(csv_row["kv"]) if csv_row.get("kv") else None,
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

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

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

            feats = projects_features
            if selected_utils:
                feats = [f for f in feats if f["properties"]["utility_id"] in selected_utils]

            self.send_json({
                "type": "FeatureCollection",
                "features": feats
            })
        elif path == "/api/overlaps":
            tier = qs.get("tier", [None])[0]
            max_dist = float(qs.get("max_distance_mi", [25])[0])
            utils_param = qs.get("utilities", [None])[0]
            selected_utils = [u.strip().upper() for u in utils_param.split(",") if u.strip()] if utils_param else []

            results = overlaps_list
            if selected_utils:
                if len(selected_utils) == 1:
                    results = [o for o in results if o["a"]["utility_id"] in selected_utils or o["b"]["utility_id"] in selected_utils]
                else:
                    results = [o for o in results if o["a"]["utility_id"] in selected_utils and o["b"]["utility_id"] in selected_utils]
            if tier:
                results = [o for o in results if o["proximity_tier"] == tier]
            if max_dist < 25:
                results = [o for o in results if o["center_distance_mi"] <= max_dist]
            hide_in_service = qs.get("hide_in_service", ["false"])[0].lower() in ("true", "1")
            if hide_in_service:
                results = [o for o in results if not o["either_already_in_service"]]

            # Re-rank
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
            self.send_json([
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
            ])
        else:
            self.send_json({"detail": "Not found"}, 404)

if __name__ == "__main__":
    port = 8001
    server = HTTPServer(("127.0.0.1", port), ApiHandler)
    print(f"StreetVision mock API running on http://127.0.0.1:{port}/")
    sys.stdout.flush()
    server.serve_forever()
