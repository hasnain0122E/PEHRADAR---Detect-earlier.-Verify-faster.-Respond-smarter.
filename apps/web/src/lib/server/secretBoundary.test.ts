// Guards the rule that OPERATOR_API_KEY never reaches browser JavaScript (Rules.md §25).
// The production build check (no key value in .next/static) is recorded in Tracker.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

describe("operator secret boundary", () => {
  it("only server-only modules read OPERATOR_API_KEY", () => {
    // UI copy may name the variable; only code that reads it from the environment matters.
    const readers = files.filter((f) => /env\.OPERATOR_API_KEY|env\[["']OPERATOR_API_KEY/.test(f.text));
    expect(readers.map((f) => f.path)).toEqual(["lib/server/operatorProxy.ts"]);
    expect(readers[0].text).toContain('import "server-only"');
  });

  it("no public env var carries a key, secret or token", () => {
    for (const f of files) expect(f.text, f.path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
  });

  it("client components never import server modules", () => {
    const clients = files.filter((f) => f.text.startsWith('"use client"'));
    expect(clients.length).toBeGreaterThan(5);
    for (const f of clients) expect(f.text, f.path).not.toMatch(/from "[^"]*\/server\//);
  });
});
