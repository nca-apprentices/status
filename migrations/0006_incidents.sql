-- Each outage's start and end, null while it lasts. The partial index allows
-- one open incident per monitor, so overlapping runs open it once.
CREATE TABLE incidents (
  monitor TEXT NOT NULL,
  started INTEGER NOT NULL,
  ended INTEGER,
  PRIMARY KEY (monitor, started)
) WITHOUT ROWID;

CREATE UNIQUE INDEX incidents_open ON incidents (monitor) WHERE ended IS NULL;
