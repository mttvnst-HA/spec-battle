"use strict";

// Compatibility wrapper around minimatch 11.
//
// Why this exists: GHSA-g3hv-75wg-m249 (minimatch denial of service via
// globparts amplification) is fixed only in minimatch >= 11.0.1, but
// electron-builder's toolchain still pins minimatch 3, 5, 9 and 10 through
// @electron/asar, glob 7, dir-compare, filelist and @electron/universal.
// package.json "overrides" points every one of those at this package, which
// re-exports minimatch 11 in the shape each older caller expects.
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
// Windows behavior: minimatch 3 treated "\" in a pattern as a path separator
// on Windows; minimatch 5+ treats it as an escape character unless
// windowsPathsNoEscape is set. To keep the old packaging behavior, this
// wrapper turns windowsPathsNoEscape on for Windows unless a caller sets it.
//
// Remove this package and the "overrides" entry once electron-builder ships
// with minimatch >= 11.0.1 throughout.

const real = require("minimatch-v11");

function isWindows(options) {
  const platform = (options && options.platform) || process.platform;
  return platform === "win32";
}

function withDefaults(options) {
  const opts = Object.assign({}, options);
  if (
    isWindows(opts) &&
    opts.windowsPathsNoEscape === undefined &&
    opts.allowWindowsEscape === undefined
  ) {
    opts.windowsPathsNoEscape = true;
  }
  return opts;
}

function minimatch(path, pattern, options) {
  return real.minimatch(path, pattern, withDefaults(options));
}

// minimatch 3 compiled each magic path segment in `mm.set` to a RegExp with a
// `_glob` property. glob 7 depends on both: it filters directory entries with
// `entry.match(part)` and reads `part._glob` to decide whether dotfiles may
// match. minimatch 11 uses Matcher objects instead, which a string's .match()
// silently treats as "no match" -- glob 7 would find nothing. Teach each
// Matcher to answer String.prototype.match via Symbol.match and carry
// `_glob`, without replacing it, so minimatch 11's own matching is unchanged.
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

class Minimatch extends real.Minimatch {
  constructor(pattern, options) {
    super(pattern, withDefaults(options));
    makeGlob7Compatible(this);
  }
}

minimatch.Minimatch = Minimatch;
minimatch.minimatch = minimatch;
minimatch.default = minimatch;
minimatch.GLOBSTAR = real.GLOBSTAR;
minimatch.sep = real.sep;
minimatch.match = (list, pattern, options) =>
  real.match(list, pattern, withDefaults(options));
minimatch.filter = (pattern, options) =>
  real.filter(pattern, withDefaults(options));
minimatch.braceExpand = (pattern, options) =>
  real.braceExpand(pattern, withDefaults(options));
minimatch.escape = (s, options) => real.escape(s, withDefaults(options));
minimatch.unescape = (s, options) => real.unescape(s, withDefaults(options));
minimatch.defaults = (def) => {
  if (!def || typeof def !== "object" || !Object.keys(def).length) {
    return minimatch;
  }
  const merge = (options) => Object.assign({}, def, options);
  const wrapped = (path, pattern, options) =>
    minimatch(path, pattern, merge(options));
  Object.assign(wrapped, minimatch);
  wrapped.Minimatch = class extends Minimatch {
    constructor(pattern, options) {
      super(pattern, merge(options));
    }
  };
  wrapped.minimatch = wrapped;
  wrapped.default = wrapped;
  wrapped.match = (list, pattern, options) =>
    minimatch.match(list, pattern, merge(options));
  wrapped.filter = (pattern, options) =>
    minimatch.filter(pattern, merge(options));
  wrapped.braceExpand = (pattern, options) =>
    minimatch.braceExpand(pattern, merge(options));
  wrapped.defaults = (more) => minimatch.defaults(Object.assign({}, def, more));
  return wrapped;
};

module.exports = minimatch;
