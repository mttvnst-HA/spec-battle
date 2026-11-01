const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Auto-updater — imported conditionally to avoid errors in dev
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch {
  autoUpdater = null;
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Only the app's own content may load inside the window: the bundled
// dist/ files in production, or the Vite dev server during development.
function isAppUrl(url) {
  try {
    const target = new URL(url);
    if (devServerUrl) {
      return target.origin === new URL(devServerUrl).origin;
    }
    return target.protocol === 'file:';
  } catch {
    return false;
  }
}

function isExternalWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: true,
    title: 'SPEC BATTLE',
    backgroundColor: '#0a0e14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
      // The sandboxed preload cannot require package.json, so the version
      // is handed over as a command-line switch instead.
      additionalArguments: [`--spec-battle-version=${app.getVersion()}`],
    },
  });

  // Block in-app navigation away from the game; open web links in the
  // user's default browser instead of inside the app window.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (isExternalWebUrl(url)) shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Auto-update in production only
  if (!devServerUrl && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('Update check failed:', err && err.message ? err.message : err);
    });
  }
}

// Refuse to attach webviews; the game never uses them.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
