"""Pipeline tests that need no database: python -m pytest tests/test_pipeline.py"""
import json
from pathlib import Path

import pytest

from pipeline.common import split_endpoints
from pipeline.extract_desc import merge_editions, parse_text
from tests.check_answer_key import main as check_key
from tests.make_synthetic_key import build

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize("title, description, expected", [
    ("Urquhart – Toolebeck 115kV line: Rebuild", "", [["Urquhart", "Toolebeck"]]),
    # voltage ratio stripped before splitting on dashes
    ("Okatie 230-115kV Substation, Jasper – Yemassee 230kV #1 Fold-in", "", [["Okatie", None]]),
    # several line items in one title
    ("VCS1-Denny Terrace 230kV & VCS1-Pineland 230kV: Rebuild", "", [["Vcs1", "Denny Terrace"], ["Vcs1", "Pineland"]]),
    ("Church Creek – Faber Place – Charleston Transmission: Add 230kV Line", "",
     [["Church Creek", "Faber Place"], ["Faber Place", "Charleston"]]),
    # tap projects name their endpoints only in the description
    ("Cainhoy 115 kV Tap: Construct", "Construct a 115 kV tap from Cainhoy to Clements Ferry. Approximately 2.8 miles.",
     [["Cainhoy", "Clements Ferry"]]),
    ("Riverport Tap: Construct Tap", "Construct Okatie – Riverport 230 kV to feed new Distribution substation.",
     [["Okatie", "Riverport"]]),
    # a tapped host line is NOT the project's endpoints
    ("Wagener 115kV Tap: Construct Tap",
     "Constructing a 115 kV Tap off the Edmund Switching Station- Owens Corning 115 kV Line to feed new Wagener Distribution substation.",
     [["Wagener", None]]),
    # (SAV) keeps the Savannah-side Goshen distinct from the Augusta-side one
    ("SAV: GOSHEN (SAV) - MCINTOSH 115KV LINE REBUILD", "", [["Goshen (SAV)", "Mcintosh"]]),
    ("EVANS PRIMARY - THURMOND DAM (USA) #5 115KV REBUILD", "", [["Evans Primary", "Thurmond Dam"]]),
])
def test_split_endpoints(title, description, expected):
    assert json.loads(split_endpoints(title, description)["segments"]) == expected


BASELINE_PDF = Path(__file__).parent.parent / "data" / "raw" / "2024-2028-2million-and-above-project-descriptions.pdf"


def merged():
    from pipeline.common import pdf_text
    if not BASELINE_PDF.exists():
        pytest.skip("put the 2024-2028 DESC PDF in data/raw/ to run the edition-merge tests")
    base = parse_text(pdf_text(str(BASELINE_PDF)))
    return merge_editions(base, [parse_text((FIXTURES / "desc_2026_2030_excerpt.txt").read_text(encoding="utf-8"))])


def test_updated_dates_are_added_not_overwritten():
    m, _ = merged()
    jasper = m[m.project_id == "06367 D - G"].iloc[0]
    assert jasper.in_service_raw == "12/31/25" and jasper.in_service_raw_updated == "12/01/2026"
    new = m[m.project_id == "6888"].iloc[0]           # Okatie - McIntosh, only in the newer edition
    assert bool(new.new_in_update) and new.in_service_raw_updated == "12/31/2028"


def test_reused_ids_do_not_overwrite_other_projects():
    m, report = merged()
    hooks = m[m.project_id == "6809 G"].iloc[0]       # Stevens Creek - Hooks in 2024-2028
    assert "Stevens Creek" in hooks["name"] and hooks.in_service_raw_updated is None
    assert (m.name.str.startswith("Hooks - Modoc")).sum() == 1        # added as its own project
    assert (m.name.str.startswith("Modoc – McCormick")).sum() == 1
    assert m.project_id.is_unique


def test_changed_ids_match_by_name():
    m, report = merged()
    riverport = m[m.name.str.startswith("Riverport")]
    assert len(riverport) == 1 and riverport.iloc[0].project_id_updated == "6367 D"


def test_answer_key_checker_passes_correct_key(tmp_path):
    path = tmp_path / "key.xlsx"
    build(path)
    assert check_key(path)


def test_answer_key_checker_catches_a_missing_overlap(tmp_path):
    path = tmp_path / "tampered.xlsx"
    build(path, drop_one=True)
    assert not check_key(path)


# ---------------------------------------------------------------- project types

def test_project_types():
    from api.project_types import classify
    assert classify("SAV: GOSHEN (SAV) - MCINTOSH 115KV LINE REBUILD") == "line_rebuild"
    assert classify("Okatie – McIntosh 115kV Tie: Add Series Reactor") == "substation"          # reactor beats line
    assert classify("Jasper – Okatie 230 kV #2: Construct") == "new_line"
    assert classify("Riverport Tap: Construct Tap") == "new_line"
    assert classify("GOSHEN AREA STRATEGIC SOLUTION") == "area_package"
    assert classify("St George - Sumter 230kV Tie: Rebuild Line from Santee Substation") == "line_rebuild"
    assert classify("Queensboro - Ft Johnson 115 kV", "Replace the line and structures") == "line_rebuild"  # description fallback
    assert classify("Mystery project") == "other"
