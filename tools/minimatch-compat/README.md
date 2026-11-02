# minimatch-compat

Temporary wrapper that closes **GHSA-g3hv-75wg-m249** (minimatch denial of service via globparts amplification) for electron-builder's packaging toolchain.

## Why

The advisory is fixed only in minimatch 11.0.1 and later. electron-builder 26 still pulls older minimatch majors, and none of the packages involved has a release on minimatch 11:

| Package | Was on | Now gets |
|---|---|---|
| `app-builder-lib` | minimatch 10 | real minimatch 11 |
| `@electron/universal` | minimatch 9 | real minimatch 11 |
| `@electron/asar` | minimatch 3 | this wrapper |
| `glob` 7 (under asar, rimraf) | minimatch 3 | this wrapper |
| `dir-compare` | minimatch 3 | this wrapper |
| `filelist` (under jake/ejs) | minimatch 5 | this wrapper |

minimatch 11 exports the same shape minimatch 9 and 10 did, so those two callers use it directly. The minimatch 3 and 5 callers would crash or silently match the wrong files on plain minimatch 11, so they get this wrapper.

## How

1. `overrides` in the root `package.json` sets `minimatch` to `^11.0.3` everywhere. Nested overrides then send `@electron/asar`, `dir-compare`, `filelist` and `glob` to this folder through the root devDependency `minimatch-compat`.
2. `index.js` loads the real minimatch 11 (installed under the alias `minimatch-v11`, so the overrides do not loop back on themselves). It re-exports it in the minimatch 3 and 5 call shapes, and restores the old matching behavior these callers depend on:
   1. On Windows, a `\` in a pattern is a path separator.
   2. On Linux and macOS, a `\` stays an escape character, even though glob 7 passes `allowWindowsEscape: false`.
   3. Brace alternatives stay as separate rows. Without this, glob 7 drops dotfiles for patterns like `{.e*,R*}` and returns the wrong literals with `nonull`.
   4. `..` segments are kept as written.
   5. Each magic path segment answers `entry.match(part)` and carries `_glob`, which glob 7 uses to walk directories.

`src/__tests__/minimatch-compat.test.js` checks the routing, every export shape, each restored behavior against results recorded from real glob 7 on minimatch 3, and the advisory itself.

## Differences that remain

Compared with glob 7 on minimatch 3, these edge cases now find files that minimatch 3 missed. They are minimatch 11 fixes and were left in place:

1. `[.]env` matches `.env`.
2. With `nocase`, patterns starting with `./` or containing `..` match.
3. `?` and `[!a]` match one emoji or other astral-plane character.
4. `[[:alpha:]]` character classes work.

electron-builder's own file filtering (app-builder-lib's `createFilter`, with this project's `files` config and electron-builder's default excludes) produces identical results to minimatch 10 on Linux and Windows path handling. The packaged app contents are file-for-file identical to the build before this change.

## When to remove

Once `npm ls minimatch --all` (with the overrides removed) shows every copy at 11.0.1 or later:

1. Delete the `overrides` block and the `minimatch-compat` devDependency from `package.json`.
2. Delete this folder and `src/__tests__/minimatch-compat.test.js`.
3. Run `npm install`, then `npm audit` to confirm nothing reappears.
