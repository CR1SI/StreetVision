"""
Parse Georgia Power's 2025 IRP Volume 3 (public disclosure) -> 10 Year Expansion Plan projects.

Two passes, joined on the TEAMS project number:
  1. Table 2 "Georgia ITS 10 Year Plan Project List": zone, year, name, need date, sponsor.
  2. Per-project detail pages: start date + description.
Tables 3/4 (cancelled / completed) are not read: they are not planned work.

Build window = detail-page Start Date -> Need Date. Costs are redacted in the public
filing and are never estimated or reconstructed.

Usage: python -m pipeline.extract_gpc_irp data/raw/2025_IRP_Volume_3_PUBLIC_DISCLOSURE.pdf data/processed/gpc_projects.csv
"""
import re
import sys

import pandas as pd
import pdfplumber

from api.models import ProjectRecord
from pipeline.common import split_endpoints
from pipeline.extract_desc import corridor_groups

ROW = re.compile(r"^\s*(\d{3})\s+(\d{4})\s+(\d{4,6})\s+(.+?)\s+(\d{1,2}/\d{1,2}/\d{4})\s+([A-Z]+)\b")
SKIP = re.compile(r"PUBLIC DISCLOSURE|CRITICAL ENERGY|contents shall|policy, should|notification|employees|"
                  r"TEAMS|Zone|Number|Table 2|Ten-Year Plan|Georgia ITS|briefly lists|REDACTED")
DETAIL = re.compile(r"Teams\s*#\s*(\d+)\s+Need Date\s+(\S+)\s+Start Date\s+(\S+)\s+Description\s+(.*?)"
                    r"\s+Supporting Statement", re.S)
# If a different extractor ever emits labels before values, descriptions would contain these.
LEAKED_LABEL = re.compile(r"Supporting Statement|Change From|Estimated Cost|ITS Assigned|Need Date|Start Date")
BORDER_ZONES = {"215", "219"}                 # 215 = Augusta / east Georgia, 219 = Savannah
GEORGIA_POWER_SPONSORS = {"GPC", "SAV"}       # SAV = former Savannah Electric territory, now Georgia Power
EXPECTED_ROWS = 208                           # Table 2 row count, checked by hand against the PDF


def parse_table(pdf) -> pd.DataFrame:
    rows, in_table = [], False
    for page in pdf.pages:
        text = page.extract_text(layout=True) or ""
        if "Table 2 Georgia ITS 10 Year Plan Project List" in text or (in_table and "Need Date" in text and "TEAMS" in text):
            in_table = True
        elif in_table:
            break
        if not in_table:
            continue
        for line in text.splitlines():
            if "B. Cancelled Projects" in line:
                return pd.DataFrame(rows)
            m = ROW.match(line)
            if m:
                zone, year, teams, name, need, sponsor = m.groups()
                rows.append({"zone": zone, "plan_year": int(year), "teams_id": teams,
                             "name": name.strip(), "need_date": need, "sponsor": sponsor})
            elif rows and line.strip() and not SKIP.search(line):
                rows[-1]["name"] += " " + line.strip()  # wrapped project name
    return pd.DataFrame(rows)


def parse_details(pdf) -> pd.DataFrame:
    out = []
    for page in pdf.pages:
        text = page.extract_text() or ""
        if "Teams #" not in text:
            continue
        for teams, need, start, desc in DETAIL.findall(text):
            desc = " ".join(desc.split())
            if LEAKED_LABEL.search(desc):
                raise ValueError(f"TEAMS {teams}: detail-page labels leaked into the description; "
                                 f"the page layout changed -- parse by position instead")
            out.append({"teams_id": teams, "start_date": start, "description": desc})
    return pd.DataFrame(out).drop_duplicates("teams_id")


def year_of(date_str):
    m = re.search(r"(\d{4})$", str(date_str))
    return int(m.group(1)) if m else None


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with pdfplumber.open(src) as pdf:
        table = parse_table(pdf)
        details = parse_details(pdf)
    if len(table) != EXPECTED_ROWS:
        print(f"WARNING: Table 2 parsed {len(table)} rows, expected {EXPECTED_ROWS}. Check the PDF edition.")
    df = table.merge(details, on="teams_id", how="left")

    records = []
    for r in df.itertuples():
        desc = r.description if isinstance(r.description, str) else ""
        ep = split_endpoints(r.name, desc)
        start_y, end_y = year_of(r.start_date), year_of(r.need_date)
        note = None
        if start_y and end_y and start_y > end_y:   # e.g. Bay Creek - Conyers: start 2031, need 2029
            note = f"PDF start date {r.start_date} is after need date {r.need_date}; window estimated"
            start_y = None
        rec = ProjectRecord(
            utility="GPC" if r.sponsor in GEORGIA_POWER_SPONSORS else r.sponsor,
            sponsor=r.sponsor, zone=r.zone, border_zone=r.zone in BORDER_ZONES,
            project_id=r.teams_id, name=r.name, description=desc, status="Planned",
            in_service_raw=r.need_date, in_service_year=end_y,
            start_date=r.start_date if isinstance(r.start_date, str) else None,
            build_start=start_y or (end_y - 1 if end_y else None), build_end=end_y,
            window_source="start_date" if start_y else "estimated",
            kv=ep["kv"], endpoint_a=ep["a"], endpoint_b=ep["b"],
            segments=ep["segments"], endpoints_from=ep["source"], data_note=note,
        )
        records.append(rec.model_dump())
    out = pd.DataFrame(records)
    out["corridor_group"] = corridor_groups(out)   # e.g. Evans Primary - Thurmond Dam #5 and #6
    out.to_csv(dst, index=False)

    gpc = out[out.utility == "GPC"]
    print(f"{len(out)} Table 2 projects -> {dst}")
    print(f"  Georgia Power (GPC + SAV): {len(gpc)}, in border zones 215/219: {int(gpc.border_zone.sum())}")
    print(f"  other sponsors kept but excluded downstream: {out[out.utility != 'GPC'].sponsor.value_counts().to_dict()}")
