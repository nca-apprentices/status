// Checks the production apps every 10 seconds and the heartbeats every minute
// from outside the cluster, and serves the results to the page in public/.

interface Env {
  DB: D1Database;
  HEARTBEAT_TOKEN: string;
}

interface Site {
  id: string;
  name: string;
  url: string;
  init?: RequestInit;
}

interface Heartbeat {
  id: string;
  name: string;
  maxAgeMs: number;
}

// One monitor's checks over one cron run.
interface Tally {
  monitor: string;
  up: boolean;
  detail: string;
  ups: number;
  checks: number;
}

interface Check {
  up: boolean;
  detail: string;
}

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

// The page shows the last 7 days in bars of 2 hours.
const BUCKET_MS = 2 * 60 * MINUTE_MS;
const HISTORY_BUCKETS = 84;

// Cron fires once a minute at most, so each run checks the sites in rounds 10
// seconds apart. A check's two attempts time out before the next round starts.
// Six rounds of two sites, at most 24 requests, stay under the Free plan's 50
// subrequests per run, and the run writes D1 once, so the rate doesn't spend
// the daily writes.
const ROUND_INTERVAL_MS = 10 * SECOND_MS;
const ROUNDS = MINUTE_MS / ROUND_INTERVAL_MS;
const ATTEMPT_TIMEOUT_MS = 4 * SECOND_MS;

// One check per app, through its deepest public path. Every site must answer
// 200 itself. A redirect, such as to a login, is down.
const SITES: Site[] = [
  // The server pings the database.
  {
    id: "ncaleague",
    name: "ncaleague",
    url: "https://ncaleague.nca-apprentices.dev/health",
  },
  // The server, which also serves the web app, passes it through vcs, so it
  // covers REST and gRPC.
  {
    id: "jjforge",
    name: "jjforge",
    url: "https://jjforge.nca-apprentices.dev/api/v1/echo",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "status" }),
    },
  },
];

// Each heartbeat posts to /heartbeat/<id>. Alertmanager resends the
// always-firing Watchdog every minute, so five minutes of silence means four
// missed sends, not one late one.
const HEARTBEATS: Heartbeat[] = [
  { id: "alerts", name: "Alert pipeline", maxAgeMs: 5 * MINUTE_MS },
];

const MONITORS = [...SITES, ...HEARTBEATS];
const HEARTBEAT_PATH = /^\/heartbeat\/([a-z-]+)$/;

export default {
  async scheduled(controller, env) {
    const start = controller.scheduledTime;
    const rounds: Check[][] = [];

    for (let i = 0; i < ROUNDS; i++) {
      await scheduler.wait(
        Math.max(0, start + i * ROUND_INTERVAL_MS - Date.now()),
      );
      rounds.push(await Promise.all(SITES.map(probe)));
    }

    const tallies = [
      ...SITES.map((site, i) =>
        tally(
          site.id,
          rounds.map((round) => round[i]),
        ),
      ),
      ...(await heartbeats(env, Date.now())),
    ];
    await record(env, tallies, start);
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const beat = HEARTBEAT_PATH.exec(pathname)?.[1];

    if (request.method === "POST" && beat) {
      return receiveHeartbeat(request, env, beat);
    }
    if (request.method === "GET" && pathname === "/api/status") {
      return Response.json(await status(env));
    }

    return new Response("Not found", { status: HTTP_NOT_FOUND });
  },
} satisfies ExportedHandler<Env>;

// A check retries a failed attempt once, so a single request held up between
// Cloudflare and the node doesn't count as down. An app that is down fails
// both attempts.
async function probe(site: Site): Promise<Check> {
  const first = await attempt(site);

  if (first.up) {
    return first;
  }

  return attempt(site);
}

// Logs each failed attempt to Workers Logs, since D1 keeps only the newest.
async function attempt(site: Site): Promise<Check> {
  const check = await request(site);

  if (!check.up) {
    console.warn({ site: site.id, detail: check.detail });
  }

  return check;
}

async function request(site: Site): Promise<Check> {
  const start = Date.now();

  try {
    const response = await fetch(site.url, {
      ...site.init,
      redirect: "manual",
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    await response.body?.cancel();

    return {
      up: response.status === HTTP_OK,
      detail: `${response.status} in ${Date.now() - start} ms`,
    };
  } catch (error) {
    return { up: false, detail: String(error) };
  }
}

// The newest check gives the current state, and every check counts toward
// the bucket's uptime.
function tally(monitor: string, checks: Check[]): Tally {
  const newest = checks[checks.length - 1];

  return {
    monitor,
    up: newest.up,
    detail: newest.detail,
    ups: checks.filter((c) => c.up).length,
    checks: checks.length,
  };
}

// A heartbeat that never arrived isn't set up yet, so it's left out, not down.
async function heartbeats(env: Env, now: number): Promise<Tally[]> {
  const { results } = await env.DB.prepare(
    "SELECT monitor, at FROM heartbeat",
  ).all<{ monitor: string; at: number }>();

  return results.flatMap(({ monitor, at }) => {
    const heartbeat = HEARTBEATS.find((h) => h.id === monitor);

    if (!heartbeat) {
      return [];
    }

    const age = now - at;
    return tally(monitor, [
      {
        up: age <= heartbeat.maxAgeMs,
        detail: `Last heartbeat ${Math.round(age / SECOND_MS)} s ago`,
      },
    ]);
  });
}

async function record(env: Env, tallies: Tally[], at: number) {
  const bucket = bucketStart(at);

  await env.DB.batch([
    ...tallies.flatMap((t) => [
      env.DB.prepare(
        `INSERT INTO latest (monitor, up, detail, at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (monitor) DO UPDATE
         SET up = excluded.up, detail = excluded.detail, at = excluded.at`,
      ).bind(t.monitor, Number(t.up), t.detail, at),
      env.DB.prepare(
        `INSERT INTO buckets (start, monitor, up, total) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (start, monitor) DO UPDATE
         SET up = up + excluded.up, total = total + excluded.total`,
      ).bind(bucket, t.monitor, t.ups, t.checks),
    ]),
    env.DB.prepare("DELETE FROM buckets WHERE start < ?1").bind(
      bucket - HISTORY_BUCKETS * BUCKET_MS,
    ),
  ]);
}

function bucketStart(at: number): number {
  return Math.floor(at / BUCKET_MS) * BUCKET_MS;
}

// The sender passes the token as a bearer token. Alertmanager's route to
// /heartbeat/alerts carries only Watchdog, so any authorized POST counts.
async function receiveHeartbeat(
  request: Request,
  env: Env,
  monitor: string,
): Promise<Response> {
  const given = request.headers.get("Authorization") ?? "";

  if (!(await sameSecret(given, `Bearer ${env.HEARTBEAT_TOKEN}`))) {
    return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
  }
  if (!HEARTBEATS.some((h) => h.id === monitor)) {
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  }

  await env.DB.prepare(
    `INSERT INTO heartbeat (monitor, at) VALUES (?1, ?2)
     ON CONFLICT (monitor) DO UPDATE SET at = excluded.at`,
  )
    .bind(monitor, Date.now())
    .run();

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

// The page draws one bar per bucket from these, so the bucket size lives
// here only.
async function status(env: Env) {
  const newest = bucketStart(Date.now());
  const since = newest - (HISTORY_BUCKETS - 1) * BUCKET_MS;
  const [latest, buckets] = await env.DB.batch<Record<string, string | number>>(
    [
      env.DB.prepare("SELECT monitor, up, detail, at FROM latest"),
      env.DB.prepare(
        "SELECT start, monitor, up, total FROM buckets WHERE start >= ?1",
      ).bind(since),
    ],
  );

  const monitors = MONITORS.map(({ id, name }) => {
    const now = latest.results.find((r) => r.monitor === id);

    return {
      id,
      name,
      up: now ? now.up === 1 : null,
      detail: now?.detail ?? "Not checked yet",
      at: now?.at ?? null,
      buckets: buckets.results
        .filter((r) => r.monitor === id)
        .map(({ start, up, total }) => ({ start, up, total })),
    };
  });

  return { newest, bucketMs: BUCKET_MS, count: HISTORY_BUCKETS, monitors };
}
