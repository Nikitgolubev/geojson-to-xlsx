"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");

// Точка входа главного процесса Electron.
// IPC-обработчики (cities/zones/log) регистрируются в registerIpc().

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

// Обёртка: единообразная обработка ошибок + запись их в журнал действий.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      try {
        db.appendLog("error", `[${channel}] ${msg}`);
      } catch (_) {
        /* журнал недоступен — игнорируем */
      }
      throw err; // проброс в renderer (invoke отклонится)
    }
  });
}

function registerIpc() {
  // Города
  handle("cities:list", () => db.cities.list());
  handle("cities:create", (name) => db.cities.create(name));
  handle("cities:rename", (id, name) => db.cities.rename(id, name));
  handle("cities:delete", (id) => db.cities.delete(id));

  // Зоны
  handle("zones:listByCity", (cityId) => db.zones.listByCity(cityId));
  handle("zones:listUnassigned", () => db.zones.listUnassigned());
  handle("zones:get", (id) => db.zones.get(id));
  handle("zones:create", (payload) => db.zones.create(payload));
  handle("zones:rename", (id, name) => db.zones.rename(id, name));
  handle("zones:assignCity", (id, cityId) => db.zones.assignCity(id, cityId));
  handle("zones:move", (id, newCityId) => db.zones.move(id, newCityId));
  handle("zones:delete", (id) => db.zones.delete(id));
  handle("zones:exportGeojson", (id) => exportGeojson(id));

  // Журнал действий
  handle("log:list", (limit) => db.log.list(limit));
  handle("log:append", (level, message) => db.log.append(level, message));
  handle("log:clear", () => db.log.clear());
}

// Экспорт исходного GeoJSON «как есть» через системный диалог сохранения.
async function exportGeojson(id) {
  const zone = db.zones.get(id);
  if (!zone) throw new Error("Зона не найдена");

  const defaultName = (zone.name || "zone") + ".geojson";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Сохранить GeoJSON",
    defaultPath: defaultName,
    filters: [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
  });
  if (canceled || !filePath) return { canceled: true };

  // Пишем содержимое из БД без изменений (имя в программе ≠ содержимое файла).
  fs.writeFileSync(filePath, zone.geojson, "utf-8");
  db.appendLog("info", `Экспортирован GeoJSON зоны «${zone.name}» → ${filePath}`);
  return { canceled: false, filePath };
}

app.whenReady().then(() => {
  db.init(app.getPath("userData"));
  registerIpc();
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
