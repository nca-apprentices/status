-- The newest issue of each monitor, kept after it closes, so an outage within
-- the hour reopens it instead of opening another. `opened` is when the issue
-- was opened, and `open` claims the outage, so overlapping runs act once. The
-- number is null until GitHub returns one.
CREATE TABLE issue (
  monitor TEXT PRIMARY KEY,
  number INTEGER,
  opened INTEGER NOT NULL,
  open INTEGER NOT NULL
);

INSERT INTO issue (monitor, number, opened, open)
SELECT monitor, issue, 0, 1 FROM outage;

DROP TABLE outage;
