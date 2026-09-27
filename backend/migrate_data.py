import json, csv

# update overlaps.geojson
with open('data/processed/overlaps.geojson') as f:
    geojson = json.load(f)

for feat in geojson['features']:
    p = feat['properties']
    if 'closest_distance_km' in p:
        p['closest_distance_mi'] = round(p.pop('closest_distance_km') / 1.609344, 2)
    if p.get('proximity_tier') == 'under 1.6 km':
        p['proximity_tier'] = 'under 1 mi'
    elif p.get('proximity_tier') == 'under 8 km':
        p['proximity_tier'] = 'under 5 mi'

with open('data/processed/overlaps.geojson', 'w') as f:
    json.dump(geojson, f)

# overlaps.csv
with open('data/processed/overlaps.csv') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

for r in rows:
    if 'closest_distance_km' in r:
        r['closest_distance_mi'] = round(float(r.pop('closest_distance_km')) / 1.609344, 2)
    if r.get('proximity_tier') == 'under 1.6 km':
        r['proximity_tier'] = 'under 1 mi'
    elif r.get('proximity_tier') == 'under 8 km':
        r['proximity_tier'] = 'under 5 mi'

with open('data/processed/overlaps.csv', 'w', newline='') as f:
    fieldnames = [f if f != 'closest_distance_km' else 'closest_distance_mi' for f in reader.fieldnames]
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

print("Data migration complete.")
