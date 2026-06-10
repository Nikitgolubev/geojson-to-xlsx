"use strict";

// Слой данных. ЕДИНСТВЕННОЕ место, знающее про SQL.
// UI обращается сюда только через IPC (window.api → main.js → db).

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

let db = null;

/**
 * Инициализация БД. Вызывается из main.js после app.whenReady().
 * @param {string} userDataDir — app.getPath('userData') (кроссплатформенно)
 */
function init(userDataDir) {
  if (db) return db;

  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "zones.db");

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      geojson TEXT NOT NULL,
      point_count INTEGER,
      source_filename TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      geojson_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      xlsx_generated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_zones_city ON zones(city_id);
  `);

  return db;
}

// --- внутренний логгер действий ---
function appendLog(level, message) {
  db.prepare("INSERT INTO action_log (level, message) VALUES (?, ?)").run(
    String(level || "info"),
    String(message == null ? "" : message)
  );
}

// ---------- Города ----------
const cities = {
  list() {
    return db
      .prepare(
        `SELECT c.id, c.name, c.created_at,
                (SELECT COUNT(*) FROM zones z WHERE z.city_id = c.id) AS zone_count
         FROM cities c
         ORDER BY c.name COLLATE NOCASE`
      )
      .all();
  },

  create(name) {
    const clean = String(name == null ? "" : name).trim();
    if (!clean) throw new Error("Имя города не может быть пустым");
    const info = db
      .prepare("INSERT INTO cities (name) VALUES (?)")
      .run(clean);
    appendLog("info", `Создан город «${clean}»`);
    return cities.get(info.lastInsertRowid);
  },

  get(id) {
    return db.prepare("SELECT id, name, created_at FROM cities WHERE id = ?").get(id);
  },

  rename(id, name) {
    const clean = String(name == null ? "" : name).trim();
    if (!clean) throw new Error("Имя города не может быть пустым");
    const before = cities.get(id);
    if (!before) throw new Error("Город не найден");
    // Переименование меняет ТОЛЬКО имя города; зоны и их файлы не трогаются.
    db.prepare("UPDATE cities SET name = ? WHERE id = ?").run(clean, id);
    appendLog("info", `Город переименован: «${before.name}» → «${clean}»`);
    return cities.get(id);
  },

  delete(id) {
    const before = cities.get(id);
    if (!before) throw new Error("Город не найден");
    // ON DELETE SET NULL: зоны не удаляются, а открепляются (city_id → NULL).
    const detached = db
      .prepare("SELECT COUNT(*) AS n FROM zones WHERE city_id = ?")
      .get(id).n;
    db.prepare("DELETE FROM cities WHERE id = ?").run(id);
    appendLog(
      "warn",
      `Удалён город «${before.name}». Откреплено зон: ${detached} (перешли в «не выбран город»).`
    );
    return { detached };
  },
};

// ---------- Зоны ----------
const ZONE_COLS = `id, city_id, name, point_count, source_filename,
                   created_at, geojson_updated_at, xlsx_generated_at`;

const zones = {
  // Списки без тяжёлого поля geojson — оно тянется отдельно через get().
  listByCity(cityId) {
    return db
      .prepare(
        `SELECT ${ZONE_COLS} FROM zones WHERE city_id = ?
         ORDER BY name COLLATE NOCASE`
      )
      .all(cityId);
  },

  listUnassigned() {
    return db
      .prepare(
        `SELECT ${ZONE_COLS} FROM zones WHERE city_id IS NULL
         ORDER BY created_at DESC`
      )
      .all();
  },

  // Полная запись вместе с geojson (для экспорта/карты).
  get(id) {
    return db
      .prepare(`SELECT ${ZONE_COLS}, geojson FROM zones WHERE id = ?`)
      .get(id);
  },

  /**
   * Создать зону. geojson хранится как есть (источник истины).
   * @param {{name:string, geojson:string, cityId?:number|null,
   *          pointCount?:number|null, sourceFilename?:string|null}} payload
   */
  create(payload) {
    const p = payload || {};
    const name = String(p.name == null ? "" : p.name).trim();
    if (!name) throw new Error("Имя зоны не может быть пустым");
    if (typeof p.geojson !== "string" || !p.geojson.length) {
      throw new Error("Пустое содержимое GeoJSON");
    }
    const info = db
      .prepare(
        `INSERT INTO zones (city_id, name, geojson, point_count, source_filename)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        p.cityId == null ? null : p.cityId,
        name,
        p.geojson,
        p.pointCount == null ? null : p.pointCount,
        p.sourceFilename == null ? null : p.sourceFilename
      );
    const where = p.cityId == null ? "без города" : `город #${p.cityId}`;
    appendLog("info", `Добавлена зона «${name}» (${where}), точек: ${p.pointCount ?? "?"}`);
    return zones.get(info.lastInsertRowid);
  },

  rename(id, name) {
    const clean = String(name == null ? "" : name).trim();
    if (!clean) throw new Error("Имя зоны не может быть пустым");
    const before = zones.get(id);
    if (!before) throw new Error("Зона не найдена");
    // Меняем ТОЛЬКО имя. geojson, source_filename и даты содержимого не трогаем.
    db.prepare("UPDATE zones SET name = ? WHERE id = ?").run(clean, id);
    appendLog("info", `Зона переименована: «${before.name}» → «${clean}»`);
    return zones.get(id);
  },

  // Назначить/сменить город (cityId = null — открепить).
  assignCity(id, cityId) {
    const before = zones.get(id);
    if (!before) throw new Error("Зона не найдена");
    if (cityId != null && !cities.get(cityId)) throw new Error("Город не найден");
    db.prepare("UPDATE zones SET city_id = ? WHERE id = ?").run(
      cityId == null ? null : cityId,
      id
    );
    appendLog(
      "info",
      cityId == null
        ? `Зона «${before.name}» откреплена от города`
        : `Зоне «${before.name}» назначен город #${cityId}`
    );
    return zones.get(id);
  },

  // move — синоним assignCity (для совместимости с API).
  move(id, newCityId) {
    return zones.assignCity(id, newCityId);
  },

  delete(id) {
    const before = zones.get(id);
    if (!before) throw new Error("Зона не найдена");
    db.prepare("DELETE FROM zones WHERE id = ?").run(id);
    appendLog("warn", `Удалена зона «${before.name}»`);
    return { ok: true };
  },

  // Отметить факт генерации XLSX (вызывается из обработчика экспорта).
  markXlsxGenerated(id) {
    db.prepare("UPDATE zones SET xlsx_generated_at = datetime('now') WHERE id = ?").run(id);
    return zones.get(id);
  },
};

// ---------- Журнал действий ----------
const log = {
  list(limit) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
    return db
      .prepare("SELECT id, ts, level, message FROM action_log ORDER BY id DESC LIMIT ?")
      .all(n);
  },
  append(level, message) {
    appendLog(level, message);
    return { ok: true };
  },
  clear() {
    db.prepare("DELETE FROM action_log").run();
    appendLog("info", "Журнал действий очищен");
    return { ok: true };
  },
};

module.exports = { init, cities, zones, log, appendLog };
