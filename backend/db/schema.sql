-- PostGIS schema: any number of utilities, official and user-submitted datasets.
-- Created on the first load, or recreated with `python -m db.load_to_postgis --reset`
-- (which deletes user uploads too). The overlap engine lives in functions.sql.

CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS overlap_pairs;   -- note: "overlaps" is a reserved word in PostgreSQL
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS datasets;
DROP TABLE IF EXISTS utilities;

CREATE TABLE utilities (
    utility_id  TEXT PRIMARY KEY CHECK (utility_id ~ '^[A-Z][A-Z0-9_]{1,15}$'),
    name        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One upload or one official source document. Deleting a dataset removes its projects
-- and every overlap they were part of.
CREATE TABLE datasets (
    dataset_id          SERIAL PRIMARY KEY,
    utility_id          TEXT NOT NULL REFERENCES utilities ON DELETE CASCADE,
    source_name         TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('official', 'user_submitted')),
    submitted_by        TEXT,
    public_attestation  BOOLEAN NOT NULL,      -- uploader confirmed: public data, no CEII
    notes               TEXT,
    delete_token_hash   TEXT,                  -- sha256 of the token returned once at upload
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (utility_id, source_name),
    CHECK (public_attestation)
);

CREATE TABLE projects (
    utility_id              TEXT NOT NULL REFERENCES utilities ON DELETE CASCADE,
    project_id              TEXT NOT NULL,
    dataset_id              INTEGER NOT NULL REFERENCES datasets ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    description             TEXT,
    status                  TEXT,
    region                  TEXT,
    kv                      INTEGER,
    in_service_date         DATE,              -- the date the overlap math uses
    in_service_date_updated DATE,              -- a newer published date, shown alongside
    build_start             INTEGER,
    build_end               INTEGER,
    location_confidence     TEXT NOT NULL CHECK (location_confidence IN ('high', 'medium', 'low', 'none')),
    is_override             BOOLEAN NOT NULL DEFAULT false,
    confidence_note         TEXT,
    corridor_group          TEXT,
    name_a                  TEXT,
    name_b                  TEXT,
    geom                    GEOMETRY(Geometry, 4326) NOT NULL
                            CHECK (GeometryType(geom) IN ('POINT', 'MULTIPOINT', 'LINESTRING', 'MULTILINESTRING')),
    center                  GEOMETRY(Point, 4326) NOT NULL,
    PRIMARY KEY (utility_id, project_id)
);

-- A pair of projects from two different utilities, stored once (utility_a < utility_b).
-- Display fields (names, dates) are joined from projects at query time; rank is computed per query.
CREATE TABLE overlap_pairs (
    overlap_id              BIGSERIAL PRIMARY KEY,
    utility_a               TEXT NOT NULL,
    project_id_a            TEXT NOT NULL,
    utility_b               TEXT NOT NULL,
    project_id_b            TEXT NOT NULL,
    center_distance_mi      DOUBLE PRECISION NOT NULL,
    closest_distance_mi     DOUBLE PRECISION NOT NULL,
    proximity_tier          TEXT NOT NULL,
    in_service_gap_days     INTEGER,
    build_windows_overlap   BOOLEAN NOT NULL,
    location_confidence     TEXT NOT NULL,
    override_involved       BOOLEAN NOT NULL,
    score                   DOUBLE PRECISION NOT NULL,
    shared_row_acres        DOUBLE PRECISION,
    connector               GEOMETRY(LineString, 4326) NOT NULL,
    CHECK (utility_a < utility_b),
    UNIQUE (utility_a, project_id_a, utility_b, project_id_b),
    FOREIGN KEY (utility_a, project_id_a) REFERENCES projects (utility_id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (utility_b, project_id_b) REFERENCES projects (utility_id, project_id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_geom        ON projects USING GIST (geom);
CREATE INDEX idx_projects_center      ON projects USING GIST (center);
CREATE INDEX idx_projects_center_geo  ON projects USING GIST ((center::geography));  -- used by ST_DWithin
CREATE INDEX idx_projects_dataset     ON projects (dataset_id);
CREATE INDEX idx_overlaps_score       ON overlap_pairs (score DESC);
CREATE INDEX idx_overlaps_b           ON overlap_pairs (utility_b, project_id_b);
