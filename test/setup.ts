import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

// Each test starts on an empty, migrated database.
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
