// Outages open issues next to the cluster's own alerts, so whoever watches
// infra gets both.

import {
  claimIssue,
  closeIssueRow,
  type Issue,
  readIssues,
  setIssueNumber,
  unclaimIssue,
} from "./db";
import { MINUTE_MS, MONITORS, SECOND_MS, type Tally } from "./monitors";

const ISSUES_URL = "https://api.github.com/repos/nca-apprentices/infra/issues";
const ALERT_LABEL = "alert";
const PAGE_URL = "https://status.nca-apprentices.dev";
const GITHUB_TIMEOUT_MS = 4 * SECOND_MS;

// A flapping monitor opens at most one issue in this time, and reopens it
// for each outage after the first.
const NEW_ISSUE_INTERVAL_MS = 60 * MINUTE_MS;

// A monitor opens an issue once no check of the run passed, so one slow
// round opens none, and closes it once its newest check passes. A GitHub
// error leaves the issue as it was, and the next run tries again.
export async function alert(
  db: D1Database,
  token: string,
  tallies: Tally[],
  now: number,
) {
  const issues = new Map((await readIssues(db)).map((i) => [i.monitor, i]));

  for (const t of tallies) {
    const issue = issues.get(t.monitor);

    try {
      if (!issue?.open && t.ups === 0) {
        await openIssue(db, token, t, issue, now);
      } else if (issue?.open && t.up) {
        await closeIssue(db, token, t, issue);
      }
    } catch (error) {
      console.error({ monitor: t.monitor, error: String(error) });
    }
  }
}

// Claims the outage before calling GitHub, so of two overlapping runs only
// one opens or reopens the issue.
async function openIssue(
  db: D1Database,
  token: string,
  t: Tally,
  last: Issue | undefined,
  now: number,
) {
  const recent =
    last?.number != null && now - last.opened < NEW_ISSUE_INTERVAL_MS
      ? { number: last.number, opened: last.opened }
      : undefined;

  if (!(await claimIssue(db, t.monitor, recent?.opened ?? now, last))) {
    return;
  }

  try {
    if (recent) {
      await reopen(token, t, recent.number);
    } else {
      await setIssueNumber(db, t.monitor, await create(token, t));
    }
  } catch (error) {
    await unclaimIssue(db, t.monitor, last);
    throw error;
  }
}

async function create(token: string, t: Tally): Promise<number> {
  const name = MONITORS.find((m) => m.id === t.monitor)?.name ?? t.monitor;
  const { number } = await github<{ number: number }>(
    token,
    "POST",
    ISSUES_URL,
    {
      title: `${name} is down`,
      body: `${t.detail}\n\n${PAGE_URL}`,
      labels: [ALERT_LABEL],
    },
  );

  return number;
}

async function reopen(token: string, t: Tally, issue: number) {
  await github(token, "PATCH", `${ISSUES_URL}/${issue}`, { state: "open" });
  await github(token, "POST", `${ISSUES_URL}/${issue}/comments`, {
    body: `Down again: ${t.detail}`,
  });
}

// An issue without a number never reached GitHub, so only the row closes.
async function closeIssue(
  db: D1Database,
  token: string,
  t: Tally,
  issue: Issue,
) {
  if (issue.number !== null) {
    await github(token, "POST", `${ISSUES_URL}/${issue.number}/comments`, {
      body: `Back up: ${t.detail}`,
    });
    await github(token, "PATCH", `${ISSUES_URL}/${issue.number}`, {
      state: "closed",
    });
  }

  await closeIssueRow(db, t.monitor);
}

async function github<T>(
  token: string,
  method: string,
  url: string,
  body: object,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "nca-apprentices-status",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub ${method} ${url}: ${response.status}`);
  }

  return response.json<T>();
}
