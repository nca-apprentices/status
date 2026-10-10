-- The open issue of each monitor that is down.
CREATE TABLE outage (
  monitor TEXT PRIMARY KEY,
  issue INTEGER NOT NULL
);
