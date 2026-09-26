"""Build tests/fixtures/answer_key_synthetic.xlsx: a SYNTHETIC stand-in for the organizers'
workbook (same column layout). Expected overlaps are computed with an independent haversine,
not our pipeline, so the checker is tested against a separate implementation."""
import math
from itertools import product

import pandas as pd

ROWS = [  # id, name_a, lat_a, lon_a, name_b, lat_b, lon_b, in_service  (approximate, not verified)
    ("DESC_1", "Jasper", 32.290, -81.030, "Okatie", 32.300, -80.930, "2026-12-01"),
    ("DESC_2", "Okatie", 32.300, -80.930, "Bluffton", 32.237, -80.860, "2025-12-31"),
    ("DESC_3", "Urquhart", 33.435, -81.910, "Toolebeck", 33.550, -81.760, "2026-08-12"),
    ("DESC_4", "Stevens Creek", 33.630, -82.050, "Hooks", None, None, "2025-12-31"),
    ("DESC_5", "Union Pier", 32.790, -79.930, None, None, None, "2027-12-31"),
    ("GPC_1", "McIntosh", 32.357, -81.168, "Purrysburg", None, None, "2026-06-01"),
    ("GPC_2", "Goshen", 32.250, -81.200, "McIntosh", 32.357, -81.169, "2027-06-01"),
    ("GPC_3", "Fenwick Street", 33.470, -81.970, "Sand Bar Ferry", 33.440, -81.950, "2026-06-01"),
    ("GPC_4", "Evans Primary", 33.530, -82.130, "Thurmond Dam", 33.662, -82.199, "2033-06-01"),
    ("GPC_5", "Hatch", 31.934, -82.344, "Wadley", 32.867, -82.404, "2031-06-01"),
]


def hav(lat1, lon1, lat2, lon2, r=3958.8):
    f1, f2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((f2 - f1) / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def center(r):
    pts = [(r[2], r[3])] + ([(r[5], r[6])] if r[5] is not None else [])
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def build(path, drop_one=False):
    desc = [r for r in ROWS if r[0].startswith("DESC")]
    gpc = [r for r in ROWS if r[0].startswith("GPC")]
    ovls, n = [], 0
    for d, g in product(desc, gpc):
        mi = hav(*center(d), *center(g))
        if mi < 25:
            n += 1
            ovls.append((f"OVL_{n}", d[0], g[0], round(mi, 2)))
    if drop_one:
        ovls = ovls[:-1]
    member = {}
    for oid, d, g, _ in ovls:
        member.setdefault(d, []).append(oid)
        member.setdefault(g, []).append(oid)
    width = max(len(v) for v in member.values())
    projects = []
    for r in ROWS:
        ids = member.get(r[0], [])
        c = center(r)
        rec = {"project_id": r[0], "name_a": r[1], "lat_a": r[2], "lon_a": r[3], "name_b": r[4],
               "lat_b": r[5], "lon_b": r[6], "lat_center": c[0], "lon_center": c[1],
               "in_service_date": pd.Timestamp(r[7]), "overlap_count": len(ids)}
        rec.update({f"overlap_{i + 1}": (ids[i] if i < len(ids) else None) for i in range(width)})
        projects.append(rec)
    with pd.ExcelWriter(path) as xl:
        pd.DataFrame(projects).to_excel(xl, sheet_name="projects", index=False)
        pd.DataFrame(ovls, columns=["overlap_id", "project_a", "project_b", "distance_mi"]) \
            .to_excel(xl, sheet_name="overlaps", index=False)
    return len(ovls)


if __name__ == "__main__":
    print(build("tests/fixtures/answer_key_synthetic.xlsx"), "overlaps written")
