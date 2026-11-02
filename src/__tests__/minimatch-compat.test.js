// Guards the minimatch 11 override that closes GHSA-g3hv-75wg-m249
// (minimatch globparts-amplification denial of service) for electron-builder's
// packaging toolchain. See tools/minimatch-compat/README.md.
//
// Layout under test (package.json "overrides"):
//   1. app-builder-lib and @electron/universal (were on minimatch 10 / 9)
//      get real minimatch 11 directly -- its export shape already fits them.
//   2. @electron/asar, glob 7, dir-compare and filelist (were on minimatch 3/5)
//      get tools/minimatch-compat, which adapts minimatch 11 to them.
//
// Expected glob 7 results below were recorded from real glob 7.2.3 running on
// minimatch 3.1.5 against the same fixture tree.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shimDir = join(root, "tools", "minimatch-compat");
const shimPath = require.resolve(join(shimDir, "index.js"));
const shim = require(shimPath);

function pkgDir(pkg, from = root) {
  return dirname(require.resolve(`${pkg}/package.json`, { paths: [from] }));
}
function resolveFrom(pkg, request) {
  return require.resolve(request, { paths: [pkgDir(pkg)] });
}
function versionOf(entryFile) {
  let dir = dirname(entryFile);
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (pkg.name === "minimatch") return pkg.version;
    } catch {
      // keep walking up
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`no minimatch package.json above ${entryFile}`);
    dir = up;
  }
}
function isPatched(version) {
  const [major, minor, patch] = version.split(/[.-]/).map(Number);
  return major > 11 || (major === 11 && (minor > 0 || patch >= 1));
}

// The real minimatch 11 the wrapper loads (resolved the way the wrapper does).
const real = require(require.resolve("minimatch-v11", { paths: [shimDir] }));

const LEGACY_CONSUMERS = ["@electron/asar", "dir-compare", "filelist", "glob"];
const MODERN_CONSUMERS = ["app-builder-lib", "@electron/universal"];

describe("minimatch override layout", () => {
  it("the wrapper loads a patched minimatch (>= 11.0.1)", () => {
    const v = versionOf(require.resolve("minimatch-v11", { paths: [shimDir] }));
    expect(isPatched(v), v).toBe(true);
  });

  it("former minimatch 3/5 callers resolve to the wrapper", () => {
    for (const pkg of LEGACY_CONSUMERS) {
      expect(resolveFrom(pkg, "minimatch"), pkg).toBe(shimPath);
    }
  });

  it("former minimatch 9/10 callers get real, patched minimatch 11 (not the wrapper)", () => {
    for (const pkg of MODERN_CONSUMERS) {
      const resolved = resolveFrom(pkg, "minimatch");
      expect(resolved, pkg).not.toBe(shimPath);
      expect(isPatched(versionOf(resolved)), `${pkg} ${versionOf(resolved)}`).toBe(true);
    }
  });
});

describe("minimatch-compat export shapes", () => {
  it("minimatch 3/5 call shape (glob 7, filelist)", () => {
    expect(typeof shim).toBe("function");
    expect(shim("src/a.js", "**/*.js")).toBe(true);
    expect(shim("src/a.css", "**/*.js")).toBe(false);
    expect(shim("anything", "#comment")).toBe(false);
    expect(shim.match(["a.js", "b.css"], "*.js")).toEqual(["a.js"]);
    expect(shim.match(["b.css"], "*.js", { nonull: true })).toEqual(["*.js"]);
    expect(["a.js", "b.css"].filter(shim.filter("*.css"))).toEqual(["b.css"]);
  });

  it("TypeScript __importDefault callers (@electron/asar, dir-compare)", () => {
    // __esModule must stay unset so __importDefault wraps the function as .default
    expect(shim.__esModule).toBeUndefined();
    expect(shim.default("dir/.hidden", "**", { dot: true })).toBe(true);
  });

  it("named minimatch export", () => {
    expect(shim.minimatch("deep/x.node", "*.node", { matchBase: true })).toBe(true);
  });

  it("Minimatch class members glob 7 reads", () => {
    const mm = new shim.Minimatch("a/{b,c}/*.js");
    expect(mm).toBeInstanceOf(real.Minimatch);
    expect(mm.match("a/b/x.js")).toBe(true);
    expect(mm.match("a/d/x.js")).toBe(false);
    expect(mm.negate).toBe(false);
    expect(new shim.Minimatch("!*.js").negate).toBe(true);
    expect(shim.GLOBSTAR).toBe(real.GLOBSTAR);
    expect(new shim.Minimatch("a/**/b").set[0]).toContain(shim.GLOBSTAR);
    expect(shim.braceExpand("{a,b}")).toEqual(["a", "b"]);
  });

  it("brace alternatives stay as separate rows aligned with globSet (glob 7 nonull, dotfiles)", () => {
    const mm = new shim.Minimatch("{.e*,R*}");
    expect(mm.set).toHaveLength(2);
    expect(mm.globSet).toHaveLength(2);
    expect(mm.set.map((row) => row[0]._glob)).toEqual([".e*", "R*"]);
    // Unwrapped minimatch 11 merges them into one @(.e*|R*) row.
    expect(new real.Minimatch("{.e*,R*}").set).toHaveLength(1);
  });

  it("magic segments answer entry.match(part) and expose _glob", () => {
    const part = new shim.Minimatch("src/*.js").set[0][1];
    expect(part._glob).toBe("*.js");
    expect("app.js".match(part)).toBeTruthy();
    expect("app.css".match(part)).toBeFalsy();
    // Unwrapped minimatch 11 silently fails here.
    expect("app.js".match(new real.Minimatch("src/*.js").set[0][1])).toBeFalsy();
  });

  it("keeps .. segments as written, like minimatch 3", () => {
    expect(shim("a/../b/x", "a/../b/*")).toBe(true);
    expect(shim("b/x", "a/../b/*")).toBe(false);
  });

  it("defaults() and Minimatch.defaults() keep the wrapper's behavior", () => {
    const dotted = shim.defaults({ dot: true });
    expect(dotted(".env", "*")).toBe(true);
    expect(shim(".env", "*")).toBe(false);
    expect(new dotted.Minimatch("*").match(".env")).toBe(true);
    expect(new dotted.Minimatch("{.e*,R*}").set).toHaveLength(2);
    expect(shim.defaults({})).toBe(shim);
    // nested defaults merge instead of dropping the outer ones
    const both = dotted.defaults({ nocase: true });
    expect(both(".ENV", "*.env")).toBe(true);
    const Both = shim.Minimatch.defaults({ dot: true }).defaults({ nocase: true });
    expect(new Both("*.env").match(".ENV")).toBe(true);
    expect(new Both("{.e*,R*}").set).toHaveLength(2);
  });
});

describe("minimatch-compat platform behavior", () => {
  const saved = process.env.__MINIMATCH_TESTING_PLATFORM__;
  afterEach(() => {
    if (saved === undefined) delete process.env.__MINIMATCH_TESTING_PLATFORM__;
    else process.env.__MINIMATCH_TESTING_PLATFORM__ = saved;
  });

  it("on Windows (via process platform) treats backslashes in patterns as separators, like minimatch 3", () => {
    process.env.__MINIMATCH_TESTING_PLATFORM__ = "win32";
    expect(shim("dist\\assets\\a.js", "dist\\**\\*.js")).toBe(true);
    expect(new shim.Minimatch("dist\\**").match("dist\\index.html")).toBe(true);
    // glob 7 passes allowWindowsEscape: false; on Windows that also means separator
    expect(shim("a/b", "a\\b", { allowWindowsEscape: false })).toBe(true);
  });

  it("respects an explicit windowsPathsNoEscape choice on Windows", () => {
    const opts = { platform: "win32", windowsPathsNoEscape: false };
    expect(shim("a*b", "a\\*b", opts)).toBe(true);
  });

  it("on Linux/macOS keeps backslash as an escape even with glob 7's allowWindowsEscape: false", () => {
    process.env.__MINIMATCH_TESTING_PLATFORM__ = "linux";
    const glob7 = { allowWindowsEscape: false };
    expect(shim("a*b", "a\\*b", glob7)).toBe(true);
    expect(shim("a/b", "a\\*b", glob7)).toBe(false);
    expect(shim("br[x]/f", "br\\[x\\]/*", glob7)).toBe(true);
  });

  it("leaves app-builder-lib on unmodified minimatch 11 Windows semantics (same as minimatch 10)", () => {
    const appBuilderMinimatch = require(resolveFrom("app-builder-lib", "minimatch"));
    const mm = new appBuilderMinimatch.Minimatch("build\\res\\**\\*", {
      dot: true,
      platform: "win32",
    });
    expect(mm.match("build/res/x.png")).toBe(false);
  });
});

describe("real consumers through the wrapper", () => {
  let fx;
  const posix = process.platform !== "win32";

  beforeAll(() => {
    fx = mkdtempSync(join(tmpdir(), "minimatch-compat-"));
    for (const d of ["a", "dist", "br[x]"]) mkdirSync(join(fx, d));
    for (const f of [".env", "README.md", "dist/index.html", "a/f.json", "br[x]/f.txt"]) {
      writeFileSync(join(fx, f), "");
    }
    if (posix) writeFileSync(join(fx, "a*b"), ""); // "*" is not allowed in Windows file names
  });
  afterAll(() => rmSync(fx, { recursive: true, force: true }));

  const glob = () => require(resolveFrom("@electron/asar", "glob"));
  const run = (pattern, opts = {}) => glob().sync(pattern, { cwd: fx, ...opts }).sort();

  it("glob 7: plain and recursive patterns", () => {
    expect(run("**/*.json")).toEqual(["a/f.json"]);
    expect(run("dist/*")).toEqual(["dist/index.html"]);
    expect(run("*.nomatch")).toEqual([]);
  });

  it("glob 7: brace alternatives that start with a dot still find dotfiles", () => {
    expect(run("{.e*,R*}")).toEqual([".env", "README.md"]);
    expect(run("{.*,*}")).toContain(".env");
  });

  it("glob 7: nonull returns every brace-expanded literal", () => {
    expect(run("{q,r}/*.{a,b}", { nonull: true })).toEqual([
      "q/*.a",
      "q/*.b",
      "r/*.a",
      "r/*.b",
    ]);
  });

  it("glob 7: .. segments are kept in results", () => {
    expect(run("a/../dist/*")).toEqual(["a/../dist/index.html"]);
  });

  it("glob 7: ignore option", () => {
    const expected = [".env", "README.md", "dist"];
    if (posix) expected.splice(2, 0, "a*b");
    expect(run("*", { dot: true, ignore: ["a/**", "br*/**"] })).toEqual(expected);
  });

  it.skipIf(!posix)("glob 7 on Linux/macOS: backslash escapes still work", () => {
    expect(run("a\\*b")).toEqual(["a*b"]);
    expect(run("br\\[x\\]/*")).toEqual(["br[x]/f.txt"]);
  });

  it("filelist include/exclude", () => {
    const filelist = require(resolveFrom("jake", "filelist"));
    const list = new filelist.FileList();
    list.include("content/*.json");
    list.exclude("content/game.json");
    const files = list.toArray();
    expect(files).toContain("content/intros.json");
    expect(files).not.toContain("content/game.json");
  });
});

describe("GHSA-g3hv-75wg-m249", () => {
  // 15 brace groups ahead of ** expand to 32,768 glob rows. minimatch 9.0.9 and
  // 10.2.6 take ~16 s to preprocess this at optimizationLevel 2 (quadratic);
  // 11.0.x takes ~0.2 s. A vulnerable version fails the 3 s bound.
  const evil = "{a,b}/".repeat(15) + "**/x";

  it("the wrapper is not vulnerable", () => {
    const start = Date.now();
    new shim.Minimatch(evil, { optimizationLevel: 2 });
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("app-builder-lib's minimatch is not vulnerable", () => {
    const { Minimatch } = require(resolveFrom("app-builder-lib", "minimatch"));
    const start = Date.now();
    new Minimatch(evil, { optimizationLevel: 2 });
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
