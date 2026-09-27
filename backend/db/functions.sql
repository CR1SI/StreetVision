-- ---------------------------------------------------------------------------------------
-- THE overlap engine (organizer method + extras), for any pair of different utilities.
-- Used both to store overlaps after each load/upload and by the live radius query,
-- so there is exactly one implementation.
--   center distance : spherical great-circle between centers (matches haversine)
--   overlap         : center distance < p_max_mi (25 mi for the stored table)
--   closest distance: between actual geometries, geography meters (works anywhere, no UTM zone)
--   score           : 0.7 * (1 - dist / p_max_mi) + 0.3 * (1 - min(gap_days, 1095) / 1095)
-- p_only_dataset limits the work to pairs touching one dataset (an incremental upload).
CREATE OR REPLACE FUNCTION find_overlaps(p_max_mi DOUBLE PRECISION, p_only_dataset INTEGER DEFAULT NULL)
RETURNS TABLE (
    utility_a TEXT, project_id_a TEXT, utility_b TEXT, project_id_b TEXT,
    center_distance_mi DOUBLE PRECISION, closest_distance_mi DOUBLE PRECISION, proximity_tier TEXT,
    in_service_gap_days INTEGER, build_windows_overlap BOOLEAN, location_confidence TEXT,
    override_involved BOOLEAN, score DOUBLE PRECISION, shared_row_acres DOUBLE PRECISION,
    connector GEOMETRY
)
LANGUAGE sql STABLE AS $$
    SELECT a.utility_id, a.project_id, b.utility_id, b.project_id,
           m.center_mi, m.closest_mi,
           CASE WHEN m.closest_mi <= 0.1 THEN 'touching/crossing'
                WHEN m.closest_mi <= 1.0 THEN 'under 1 mi'
                WHEN m.closest_mi <= 5.0 THEN 'under 5 mi'
                ELSE 'under 25 mi' END,
           m.gap,
           COALESCE(a.build_start <= b.build_end AND b.build_start <= a.build_end, false),
           (ARRAY['none', 'low', 'medium', 'high'])[LEAST(
                array_position(ARRAY['none', 'low', 'medium', 'high'], a.location_confidence),
                array_position(ARRAY['none', 'low', 'medium', 'high'], b.location_confidence))],
           a.is_override OR b.is_override,
           round((0.7 * (1 - m.center_mi / p_max_mi)
                + 0.3 * (1 - LEAST(COALESCE(m.gap, 1095), 1095) / 1095.0))::numeric, 4)::float,
           CASE WHEN GeometryType(a.geom) IN ('LINESTRING', 'MULTILINESTRING')
                 AND GeometryType(b.geom) IN ('LINESTRING', 'MULTILINESTRING')
                 AND m.closest_mi <= 1.0
                THEN round((LEAST(ST_Length(a.geom::geography), ST_Length(b.geom::geography))
                            * 3.28084 * 100 / 43560)::numeric, 1)::float END,   -- shorter line x 100 ft corridor
           ST_MakeLine(a.center, b.center)
    FROM projects a
    JOIN projects b
      ON a.utility_id < b.utility_id
     AND ST_DWithin(a.center::geography, b.center::geography, p_max_mi * 1609.344, false)
    CROSS JOIN LATERAL (
        SELECT ST_Distance(a.center::geography, b.center::geography, false) / 1609.344 AS center_mi,
               ST_Distance(a.geom::geography, b.geom::geography, false) / 1609.344   AS closest_mi,
               abs(a.in_service_date - b.in_service_date)                           AS gap
    ) m
    WHERE m.center_mi < p_max_mi
      AND (p_only_dataset IS NULL OR a.dataset_id = p_only_dataset OR b.dataset_id = p_only_dataset)
$$;
