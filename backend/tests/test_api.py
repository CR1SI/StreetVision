"""API tests. Need PostGIS running and loaded (python -m db.load_to_postgis):
python -m pytest tests/test_api.py

The upload tests use a SYNTHETIC third utility and delete it afterwards."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from api.main import app

client = TestClient(app)

UPLOAD = """utility_id,project_id,name,in_service_date,build_start,build_end,kv,endpoint_a,lat_a,lon_a,endpoint_b,lat_b,lon_b
ZTEST,Z-1,Synthetic line near the border,2027-06-01,2026,2027,230,Test A,32.29,-81.08,Test B,32.48,-80.98
ZTEST,Z-2,Synthetic substation,2028-12-31,2028,2028,115,Test C,32.21,-81.02,,,
ZTEST,Z-3,No coordinates,2028-01-01,,,,Nowhere,,,,,
"""
FORM = {"utility_id": "ZTEST", "source_name": "pytest synthetic upload", "public_attestation": "true"}


@pytest.fixture(scope="module", autouse=True)
def database_up():
    try:
        body = client.get("/api/health").json()
    except OperationalError:
        pytest.skip("PostGIS not running")
    if not body.get("projects"):
        pytest.skip("PostGIS not loaded")


def test_health_and_utilities():
    assert client.get("/api/health").json()["status"] == "ok"
    ids = [u["utility_id"] for u in client.get("/api/utilities").json()]
    assert ids and ids == sorted(ids)


def test_projects_is_geojson():
    fc = client.get("/api/projects").json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    assert {"utility_id", "project_id", "center", "source_kind", "project_type", "endpoint_a"} <= set(fc["features"][0]["properties"])
    types = {f["properties"]["project_type"] for f in fc["features"]}
    assert types <= {"line_rebuild", "new_line", "substation", "area_package", "other"} and len(types) > 1
    assert all("project_type" in o["a"] for o in client.get("/api/overlaps?limit=5").json())


def test_overlaps_ranked_and_filtered():
    ov = client.get("/api/overlaps").json()
    assert [o["rank"] for o in ov] == list(range(1, len(ov) + 1))
    assert all(o["a"]["utility_id"] < o["b"]["utility_id"] for o in ov)
    assert all(o["center_distance_mi"] < 25 for o in ov)
    assert all(o["center_distance_mi"] <= 10 for o in client.get("/api/overlaps?max_distance_mi=10").json())


def test_live_matches_stored_at_25_miles():
    stored = {(o["a"]["project_id"], o["b"]["project_id"]) for o in client.get("/api/overlaps?limit=2000").json()}
    live = {(o["a"]["project_id"], o["b"]["project_id"]) for o in client.get("/api/overlaps/live?max_distance_mi=25&limit=5000").json()}
    assert stored == live


def test_detail_and_404():
    first = client.get("/api/overlaps").json()[0]
    d = client.get(f"/api/overlaps/{first['overlap_id']}").json()
    assert d["project_a"]["utility_id"] == first["a"]["utility_id"]
    assert client.get("/api/overlaps/999999999").status_code == 404


def test_near_and_validation():
    assert client.get("/api/projects/near?lat=32.3&lon=-81.1&radius_mi=25").status_code == 200
    assert client.get("/api/projects/near?lat=32.3&lon=-81.1&radius_mi=500").status_code == 422


def test_upload_adds_utility_and_overlaps_then_delete_removes_them():
    before = client.get("/api/health").json()
    official_before = len(client.get("/api/overlaps?source=official&limit=2000").json())
    r = client.post("/api/datasets", files={"file": ("z.csv", UPLOAD, "text/csv")}, data=FORM)
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["rows_accepted"] == 2 and rep["rows_rejected"] == 1
    assert rep["errors"][0]["project_id"] == "Z-3"
    ds, token = rep["dataset"]["dataset_id"], rep["delete_token"]
    try:
        assert "ZTEST" in [u["utility_id"] for u in client.get("/api/utilities").json()]
        mine = client.get("/api/overlaps?utilities=ZTEST").json()
        assert len(mine) == rep["new_overlaps"]
        assert all(o["user_data_involved"] for o in mine)
        assert len(client.get("/api/overlaps?source=official&limit=2000").json()) == official_before
    finally:
        assert client.delete(f"/api/datasets/{ds}").status_code == 403           # no token
        assert client.delete(f"/api/datasets/{ds}", headers={"X-Delete-Token": token}).status_code == 200
    after = client.get("/api/health").json()
    assert after == before


def test_upload_guards():
    no_attest = {**FORM, "public_attestation": "false"}
    assert client.post("/api/datasets", files={"file": ("z.csv", UPLOAD, "text/csv")}, data=no_attest).status_code == 400
    bad_id = {**FORM, "utility_id": "lower!"}
    assert client.post("/api/datasets", files={"file": ("z.csv", UPLOAD, "text/csv")}, data=bad_id).status_code == 422
    official = client.get("/api/datasets?source=official").json()[0]
    hijack = f"utility_id,project_id,name,lat_a,lon_a\n{official['utility_id']},HIJACK,x,32,-81\n"
    r = client.post("/api/datasets", files={"file": ("z.csv", hijack, "text/csv")},
                    data={**FORM, "utility_id": official["utility_id"], "source_name": official["source_name"]})
    assert r.status_code == 409                                                  # can't replace official data
    assert client.delete(f"/api/datasets/{official['dataset_id']}", headers={"X-Delete-Token": "x"}).status_code == 403


def test_template_downloads():
    r = client.get("/api/datasets/template")
    assert r.status_code == 200 and r.text.startswith("utility_id,project_id,name")
