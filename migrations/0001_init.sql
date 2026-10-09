-- The newest check of each monitor.
CREATE TABLE latest (
  monitor TEXT PRIMARY KEY,
  up INTEGER NOT NULL,
  detail TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Checks per monitor and UTC day. One row a day instead of one a check keeps
-- a page view to a few hundred rows read, inside the Free plan's 5 million.
CREATE TABLE daily (
  monitor TEXT NOT NULL,
  day TEXT NOT NULL,
  up INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (monitor, day)
) WITHOUT ROWID;

-- When each heartbeat last arrived.
CREATE TABLE heartbeat (
  monitor TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
