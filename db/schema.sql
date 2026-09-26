-- PostGIS schema for the Gridlock overlap tool.
-- load_to_postgis.py runs this file first on every load, so indexes and keys always exist
-- (loading with GeoPandas if_exists="replace" would silently drop them).

CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS overlap_pairs;   -- "overlaps" is a reserved word in PostgreSQL
DROP TABLE IF EXISTS projects;

CREATE TABLE projects (
    utility                 TEXT    NOT NULL CHECK (utility IN ('DESC', 'GPC')),
    project_id              TEXT    NOT NULL,           -- DESC ID or GPC TEAMS number: separate numbering systems
    name                    TEXT    NOT NULL,
    description             TEXT,
    status                  TEXT,
    zone                    TEXT,                       -- GPC planning zone (215 Augusta, 219 Savannah)
    kv                      INTEGER,
    in_service_date         DATE,                       -- baseline edition
    in_service_date_updated DATE,                       -- newer DESC edition, shown alongside, never overwriting
    in_service_effective    DATE,                       -- the date the overlap math used
    build_start             INTEGER,
    build_end               INTEGER,
    window_source           TEXT,
    location_confidence     TEXT    NOT NULL CHECK (location_confidence IN ('high', 'medium', 'low', 'none')),
    is_override             BOOLEAN NOT NULL DEFAULT false,
    confidence_note         TEXT,
    corridor_group          TEXT,
    in_service_passed       BOOLEAN NOT NULL DEFAULT false,
    name_a                  TEXT,
    name_b                  TEXT,
    geom                    GEOMETRY(Geometry, 4326) NOT NULL,   -- Point, LineString, or multi-part
    center                  GEOMETRY(Point, 4326)    NOT NULL,
    PRIMARY KEY (utility, project_id)
);

CREATE TABLE overlap_pairs (
    overlap_id                    TEXT PRIMARY KEY,           -- OVL_1, OVL_2, ... in rank order
    rank                          INTEGER NOT NULL UNIQUE,
    desc_utility                  TEXT NOT NULL DEFAULT 'DESC' CHECK (desc_utility = 'DESC'),
    desc_id                       TEXT NOT NULL,
    gpc_utility                   TEXT NOT NULL DEFAULT 'GPC'  CHECK (gpc_utility = 'GPC'),
    gpc_id                        TEXT NOT NULL,
    desc_name                     TEXT NOT NULL,
    gpc_name                      TEXT NOT NULL,
    desc_in_service               DATE,
    gpc_in_service                DATE,
    center_distance_mi            DOUBLE PRECISION NOT NULL,
    closest_distance_km           DOUBLE PRECISION,
    proximity_tier                TEXT NOT NULL,
    shareable                     TEXT,
    in_service_gap_days           INTEGER,
    build_windows_overlap         BOOLEAN,
    desc_window                   TEXT,
    gpc_window                    TEXT,
    either_already_in_service     BOOLEAN,
    location_confidence           TEXT NOT NULL,
    override_involved             BOOLEAN NOT NULL DEFAULT false,
    score                         DOUBLE PRECISION NOT NULL,
    shared_row_acres_upper_bound  DOUBLE PRECISION,
    shared_row_value_usd          DOUBLE PRECISION,
    connector                     GEOMETRY(LineString, 4326) NOT NULL,
    FOREIGN KEY (desc_utility, desc_id) REFERENCES projects (utility, project_id) ON DELETE CASCADE,
    FOREIGN KEY (gpc_utility, gpc_id)   REFERENCES projects (utility, project_id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_geom       ON projects USING GIST (geom);
CREATE INDEX idx_projects_center     ON projects USING GIST (center);
-- ST_DWithin on geography (meters) needs a geography index to use it
CREATE INDEX idx_projects_center_geo ON projects USING GIST ((center::geography));
CREATE INDEX idx_projects_utility    ON projects (utility);
CREATE INDEX idx_overlaps_score      ON overlap_pairs (score DESC);
CREATE INDEX idx_overlaps_distance   ON overlap_pairs (center_distance_mi);
