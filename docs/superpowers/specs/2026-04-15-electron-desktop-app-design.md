# Electron Desktop App — Design Spec

## Summary

Wrap the existing Spec Battle RPG (React 18 + Vite) in Electron with an NSIS Windows installer and auto-update via GitHub Releases. The web app remains fully functional; Electron is an additive distribution channel.

## Architecture

Two-process Electron setup:

```
electron/
  main.cjs      — Main process: BrowserWindow creation, app lifecycle, auto-update
  preload.cjs   — contextBridge: exposes app version to renderer
```

Note: `.cjs` extension is required because the project's `package.json` has `"type": "module"`. Without it, Node.js treats `.js` files as ESM and `require()` calls in the Electron process files would throw `ERR_REQUIRE_ESM`.

### Build Flow

```
vite build → dist/   →   electron-builder packages dist/ + electron/ → NSIS installer
```

### Dev Flow

```
concurrently:
  1. vite dev server (localhost:5173)
  2. wait-on localhost:5173, then launch electron with VITE_DEV_SERVER_URL env
```

Main process checks `VITE_DEV_SERVER_URL`:
- **Set:** loads the dev server URL (hot reload)
- **Unset:** loads `file://${path.join(__dirname, '../dist/index.html')}` (production build)

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `electron/main.cjs` | Main process: window creation, menu removal, auto-update |
| `electron/preload.cjs` | contextBridge exposing `{ version }` to renderer |
| `public/fonts/PressStart2P-Regular.woff2` | Bundled pixel font for offline use |
| `build/icon.ico` | Windows app icon (generated placeholder — 256x256 pixel-art style) |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `"main": "electron/main.cjs"`, dependencies, electron-builder config, new scripts |
| `vite.config.js` | Set `base: './'` for file:// protocol compatibility |
| `index.html` | Replace Google Fonts CDN link with local `@font-face` |

### Unchanged

All game code (`src/`), content (`content/`), tests, sim harness, and tune harness remain untouched.

## Window Configuration

- **Size:** 800x600, non-resizable (`resizable: false`)
- **Title:** "SPEC BATTLE"
- **Menu:** Removed (`Menu.setApplicationMenu(null)`)
- **Background:** `#0a0e14` (matches `C.bg`)
- **DevTools:** Opened automatically when `VITE_DEV_SERVER_URL` is set; disabled in production
- **WebPreferences:** `contextIsolation: true`, `nodeIntegration: false`, `preload` script path

## Font Bundling

Current state: `index.html` loads Press Start 2P via Google Fonts CDN. This fails offline.

Solution:
1. Download `PressStart2P-Regular.woff2` into `public/fonts/`
2. Replace the `<link>` tag in `index.html` with an inline `@font-face`:

```css
@font-face {
  font-family: 'Press Start 2P';
  src: url('/fonts/PressStart2P-Regular.woff2') format('woff2');
  font-display: swap;
}
```

Vite serves `public/` at root in dev and copies it to `dist/` on build, so this works in both web and Electron contexts. The `base: './'` config makes the path relative for `file://` loading.

## Auto-Update

Uses `electron-updater` (part of electron-builder ecosystem):

```js
// electron/main.cjs — after window creation
const { autoUpdater } = require('electron-updater');

autoUpdater.checkForUpdatesAndNotify();
```

- Checks GitHub Releases on app launch
- Downloads update silently in background
- Shows native notification when ready; installs on next app restart
- Requires `publish` config in electron-builder pointing to GitHub repo

Configuration in `package.json`:

```json
"build": {
  "publish": [{
    "provider": "github",
    "owner": "mttvnst",
    "repo": "spec-battle"
  }]
}
```

Releasing: `npm run electron:build` with `GH_TOKEN` env var → uploads installer to GitHub Releases automatically.

## NSIS Installer

Configuration in `package.json` under `"build"`:

```json
{
  "appId": "com.specbattle.rpg",
  "productName": "Spec Battle",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*"
  ],
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Spec Battle"
  }
}
```

- Default install: `%LOCALAPPDATA%\Programs\Spec Battle`
- User can choose install directory (oneClick: false)
- Desktop + Start Menu shortcuts
- Uninstaller in Add/Remove Programs

## npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `electron:dev` | `concurrently -k "vite" "wait-on http://localhost:5173 && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron ."` | Dev mode with hot reload |
| `electron:build` | `vite build && electron-builder --win` | Package Windows NSIS installer |
| `electron:preview` | `vite build && cross-env electron .` | Run built app in Electron without packaging |

## Dependencies

### Production

| Package | Purpose |
|---------|---------|
| `electron-updater` | Auto-update from GitHub Releases |

### Dev

| Package | Purpose |
|---------|---------|
| `electron` | Runtime |
| `electron-builder` | Packaging + NSIS |
| `concurrently` | Parallel dev scripts |
| `wait-on` | Wait for Vite before launching Electron |
| `cross-env` | Cross-platform env vars in npm scripts |

## Security

- `contextIsolation: true` — renderer cannot access Node.js APIs directly
- `nodeIntegration: false` — no `require()` in renderer
- Preload script uses `contextBridge.exposeInMainWorld` for safe IPC
- No remote content loaded (local files only in production)

## Testing

Electron packaging doesn't affect existing tests — all game logic tests continue to run via `npm test` (Vitest) as before. No Electron-specific tests are needed for the initial release; the app is a thin wrapper.

Manual verification:
1. `npm run electron:dev` — game loads, hot reload works
2. `npm run electron:build` — NSIS installer produced in `release/`
3. Install → launch → play a full game → uninstall

## Gitignore Additions

```
release/
```

The `release/` directory contains built installers and should not be committed.
