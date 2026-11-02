# minimatch-compat

Temporary wrapper that closes **GHSA-g3hv-75wg-m249** (minimatch denial of service via globparts amplification) for electron-builder's packaging toolchain.

## Why

The advisory is fixed only in minimatch 11.0.1 and later. electron-builder 26 still pulls minimatch 3, 5, 9 and 10 through `@electron/asar`, `glob` 7, `dir-compare`, `filelist` and `@electron/universal`, and none of those packages has a release on minimatch 11. minimatch 11 also changed its CommonJS export shape, so forcing it in directly crashes the older callers.

## How

1. The `overrides` entry in the root `package.json` points every `minimatch` dependency at this folder.
2. `index.js` loads the real minimatch 11 (installed under the alias `minimatch-v11` so the override does not loop back on itself) and re-exports it in every shape the older callers use.
3. On Windows it turns on `windowsPathsNoEscape` unless a caller sets it, which keeps minimatch 3's behavior of treating `\` in a pattern as a path separator.

`src/__tests__/minimatch-compat.test.js` checks the export shapes, the Windows default, and that every installed `minimatch` resolves to this wrapper.

## When to remove

Once `npm ls minimatch` shows electron-builder's tree on minimatch 11.0.1 or later without the override:

1. Delete the `minimatch` entry from `overrides` in `package.json`.
2. Delete this folder.
3. Run `npm install`, then `npm audit` to confirm nothing reappears.
