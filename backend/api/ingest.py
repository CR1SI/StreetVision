"""
The one way projects enter the database: official loads (db/load_to_postgis.py) and user
uploads (POST /api/datasets) both call ingest().

  1. Validate every row against ProjectIn; collect per-row errors instead of failing the batch.
  2. Refuse rows that would overwrite another dataset's project (user data can never replace official data).
  3. Replace the dataset if one with the same utility + source name exists (re-upload).
  4. Insert projects, then compute overlaps for pairs touching this dataset only (incremental).
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from pydantic import ValidationError
from shapely import wkt as shapely_wkt
from shapely.geometry import LineString, Point
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from api.models import STANDARD_COLUMNS, ProjectIn, RowError

MAX_ROWS = 20_000
STORED_RADIUS_MI = 25.0


class IngestError(Exception):
    """The whole batch was refused (nothing written). .errors holds row-level detail."""
    def __init__(self, message: str, errors: list[RowError] | None = None, status: int = 422):
        super().__init__(message)
        self.errors = errors or []
        self.status = status


@dataclass
class IngestResult:
    dataset_id: int
    rows_received: int
    rows_accepted: int
    errors: list[RowError] = field(default_factory=list)
    new_overlaps: int = 0


def rows_from_csv(content: bytes) -> list[dict]:
    try:
        text_ = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise IngestError("File must be UTF-8 encoded CSV") from None
    reader = csv.DictReader(io.StringIO(text_))
    if not reader.fieldnames:
        raise IngestError("CSV has no header row")
    header = {h.strip() for h in reader.fieldnames if h}
    if "project_id" not in header or "name" not in header:
        raise IngestError(f"CSV must include at least project_id and name. Template columns: {', '.join(STANDARD_COLUMNS)}")
    return [{(k or "").strip(): v for k, v in row.items()} for row in reader]


def geometry_and_center(p: ProjectIn):
    """Organizer rule: center = midpoint of A and B, or A alone. For free-form WKT: mean of its
    distinct vertices (equal to the midpoint for a two-point line)."""
    if p.geometry_wkt:
        g = shapely_wkt.loads(p.geometry_wkt)
        parts = getattr(g, "geoms", [g])
        verts = list(dict.fromkeys(c for part in parts for c in part.coords))
        center = (sum(v[0] for v in verts) / len(verts), sum(v[1] for v in verts) / len(verts))
        return g, center
    a = (p.lon_a, p.lat_a)
    if p.lat_b is not None:
        b = (p.lon_b, p.lat_b)
        return LineString([a, b]), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return Point(a), a


def ingest(conn: Connection, rows: list[dict], *, utility_id: str, utility_name: str | None,
           source_name: str, kind: str, submitted_by: str | None = None, notes: str | None = None,
           public_attestation: bool = False, compute: bool = True,
           delete_token_hash: str | None = None) -> IngestResult:
    if not public_attestation:
        raise IngestError("Confirm the data is public (no CEII) to upload it", status=400)
    if len(rows) > MAX_ROWS:
        raise IngestError(f"Too many rows ({len(rows)}); the limit is {MAX_ROWS}", status=413)

    existing = conn.execute(text("SELECT dataset_id, kind FROM datasets WHERE utility_id = :u AND source_name = :s"),
                            {"u": utility_id, "s": source_name}).mappings().first()
    if existing and existing["kind"] == "official" and kind != "official":
        raise IngestError(f"'{source_name}' is an official dataset for {utility_id}; choose a different source name",
                          status=409)

    # project ids already taken by OTHER datasets of this utility
    taken = {r["project_id"]: (r["dataset_id"], r["kind"]) for r in conn.execute(text("""
        SELECT p.project_id, p.dataset_id, d.kind FROM projects p JOIN datasets d USING (dataset_id)
        WHERE p.utility_id = :u AND d.dataset_id IS DISTINCT FROM :ds"""),
        {"u": utility_id, "ds": existing["dataset_id"] if existing else None}).mappings()}

    accepted, errors, seen = [], [], set()
    for i, raw in enumerate(rows, start=1):
        raw = {k: v for k, v in raw.items() if k in ProjectIn.model_fields}
        raw.setdefault("utility_id", utility_id)
        if not raw.get("utility_id"):
            raw["utility_id"] = utility_id
        pid = (raw.get("project_id") or "").strip() or None
        try:
            p = ProjectIn(**raw)
        except ValidationError as e:
            msg = "; ".join(f"{'.'.join(str(x) for x in err['loc']) or 'row'}: {err['msg']}" for err in e.errors())
            errors.append(RowError(row=i, project_id=pid, error=msg))
            continue
        if p.utility_id != utility_id:
            errors.append(RowError(row=i, project_id=pid, error=f"utility_id {p.utility_id} does not match this dataset ({utility_id})"))
        elif p.project_id in seen:
            errors.append(RowError(row=i, project_id=pid, error="duplicate project_id in this file"))
        elif p.project_id in taken:
            ds, k = taken[p.project_id]
            errors.append(RowError(row=i, project_id=pid, error=f"project_id already exists in {k} dataset {ds}"))
        else:
            seen.add(p.project_id)
            accepted.append(p)

    if not accepted:
        raise IngestError("No valid rows; nothing was saved", errors)

    conn.execute(text("""INSERT INTO utilities (utility_id, name) VALUES (:u, :n)
                         ON CONFLICT (utility_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, utilities.name)"""),
                 {"u": utility_id, "n": utility_name})
    if existing:  # re-upload replaces the old version; cascades to its projects and their overlaps
        conn.execute(text("DELETE FROM datasets WHERE dataset_id = :d"), {"d": existing["dataset_id"]})
    dataset_id = conn.execute(text("""
        INSERT INTO datasets (utility_id, source_name, kind, submitted_by, public_attestation, notes, delete_token_hash)
        VALUES (:u, :s, :k, :by, :att, :notes, :tok) RETURNING dataset_id"""),
        {"u": utility_id, "s": source_name, "k": kind, "by": submitted_by, "att": public_attestation,
         "notes": notes, "tok": delete_token_hash}).scalar_one()

    params = []
    for p in accepted:
        geom, center = geometry_and_center(p)
        params.append({**p.model_dump(exclude={"geometry_wkt", "lat_a", "lon_a", "lat_b", "lon_b", "source_name"}),
                       "dataset_id": dataset_id, "name_a": p.endpoint_a, "name_b": p.endpoint_b,
                       "geom": geom.wkt, "clon": center[0], "clat": center[1]})
    try:
        conn.execute(text("""
            INSERT INTO projects (utility_id, project_id, dataset_id, name, description, status, region, kv,
                                  in_service_date, in_service_date_updated, build_start, build_end,
                                  location_confidence, is_override, confidence_note, corridor_group,
                                  name_a, name_b, geom, center)
            VALUES (:utility_id, :project_id, :dataset_id, :name, :description, :status, :region, :kv,
                    :in_service_date, :in_service_date_updated, :build_start, :build_end,
                    :location_confidence, :is_override, :confidence_note, :corridor_group,
                    :name_a, :name_b, ST_GeomFromText(:geom, 4326), ST_SetSRID(ST_MakePoint(:clon, :clat), 4326))"""),
            params)
    except IntegrityError as exc:
        raise IngestError(
            f"A concurrent upload created a conflict: {exc.orig}",
            status=409,
        ) from None

    new = 0
    if compute:
        new = compute_overlaps(conn, dataset_id)
    return IngestResult(dataset_id=dataset_id, rows_received=len(rows), rows_accepted=len(accepted),
                        errors=errors, new_overlaps=new)


def compute_overlaps(conn: Connection, dataset_id: int | None = None) -> int:
    """Store overlaps for pairs touching one dataset (or all pairs when dataset_id is None)."""
    return conn.execute(text("""
        INSERT INTO overlap_pairs (utility_a, project_id_a, utility_b, project_id_b, center_distance_mi,
                                   closest_distance_km, proximity_tier, in_service_gap_days,
                                   build_windows_overlap, location_confidence, override_involved,
                                   score, shared_row_acres, connector)
        SELECT * FROM find_overlaps(:mi, :ds)
        ON CONFLICT (utility_a, project_id_a, utility_b, project_id_b) DO NOTHING"""),
        {"mi": STORED_RADIUS_MI, "ds": dataset_id}).rowcount
