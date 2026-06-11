"use strict";

// Смоук-тест экспорта в папки. Чистый node: node test/export-folders-smoke.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { writeAllToFolders, writeZonesToFolder, sanitizeName } = require("../electron/export-folders");

const POLY = JSON.stringify({ type: "Polygon", coordinates: [[[37.6, 55.7], [37.7, 55.7], [37.7, 55.8], [37.6, 55.7]]] });
const POINT = JSON.stringify({ type: "Point", coordinates: [30.3, 59.9] });

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gz-folders-"));

  const exportData = {
    app: "geojson-zones",
    version: 2,
    cities: [{ name: "Москва" }, { name: "Санкт-Петербург" }],
    zones: [
      { name: "Зона 1", cityName: "Москва", geojson: POLY },
      { name: "Зона 1", cityName: "Москва", geojson: POLY }, // дубль имени → коллизия
      { name: "Невская", cityName: null, geojson: POINT }, // без города
    ],
  };

  const res = writeAllToFolders(tmp, exportData);
  assert.strictEqual(res.zones, 3, "записано 3 зоны");
  assert.strictEqual(res.files, 6, "записано 6 файлов (geojson+xlsx на зону)");

  // Структура Москвы
  const mGeo = path.join(tmp, "Москва", "Москва_geojson");
  const mXlsx = path.join(tmp, "Москва", "Москва_xlsx");
  assert.ok(fs.existsSync(path.join(mGeo, "Зона 1.geojson")), "Москва/Зона 1.geojson");
  assert.ok(fs.existsSync(path.join(mGeo, "Зона 1 (2).geojson")), "коллизия имени → (2)");
  assert.ok(fs.existsSync(path.join(mXlsx, "Зона 1.xlsx")), "Москва/Зона 1.xlsx");

  // Пустой город — папки созданы
  assert.ok(fs.existsSync(path.join(tmp, "Санкт-Петербург", "Санкт-Петербург_geojson")), "пустой город: папка geojson");
  assert.ok(fs.existsSync(path.join(tmp, "Санкт-Петербург", "Санкт-Петербург_xlsx")), "пустой город: папка xlsx");

  // Без города
  assert.ok(fs.existsSync(path.join(tmp, "Без города", "Без города_geojson", "Невская.geojson")), "Без города/Невская.geojson");

  // Содержимое geojson — байт-в-байт исходное
  assert.strictEqual(fs.readFileSync(path.join(mGeo, "Зона 1.geojson"), "utf-8"), POLY, "geojson не изменён");

  // writeZonesToFolder (массовое скачивание)
  const dir = path.join(tmp, "bulk");
  const r2 = writeZonesToFolder(dir, [{ name: "A", geojson: POLY }, { name: "A", geojson: POINT }], "geojson");
  assert.strictEqual(r2.count, 2, "массовая запись 2 файлов");
  assert.ok(fs.existsSync(path.join(dir, "A.geojson")) && fs.existsSync(path.join(dir, "A (2).geojson")), "коллизия в bulk");

  // sanitizeName сохраняет пробелы/дефисы
  assert.strictEqual(sanitizeName("Санкт-Петербург"), "Санкт-Петербург");
  assert.strictEqual(sanitizeName("Без города"), "Без города");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("EXPORT-FOLDERS SMOKE OK ✔");
}

try {
  main();
} catch (err) {
  console.error("EXPORT-FOLDERS SMOKE FAILED ✗:", err && err.message ? err.message : err);
  process.exit(1);
}
