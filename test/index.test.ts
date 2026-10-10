import { createScheduledController, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const BASE = "https://status.test";
const ISSUES = "https://api.github.com/repos/nca-apprentices/infra/issues";
const ISSUE = 7;

interface Monitor {
  id: string;
  up: boolean | null;
  detail: string;
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

// The requests the Worker sent to GitHub.
let github: Call[];

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`), env);
}

function beat(token: string, id = "alerts"): Promise<Response> {
  return worker.fetch(
    new Request(`${BASE}/heartbeat/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
  );
}

async function monitors(): Promise<Record<string, Monitor>> {
  const body = await (await get("/api/status")).json<{ monitors: Monitor[] }>();
  return Object.fromEntries(body.monitors.map((m) => [m.id, m]));
}

// Runs one cron run. `site` gives the status of the nth request to a site,
// counted from 0, so a run can fail some checks and pass others.
async function cron(site: number | ((n: number) => number)) {
  const answer = typeof site === "number" ? () => site : site;
  let n = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);

    if (request.url.startsWith(ISSUES)) {
      github.push({
        url: request.url,
        method: request.method,
        body: await request.json(),
      });
      return Response.json({ number: ISSUE });
    }

    return new Response(null, { status: answer(n++) });
  });
  await worker.scheduled(createScheduledController(), env);
}

function opened(): Call[] {
  return github.filter((c) => c.method === "POST" && c.url === ISSUES);
}

beforeEach(() => {
  github = [];
  vi.spyOn(scheduler, "wait").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("heartbeat", () => {
  it("refuses a wrong token", async () => {
    expect((await beat("wrong")).status).toBe(401);
  });

  it("refuses an unknown heartbeat", async () => {
    expect((await beat("test", "nope")).status).toBe(404);
  });

  it("marks the heartbeat up on the next run", async () => {
    expect((await beat("test")).status).toBe(204);
    await cron(200);

    expect((await monitors()).alerts.up).toBe(true);
  });
});

describe("sites", () => {
  it("are unchecked before the first run", async () => {
    expect((await monitors()).ncaleague.up).toBeNull();
  });

  it("are up when they answer 200", async () => {
    await cron(200);

    expect((await monitors()).ncaleague.up).toBe(true);
  });

  it("are down when they answer anything else", async () => {
    await cron(302);

    const { ncaleague } = await monitors();
    expect(ncaleague.up).toBe(false);
    expect(ncaleague.detail).toMatch(/^302/);
  });
});

describe("alerts", () => {
  it("open an issue for each site down a whole run", async () => {
    await cron(500);

    expect(opened().map((c) => c.body.title)).toEqual([
      "ncaleague is down",
      "jjforge is down",
    ]);
    expect(opened()[0].body.labels).toEqual(["alert"]);
  });

  it("open no issue for a site that recovers within the run", async () => {
    // The first round's two sites fail both attempts.
    await cron((n) => (n < 4 ? 500 : 200));

    expect(github).toEqual([]);
  });

  it("open one issue per outage", async () => {
    await cron(500);
    await cron(500);

    expect(opened()).toHaveLength(2);
  });

  it("close the issue when the site is back", async () => {
    await cron(500);
    github = [];
    await cron(200);

    const closed = github.filter((c) => c.method === "PATCH");
    expect(closed.map((c) => c.url)).toEqual([
      `${ISSUES}/${ISSUE}`,
      `${ISSUES}/${ISSUE}`,
    ]);
    expect(closed[0].body.state).toBe("closed");
  });
});
