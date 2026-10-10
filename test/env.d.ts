declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    HEARTBEAT_TOKEN: string;
    GITHUB_TOKEN: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
