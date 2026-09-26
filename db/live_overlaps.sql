-- The overlap method as one spatial join, run live by GET /api/overlaps/live.
-- ST_DWithin on the geography index finds DESC x GPC center pairs within :max_m meters,
-- without comparing every pair. use_spheroid=false = spherical distance, matching the
-- pipeline's haversine (the official method), so the two agree to a few feet.
-- The same query works unchanged if the projects table grows to every utility in SERTP.

SELECT
    d.project_id                                                       AS desc_id,
    d.name                                                             AS desc_name,
    g.project_id                                                       AS gpc_id,
    g.name                                                             AS gpc_name,
    ST_Distance(d.center::geography, g.center::geography, false) / 1609.344          AS center_distance_mi,
    ST_Distance(ST_Transform(d.geom, 32617), ST_Transform(g.geom, 32617)) / 1000.0     AS closest_distance_km,
    abs(d.in_service_effective - g.in_service_effective)               AS in_service_gap_days,
    ST_X(d.center) AS d_lon, ST_Y(d.center) AS d_lat,
    ST_X(g.center) AS g_lon, ST_Y(g.center) AS g_lat,
    round((
        0.7 * (1 - (ST_Distance(d.center::geography, g.center::geography, false) / 1609.344) / :max_mi)
      + 0.3 * (1 - LEAST(COALESCE(abs(d.in_service_effective - g.in_service_effective), 1095), 1095) / 1095.0)
    )::numeric, 4)::float                                              AS score
FROM projects d
JOIN projects g
  ON  d.utility = 'DESC'
  AND g.utility = 'GPC'
  AND ST_DWithin(d.center::geography, g.center::geography, :max_m, false)
WHERE (NOT :hide_in_service OR NOT (d.in_service_passed OR g.in_service_passed))
ORDER BY score DESC, center_distance_mi
