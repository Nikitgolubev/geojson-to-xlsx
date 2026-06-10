"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");

// Точка входа главного процесса Electron.
// IPC-обработчики (cities/zones/log) регистрируются в registerIpc() — Этап 1.

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "GeoJSON Zones",
    backgroundColor: "#f5f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload использует require('better-sqlite3') косвенно через main; оставляем false для совместимости native-модулей
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS: пересоздать окно при клике на иконку в доке (задел под будущую mac-версию)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // На macOS приложения обычно остаются активными без окон; на Windows — закрываем
  if (process.platform !== "darwin") {
    app.quit();
  }
});
