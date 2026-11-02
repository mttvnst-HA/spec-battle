// Guards the minimatch 11 compatibility wrapper (tools/minimatch-compat) that
// closes GHSA-g3hv-75wg-m249 for electron-builder's packaging toolchain.
// See tools/minimatch-compat/README.md.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shim = require(join(root, "tools", "minimatch-compat", "index.js"));
const real = require("minimatch-v11");

// Every package that pulled an older, vulnerable minimatch before the override.
const CONSUMERS = [
  "@electron/asar",
  "@electron/universal",
  "app-builder-lib",
  "dir-compare",
  "filelist",
  "glob",
];

function resolveFrom(pkg, request) {
  const pkgJson = require.resolve(`${pkg}/package.json`, { paths: [root] });
  return require.resolve(request, { paths: [dirname(pkgJson)] });
}

describe("minimatch-compat wrapper", () => {
  it("wraps a patched minimatch (>= 11.0.1)", () => {
    const pkg = JSON.parse(
      readFileSync(resolveFrom("minimatch-v11", "minimatch-v11/package.json"), "utf-8"),
    );
    const [major, minor, patch] = pkg.version.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(11);
    if (major === 11) expect(minor * 1000 + patch).toBeGreaterThanOrEqual(1);
  });

  it("every former consumer now resolves minimatch to the wrapper", () => {
    const shimPath = require.resolve(join(root, "tools", "minimatch-compat", "index.js"));
    for (const pkg of CONSUMERS) {
      const resolved = require(resolveFrom(pkg, "minimatch"));
      expect(resolved, pkg).toBe(require(shimPath));
    }
  });

  it("supports the call shape of minimatch 3/5 (glob 7, filelist)", () => {
    expect(typeof shim).toBe("function");
    expect(shim("src/a.js", "**/*.js")).toBe(true);
    expect(shim("src/a.css", "**/*.js")).toBe(false);
    expect(shim.match(["a.js", "b.css"], "*.js")).toEqual(["a.js"]);
    expect(["a.js", "b.css"].filter(shim.filter("*.css"))).toEqual(["b.css"]);
  });

  it("supports TypeScript __importDefault callers (@electron/asar, dir-compare)", () => {
    // __esModule must stay unset so __importDefault wraps the function as .default
    expect(shim.__esModule).toBeUndefined();
    expect(shim.default("dir/.hidden", "**", { dot: true })).toBe(true);
  });

  it("supports the named-export shape of minimatch 9+ (@electron/universal)", () => {
    expect(shim.minimatch("deep/x.node", "*.node", { matchBase: true })).toBe(true);
  });

  it("exposes the Minimatch class and constants glob 7 relies on", () => {
    const mm = new shim.Minimatch("a/{b,c}/*.js");
    expect(mm).toBeInstanceOf(real.Minimatch);
    expect(mm.match("a/b/x.js")).toBe(true);
    expect(mm.match("a/d/x.js")).toBe(false);
    expect(Array.isArray(mm.set)).toBe(true);
    expect(Array.isArray(mm.globSet)).toBe(true);
    expect(mm.negate).toBe(false);
    expect(new shim.Minimatch("!*.js").negate).toBe(true);
    expect(shim.GLOBSTAR).toBe(real.GLOBSTAR);
    expect(new shim.Minimatch("a/**/b").set[0]).toContain(shim.GLOBSTAR);
    expect(shim.braceExpand("{a,b}")).toEqual(["a", "b"]);
  });

  it("lets glob 7 test directory entries with entry.match(part) and read part._glob", () => {
    // glob 7 walks the filesystem one segment at a time: for a magic segment
    // it calls `entry.match(part)` and checks `part._glob` for a leading dot.
    const [row] = new shim.Minimatch("src/*.js").set;
    const part = row[1];
    expect(part._glob).toBe("*.js");
    expect("app.js".match(part)).toBeTruthy();
    expect("app.css".match(part)).toBeFalsy();
    // Unwrapped minimatch 11 silently fails here -- the bug the wrapper fixes.
    const [rawRow] = new real.Minimatch("src/*.js").set;
    expect("app.js".match(rawRow[1])).toBeFalsy();
  });

  it("drives real glob 7 to the same results as before", () => {
    const glob = require(resolveFrom("@electron/asar", "glob"));
    const cwd = root;
    const found = glob.sync("src/game/*.js", { cwd }).sort();
    expect(found).toContain("src/game/logic.js");
    expect(found).toContain("src/game/reducer.js");
    expect(found.every((f) => /^src\/game\/[^/]+\.js$/.test(f))).toBe(true);
    const deep = glob.sync("content/**/*.json", { cwd });
    expect(deep).toContain("content/quotes/engineer.json");
    expect(deep).toContain("content/game.json");
    expect(glob.sync("content/*.{json,md}", { cwd })).toContain("content/README.md");
    expect(glob.sync("src/**/*.nomatch", { cwd })).toEqual([]);
  });

  it("drives real filelist include/exclude filters", () => {
    const filelist = require(resolveFrom("jake", "filelist"));
    const list = new filelist.FileList();
    list.include("content/*.json");
    list.exclude("content/game.json");
    const files = list.toArray();
    expect(files).toContain("content/intros.json");
    expect(files).not.toContain("content/game.json");
  });

  it("on Windows treats backslashes in patterns as separators, like minimatch 3", () => {
    const win = { platform: "win32" };
    expect(shim("dist\\assets\\a.js", "dist\\**\\*.js", win)).toBe(true);
    expect(new shim.Minimatch("dist\\**", win).match("dist\\index.html")).toBe(true);
    // Unwrapped minimatch 11 reads "\" as an escape and would miss this.
    expect(real.minimatch("dist\\assets\\a.js", "dist\\**\\*.js", win)).toBe(false);
  });

  it("leaves an explicit windowsPathsNoEscape choice alone", () => {
    const opts = { platform: "win32", windowsPathsNoEscape: false };
    expect(shim("a*b", "a\\*b", opts)).toBe(true);
  });

  it("keeps defaults() working with the wrapper's behavior", () => {
    const dotted = shim.defaults({ dot: true });
    expect(dotted(".env", "*")).toBe(true);
    expect(shim(".env", "*")).toBe(false);
    expect(new dotted.Minimatch("*").match(".env")).toBe(true);
    expect(shim.defaults({})).toBe(shim);
  });

  it("is not vulnerable to globparts amplification (GHSA-g3hv-75wg-m249)", () => {
    // A pattern of many brace groups and globstars that blows up on <11.0.1.
    const evil = "{a,b}/".repeat(12) + "**/".repeat(12) + "x";
    const start = Date.now();
    new shim.Minimatch(evil);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
