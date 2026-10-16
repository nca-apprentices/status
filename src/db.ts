// Every D1 query, so the rest of the Worker deals in tallies, heartbeats, and
// issues instead of SQL.

import { MINUTE_MS, type Tally } from "./monitors";

// The page shows the last 90 days in bars of one UTC day, which reads as few
// rows as 7 days of 2-hour bars did.
export const BUCKET_MS = 24 * 60 * MINUTE_MS;
export const HISTORY_BUCKETS = 90;

export type Beat = { monitor: string; at: number };
export type Latest = {
  monitor: string;
  up: number;
  detail: string;
  at: number;
};
export type Bucket = {
  start: number;
  monitor: string;
  up: number;
  total: number;
};
export type Incident = {
  monitor: string;
  started: number;
  ended: number | null;
};
export type Issue = {
  monitor: string;
  number: number | null;
  opened: number;
  open: number;
};

export function bucketStart(at: number): number {
  return Math.floor(at / BUCKET_MS) * BUCKET_MS;
}

export async function readBeats(db: D1Database): Promise<Beat[]> {
  const { results } = await db
    .prepare("SELECT monitor, at FROM heartbeat")
    .all<Beat>();

  return results;
}

export async function writeBeat(db: D1Database, monitor: string, at: number) {
  await db
    .prepare(
      `INSERT INTO heartbeat (monitor, at) VALUES (?1, ?2)
       ON CONFLICT (monitor) DO UPDATE SET at = excluded.at`,
    )
    .bind(monitor, at)
    .run();
}

// One batch per run, which also drops the buckets and incidents older than
// the page shows. An incident opens when no check of the run passed and ends
// when the newest passed, the same rule the alerts follow.
export async function record(db: D1Database, tallies: Tally[], at: number) {
  const bucket = bucketStart(at);
  const oldest = bucket - HISTORY_BUCKETS * BUCKET_MS;

  await db.batch([
    ...tallies.flatMap((t) => [
      db
        .prepare(
          `INSERT INTO latest (monitor, up, detail, at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (monitor) DO UPDATE
           SET up = excluded.up, detail = excluded.detail, at = excluded.at`,
        )
        .bind(t.monitor, Number(t.up), t.detail, at),
      db
        .prepare(
          `INSERT INTO buckets (start, monitor, up, total) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (start, monitor) DO UPDATE
           SET up = up + excluded.up, total = total + excluded.total`,
        )
        .bind(bucket, t.monitor, t.ups, t.checks),
      ...incident(db, t, at),
    ]),
    db.prepare("DELETE FROM buckets WHERE start < ?1").bind(oldest),
    db.prepare("DELETE FROM incidents WHERE ended < ?1").bind(oldest),
  ]);
}

function incident(db: D1Database, t: Tally, at: number): D1PreparedStatement[] {
  if (t.ups === 0) {
    return [
      db
        .prepare(
          `INSERT INTO incidents (monitor, started) VALUES (?1, ?2)
           ON CONFLICT DO NOTHING`,
        )
        .bind(t.monitor, at),
    ];
  }
  if (t.up) {
    return [
      db
        .prepare(
          "UPDATE incidents SET ended = ?2 WHERE monitor = ?1 AND ended IS NULL",
        )
        .bind(t.monitor, at),
    ];
  }

  return [];
}

export async function readStatus(
  db: D1Database,
  since: number,
  incidentsSince: number,
): Promise<{ latest: Latest[]; buckets: Bucket[]; incidents: Incident[] }> {
  const [latest, buckets, incidents] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT monitor, up, detail, at FROM latest"),
    db
      .prepare(
        "SELECT start, monitor, up, total FROM buckets WHERE start >= ?1",
      )
      .bind(since),
    db
      .prepare(
        `SELECT monitor, started, ended FROM incidents
         WHERE ended IS NULL OR ended >= ?1 ORDER BY started DESC`,
      )
      .bind(incidentsSince),
  ]);

  return {
    latest: latest.results as Latest[],
    buckets: buckets.results as Bucket[],
    incidents: incidents.results as Incident[],
  };
}

export async function readIssues(db: D1Database): Promise<Issue[]> {
  const { results } = await db
    .prepare("SELECT monitor, number, opened, open FROM issue")
    .all<Issue>();

  return results;
}

// Marks the monitor's issue open with `opened`, unless it is open already or
// another run changed it since `last` was read. Returns whether this run won.
export async function claimIssue(
  db: D1Database,
  monitor: string,
  opened: number,
  last: Issue | undefined,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `INSERT INTO issue (monitor, opened, open) VALUES (?1, ?2, 1)
       ON CONFLICT (monitor) DO UPDATE SET opened = ?2, open = 1
       WHERE open = 0 AND opened = ?3`,
    )
    .bind(monitor, opened, last?.opened ?? null)
    .run();

  return meta.changes > 0;
}

// Undoes a claim whose GitHub call failed, so the next run tries again.
export async function unclaimIssue(
  db: D1Database,
  monitor: string,
  last: Issue | undefined,
) {
  await db
    .prepare("UPDATE issue SET opened = ?2, open = 0 WHERE monitor = ?1")
    .bind(monitor, last?.opened ?? 0)
    .run();
}

export async function setIssueNumber(
  db: D1Database,
  monitor: string,
  number: number,
) {
  await db
    .prepare("UPDATE issue SET number = ?2 WHERE monitor = ?1")
    .bind(monitor, number)
    .run();
}

export async function closeIssueRow(db: D1Database, monitor: string) {
  await db
    .prepare("UPDATE issue SET open = 0 WHERE monitor = ?1")
    .bind(monitor)
    .run();
}
