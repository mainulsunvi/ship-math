/**
 * Purity guard (spec 004 criterion 8): the modules bundled into the Function
 * WASM (and their pure app-side siblings) must contain zero network and zero
 * Prisma/Shopify imports. Spec 004 §7.8 allows "a lint rule or test-import
 * guard" — this is the test-import guard.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ImportSpecifier {
  specifier: string;
  typeOnly: boolean;
}

const MODULES_DIR = path.join(import.meta.dirname, "..");

const PURE_MODULES: Array<{ file: string; allowed: readonly string[] }> = [
  // Bundled into the Function runtime — NO imports at all.
  { file: "zone-matching.ts", allowed: [] },
  // Bundled into the Function runtime — sibling pure module only.
  { file: "rule-evaluation.ts", allowed: ["./zone-matching"] },
  // App-side pure glue: value import from the shared normalizer, TYPE-only
  // import from config-schema (erased at build time — no zod at runtime).
  { file: "postal.ts", allowed: ["./zone-matching", "./config-schema"] },
  // Type-only imports from config-schema.
  { file: "tag-collection.ts", allowed: ["./config-schema"] },
  // zod is the only dependency (schema must stay WASM-bundleable for 007).
  { file: "carrier/action-schema.ts", allowed: ["zod"] },
  // Zero imports — decimal-string arithmetic shared by the carrier engine.
  { file: "money.ts", allowed: [] },
  // Carrier rate engine (007 §A3): pure sibling modules only — the action
  // schema, money math, rule evaluation, and zone matching.
  {
    file: "carrier/engine.ts",
    allowed: ["./action-schema", "../money", "../rule-evaluation", "../zone-matching"],
  },
  // Explain traces (008 §A4): app-side pure glue over the shared evaluators
  // and the carrier engine's detailed pipeline — never bundled into WASM.
  {
    file: "rule-explain.ts",
    allowed: ["./rule-evaluation", "./zone-matching", "./carrier/engine"],
  },
];

/** Specifiers that must never appear in a pure module. */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /db\.server/,
  /shopify\.server/,
  /@prisma/,
  /@shopify/,
  /^node:/,
  /^(fs|path|http|https|net|dns|child_process|worker_threads)$/,
  /^(undici|axios|node-fetch|got)$/,
];

function importSpecifiers(source: string): ImportSpecifier[] {
  const found: ImportSpecifier[] = [];
  const statement = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = statement.exec(source)) !== null) {
    const typeOnly = /(?:^|\n)\s*(?:import|export)\s+type\s/.test(
      source.slice(Math.max(0, match.index), match.index + (match[0].length ?? 0)),
    );
    found.push({ specifier: match[1], typeOnly });
  }
  const bare = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  while ((match = bare.exec(source)) !== null) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  const requireLike = /require\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requireLike.exec(source)) !== null) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  return found;
}

describe("004 criterion 8 — purity guard (no network/Prisma imports in pure modules)", function () {
  for (const { file, allowed } of PURE_MODULES) {
    it(`${file}: imports ⊆ {${allowed.join(", ") || "none"}} and no forbidden specifiers`, async function () {
      const source = await readFile(path.join(MODULES_DIR, file), "utf8");
      const imports = importSpecifiers(source);
      for (const entry of imports) {
        expect(
          allowed.includes(entry.specifier),
          `${file} imports "${entry.specifier}" which is not in the allowlist ${JSON.stringify(allowed)}`,
        ).toBe(true);
        for (const pattern of FORBIDDEN_PATTERNS) {
          expect(
            pattern.test(entry.specifier),
            `${file} imports forbidden specifier "${entry.specifier}"`,
          ).toBe(false);
        }
      }
      // zone-matching.ts additionally must have ZERO imports (Function runtime).
      if (allowed.length === 0) {
        expect(imports, `${file} must not import anything`).toHaveLength(0);
      }
    });
  }

  it("postal.ts and tag-collection.ts import config-schema TYPE-ONLY (no zod at runtime)", async function () {
    for (const file of ["postal.ts", "tag-collection.ts"]) {
      const source = await readFile(path.join(MODULES_DIR, file), "utf8");
      const configSchemaImports = importSpecifiers(source).filter(function fromConfigSchema(entry) {
        return entry.specifier === "./config-schema";
      });
      expect(configSchemaImports.length).toBeGreaterThan(0);
      for (const entry of configSchemaImports) {
        expect(entry.typeOnly, `${file} must import config-schema with \`import type\``).toBe(true);
      }
    }
  });
});
