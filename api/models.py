"""
Pydantic schemas shared by the pipeline (record validation) and the API (responses).

This file is the contract between the data half and the frontend half of the team:
property names here are what the map and panels read.
"""
from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Utility = Literal["DESC", "GPC"]
Confidence = Literal["high", "medium", "low", "none"]


# ---------------------------------------------------------------- pipeline records

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
    # "updated dates" pass from a newer DESC edition -- shown next to the baseline, never overwriting it
    in_service_raw_updated: Optional[str] = None
    build_start_updated: Optional[int] = None
    build_end_updated: Optional[int] = None
    edition_updated: Optional[str] = None
    new_in_update: bool = False
    corridor_group: Optional[str] = None     # same endpoints as another budget item (kept separate)
    data_note: Optional[str] = None          # source-data inconsistencies, stated rather than silently fixed

    @field_validator("build_end")
    @classmethod
    def window_order(cls, v, info):
        start = info.data.get("build_start")
        if v is not None and start is not None and v < start:
            raise ValueError(f"build_end {v} before build_start {start}")
        return v


class OverlapRecord(BaseModel):
    """One row of overlaps.csv, validated before it is written or loaded."""
    overlap_id: str
    rank: int
    desc_id: str
    desc_name: str
    gpc_id: str
    gpc_name: str
    desc_in_service: Optional[date] = None
    gpc_in_service: Optional[date] = None
    center_distance_mi: float = Field(ge=0, lt=25)
    closest_distance_km: float = Field(ge=0)
    proximity_tier: str
    shareable: str
    in_service_gap_days: Optional[int] = None
    build_windows_overlap: bool
    desc_window: str
    gpc_window: str
    either_already_in_service: bool
    location_confidence: Confidence
    override_involved: bool
    score: float
    shared_row_acres_upper_bound: Optional[float] = None
    shared_row_value_usd: Optional[float] = None


# ---------------------------------------------------------------- API responses

class ProjectOut(BaseModel):
    utility: Utility
    project_id: str
    name: str
    description: str | None = None
    status: str | None = None
    zone: str | None = None
    kv: int | None = None
    in_service_date: date | None = None
    in_service_date_updated: date | None = None
    build_start: int | None = None
    build_end: int | None = None
    window_source: str | None = None
    location_confidence: Confidence
    is_override: bool
    confidence_note: str | None = None
    in_service_passed: bool
    center: tuple[float, float]              # [lon, lat]


class OverlapOut(BaseModel):
    overlap_id: str
    rank: int
    desc_id: str
    desc_name: str
    gpc_id: str
    gpc_name: str
    desc_in_service: date | None = None
    gpc_in_service: date | None = None
    center_distance_mi: float
    closest_distance_km: float | None = None
    proximity_tier: str
    shareable: str | None = None
    in_service_gap_days: int | None = None
    build_windows_overlap: bool | None = None
    desc_window: str | None = None
    gpc_window: str | None = None
    either_already_in_service: bool | None = None
    location_confidence: Confidence
    override_involved: bool
    score: float
    shared_row_acres_upper_bound: float | None = None
    shared_row_value_usd: float | None = None
    connector: list[tuple[float, float]]     # [[lon, lat], [lon, lat]] center to center


class OverlapDetail(OverlapOut):
    desc_project: ProjectOut
    gpc_project: ProjectOut


class NearbyProject(BaseModel):
    utility: Utility
    project_id: str
    name: str
    distance_mi: float
    center: tuple[float, float]


class LiveOverlap(BaseModel):
    """An overlap computed on request by PostGIS (ST_DWithin), not read from the stored table."""
    rank: int
    desc_id: str
    desc_name: str
    gpc_id: str
    gpc_name: str
    center_distance_mi: float
    closest_distance_km: float
    in_service_gap_days: int | None = None
    score: float
    connector: list[tuple[float, float]]
