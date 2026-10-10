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

## Free plan budget

| Resource        | Limit           | Used                                    |
| --------------- | --------------- | --------------------------------------- |
| Worker requests | 100,000 a day   | 1,440 per heartbeat, plus page views    |
| D1 rows written | 100,000 a day   | About 15,000                            |
| D1 rows read    | 5,000,000 a day | About 260 per page view                 |
| Cron triggers   | 5 per account   | 1                                       |
| Subrequests     | 50 per run      | 12, and up to 24 with retries           |
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
| `mise run check`  | Typechecks the Worker                                        |
| `mise run deploy` | Migrates the database and deploys, as CI does on `main`      |
| `mise run tail`   | Streams the deployed Worker's requests and cron runs         |
| `mise run secret` | Sets the heartbeat token                                     |

`deploy`, `tail`, and `secret` act on Cloudflare and need `mise run login`
first.

## Set up

Done once, kept here for a rebuild:

1. `wrangler d1 create status`, and put the `database_id` it prints in
   `wrangler.jsonc`.
2. `mise run deploy`. The first deploy registers the account's workers.dev
   subdomain. A new cron trigger takes up to 15 minutes to fire.
3. `mise run secret`, with the token from `openssl rand -hex 32`. Put the same
   token in the cluster's `status-heartbeat` secret, see
   `docs/operations.md` in nca-apprentices/infra.

GitHub Actions deploys each push to `main`. It needs the repository
secret `CLOUDFLARE_API_TOKEN`, a custom token with the account permissions
Workers Scripts Edit and D1 Edit, and the repository variable
`CLOUDFLARE_ACCOUNT_ID`.

## Add a check

A site is one entry in `SITES` in `src/index.ts`, and a heartbeat one entry in
`HEARTBEATS`. A heartbeat's sender posts to `/heartbeat/<id>` with
`Authorization: Bearer <token>`.
