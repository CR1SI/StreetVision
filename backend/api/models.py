"""
Pydantic schemas: the contract between the data side and the frontend.

Three groups:
  1. ProjectRecord  - rows the PDF adapters extract (source-specific, pre-geocoding).
  2. ProjectIn      - the STANDARD project format. Official data (via the PDF adapters) and
                      user uploads both arrive in this shape and go through the same validation.
  3. *Out models    - API responses. Overlaps are generic pairs (a, b) of projects from two
                      different utilities, so any number of utilities can be compared.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator
from shapely import wkt as shapely_wkt

Confidence = Literal["high", "medium", "low", "none"]
UTILITY_ID_PATTERN = r"^[A-Z][A-Z0-9_]{1,15}$"


# ---------------------------------------------------------------- 1. adapter records

class ProjectRecord(BaseModel):
    """One row of desc_projects.csv / gpc_projects.csv, validated at extraction time."""
    utility: str
    project_id: str
    name: str
    description: str = ""
    need: str = ""
    status: str = ""
    zone: Optional[str] = None              # GPC planning zone (215 Augusta, 219 Savannah)
    sponsor: Optional[str] = None           # GPC sponsor code (GPC, SAV, GTC, MEAG, DU)
    border_zone: bool = False
    in_service_raw: str = ""
    in_service_year: Optional[int] = None
    start_date: Optional[str] = None
    build_start: Optional[int] = None
    build_end: Optional[int] = None
    window_source: Literal["spend", "start_date", "estimated", "unknown"] = "unknown"
    total_cost: Optional[float] = None
    kv: Optional[int] = None
    endpoint_a: Optional[str] = None
    endpoint_b: Optional[str] = None
    segments: str = "[]"                    # JSON list of [a, b|null] pairs
    endpoints_from: Literal["title", "description", "none"] = "none"
    edition: Optional[str] = None           # DESC PDF edition, e.g. "2024-2028"
    in_service_raw_updated: Optional[str] = None
    build_start_updated: Optional[int] = None
    build_end_updated: Optional[int] = None
    edition_updated: Optional[str] = None
    new_in_update: bool = False
    project_id_updated: Optional[str] = None  # the newer edition's ID, when it changed
    match_note: Optional[str] = None
    corridor_group: Optional[str] = None
    data_note: Optional[str] = None

    @field_validator("build_end")
    @classmethod
    def window_order(cls, v, info):
        start = info.data.get("build_start")
        if v is not None and start is not None and v < start:
            raise ValueError(f"build_end {v} before build_start {start}")
        return v


# ---------------------------------------------------------------- 2. standard project format

STANDARD_COLUMNS = [
    "utility_id", "project_id", "name", "description", "status", "kv",
    "in_service_date", "in_service_date_updated", "build_start", "build_end",
    "endpoint_a", "lat_a", "lon_a", "endpoint_b", "lat_b", "lon_b", "geometry_wkt",
    "region", "location_confidence", "confidence_note", "is_override", "corridor_group",
    "source_name",
]


class ProjectIn(BaseModel):
    """One planned project in the standard format (CSV template: GET /api/datasets/template).

    Location: give endpoint A coordinates (a point project), A and B (a straight line),
    or geometry_wkt (any LineString / MultiLineString / Point / MultiPoint in WGS84 lon/lat).
    Center point follows the organizer method: midpoint of A and B, or A alone.
    """
    utility_id: str = Field(pattern=UTILITY_ID_PATTERN, description="Short code, e.g. DESC, GPC, SANTEE")
    project_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=300)
    description: Optional[str] = Field(None, max_length=5000)
    status: Optional[str] = Field(None, max_length=100)
    kv: Optional[int] = Field(None, ge=1, le=1200)
    in_service_date: Optional[date] = None
    in_service_date_updated: Optional[date] = None
    build_start: Optional[int] = Field(None, ge=1990, le=2100)
    build_end: Optional[int] = Field(None, ge=1990, le=2100)
    endpoint_a: Optional[str] = Field(None, max_length=120)
    lat_a: Optional[float] = Field(None, ge=-90, le=90)
    lon_a: Optional[float] = Field(None, ge=-180, le=180)
    endpoint_b: Optional[str] = Field(None, max_length=120)
    lat_b: Optional[float] = Field(None, ge=-90, le=90)
    lon_b: Optional[float] = Field(None, ge=-180, le=180)
    geometry_wkt: Optional[str] = Field(None, max_length=200_000)
    region: Optional[str] = Field(None, max_length=40)
    location_confidence: Confidence = "medium"
    confidence_note: Optional[str] = Field(None, max_length=1000)
    is_override: bool = False
    corridor_group: Optional[str] = Field(None, max_length=200)
    source_name: Optional[str] = Field(None, max_length=200)   # only used by the batch loader

    @field_validator("*", mode="before")
    @classmethod
    def blank_to_none(cls, v):
        return None if isinstance(v, str) and v.strip() == "" else v

    # Fields with a default (not Optional) must fall back to it when the CSV cell is blank;
    # otherwise blank_to_none turns "" into None and validation fails (the template's own
    # example rows leave these columns empty).
    @field_validator("is_override", mode="before")
    @classmethod
    def blank_override(cls, v):
        return False if v is None or (isinstance(v, str) and v.strip() == "") else v

    @field_validator("location_confidence", mode="before")
    @classmethod
    def blank_confidence(cls, v):
        return "medium" if v is None or (isinstance(v, str) and v.strip() == "") else v

    @model_validator(mode="after")
    def check_location_and_window(self):
        if (self.lat_a is None) != (self.lon_a is None):
            raise ValueError("lat_a and lon_a must be given together")
        if (self.lat_b is None) != (self.lon_b is None):
            raise ValueError("lat_b and lon_b must be given together")
        if self.lat_b is not None and self.lat_a is None:
            raise ValueError("endpoint B has coordinates but endpoint A does not")
        if self.geometry_wkt:
            try:
                g = shapely_wkt.loads(self.geometry_wkt)
            except Exception as e:  # noqa: BLE001 - surface the parser's message
                raise ValueError(f"geometry_wkt is not valid WKT: {e}") from None
            if g.geom_type not in ("Point", "MultiPoint", "LineString", "MultiLineString") or g.is_empty:
                raise ValueError(f"geometry_wkt must be a non-empty (Multi)Point or (Multi)LineString, got {g.geom_type}")
            minx, miny, maxx, maxy = g.bounds
            if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
                raise ValueError("geometry_wkt coordinates must be lon/lat (WGS84)")
        elif self.lat_a is None:
            raise ValueError("needs coordinates: lat_a/lon_a (and lat_b/lon_b for a line) or geometry_wkt")
        if self.build_start and self.build_end and self.build_end < self.build_start:
            raise ValueError(f"build_end {self.build_end} is before build_start {self.build_start}")
        return self


# ---------------------------------------------------------------- 3. API responses

class UtilityOut(BaseModel):
    utility_id: str
    name: Optional[str] = None
    projects: int
    datasets: int
    has_official_data: bool


class DatasetOut(BaseModel):
    dataset_id: int
    utility_id: str
    source_name: str
    kind: Literal["official", "user_submitted"]
    submitted_by: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    projects: int


class RowError(BaseModel):
    row: int                                  # 1-based data row (header excluded)
    project_id: Optional[str] = None
    error: str


class UploadReport(BaseModel):
    dataset: DatasetOut
    delete_token: str                         # shown once; send as X-Delete-Token to remove the upload
    rows_received: int
    rows_accepted: int
    rows_rejected: int
    errors: list[RowError]
    new_overlaps: int


class ProjectOut(BaseModel):
    utility_id: str
    project_id: str
    name: str
    description: str | None = None
    status: str | None = None
    region: str | None = None
    kv: int | None = None
    in_service_date: date | None = None
    in_service_date_updated: date | None = None
    build_start: int | None = None
    build_end: int | None = None
    location_confidence: Confidence
    is_override: bool
    confidence_note: str | None = None
    in_service_passed: bool
    dataset_id: int
    source_kind: Literal["official", "user_submitted"]
    center: tuple[float, float]              # [lon, lat]


class ProjectRef(BaseModel):
    """One side of an overlap pair."""
    utility_id: str
    project_id: str
    name: str
    in_service_date: date | None = None
    build_window: str | None = None
    source_kind: Literal["official", "user_submitted"]


class OverlapOut(BaseModel):
    overlap_id: int                           # stable while both projects exist
    rank: int                                 # position within the current (filtered) result
    label: str                                # "OVL_<rank>", the organizers' naming
    a: ProjectRef
    b: ProjectRef
    center_distance_mi: float
    closest_distance_km: float
    proximity_tier: str
    shareable: str
    in_service_gap_days: int | None = None
    build_windows_overlap: bool
    either_already_in_service: bool
    location_confidence: Confidence
    override_involved: bool
    user_data_involved: bool
    score: float
    shared_row_acres_upper_bound: float | None = None
    shared_row_value_usd: float | None = None
    connector: list[tuple[float, float]]      # [[lon, lat], [lon, lat]] center to center


class OverlapDetail(OverlapOut):
    project_a: ProjectOut
    project_b: ProjectOut


class NearbyProject(BaseModel):
    utility_id: str
    project_id: str
    name: str
    distance_mi: float
    center: tuple[float, float]


class LiveOverlap(BaseModel):
    """Computed on request by PostGIS at any radius, not read from the stored table."""
    rank: int
    a: ProjectRef
    b: ProjectRef
    center_distance_mi: float
    closest_distance_km: float
    in_service_gap_days: int | None = None
    score: float
    connector: list[tuple[float, float]]
