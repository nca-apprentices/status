// Checks the production apps every 10 seconds and the heartbeats every minute
// from outside the cluster, and serves the results to the page in public/.

import { alert } from "./alerts";
import { handle } from "./api";
import { checkHeartbeats, checkSites } from "./checks";
import { readBeats, readStreaks, record } from "./db";

interface Env {
  DB: D1Database;
  HEARTBEAT_TOKEN: string;
  GITHUB_TOKEN: string;
}

export default {
  async scheduled(controller, env) {
    const start = controller.scheduledTime;
    const tallies = [
      ...(await checkSites(start, await readStreaks(env.DB))),
      ...checkHeartbeats(await readBeats(env.DB), Date.now()),
    ];

    await record(env.DB, tallies, start);
    await alert(env.DB, env.GITHUB_TOKEN, tallies, start);
  },

  fetch(request, env) {
    return handle(request, env.DB, env.HEARTBEAT_TOKEN);
  },
} satisfies ExportedHandler<Env>;
