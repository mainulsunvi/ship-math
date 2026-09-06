/**
 * Vitest global setup — provisions a throwaway SQLite fixture database so
 * repository tests NEVER touch prisma/dev.sqlite.
 *
 * prisma/schema.prisma hardcodes its datasource url (file:dev.sqlite), so the
 * CLI cannot be pointed elsewhere with env vars alone. Instead we rewrite a
 * scratch copy of the schema (node_modules/.shipmath-test/, git-ignored) with
 * an absolute fixture url and run `prisma db push` against THAT; the client
 * connects to the same absolute url via SHIPMATH_TEST_DATABASE_URL (set in
 * vitest.config.ts, read by app/db.server.ts).
 */

import { exec } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const repoRoot = import.meta.dirname;
const scratchDir = path.join(repoRoot, "node_modules", ".shipmath-test");
const fixtureDbPath = path.join(scratchDir, "test-fixture.sqlite");
const scratchSchemaPath = path.join(scratchDir, "schema.test.prisma");
const fixtureUrl = `file:${fixtureDbPath.split(path.sep).join("/")}`;

export async function setup(): Promise<void> {
  await rm(fixtureDbPath, { force: true });
  await rm(`${fixtureDbPath}-journal`, { force: true });
  await rm(`${fixtureDbPath}-wal`, { force: true });
  await mkdir(scratchDir, { recursive: true });

  const source = await readFile(path.join(repoRoot, "prisma", "schema.prisma"), "utf8");
  if (!source.includes("file:dev.sqlite")) {
    throw new Error(
      "prisma/schema.prisma no longer hardcodes file:dev.sqlite — update the fixture rewrite in vitest.global-setup.ts",
    );
  }
  await writeFile(scratchSchemaPath, source.replace("file:dev.sqlite", fixtureUrl), "utf8");

  // db push targets ONLY the scratch schema (absolute fixture url) — it can
  // never mutate prisma/dev.sqlite.
  await execAsync(`pnpm exec prisma db push --skip-generate --schema "${scratchSchemaPath}"`, { cwd: repoRoot });
}

export async function teardown(): Promise<void> {
  // Best effort: Windows may keep the sqlite file locked for a moment.
  await rm(scratchSchemaPath, { force: true }).catch(function ignoreSchema() {
    /* best effort */
  });
  await rm(fixtureDbPath, { force: true }).catch(function ignoreDb() {
    /* best effort */
  });
  await rm(`${fixtureDbPath}-journal`, { force: true }).catch(function ignoreJournal() {
    /* best effort */
  });
}
