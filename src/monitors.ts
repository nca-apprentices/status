// What the Worker checks, and what a check of it gives.

export interface Site {
  id: string;
  name: string;
  url: string;
  init?: RequestInit;
}

export interface Heartbeat {
  id: string;
  name: string;
  maxAgeMs: number;
}

export interface Check {
  up: boolean;
  detail: string;
}

// One monitor's checks over one cron run. `streak` counts the failed checks
// in a row that end it, carried across runs.
export interface Tally {
  monitor: string;
  up: boolean;
  detail: string;
  ups: number;
  checks: number;
  streak: number;
}

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;

// One check per app, through its deepest public path. Every site must answer
// 200 itself. A redirect, such as to a login, is down.
export const SITES: Site[] = [
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
export const HEARTBEATS: Heartbeat[] = [
  { id: "alerts", name: "Alert pipeline", maxAgeMs: 5 * MINUTE_MS },
];

export const MONITORS = [...SITES, ...HEARTBEATS];
