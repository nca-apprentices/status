-- The days whose failed checks were stalls between Cloudflare and the node,
-- counted as up as 0008 counts them from now on. Each day holds at most two
-- failed checks, or Workers Logs show no three failed checks in a row.
-- jjforge on 2026-10-19 and ncaleague on 2026-10-24 stay, since no log
-- shows their order.
UPDATE buckets SET up = total
WHERE (monitor, start) IN (
  VALUES
    ('ncaleague', 1792281600000), -- 2026-10-18
    ('ncaleague', 1792454400000), -- 2026-10-20
    ('ncaleague', 1792540800000), -- 2026-10-21
    ('ncaleague', 1792627200000), -- 2026-10-22
    ('jjforge', 1792454400000), -- 2026-10-20
    ('jjforge', 1792540800000), -- 2026-10-21
    ('jjforge', 1792627200000), -- 2026-10-22
    ('jjforge', 1792713600000), -- 2026-10-23
    ('jjforge', 1792800000000) -- 2026-10-24
);
