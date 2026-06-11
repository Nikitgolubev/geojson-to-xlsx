"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const selftest = require("./selftest");
const { geojsonToXlsxBuffer } = require("./xlsx-export");
const { buildAppMenu } = require("./menu");
const { writeAllToFolders, writeZonesToFolder } = require("./export-folders");

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

  // Отладочные/тестовые хуки (только при выставленных GZ_* переменных).
  if (selftest.isEnabled()) selftest.attach(mainWindow, app);

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
  handle("zones:countUnassigned", () => db.zones.countUnassigned());
  handle("zones:get", (id) => db.zones.get(id));
  handle("zones:create", (payload) => db.zones.create(payload));
  handle("zones:rename", (id, name) => db.zones.rename(id, name));
  handle("zones:assignCity", (id, cityId) => db.zones.assignCity(id, cityId));
  handle("zones:assignCityBulk", (ids, cityId) => db.zones.assignCityBulk(ids, cityId));
  handle("zones:move", (id, newCityId) => db.zones.move(id, newCityId));
  handle("zones:delete", (id) => db.zones.delete(id));
  handle("zones:deleteBulk", (ids) => db.zones.deleteBulk(ids));
  handle("zones:exportGeojson", (id) => exportGeojson(id));
  handle("zones:exportXlsx", (id) => exportXlsx(id));
  handle("zones:exportManyToFolder", (ids, format) => exportManyToFolder(ids, format));

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

// Экспорт XLSX (генерируется из хранимого GeoJSON) через диалог сохранения.
async function exportXlsx(id) {
  const zone = db.zones.get(id);
  if (!zone) throw new Error("Зона не найдена");

  const { buffer, count } = geojsonToXlsxBuffer(zone.geojson);

  const defaultName = (zone.name || "zone") + ".xlsx";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Сохранить XLSX",
    defaultPath: defaultName,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (canceled || !filePath) return { canceled: true };

  fs.writeFileSync(filePath, buffer);
  db.zones.markXlsxGenerated(id); // фиксируем дату последней генерации XLSX
  db.appendLog("info", `Экспортирован XLSX зоны «${zone.name}» (точек: ${count}) → ${filePath}`);
  return { canceled: false, filePath, count };
}

// Сообщить renderer, что данные изменились (перерисовать вкладку + счётчики).
function notifyDataChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("data:changed");
  }
}

// Массовое «Скачать» выбранных зон в выбранную папку (geojson | xlsx).
async function exportManyToFolder(ids, format) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return { canceled: true };
  const fmt = format === "xlsx" ? "xlsx" : "geojson";

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Выберите папку для сохранения",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };

  const zones = list.map((id) => db.zones.get(id)).filter(Boolean);
  const { count } = writeZonesToFolder(filePaths[0], zones, fmt);
  if (fmt === "xlsx") zones.forEach((z) => db.zones.markXlsxGenerated(z.id));
  db.appendLog("info", `Массовый экспорт ${fmt.toUpperCase()}: ${count} зон → ${filePaths[0]}`);
  return { canceled: false, count, dir: filePaths[0] };
}

// Экспорт всех данных в структуру папок (Город/Город_geojson|_xlsx).
async function exportAllToFolders() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Выберите папку для экспорта всех данных",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };

  const exportData = db.data.exportAll();
  const res = writeAllToFolders(filePaths[0], exportData);
  db.appendLog("info", `Экспорт всех данных в папки: ${res.zones} зон, ${res.files} файлов → ${filePaths[0]}`);
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Экспорт завершён",
    message: `Экспортировано зон: ${res.zones}\nФайлов: ${res.files}\nПапка: ${filePaths[0]}`,
  });
  return { canceled: false, ...res };
}

// Сохранить резервную копию всех данных в один файл.
async function exportBackup() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Сохранить резервную копию",
    defaultPath: "geojson-zones-backup.json",
    filters: [{ name: "Резервная копия", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const snapshot = db.data.exportAll();
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  db.appendLog("info", `Сохранена резервная копия (${snapshot.zones.length} зон) → ${filePath}`);
  return { canceled: false, filePath };
}

// Загрузить резервную копию (merge) и уведомить renderer.
async function importBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Загрузить резервную копию",
    filters: [{ name: "Резервная копия", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePaths[0], "utf-8"));
  } catch (e) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Ошибка",
      message: "Файл не является корректным JSON.",
    });
    return { canceled: true, error: "parse" };
  }

  let res;
  try {
    res = db.data.importAll(parsed);
  } catch (e) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Ошибка",
      message: e && e.message ? e.message : String(e),
    });
    return { canceled: true, error: "import" };
  }

  notifyDataChanged();
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Загрузка завершена",
    message: `Добавлено городов: ${res.citiesAdded}\nДобавлено зон: ${res.zonesAdded}`,
  });
  return { canceled: false, ...res };
}

app.whenReady().then(() => {
  // Тестовый режим: изолированная БД во временной папке (не трогаем данные пользователя).
  if (process.env.GZ_TESTDIR) app.setPath("userData", process.env.GZ_TESTDIR);
  db.init(app.getPath("userData"));
  registerIpc();
  createWindow();

  // Верхнее меню (рус.): действия с данными выполняются здесь, в main-процессе.
  buildAppMenu({
    onExportFolders: () => exportAllToFolders(),
    onExportBackup: () => exportBackup(),
    onImportBackup: () => importBackup(),
    onHelp: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("menu:help");
    },
  });

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
