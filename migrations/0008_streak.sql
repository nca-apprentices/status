-- The failed checks in a row that end each monitor's newest run, so the next
-- run tells a stall from an outage.
ALTER TABLE latest ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
