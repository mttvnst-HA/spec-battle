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
| `electron/main.js` | Create | Main process: window, menu, auto-update, dev/prod URL routing |
| `electron/preload.js` | Create | contextBridge: expose app version to renderer |
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

The preload script bridges Electron's main process and the renderer. It exposes the app version to the renderer via `contextBridge`. This is written first because `main.js` references it.

**Files:**
- Create: `electron/preload.js`

- [ ] **Step 1: Create the preload script**

Create `electron/preload.js`:

```js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  version: process.env.npm_package_version || 'dev',
});
```

Note: preload scripts use CommonJS (`require`) — they run in a sandboxed Node context, not the ESM renderer. Electron's preload does not support ESM `import` syntax.

- [ ] **Step 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat(electron): add preload script exposing app version

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Create the Electron main process

The main process creates the BrowserWindow, removes the menu bar, routes to the dev server or built files, and wires up auto-update.

**Files:**
- Create: `electron/main.js`

- [ ] **Step 1: Create electron/main.js**

Create `electron/main.js`:

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
      preload: path.join(__dirname, 'preload.js'),
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

Note: like the preload, the main process uses CommonJS. Electron's main process does not reliably support `"type": "module"` from the host `package.json` — it uses its own module system. `require()` is correct here.

- [ ] **Step 2: Commit**

```bash
git add electron/main.js
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

We need a valid `.ico` file. Generate a minimal 16x16 green-on-black placeholder using Node.js (no external dependencies):

```bash
mkdir -p build
node -e "
// Minimal 16x16 32-bit ICO: green 'S' on black background
// ICO header (6 bytes) + 1 entry (16 bytes) + BMP DIB (40 bytes) + pixels (1024 bytes) + AND mask (64 bytes)
const W = 16, H = 16;
const pixels = Buffer.alloc(W * H * 4, 0); // BGRA, all black

// Draw a green 'S' pattern
const green = [0x88, 0xff, 0x00, 0xff]; // BGRA: #00ff88
const coords = [
  // top bar
  [4,2],[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],[11,2],
  // left side upper
  [3,3],[3,4],[3,5],
  // middle bar
  [4,6],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],
  // right side lower
  [12,7],[12,8],[12,9],[12,10],
  // bottom bar
  [4,11],[5,11],[6,11],[7,11],[8,11],[9,11],[10,11],[11,11],
  // left side lower connect
  [3,10],
  // right side upper connect
  [12,3],
];
for (const [x, y] of coords) {
  // ICO BMP stores rows bottom-to-top
  const row = (H - 1 - y);
  const off = (row * W + x) * 4;
  pixels[off] = green[0]; pixels[off+1] = green[1]; pixels[off+2] = green[2]; pixels[off+3] = green[3];
}

const andMask = Buffer.alloc(H * Math.ceil(W / 8 / 4) * 4, 0); // all opaque

// BMP InfoHeader (BITMAPINFOHEADER)
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);       // header size
dib.writeInt32LE(W, 4);         // width
dib.writeInt32LE(H * 2, 8);     // height (doubled for ICO: image + mask)
dib.writeUInt16LE(1, 12);       // planes
dib.writeUInt16LE(32, 14);      // bpp
dib.writeUInt32LE(0, 20);       // image size (can be 0 for BI_RGB)

const imageData = Buffer.concat([dib, pixels, andMask]);

// ICO header
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);     // reserved
header.writeUInt16LE(1, 2);     // type: ICO
header.writeUInt16LE(1, 4);     // count: 1 image

// ICO directory entry
const entry = Buffer.alloc(16);
entry[0] = W;                   // width
entry[1] = H;                   // height
entry[2] = 0;                   // palette
entry[3] = 0;                   // reserved
entry.writeUInt16LE(1, 4);      // planes
entry.writeUInt16LE(32, 6);     // bpp
entry.writeUInt32LE(imageData.length, 8);  // size
entry.writeUInt32LE(6 + 16, 12);           // offset

const ico = Buffer.concat([header, entry, imageData]);
require('fs').writeFileSync('build/icon.ico', ico);
console.log('icon.ico written:', ico.length, 'bytes');
"
```

Expected: `build/icon.ico` created, ~1.1 KB.

- [ ] **Step 2: Verify the file is a valid ICO**

```bash
ls -la build/icon.ico
```

Expected: file exists and is > 0 bytes.

- [ ] **Step 3: Commit**

```bash
git add build/icon.ico
git commit -m "feat(electron): add placeholder app icon

16x16 green 'S' on black. Replace with proper pixel art later.

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
"main": "electron/main.js",
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
