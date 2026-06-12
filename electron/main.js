"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const selftest = require("./selftest");
const { geojsonToXlsxBuffer } = require("./xlsx-export");
const { buildAppMenu } = require("./menu");
const { writeAllToFolders, writeZonesToFolder, sanitizeName } = require("./export-folders");
const { buildEml } = require("./bug-report");
const { isNewer, parseLatest } = require("./version-check");
const { parseNominatim, buildSearchUrl } = require("./geocode");
const ghSync = require("./github-sync");

// Точка входа главного процесса Electron.
// IPC-обработчики (cities/zones/log) регистрируются в registerIpc().

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "polygons",
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
  handle("zones:allForCheck", () => db.zones.allWithGeojson());
  handle("zones:create", (payload) => db.zones.create(payload));
  handle("zones:findByName", (name) => db.zones.findByName(name));
  handle("zones:updateGeojson", (id, payload) => db.zones.updateGeojson(id, payload));
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

  // Система / обратная связь
  handle("system:openExternal", (url) => openExternal(url));
  handle("system:geocode", (query) => geocodeAddress(query));
  handle("system:saveToDownloads", (filename, content) => saveToDownloads(filename, content));
  handle("system:pickAttachment", () => pickAttachment());
  handle("system:sendBugReport", (payload) => sendBugReport(payload));

  // Синхронизация данных с GitHub (вкладка «Обновление данных», v0.9.0)
  handle("sync:getToken", () => ({ token: getSyncToken() }));
  handle("sync:setToken", (token) => setSyncToken(token));
  handle("sync:ping", () => pingGithub());
  handle("sync:check", () => checkDataSync());
  handle("sync:push", () => pushData());
  handle("sync:pull", () => pullData());
}

// Открыть внешнюю ссылку (только http/https/mailto).
async function openExternal(url) {
  const u = String(url || "");
  if (!/^(https?:|mailto:)/i.test(u)) throw new Error("Недопустимая ссылка");
  await shell.openExternal(u);
  return { ok: true };
}

// Сохранить текстовый файл в системную папку «Загрузки» (коллизии → " (2)").
function saveToDownloads(filename, content) {
  const dir = app.getPath("downloads");
  let base = sanitizeName(String(filename || "polygon").replace(/\.geojson$/i, ""));
  if (!base) base = "polygon";
  let target = path.join(dir, base + ".geojson");
  let n = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${n}).geojson`);
    n++;
  }
  fs.writeFileSync(target, String(content == null ? "" : content), "utf-8");
  db.appendLog("info", `Полигон сохранён в Загрузки → ${target}`);
  return { path: target };
}

// Выбрать файл-вложение для письма об ошибке.
async function pickAttachment() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Выберите файл для вложения",
    properties: ["openFile"],
  });
  if (canceled || !filePaths || !filePaths.length) return null;
  const p = filePaths[0];
  let size = 0;
  try { size = fs.statSync(p).size; } catch (_) { /* ignore */ }
  return { path: p, name: path.basename(p), size };
}

// Сформировать .eml (тема/текст/вложение) и открыть его в почтовом клиенте.
async function sendBugReport(payload) {
  const p = payload || {};
  let attachment = null;
  if (p.attachmentPath) {
    const buf = fs.readFileSync(p.attachmentPath);
    attachment = { filename: path.basename(p.attachmentPath), content: buf, mime: "application/octet-stream" };
  }
  const eml = buildEml({
    to: "nikitgolubev@gmail.com",
    subject: p.subject || "Сообщение об ошибке (polygons)",
    body: p.body || "",
    attachment,
  });
  const file = path.join(app.getPath("temp"), "polygons-bug-" + Date.now() + ".eml");
  fs.writeFileSync(file, eml);
  await shell.openPath(file);
  db.appendLog("info", "Подготовлено письмо об ошибке → " + file);
  return { ok: true, file };
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

// Геокодинг адреса через OSM Nominatim (из main, чтобы не ослаблять CSP renderer).
async function geocodeAddress(query) {
  const q = String(query == null ? "" : query).trim();
  if (q.length < 3) return [];
  const https = require("https");
  const url = buildSearchUrl(q);
  let json = "";
  await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "polygons (geojson-zones)" } }, (res) => {
      res.on("data", (chunk) => { json += chunk; });
      res.on("end", resolve);
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Таймаут запроса к геокодеру")));
  });
  return parseNominatim(json);
}

// Авто-бэкап данных (города+зоны) в папку «Загрузки» перед обновлением.
function backupToDownloads() {
  const snapshot = db.data.exportAll();
  const dir = app.getPath("downloads");
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let target = path.join(dir, `polygons-backup-${stamp}.json`);
  let n = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `polygons-backup-${stamp} (${n}).json`);
    n++;
  }
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), "utf-8");
  db.appendLog("info", `Авто-бэкап перед обновлением (${snapshot.zones.length} зон) → ${target}`);
  return { path: target, zones: snapshot.zones.length, cities: snapshot.cities.length };
}

async function checkForUpdates() {
  const https = require("https");
  const currentVersion = app.getVersion();
  const url = "https://api.github.com/repos/Nikitgolubev/geojson-to-xlsx/releases/latest";
  let json = "";
  try {
    await new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "geojson-zones-app" } }, (res) => {
        res.on("data", (chunk) => { json += chunk; });
        res.on("end", resolve);
        res.on("error", reject);
      }).on("error", reject);
    });
    const release = parseLatest(json);
    if (isNewer(release.tag, currentVersion)) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Доступно обновление",
        message: `Найдена новая версия: ${release.tag}`,
        detail: `Текущая версия: v${currentVersion}\nОткрыть страницу загрузки?`,
        buttons: ["Открыть страницу загрузки", "Позже"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        // Перед обновлением сохраняем резервную копию данных в «Загрузки».
        let backupNote = "";
        try {
          const b = backupToDownloads();
          backupNote = `Резервная копия данных сохранена в «Загрузки»:\n${b.path}\n(городов: ${b.cities}, зон: ${b.zones})`;
        } catch (e) {
          backupNote = `Не удалось создать резервную копию: ${e && e.message ? e.message : e}`;
        }
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Резервная копия",
          message: backupNote,
          buttons: ["Перейти к загрузке"],
        });
        await shell.openExternal(release.htmlUrl);
      }
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Обновлений нет",
        message: `Версия актуальна (v${currentVersion})`,
        buttons: ["OK"],
      });
    }
  } catch (err) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Ошибка проверки обновлений",
      message: "Не удалось получить информацию об обновлениях",
      detail: String(err.message || err),
      buttons: ["OK"],
    });
  }
}

// ===== Синхронизация данных с GitHub (v0.9.0) =====
const GH_OWNER_REPO = "Nikitgolubev/geojson-to-xlsx";
const GH_BRANCH = "main";
const GH_DIR = "backups";

function tokenFile() { return path.join(app.getPath("userData"), "github-token.json"); }
function getSyncToken() {
  try { return JSON.parse(fs.readFileSync(tokenFile(), "utf-8")).token || ""; }
  catch (_) { return ""; }
}
function setSyncToken(token) {
  fs.writeFileSync(tokenFile(), JSON.stringify({ token: String(token || "").trim() }), "utf-8");
  return { ok: true };
}
function syncStateFile() { return path.join(app.getPath("userData"), "sync-state.json"); }
function getSyncState() {
  try { return JSON.parse(fs.readFileSync(syncStateFile(), "utf-8")); }
  catch (_) { return null; }
}
function setSyncState(state) {
  fs.writeFileSync(syncStateFile(), JSON.stringify(state), "utf-8");
}

function emitSyncProgress(percent, text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sync:progress", { percent, text });
  }
}

// Низкоуровневый HTTPS-запрос к GitHub API. Возвращает {status, json, raw}.
function ghRequest(method, urlPath, { token, body } = {}) {
  const https = require("https");
  const headers = {
    "User-Agent": "polygons (geojson-zones)",
    "Accept": "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = "token " + token;
  let payload = null;
  if (body != null) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method, hostname: "api.github.com", path: urlPath, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch (_) {}
          resolve({ status: res.statusCode, json, raw: data });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Таймаут запроса к GitHub")));
    if (payload) req.write(payload);
    req.end();
  });
}

// Проверка доступности репозитория и ПРАВА ЗАПИСИ с текущим токеном (для «лампочки»).
// GitHub в ответе /repos отдаёт permissions.push = true, если токен может писать.
async function pingGithub() {
  const token = getSyncToken();
  try {
    const res = await ghRequest("GET", `/repos/${GH_OWNER_REPO}`, { token });
    const ok = res.status === 200;
    const perms = res.json && res.json.permissions ? res.json.permissions : null;
    const canWrite = !!(perms && perms.push);
    return { ok, status: res.status, hasToken: !!token, canWrite };
  } catch (err) {
    return { ok: false, status: 0, hasToken: !!token, canWrite: false, error: String(err.message || err) };
  }
}

// Получить файл из backups/ → {content(parsed JSON|null), sha|null, exists}.
async function ghGetFile(name) {
  const token = getSyncToken();
  const res = await ghRequest("GET", `/repos/${GH_OWNER_REPO}/contents/${GH_DIR}/${name}?ref=${GH_BRANCH}`, { token });
  if (res.status === 404) return { exists: false, content: null, sha: null };
  if (res.status !== 200 || !res.json) throw new Error(`GitHub ${res.status} при чтении ${name}`);
  const decoded = Buffer.from(res.json.content || "", "base64").toString("utf-8");
  let content = null;
  try { content = JSON.parse(decoded); } catch (_) {}
  return { exists: true, content, sha: res.json.sha };
}

// Записать (создать/обновить) файл в backups/ через Contents API (нужен токен).
async function ghPutFile(name, obj, sha, message) {
  const token = getSyncToken();
  if (!token) throw new Error("Не задан токен GitHub");
  const body = {
    message: message || `data: update ${name}`,
    content: Buffer.from(JSON.stringify(obj, null, 2), "utf-8").toString("base64"),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await ghRequest("PUT", `/repos/${GH_OWNER_REPO}/contents/${GH_DIR}/${name}`, { token, body });
  if (res.status !== 200 && res.status !== 201) {
    const msg = res.json && res.json.message ? res.json.message : res.status;
    // 403/404 при записи → почти всегда нехватка прав токена.
    if (res.status === 403 || res.status === 404) {
      throw new Error(
        `Нет прав на запись (${res.status}). У токена должно быть Contents: Read and write ` +
        `на репозиторий geojson-to-xlsx (для классического токена — scope «repo»). ` +
        `Пересоздайте токен с этими правами. Ответ GitHub: ${msg}`
      );
    }
    throw new Error(`GitHub отклонил запись ${name}: ${msg}`);
  }
  return res.json;
}

// Проверка актуальности локальных данных относительно хранилища.
async function checkDataSync() {
  const snapshot = db.data.exportAll();
  const localHash = ghSync.computeHash(snapshot);
  let manifest = null;
  try {
    const m = await ghGetFile("manifest.json");
    manifest = m.content;
  } catch (err) {
    return { ok: false, error: String(err.message || err), localHash };
  }
  const remoteHash = manifest ? manifest.dataHash : null;
  const verdict = ghSync.decideVerdict(localHash, remoteHash, getSyncState());
  return {
    ok: true,
    verdict,
    localCounts: { cities: snapshot.cities.length, zones: snapshot.zones.length },
    remote: manifest ? { version: manifest.version, savedAt: manifest.savedAt, counts: manifest.counts } : null,
  };
}

// Отправить данные в хранилище (push). Требует токен.
async function pushData() {
  if (!getSyncToken()) throw new Error("Сначала сохраните токен GitHub");
  emitSyncProgress(5, "Подготовка данных…");
  const snapshot = db.data.exportAll();
  const hash = ghSync.computeHash(snapshot);
  const savedAt = new Date().toISOString();

  emitSyncProgress(20, "Чтение текущей версии в хранилище…");
  const curManifest = await ghGetFile("manifest.json");
  const curLatest = await ghGetFile("latest.json");
  const version = ghSync.nextVersion(curManifest.content ? curManifest.content.version : 0);

  const fullSnapshot = Object.assign({}, snapshot, { syncVersion: version, savedAt, dataHash: hash });
  emitSyncProgress(50, "Загрузка latest.json…");
  await ghPutFile("latest.json", fullSnapshot, curLatest.sha, `data: snapshot v${version} (${savedAt})`);

  const manifest = ghSync.buildManifest({ version, savedAt, hash, cities: snapshot.cities, zones: snapshot.zones });
  emitSyncProgress(80, "Загрузка manifest.json…");
  await ghPutFile("manifest.json", manifest, curManifest.sha, `data: manifest v${version}`);

  setSyncState({ version, savedAt, hash });
  emitSyncProgress(100, "Готово");
  db.appendLog("info", `Данные отправлены в хранилище: версия ${version} (${snapshot.zones.length} зон)`);
  return { ok: true, version, savedAt, counts: { cities: snapshot.cities.length, zones: snapshot.zones.length } };
}

// Получить данные из хранилища (pull) — ПОЛНАЯ ЗАМЕНА локальных. Перед этим — бэкап.
async function pullData() {
  emitSyncProgress(5, "Резервная копия текущих данных…");
  try { backupToDownloads(); } catch (_) {}

  emitSyncProgress(25, "Скачивание latest.json…");
  const latest = await ghGetFile("latest.json");
  if (!latest.exists || !latest.content) throw new Error("В хранилище нет данных (latest.json)");
  const payload = latest.content;

  emitSyncProgress(60, "Применение данных (замена)…");
  const res = db.data.replaceAll(payload);

  // Обновляем локальное состояние синка из манифеста (если есть).
  try {
    const m = await ghGetFile("manifest.json");
    if (m.content) setSyncState({ version: m.content.version, savedAt: m.content.savedAt, hash: m.content.dataHash });
  } catch (_) {}

  notifyDataChanged();
  emitSyncProgress(100, "Готово");
  db.appendLog("info", `Данные получены из хранилища (замена): ${res.citiesAdded} городов, ${res.zonesAdded} зон`);
  return { ok: true, counts: { cities: res.citiesAdded, zones: res.zonesAdded } };
}

app.whenReady().then(() => {
  // Тестовый режим: изолированная БД во временной папке (не трогаем данные пользователя).
  if (process.env.GZ_TESTDIR) {
    app.setPath("userData", process.env.GZ_TESTDIR);
  } else {
    // Имя приложения сменилось на «polygons», но папку данных закрепляем за прежним
    // именем, чтобы города/зоны существующих пользователей не «потерялись».
    app.setPath("userData", path.join(app.getPath("appData"), "GeoJSON Zones"));
  }
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
    onSetTheme: (v) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("menu:set-theme", v);
    },
    onFeedback: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("menu:feedback");
    },
    onBug: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("menu:bug");
    },
    onCheckUpdate: () => checkForUpdates(),
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
