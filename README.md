# nca-apprentices status

The status page at <https://status.nca-apprentices.dev> and the outside
monitor of the cluster. A Cloudflare Worker on the Free plan checks:

- Every 10 seconds, each app through its deepest public path: ncaleague's
  `/health`, which pings the database, and jjforge's `POST /api/v1/echo`,
  which passes through the server and vcs. Each must answer 200 within two
  tries of 4 seconds. A redirect counts as down. Workers Logs keeps each
  failed try.
- Every minute, the heartbeats. Alertmanager posts the always-firing
  `Watchdog` to `/heartbeat/alerts` every minute. Five minutes without a post
  means vmalert, vmsingle, or Alertmanager is down. A new heartbeat is one
  entry in `HEARTBEATS` in `src/index.ts`.

Cron fires once a minute at most, so each run checks the sites in six rounds
and writes D1 once.

D1 keeps the newest check of each monitor and one row per monitor and 2
hours, for the last 7 days.
The page in `public/` reads them from `/api/status`.

A monitor with no passing check in a run opens an issue labeled `alert` in
nca-apprentices/infra, next to the cluster's own alerts. The issue closes
when the monitor's newest check passes. `outage` in D1 keeps the open issues.

## Free plan budget

| Resource        | Limit           | Used                                    |
| --------------- | --------------- | --------------------------------------- |
| Worker requests | 100,000 a day   | 1,440 per heartbeat, plus page views    |
| D1 rows written | 100,000 a day   | About 15,000                            |
| D1 rows read    | 5,000,000 a day | About 260 per page view                 |
| Cron triggers   | 5 per account   | 1                                       |
| Subrequests     | 50 per run      | 12, up to 24 with retries, 2 per alert  |
| CPU time        | 10 ms per run   | Waiting on `fetch` and D1 doesn't count |

Workers Free needs no payment method. A limit reached fails requests until
00:00 UTC and never bills.

## Tasks

Install [mise](https://mise.jdx.dev), then run `mise trust` once. `mise
tasks` lists the tasks:

| Task              | Does                                                         |
| ----------------- | ------------------------------------------------------------ |
| `mise run login`  | Signs wrangler in to Cloudflare, once per machine            |
| `mise run dev`    | Runs the Worker on `localhost:8787` against a local database |
| `mise run cron`   | Runs one cron run against `mise run dev`                     |
| `mise run check`  | Typechecks the Worker and its tests                          |
| `mise run test`   | Runs the tests in workerd against a local database           |
| `mise run deploy` | Migrates the database and deploys, as CI does on `main`      |
| `mise run tail`   | Streams the deployed Worker's requests and cron runs         |
| `mise run secret` | Sets the heartbeat token                                     |
| `mise run github` | Sets the token that opens and closes outage issues           |

`deploy`, `tail`, `secret`, and `github` act on Cloudflare and need
`mise run login` first.

## Set up

Done once, kept here for a rebuild:

1. `wrangler d1 create status`, and put the `database_id` it prints in
   `wrangler.jsonc`.
2. `mise run deploy`. The first deploy registers the account's workers.dev
   subdomain. A new cron trigger takes up to 15 minutes to fire.
3. `mise run secret`, with the token from `openssl rand -hex 32`. Put the same
   token in the cluster's `status-heartbeat` secret, see
   `docs/operations.md` in nca-apprentices/infra.
4. `mise run github`, with the token in the cluster's `github-alerts` secret,
   which opens infra's issues. A renewal sets it in both places, see
   `docs/operations.md` in nca-apprentices/infra.

GitHub Actions deploys each push to `main`. It needs the repository
secret `CLOUDFLARE_API_TOKEN`, a custom token with the account permissions
Workers Scripts Edit and D1 Edit, and the repository variable
`CLOUDFLARE_ACCOUNT_ID`.

## Add a check

A site is one entry in `SITES` in `src/index.ts`, and a heartbeat one entry in
`HEARTBEATS`. A heartbeat's sender posts to `/heartbeat/<id>` with
`Authorization: Bearer <token>`.
