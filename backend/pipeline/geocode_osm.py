"""
Organizer guide Part 1: coordinates from OpenStreetMap (Overpass API).

1. One Overpass query for every named power=substation / power=plant covering both
   utilities' border territory (cached to data/raw/osm_substations.json).
2. Each endpoint is matched by name AND region: DESC endpoints only against the SC side,
   GPC endpoints only against their planning zone's area. That is what keeps
   "Goshen (SAV)" (Rincon, zone 219) and "Goshen" (Augusta side, zone 215) apart.
3. Writes data/substations.csv with a confidence label per match.

Part 2 (confirm via documentation) is manual: in data/substations.csv set
confirmed = yes / no, or type lat/lon yourself and set confirmed = manual.
Rows you have reviewed are kept when this script is re-run.

Usage:
  python -m pipeline.geocode_osm              # query Overpass (needs internet)
  python -m pipeline.geocode_osm --offline    # reuse the cached response
  python -m pipeline.geocode_osm --all-zones  # also geocode GPC zones away from the border
"""
import difflib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

import pandas as pd

OVERPASS = "https://overpass-api.de/api/interpreter"
CACHE = "data/raw/osm_substations.json"
OUT = "data/substations.csv"

# (south, west, north, east). Approximate and editable -- widen one if a real match falls outside.
REGION_BBOX = {
    "SC": (32.0, -82.4, 35.2, -78.5),     # DESC territory, incl. Stevens Creek on the GA bank near Augusta
    "215": (31.7, -83.3, 34.2, -81.4),    # GPC Augusta / east Georgia (Thomson, Warrenton, Vogtle, Thurmond)
    "219": (31.4, -81.9, 32.7, -80.7),    # GPC Savannah (McIntosh, Goshen (SAV), Purrysburg on the SC bank)
    "GA": (30.3, -85.7, 35.0, -80.7),     # fallback for other GPC zones with --all-zones
}
QUERY_BBOX = (31.4, -83.5, 35.3, -78.5)
QUERY = f"""
[out:json][timeout:180];
(
  nwr["power"="substation"]{QUERY_BBOX};
  nwr["power"="plant"]{QUERY_BBOX};
);
out center tags;
"""

# Review these first. Hooks has no coordinates even in the organizers' own answer key.
PRIORITY = {"okatie", "jasper", "bluffton", "riverport", "yemassee", "purrysburg", "mcintosh", "goshen",
            "urquhart", "toolebeck", "aiken psa", "fenwick street", "sand bar ferry", "thurmond",
            "thurmond dam", "hooks", "stevens creek", "evans", "kraft", "little ogeechee", "meldrim"}

STOP = r"\b(substation|sub|switching|station|switchyard|transmission|distribution|primary|electric|plant|" \
       r"power|generating|steam|tie|jct|junction|the|sav|\d+\s*kv|kv)\b"
OPERATOR_HINTS = {"DESC": r"dominion|sce&g|south carolina electric|scana",
                  "GPC": r"georgia power|southern company|southern co|savannah electric"}


def norm(name) -> str:
    name = str(name).lower().replace("&", " and ")
    name = re.sub(r"^st\.?\s", "saint ", name)
    name = re.sub(STOP, " ", name)
    name = re.sub(r"[^a-z0-9 ]", " ", name)
    return " ".join(name.split())


def fetch():
    if "--offline" in sys.argv:
        return json.load(open(CACHE))
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": "gridlock-challenge"})
    with urllib.request.urlopen(req, timeout=240) as r:
        result = json.load(r)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(result, open(CACHE, "w"))
    return result


def osm_features(result) -> pd.DataFrame:
    rows = []
    for el in result["elements"]:
        tags = el.get("tags", {})
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if not tags.get("name") or lat is None:
            continue
        rows.append({"osm_id": f"{el['type']}/{el['id']}", "osm_name": tags["name"],
                     "operator": tags.get("operator", ""), "voltage": tags.get("voltage", ""),
                     "lat": lat, "lon": lon, "key": norm(tags["name"])})
    return pd.DataFrame(rows)


def in_bbox(df, region):
    s, w, n, e = REGION_BBOX[region]
    return df[(df.lat >= s) & (df.lat <= n) & (df.lon >= w) & (df.lon <= e)]


def best_match(name, utility, region, osm):
    key = norm(name)
    cands = in_bbox(osm, region)
    if not key or cands.empty:
        return {}
    cands = cands.assign(score=cands["key"].map(lambda k: difflib.SequenceMatcher(None, key, k).ratio()))
    hint = OPERATOR_HINTS.get(utility)
    if hint:
        cands.loc[cands["operator"].str.contains(hint, case=False, regex=True), "score"] += 0.05
    top = cands.sort_values("score", ascending=False).head(2)
    best = top.iloc[0]
    runner_up = top.iloc[1]["score"] if len(top) > 1 else 0.0
    if best["score"] >= 0.95 and best["score"] - runner_up > 0.03:
        conf = "high"
    elif best["score"] >= 0.8:
        conf = "medium"
    else:
        conf = "low"
    return {**best.drop("key").to_dict(), "score": round(float(best["score"]), 3), "confidence": conf}


def endpoint_names(all_zones: bool) -> pd.DataFrame:
    """Every (utility, region, name) that needs a coordinate."""
    rows = []
    desc = pd.read_csv("data/processed/desc_projects.csv", dtype=str)
    gpc = pd.read_csv("data/processed/gpc_projects.csv", dtype=str)
    gpc = gpc[gpc["utility"] == "GPC"]
    if not all_zones:
        gpc = gpc[gpc["border_zone"].str.lower() == "true"]
    ov = pd.read_csv("data/overrides.csv", dtype=str)
    overridden = set(zip(ov.utility, ov.project_id))
    for df, util in ((desc, "DESC"), (gpc, "GPC")):
        for r in df.itertuples():
            if (util, r.project_id) in overridden:   # the override names replace the parsed ones
                continue
            region = "SC" if util == "DESC" else (r.zone if r.zone in REGION_BBOX else "GA")
            for seg in json.loads(r.segments):
                rows += [{"utility": util, "region": region, "name": n} for n in seg if n]
    zones = gpc.set_index("project_id")["zone"].to_dict()
    for r in ov.itertuples():
        region = "SC" if r.utility == "DESC" else zones.get(r.project_id, "GA")
        for n, lat in ((r.endpoint_a, r.lat_a), (r.endpoint_b, r.lat_b)):
            if isinstance(n, str) and not isinstance(lat, str):  # typed coordinates need no lookup
                rows.append({"utility": r.utility, "region": region, "name": n})
    return pd.DataFrame(rows).drop_duplicates()


if __name__ == "__main__":
    osm = osm_features(fetch())
    print(f"{len(osm)} named OSM substations/plants in the query area")

    rows = []
    for r in endpoint_names("--all-zones" in sys.argv).itertuples():
        m = best_match(r.name, r.utility, r.region, osm)
        usable = m.get("confidence") in ("high", "medium")
        rows.append({
            "utility": r.utility, "region": r.region, "name": r.name,
            "priority": "yes" if norm(r.name) in PRIORITY else "",
            # low-confidence guesses stay candidates: no coordinates until someone confirms them
            "lat": m.get("lat") if usable else None, "lon": m.get("lon") if usable else None,
            "confidence": m.get("confidence", "none"), "confirmed": "",
            "osm_name": m.get("osm_name"), "osm_id": m.get("osm_id"), "operator": m.get("operator"),
            "score": m.get("score"), "candidate_lat": m.get("lat"), "candidate_lon": m.get("lon"),
            "source": "OSM Overpass",
        })
    sheet = pd.DataFrame(rows)

    key = ["utility", "region", "name"]
    if os.path.exists(OUT):  # keep manual review from earlier runs
        old = pd.read_csv(OUT, dtype=str)
        reviewed = old[old["confirmed"].fillna("").str.lower().isin(["yes", "no", "manual"])]
        fresh = ~sheet.set_index(key).index.isin(reviewed.set_index(key).index)
        sheet = pd.concat([reviewed, sheet[fresh]], ignore_index=True)

    sheet.sort_values(["priority", "utility", "region", "confidence", "name"],
                      ascending=[False, True, True, True, True]).to_csv(OUT, index=False)
    print(sheet["confidence"].value_counts().to_string())
    print(f"-> {OUT}. Review priority rows first: confirmed=yes / no, or type lat/lon + confirmed=manual.")
