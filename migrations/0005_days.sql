-- One bucket per UTC day instead of per 2 hours, so 90 days of bars read as
-- few rows as 7 days did. The 2-hour buckets add up into their days.
CREATE TABLE days (
  start INTEGER NOT NULL,
  monitor TEXT NOT NULL,
  up INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (start, monitor)
) WITHOUT ROWID;

INSERT INTO days (start, monitor, up, total)
SELECT start - start % 86400000, monitor, SUM(up), SUM(total)
FROM buckets
GROUP BY 1, 2;

DROP TABLE buckets;

ALTER TABLE days RENAME TO buckets;
