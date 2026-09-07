import path from "node:path";
import { defineConfig } from "vitest/config";

const repoRoot = import.meta.dirname;
const fixtureDbPath = path.join(repoRoot, "node_modules", ".shipmath-test", "test-fixture.sqlite");
/** Absolute, forward-slashed SQLite URL — avoids schema-relative path ambiguity on Windows. */
const fixtureUrl = `file:${fixtureDbPath.split(path.sep).join("/")}`;

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/lib/**/*.test.ts"],
    // Sequential workers: the repository suite shares one SQLite fixture file.
    fileParallelism: false,
    env: {
      // The ONLY knob that redirects Prisma in tests (read by app/db.server.ts).
      // Unset for the app → runtime behavior unchanged (schema url file:dev.sqlite).
      SHIPMATH_TEST_DATABASE_URL: fixtureUrl,
      // Stub Shopify app env so test modules may import app/shopify.server.ts
      // (the carrier callback route does transitively). shopifyApp() throws on
      // missing config — these values are only test fixtures, never runtime.
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "test-api-secret",
      SCOPES: "read_products",
      SHOPIFY_APP_URL: "https://shipmath.test.example.com",
    },
    globalSetup: [path.join(repoRoot, "vitest.global-setup.ts")],
  },
});
