// Turns site requests and heartbeat times into one tally per monitor and run.

import {
  type Check,
  HEARTBEATS,
  MINUTE_MS,
  SECOND_MS,
  type Site,
  SITES,
  type Tally,
} from "./monitors";

const HTTP_OK = 200;

// Cron fires once a minute at most, so each run checks the sites in rounds 10
// seconds apart. A check's two attempts time out before the next round starts.
// Six rounds of two sites, at most 24 requests, stay under the Free plan's 50
// subrequests per run, and the run writes D1 once, so the rate doesn't spend
// the daily writes.
const ROUND_INTERVAL_MS = 10 * SECOND_MS;
const ROUNDS = MINUTE_MS / ROUND_INTERVAL_MS;
const ATTEMPT_TIMEOUT_MS = 4 * SECOND_MS;

export async function checkSites(start: number): Promise<Tally[]> {
  const rounds: Check[][] = [];

  for (let i = 0; i < ROUNDS; i++) {
    await scheduler.wait(
      Math.max(0, start + i * ROUND_INTERVAL_MS - Date.now()),
    );
    rounds.push(await Promise.all(SITES.map(probe)));
  }

  return SITES.map((site, i) =>
    tally(
      site.id,
      rounds.map((round) => round[i]),
    ),
  );
}

// A heartbeat that never arrived isn't set up yet, so it's left out, not down.
export function checkHeartbeats(
  beats: { monitor: string; at: number }[],
  now: number,
): Tally[] {
  return beats.flatMap(({ monitor, at }) => {
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
  const start = Date.now();
  let check: Check;

  try {
    const response = await fetch(site.url, {
      ...site.init,
      redirect: "manual",
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    await response.body?.cancel();

    check = {
      up: response.status === HTTP_OK,
      detail: `${response.status} in ${Date.now() - start} ms`,
    };
  } catch (error) {
    check = { up: false, detail: String(error) };
  }

  if (!check.up) {
    console.warn({ site: site.id, detail: check.detail });
  }

  return check;
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
