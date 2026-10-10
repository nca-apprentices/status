import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The tests run in workerd against a local D1, which test/setup.ts migrates.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          HEARTBEAT_TOKEN: "test",
          GITHUB_TOKEN: "test",
          TEST_MIGRATIONS: await readD1Migrations("migrations"),
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
}));
