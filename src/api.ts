// The HTTP routes: heartbeats come in, and the page reads the status.

import {
  BUCKET_MS,
  bucketStart,
  HISTORY_BUCKETS,
  readStatus,
  writeBeat,
} from "./db";
import { HEARTBEATS, MINUTE_MS, MONITORS } from "./monitors";

const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const HEARTBEAT_PATH = /^\/heartbeat\/([a-z-]+)$/;

// The status changes once a minute, so viewers in one data center share a
// response for this long and D1 reads stay flat however many watch.
const STATUS_MAX_AGE_S = 30;

// The page lists the incidents that ended in this rolling window, while its
// bars cover all the history.
const INCIDENT_WINDOW_MS = 7 * 24 * 60 * MINUTE_MS;

export async function handle(
  request: Request,
  db: D1Database,
  token: string,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const beat = HEARTBEAT_PATH.exec(pathname)?.[1];

  if (request.method === "POST" && beat) {
    return receiveHeartbeat(request, db, token, beat);
  }
  if (request.method === "GET" && pathname === "/api/status") {
    return cachedStatus(request, db);
  }

  return new Response("Not found", { status: HTTP_NOT_FOUND });
}

// The sender passes the token as a bearer token. Alertmanager's route to
// /heartbeat/alerts carries only Watchdog, so any authorized POST counts.
async function receiveHeartbeat(
  request: Request,
  db: D1Database,
  token: string,
  monitor: string,
): Promise<Response> {
  const given = request.headers.get("Authorization") ?? "";

  if (!(await sameSecret(given, `Bearer ${token}`))) {
    return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
  }
  if (!HEARTBEATS.some((h) => h.id === monitor)) {
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  }

  await writeBeat(db, monitor, Date.now());

  return new Response(null, { status: HTTP_NO_CONTENT });
}

// Compares hashes, which have equal lengths, so the time taken reveals
// neither the token nor its length.
async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))),
  );

  return crypto.subtle.timingSafeEqual(hashA, hashB);
}

// Only the edge cache keeps the status. The zone's browser cache TTL raises
// any max-age sent to browsers to hours, so they get no-store instead.
async function cachedStatus(
  request: Request,
  db: D1Database,
): Promise<Response> {
  let response = await caches.default.match(request);

  if (!response) {
    response = Response.json(await status(db), {
      headers: { "Cache-Control": `max-age=${STATUS_MAX_AGE_S}` },
    });
    await caches.default.put(request, response.clone());
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// The page draws one bar per bucket from these, so the bucket size lives
// here only.
async function status(db: D1Database) {
  const newest = bucketStart(Date.now());
  const { latest, buckets, incidents } = await readStatus(
    db,
    newest - (HISTORY_BUCKETS - 1) * BUCKET_MS,
    Date.now() - INCIDENT_WINDOW_MS,
  );

  const monitors = MONITORS.map(({ id, name }) => {
    const now = latest.find((r) => r.monitor === id);

    return {
      id,
      name,
      up: now ? now.up === 1 : null,
      detail: now?.detail ?? "Not checked yet",
      at: now?.at ?? null,
      buckets: buckets
        .filter((r) => r.monitor === id)
        .map(({ start, up, total }) => ({ start, up, total })),
    };
  });

  return {
    newest,
    bucketMs: BUCKET_MS,
    count: HISTORY_BUCKETS,
    monitors,
    incidentMs: INCIDENT_WINDOW_MS,
    incidents,
  };
}
