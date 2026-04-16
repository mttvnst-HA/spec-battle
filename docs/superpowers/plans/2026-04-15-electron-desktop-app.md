# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap Spec Battle RPG in Electron with an NSIS Windows installer and auto-update.

**Architecture:** Two-process Electron app (main + preload) loading the Vite-built `dist/` output via `file://` protocol in production and the Vite dev server in development. electron-builder packages everything into an NSIS installer. The existing web app is untouched.

**Tech Stack:** Electron, electron-builder, electron-updater, concurrently, wait-on, cross-env

**Spec:** `docs/superpowers/specs/2026-04-15-electron-desktop-app-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/main.cjs` | Create | Main process: window, menu, auto-update, dev/prod URL routing |
| `electron/preload.cjs` | Create | contextBridge: expose app version to renderer |
| `public/fonts/PressStart2P-Regular.woff2` | Create | Bundled font for offline Electron use |
| `build/icon.ico` | Create | Placeholder app icon for Windows |
| `index.html` | Modify | Replace CDN font link with local @font-face |
| `vite.config.js` | Modify | Add `base: './'` for file:// compatibility |
| `package.json` | Modify | Add `main`, dependencies, `build` config, scripts |
| `.gitignore` | Modify | Add `release/` |

---

### Task 1: Bundle the font locally

The app loads Press Start 2P from Google Fonts CDN. Electron runs offline, so the font must be bundled. This task is independent of Electron itself and keeps the web app working.

**Files:**
- Create: `public/fonts/PressStart2P-Regular.woff2`
- Modify: `index.html`

- [ ] **Step 1: Download the font file**

```bash
mkdir -p public/fonts
curl -L -o public/fonts/PressStart2P-Regular.woff2 "https://fonts.gstatic.com/s/pressstart2p/v15/e3t4euO8T-267oIAQAu6jDQyK3nVivM.woff2"
```

Verify the file exists and is non-empty:

```bash
ls -la public/fonts/PressStart2P-Regular.woff2
```

Expected: a file around 6-8 KB.

- [ ] **Step 2: Replace CDN link with local @font-face in index.html**

In `index.html`, replace:

```html
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
```

With:

```html
<style>
  @font-face {
    font-family: 'Press Start 2P';
    src: url('./fonts/PressStart2P-Regular.woff2') format('woff2');
    font-display: swap;
  }
</style>
```

Note: the `url('./fonts/...')` relative path works with both Vite dev server (serves `public/` at root) and Electron's `file://` protocol (after `base: './'` is set in Task 3).

The full `index.html` should now look like:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SPEC BATTLE</title>
    <style>
      @font-face {
        font-family: 'Press Start 2P';
        src: url('./fonts/PressStart2P-Regular.woff2') format('woff2');
        font-display: swap;
      }
    </style>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { height: 100%; width: 100%; background: #0a0e14; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify font loads in web dev mode**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. The pixel font should render identically to before. Check the Network tab — the font should load from `localhost`, not `fonts.googleapis.com`.

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all tests pass. No game code was changed.

- [ ] **Step 5: Commit**

```bash
git add public/fonts/PressStart2P-Regular.woff2 index.html
git commit -m "feat(font): bundle Press Start 2P locally for offline use

Replace Google Fonts CDN link with local @font-face.
Required for Electron offline support.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Configure Vite for file:// protocol

Electron loads the built app via `file://` protocol, which requires relative asset paths. Vite defaults to absolute paths (`/assets/...`), which resolve to the filesystem root under `file://`.

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Add base config to vite.config.js**

Change `vite.config.js` from:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

To:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
})
```

- [ ] **Step 2: Verify the build produces relative paths**

```bash
npm run build
```

Then inspect the generated `dist/index.html`:

```bash
cat dist/index.html
```

Expected: asset paths should start with `./assets/` (not `/assets/`). The font `@font-face` URL should also be relative.

- [ ] **Step 3: Run existing tests**

```bash
npm test
```

Expected: all tests pass. `base` only affects the build output, not runtime logic.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "build(vite): set base './' for Electron file:// compatibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Create the Electron preload script

The preload script bridges Electron's main process and the renderer. It exposes the app version to the renderer via `contextBridge`. This is written first because `main.cjs` references it.

**Files:**
- Create: `electron/preload.cjs`

- [ ] **Step 1: Create the preload script**

Create `electron/preload.cjs`:

```js
const { contextBridge } = require('electron');
const { version } = require('../package.json');

contextBridge.exposeInMainWorld('electronAPI', {
  version,
});
```

Note: the `.cjs` extension is required because the project's `package.json` has `"type": "module"`, which makes Node.js treat `.js` files as ESM. Electron's preload does not support ESM `import` syntax — it must use `require()`, so the file must be explicitly `.cjs`. The version is read from `package.json` directly rather than `process.env.npm_package_version`, which is only set when running via `npm run` and would be `undefined` in the packaged app.

- [ ] **Step 2: Commit**

```bash
git add electron/preload.cjs
git commit -m "feat(electron): add preload script exposing app version

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Create the Electron main process

The main process creates the BrowserWindow, removes the menu bar, routes to the dev server or built files, and wires up auto-update.

**Files:**
- Create: `electron/main.cjs`

- [ ] **Step 1: Create electron/main.cjs**

Create `electron/main.cjs`:

```js
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Auto-updater — imported conditionally to avoid errors in dev
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  autoUpdater = null;
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    title: 'SPEC BATTLE',
    backgroundColor: '#0a0e14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Auto-update in production only
  if (!devServerUrl && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
```

Note: the `.cjs` extension is required because the project's `package.json` has `"type": "module"`. Node.js treats `.js` files as ESM in that context, and `require()` would throw `ERR_REQUIRE_ESM`. The `.cjs` extension forces CommonJS regardless of the package type.

- [ ] **Step 2: Commit**

```bash
git add electron/main.cjs
git commit -m "feat(electron): add main process with window, menu, auto-update

800x600 non-resizable window. Loads Vite dev server (VITE_DEV_SERVER_URL)
in dev or dist/index.html in production. Auto-update via electron-updater.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Create placeholder app icon

electron-builder requires an icon for the Windows installer and executable.

**Files:**
- Create: `build/icon.ico`

- [ ] **Step 1: Generate a placeholder ICO file**

We need a valid `.ico` file at 256x256 (electron-builder's recommended minimum for NSIS installers, taskbar, and Add/Remove Programs). Generate a green "SB" block-letter icon on black using Node.js (no external dependencies):

```bash
mkdir -p build
node -e "
const fs = require('fs');

// 256x256 32-bit ICO: green 'SB' block letters on black (#0a0e14)
const W = 256, H = 256;
const pixels = Buffer.alloc(W * H * 4); // BGRA

// Fill background with game bg color #0a0e14
const bg = [0x14, 0x0e, 0x0a, 0xff]; // BGRA
for (let i = 0; i < W * H; i++) {
  pixels[i*4] = bg[0]; pixels[i*4+1] = bg[1]; pixels[i*4+2] = bg[2]; pixels[i*4+3] = bg[3];
}

const green = [0x88, 0xff, 0x00, 0xff]; // BGRA: #00ff88

function fillRect(x, y, w, h) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx, py = y + dy;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        // ICO BMP stores rows bottom-to-top
        const row = (H - 1 - py);
        const off = (row * W + px) * 4;
        pixels[off] = green[0]; pixels[off+1] = green[1]; pixels[off+2] = green[2]; pixels[off+3] = green[3];
      }
    }
  }
}

// Block size for pixel-art feel (16px blocks on 256 grid)
const B = 16;

// 'S' letter — left half (x: 2B to 7B, y: 3B to 13B)
fillRect(2*B, 3*B, 5*B, B);    // top bar
fillRect(2*B, 4*B, B, 2*B);    // left upper
fillRect(2*B, 6*B, 5*B, B);    // middle bar
fillRect(6*B, 7*B, B, 2*B);    // right lower
fillRect(2*B, 9*B, 5*B, B);    // bottom bar

// 'B' letter — right half (x: 9B to 14B, y: 3B to 10B)
fillRect(9*B, 3*B, B, 7*B);    // left vertical
fillRect(10*B, 3*B, 4*B, B);   // top bar
fillRect(13*B, 4*B, B, B);     // right upper top
fillRect(10*B, 6*B, 3*B, B);   // middle bar
fillRect(13*B, 7*B, B, 2*B);   // right lower
fillRect(10*B, 9*B, 4*B, B);   // bottom bar

const andMask = Buffer.alloc(H * Math.ceil(W / 8 / 4) * 4, 0);

const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(W, 4);
dib.writeInt32LE(H * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);

const imageData = Buffer.concat([dib, pixels, andMask]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry[0] = 0; // 0 means 256 in ICO format
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(imageData.length, 8);
entry.writeUInt32LE(6 + 16, 12);

const ico = Buffer.concat([header, entry, imageData]);
fs.writeFileSync('build/icon.ico', ico);
console.log('icon.ico written:', ico.length, 'bytes');
"
```

Expected: `build/icon.ico` created, ~262 KB (256x256 uncompressed BMP).

- [ ] **Step 2: Verify the file is a valid ICO**

```bash
ls -la build/icon.ico
```

Expected: file exists and is > 0 bytes.

- [ ] **Step 3: Commit**

```bash
git add build/icon.ico
git commit -m "feat(electron): add placeholder app icon

256x256 green 'SB' on game bg. Replace with proper pixel art later.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Update package.json — main field, dependencies, builder config, scripts

This is the integration task: wire everything together in `package.json`.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `main` field**

Add `"main": "electron/main.js"` to `package.json` right after the `"type": "module"` line. This tells Electron which file is the main process entry point.

The field goes at the top level, after `"type"`:

```json
"main": "electron/main.cjs",
```

- [ ] **Step 2: Add dependencies**

Add `electron-updater` to `dependencies`:

```json
"dependencies": {
  "electron-updater": "^6.3.9",
  "react": "^18.3.1",
  "react-dom": "^18.3.1"
}
```

Add the dev dependencies to `devDependencies`:

```json
"devDependencies": {
  "@vitejs/plugin-react": "^4.3.4",
  "concurrently": "^9.1.2",
  "cross-env": "^7.0.3",
  "electron": "^35.1.2",
  "electron-builder": "^25.1.8",
  "vite": "^6.0.0",
  "vitest": "^4.1.4",
  "wait-on": "^8.0.3"
}
```

- [ ] **Step 3: Add electron-builder config**

Add the `"build"` key at the top level of `package.json`:

```json
"build": {
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
  },
  "publish": [{
    "provider": "github",
    "owner": "mttvnst",
    "repo": "spec-battle"
  }]
}
```

- [ ] **Step 4: Add npm scripts**

Add these scripts to the `"scripts"` block:

```json
"electron:dev": "concurrently -k \"vite\" \"wait-on http://localhost:5173 && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron .\"",
"electron:build": "vite build && electron-builder --win",
"electron:preview": "vite build && electron ."
```

- [ ] **Step 5: Verify the final package.json is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: completes without errors. `node_modules/electron/` and `node_modules/electron-builder/` should exist.

- [ ] **Step 7: Run existing tests**

```bash
npm test
```

Expected: all existing tests pass. None of the game code was modified.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(electron): add Electron deps, builder config, and scripts

Adds electron, electron-builder, electron-updater, concurrently,
wait-on, cross-env. Configures NSIS installer and GitHub Releases
auto-update. New scripts: electron:dev, electron:build, electron:preview.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add release/ to .gitignore**

Append to `.gitignore`:

```
# Electron-builder output
release/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): add release/ for Electron builds

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Smoke test — Electron dev mode

Verify the full Electron dev flow works end-to-end.

**Files:** None (verification only)

- [ ] **Step 1: Launch Electron dev mode**

```bash
npm run electron:dev
```

Expected:
- Vite dev server starts on port 5173
- After a few seconds, an Electron window opens titled "SPEC BATTLE"
- The game renders with the pixel font (Press Start 2P)
- No menu bar is visible
- DevTools opens automatically
- The window is 800x600 and non-resizable

- [ ] **Step 2: Play-test**

Click through the title screen and play a few turns of a battle. Verify:
- Sprites render correctly
- Move buttons work
- Battle log scrolls
- Game over screen shows

- [ ] **Step 3: Verify hot reload**

With the Electron window open, make a trivial change to `src/App.jsx` (e.g., add a space in a comment). The app should hot-reload without needing to restart Electron.

Revert the trivial change after verifying.

- [ ] **Step 4: Close and verify clean exit**

Close the Electron window. Both the Electron process and Vite dev server should terminate (the `-k` flag in `concurrently` kills both).

---

### Task 9: Smoke test — Electron build + installer

Verify the NSIS installer builds and works.

**Files:** None (verification only)

- [ ] **Step 1: Build the installer**

```bash
npm run electron:build
```

Expected: builds complete, NSIS installer produced in `release/`. Look for a file like `release/Spec Battle Setup 1.0.0.exe`.

```bash
ls -la release/
```

- [ ] **Step 2: Install and launch**

Run the installer (`release/Spec Battle Setup 1.0.0.exe`). Verify:
- Setup wizard appears with install location picker
- Installs to `%LOCALAPPDATA%\Programs\Spec Battle` by default
- Desktop shortcut and Start Menu shortcut are created
- Launching the app shows the game with the pixel font
- No DevTools open (production mode)
- The window title is "SPEC BATTLE"

- [ ] **Step 3: Play-test the installed app**

Play a full game through to the victory/defeat screen. Verify the game is fully functional.

- [ ] **Step 4: Uninstall**

Uninstall via Add/Remove Programs. Verify the app and shortcuts are removed.

- [ ] **Step 5: Verify web mode still works**

```bash
npm run dev
```

Open `http://localhost:5173` — the web app should work identically to before, with the locally-bundled font.

```bash
npm test
```

All tests pass.
