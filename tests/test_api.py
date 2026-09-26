"""API smoke tests. Needs PostGIS running and loaded (python -m db.load_to_postgis):
python -m pytest tests/test_api.py"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from api.main import app

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def database_up():
    try:
        client.get("/api/health")
    except OperationalError:
        pytest.skip("PostGIS not running / not loaded")


def test_health():
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["projects"] > 0


def test_projects_is_geojson():
    fc = client.get("/api/projects").json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    assert {"utility", "project_id", "center", "location_confidence"} <= set(fc["features"][0]["properties"])


def test_overlaps_ranked_and_filtered():
    ov = client.get("/api/overlaps").json()
    assert [o["rank"] for o in ov] == sorted(o["rank"] for o in ov)
    assert all(o["center_distance_mi"] < 25 for o in ov)
    near = client.get("/api/overlaps?max_distance_mi=10").json()
    assert all(o["center_distance_mi"] <= 10 for o in near)


def test_live_query_matches_pipeline():
    stored = {(o["desc_id"], o["gpc_id"]) for o in client.get("/api/overlaps").json()}
    live = {(o["desc_id"], o["gpc_id"]) for o in client.get("/api/overlaps/live?max_distance_mi=25").json()}
    assert stored == live


def test_detail_and_404():
    first = client.get("/api/overlaps").json()[0]["overlap_id"]
    d = client.get(f"/api/overlaps/{first}").json()
    assert d["desc_project"]["utility"] == "DESC" and d["gpc_project"]["utility"] == "GPC"
    assert client.get("/api/overlaps/OVL_999999").status_code == 404


def test_near_and_validation():
    assert client.get("/api/projects/near?lat=32.3&lon=-81.1&radius_mi=25").status_code == 200
    assert client.get("/api/projects/near?lat=32.3&lon=-81.1&radius_mi=500").status_code == 422
