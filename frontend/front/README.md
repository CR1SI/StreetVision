# StreetVision frontend

React 18 + Vite + Tailwind + MapLibre GL, built on the `grid-model` branch's map setup (dark CARTO
basemap, fly-to and orbit camera). Every number on screen comes from the FastAPI backend in `api/`.

## Run it

**Demo / judges (one server):** build once, then FastAPI serves the site and the API together.

    cd front && npm install && npm run build      # writes ../web
    cd .. && uvicorn api.main:app                 # http://localhost:8000

`web/` is committed, so the backend alone serves the current build; rebuild after frontend changes.
FastAPI only mounts `web/` if it exists at startup, so restart uvicorn after the first build.

**Frontend development (hot reload):** run the backend on :8000, then

    cd front && npm run dev                       # http://localhost:5173, /api proxied to :8000

Optional env: `VITE_API_BASE` (API on another host), `VITE_BASEMAP_STYLE` (another MapLibre style URL).

## Pages (real URLs, one folder per page)

| URL | Page | Endpoints |
|---|---|---|
| `/` | Map workspace + ranked list (the required deliverables) | `utilities`, `projects`, `overlaps`, `overlaps/live` (radius > 25 mi), `projects/near` (click empty map) |
| `/overlap/?id=` | One coordination opportunity: both projects, timeline, right-of-way estimate, inset map | `overlaps/{id}?land_cost_per_acre=`, `projects` |
| `/data/` | Data catalog: every dataset, official and community, with GeoJSON/CSV download | `datasets`, `health`, `projects` |
| `/dataset/?id=` | One dataset: metadata, map, sortable table | `datasets`, `projects`, `overlaps` |
| `/contribute/` | CSV upload (template, attestation, per-row errors, delete token) and token-based delete | `datasets/template`, `POST datasets`, `DELETE datasets/{id}` |
| `/check/` | Address / ZIP coordination check with a reasoned verdict | `projects/near`, `overlaps`, OSM Nominatim for geocoding |
| `/about/` | Method, tiers, assumptions, live counts | `health` |

The home page URL keeps its state (`?utilities=DESC&tier=under 8 km&overlap=22`), so a filtered
view or a selected overlap can be shared as a link.

## Layout

    front/
      index.html, <page>/index.html   one HTML entry per page (Vite multi-page build)
      src/entries/                    mounts each page
      src/pages/                      Home, Overlap, DataCatalog, Dataset, Contribute, Check, About
      src/components/                 Layout (nav), MapView, OverlapCard, Timeline, ui primitives
      src/hooks/useMapLibre.js        map lifecycle, fly-to, orbit (from grid-model), offline fallback
      src/lib/api.js                  every backend call goes through here
      src/lib/mapLayers.js            every map layer (projects, 3D kV columns, connectors)
      src/lib/colors.js               one palette for map + UI (utilities, tiers, confidence)

## Design notes

- **Colors:** navy UI with the Sperry Tech purple/teal/pink accents; the map land is `#171717`.
  Utilities are cool colors (DESC purple, GPC teal, uploads get the next free color); overlap tiers
  are warm, hotter = closer. Nothing hardcodes DESC/GPC except their two fixed colors.
- **Offline-safe:** if the street basemap can't load (venue Wi-Fi), the map falls back to a plain
  `#171717` canvas and says so; all data still works. Fonts are bundled, not loaded from Google.
- **No accounts:** uploads are gated by the public-data / no-CEII attestation, and deletes by the
  one-time token, both as the backend defines.
- **3D:** the cube button extrudes a column per project, height by voltage (kV).
