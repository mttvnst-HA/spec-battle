const { contextBridge } = require('electron');

// Runs in a sandboxed preload, which can only require('electron'). The main
// process passes the app version as --spec-battle-version=<x.y.z>.
const VERSION_FLAG = '--spec-battle-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_FLAG));
const version = versionArg ? versionArg.slice(VERSION_FLAG.length) : 'unknown';

contextBridge.exposeInMainWorld('electronAPI', {
  version,
});
