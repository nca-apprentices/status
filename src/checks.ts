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

// A site is down once this many checks in a row fail, 30 seconds of rounds.
// A stall between Cloudflare and the node holds requests for up to 20
// seconds, so it never reaches the count, and an outage shows within a run.
const SITE_DOWN_AFTER = 3;
// The heartbeat's age already allows four missed sends, so one late check
// is down.
const HEARTBEAT_DOWN_AFTER = 1;

export async function checkSites(
  start: number,
  streaks: Map<string, number>,
): Promise<Tally[]> {
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
      streaks.get(site.id) ?? 0,
      SITE_DOWN_AFTER,
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
    return tally(
      monitor,
      [
        {
          up: age <= heartbeat.maxAgeMs,
          detail: `Last heartbeat ${Math.round(age / SECOND_MS)} s ago`,
        },
      ],
      0,
      HEARTBEAT_DOWN_AFTER,
    );
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

// A monitor is down once `downAfter` checks in a row failed, counting on
// from `streak`, the previous run's. The failed checks before that count as
// up. With 3, the failures F F F F count up, up, down, down.
function tally(
  monitor: string,
  checks: Check[],
  streak: number,
  downAfter: number,
): Tally {
  let downs = 0;

  for (const check of checks) {
    streak = check.up ? 0 : streak + 1;

    if (streak >= downAfter) {
      downs++;
    }
  }

  return {
    monitor,
    up: streak < downAfter,
    detail: checks[checks.length - 1].detail,
    ups: checks.length - downs,
    checks: checks.length,
    streak,
  };
}
