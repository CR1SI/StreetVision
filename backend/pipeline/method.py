"""
Reference implementation of the organizers' overlap method, in plain Python.

The production engine is the SQL function find_overlaps (db/functions.sql). This file exists
to check it: the answer-key test runs the organizers' worked example through this code, and
the loader confirms PostGIS agrees with it. Keep the two in step if the method changes.

  center distance = haversine between project centers
  overlap         = two DIFFERENT utilities, center distance under 25 miles
  time gap        = days between in-service dates
  score           = 0.7 * (1 - distance / 25) + 0.3 * (1 - min(gap, 1095) / 1095)
"""
import calendar
import re
from datetime import date

import numpy as np
import pandas as pd

MAX_MILES = 25.0
TIMING_CAP_DAYS = 3 * 365
EARTH_RADIUS_MI = 3958.7613   # mean Earth radius; PostGIS's sphere uses the same (6371008.8 m)


def parse_date(raw):
    """Last m/d/y in the text; impossible days are clamped (04/31 -> 04/30)."""
    found = re.findall(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", str(raw))
    if not found:
        return None
    m, d, y = (int(x) for x in found[-1])
    y = y + 2000 if y < 100 else y
    return date(y, m, min(d, calendar.monthrange(y, m)[1]))


def haversine_mi(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MI * np.arcsin(np.sqrt(a))


def compute_overlaps(projects: pd.DataFrame, max_miles: float = MAX_MILES) -> pd.DataFrame:
    """projects: columns utility_id, project_id, center_lon, center_lat, in_service_date (date or None).
    Returns one row per pair (utility_a < utility_b), best score first."""
    cols = ["utility_id", "project_id", "center_lon", "center_lat", "in_service_date"]
    p = projects[cols]
    pairs = p.add_suffix("_a").merge(p.add_suffix("_b"), how="cross")
    pairs = pairs[pairs.utility_id_a < pairs.utility_id_b]
    if pairs.empty:
        return pairs.assign(center_distance_mi=[], in_service_gap_days=[], score=[])

    pairs = pairs.assign(center_distance_mi=haversine_mi(
        pairs.center_lat_a, pairs.center_lon_a, pairs.center_lat_b, pairs.center_lon_b))
    pairs = pairs[pairs.center_distance_mi < max_miles].copy()
    pairs["in_service_gap_days"] = [abs((a - b).days) if a and b and not pd.isna(a) and not pd.isna(b) else None
                                    for a, b in zip(pairs.in_service_date_a, pairs.in_service_date_b)]
    gap = pairs.in_service_gap_days.astype("float").fillna(TIMING_CAP_DAYS).clip(upper=TIMING_CAP_DAYS)
    pairs["score"] = (0.7 * (1 - pairs.center_distance_mi / max_miles) + 0.3 * (1 - gap / TIMING_CAP_DAYS)).round(4)
    return (pairs.rename(columns={"utility_id_a": "utility_a", "utility_id_b": "utility_b"})
                 .sort_values(["score", "center_distance_mi"], ascending=[False, True])
                 .reset_index(drop=True))
