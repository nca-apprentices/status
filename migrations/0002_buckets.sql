-- Checks per monitor and bucket of time, which replace the days. The start
-- comes first in the key, so a page view reads only the buckets it shows.
CREATE TABLE buckets (
  start INTEGER NOT NULL,
  monitor TEXT NOT NULL,
  up INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (start, monitor)
) WITHOUT ROWID;

DROP TABLE daily;

-- A clean start: the next run fills it again, and a heartbeat that never
-- arrived no longer shows as down.
DELETE FROM latest;
