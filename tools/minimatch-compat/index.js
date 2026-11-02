"use strict";

// Compatibility wrapper around minimatch 11.
//
// Why this exists: GHSA-g3hv-75wg-m249 (minimatch denial of service via
// globparts amplification) is fixed only in minimatch >= 11.0.1, but
// electron-builder's toolchain still pins minimatch 3, 5, 9 and 10 through
// @electron/asar, glob 7, dir-compare, filelist, @electron/universal and
// app-builder-lib. package.json "overrides" points every one of those at this
// package, which re-exports minimatch 11 in the shape and with the matching
// behavior the older callers expect. See README.md for the full list of
// differences that remain and why they are acceptable.
//
// Shapes the older callers use:
//   1. minimatch(path, pattern, opts)          -- glob 7, filelist (v3/v5 style)
//   2. require("minimatch").default(...)       -- @electron/asar, dir-compare
//      (TypeScript __importDefault; works because __esModule is NOT set here)
//   3. require("minimatch").minimatch(...)     -- @electron/universal (v9 style)
//   4. Minimatch, match, filter, GLOBSTAR, sep, braceExpand, defaults,
//      escape, unescape                        -- glob 7, app-builder-lib
//      (makeRe is gone in minimatch 11; none of these callers use it)
//
// Behavior kept from the older majors (each verified against minimatch 3 with
// real glob 7 -- see src/__tests__/minimatch-compat.test.js):
//   a. Windows: a "\" in a pattern is a path separator (minimatch 3 split
//      patterns on path.sep). windowsPathsNoEscape defaults on for win32.
//   b. Linux/macOS: "\" stays an escape character. glob 7 always passes
//      allowWindowsEscape: false, which minimatch 3 ignored off Windows but
//      minimatch 11 honors everywhere (turning every "\" into "/"), so the
//      wrapper drops that flag when not on Windows.
//   c. Brace alternatives stay as separate rows (minimatch 11 merges them into
//      one @(a|b) row). glob 7 reads each row's raw glob to decide whether
//      dotfiles may match, and lines rows up with globSet for nonull.
//   d. ".." segments are kept as written (optimizationLevel 0), as in
//      minimatch 3 and 5, instead of being folded away.
//   e. Each magic path segment answers String.prototype.match() and carries
//      _glob, which glob 7 uses to filter directory entries.
//
// Remove this package and the "overrides" entry once electron-builder ships
// with minimatch >= 11.0.1 throughout.

const real = require("minimatch-v11");

// Read at call time (minimatch 11 reads it once at load) so tests can switch it.
function platformOf(options) {
  return (
    (options && options.platform) ||
    process.env.__MINIMATCH_TESTING_PLATFORM__ ||
    process.platform
  );
}

function withDefaults(options) {
  const opts = Object.assign({}, options);
  // Pass the platform through so minimatch 11 splits file paths the same way.
  if (opts.platform === undefined) opts.platform = platformOf(opts);
  const windows = opts.platform === "win32";
  if (windows) {
    if (
      opts.windowsPathsNoEscape === undefined &&
      opts.allowWindowsEscape === undefined
    ) {
      opts.windowsPathsNoEscape = true;
    }
  } else if (
    opts.allowWindowsEscape === false &&
    opts.windowsPathsNoEscape === undefined
  ) {
    // (b) minimatch 3 ignored this flag off Windows; minimatch 11 does not.
    delete opts.allowWindowsEscape;
  }
  if (opts.optimizationLevel === undefined) {
    opts.optimizationLevel = 0; // (d)
  }
  return opts;
}

// (e) Teach each Matcher to answer String.prototype.match via Symbol.match and
// carry _glob, without replacing it, so minimatch 11's own matching is
// unchanged. Symbol.match is non-enumerable and only added to parts of this
// wrapper's own instances.
function makeGlob7Compatible(mm) {
  for (const row of mm.set || []) {
    for (const part of row) {
      if (
        part &&
        typeof part === "object" &&
        part !== real.GLOBSTAR &&
        typeof part.test === "function" &&
        !Object.prototype.hasOwnProperty.call(part, Symbol.match)
      ) {
        Object.defineProperty(part, Symbol.match, {
          value: (s) => (part.test(String(s)) ? [String(s)] : null),
        });
        if (part._glob === undefined) {
          Object.defineProperty(part, "_glob", { value: part.pattern });
        }
      }
    }
  }
}

function makeMinimatchClass(Base, merge) {
  return class Minimatch extends Base {
    constructor(pattern, options) {
      super(pattern, withDefaults(merge(options)));
      makeGlob7Compatible(this);
    }

    // (c) Keep brace alternatives as separate rows.
    mergeRows() {}

    static defaults(def) {
      if (!def || typeof def !== "object" || !Object.keys(def).length) {
        return this;
      }
      const Parent = this;
      return class extends Parent {
        constructor(pattern, options) {
          super(pattern, Object.assign({}, def, options));
        }
      };
    }
  };
}

function build(merge) {
  const Minimatch = makeMinimatchClass(real.Minimatch, merge);
  const opts = (options) => withDefaults(merge(options));

  function minimatch(path, pattern, options) {
    // Same comment and empty-pattern handling as minimatch's own function,
    // then delegate to this wrapper's class so (a)-(e) apply.
    if (typeof pattern !== "string") {
      throw new TypeError("glob pattern string required");
    }
    const o = merge(options);
    if (!o.nocomment && pattern.charAt(0) === "#") return false;
    return new Minimatch(pattern, o).match(path);
  }

  minimatch.Minimatch = Minimatch;
  minimatch.minimatch = minimatch;
  minimatch.default = minimatch;
  minimatch.GLOBSTAR = real.GLOBSTAR;
  minimatch.sep = real.sep;
  minimatch.match = (list, pattern, options) => {
    const mm = new Minimatch(pattern, options);
    const out = list.filter((f) => mm.match(f));
    if (mm.options.nonull && !out.length) out.push(pattern);
    return out;
  };
  minimatch.filter = (pattern, options) => (p) =>
    minimatch(p, pattern, options);
  minimatch.braceExpand = (pattern, options) =>
    real.braceExpand(pattern, opts(options));
  minimatch.escape = (s, options) => real.escape(s, opts(options));
  minimatch.unescape = (s, options) => real.unescape(s, opts(options));
  minimatch.defaults = (def) => {
    if (!def || typeof def !== "object" || !Object.keys(def).length) {
      return minimatch;
    }
    return build((options) => Object.assign({}, merge({}), def, options));
  };
  return minimatch;
}

module.exports = build((options) => Object.assign({}, options));
