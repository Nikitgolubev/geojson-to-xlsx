"use strict";

// Экспорт всех данных в структуру папок на диске. Чистый модуль (без диалогов) —
// тестируется напрямую. main.js спрашивает папку и вызывает writeAllToFolders().
//
// Структура:
//   <root>/<Город>/<Город>_geojson/<Зона>.geojson
//   <root>/<Город>/<Город>_xlsx/<Зона>.xlsx
//   <root>/Без города/Без города_geojson|_xlsx/<Зона>.*

const fs = require("fs");
const path = require("path");
const { geojsonToXlsxBuffer } = require("./xlsx-export");

const UNASSIGNED = "Без города";

// Недопустимые в Windows символы имени файла/папки (пробелы и дефисы сохраняем).
const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;
// Управляющие символы 0x00–0x1f.
const CONTROL_CHARS = new RegExp("[\\x00-\\x1f]", "g");

// Заменяем недопустимые символы на «_» и подчищаем края.
function sanitizeName(name) {
  let s = String(name == null ? "" : name)
    .replace(ILLEGAL_CHARS, "_")
    .replace(CONTROL_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // Windows не любит точки/пробелы в конце
  return s || "_";
}

// Уникальное имя файла в пределах папки: «имя.ext», «имя (2).ext», …
function uniqueFileName(usedSet, base, ext) {
  let candidate = `${base}${ext}`;
  let i = 2;
  while (usedSet.has(candidate.toLowerCase())) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  usedSet.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param {string} rootDir — выбранная пользователем папка
 * @param {object} exportData — результат db.data.exportAll() (cities + zones с geojson)
 * @returns {{groups:number, zones:number, files:number}}
 */
function writeAllToFolders(rootDir, exportData) {
  const cities = (exportData && exportData.cities) || [];
  const zones = (exportData && exportData.zones) || [];

  // Группируем зоны по имени города (или «Без города»).
  const byGroup = new Map();
  function ensureGroup(name) {
    if (!byGroup.has(name)) byGroup.set(name, []);
    return byGroup.get(name);
  }
  // Папки для всех городов — даже без зон.
  for (const c of cities) ensureGroup(c.name);
  let hasUnassigned = false;
  for (const z of zones) {
    if (z.cityName == null) {
      hasUnassigned = true;
      ensureGroup(UNASSIGNED).push(z);
    } else {
      ensureGroup(z.cityName).push(z);
    }
  }
  if (!hasUnassigned) byGroup.delete(UNASSIGNED); // не плодим пустую «Без города»

  let filesWritten = 0;
  let zonesWritten = 0;

  for (const [groupName, groupZones] of byGroup) {
    const safeGroup = sanitizeName(groupName);
    const geojsonDir = path.join(rootDir, safeGroup, `${safeGroup}_geojson`);
    const xlsxDir = path.join(rootDir, safeGroup, `${safeGroup}_xlsx`);
    fs.mkdirSync(geojsonDir, { recursive: true });
    fs.mkdirSync(xlsxDir, { recursive: true });

    const usedGeo = new Set();
    const usedXlsx = new Set();

    for (const z of groupZones) {
      const base = sanitizeName(z.name);

      const geoName = uniqueFileName(usedGeo, base, ".geojson");
      fs.writeFileSync(path.join(geojsonDir, geoName), z.geojson, "utf-8");
      filesWritten++;

      const xlsxName = uniqueFileName(usedXlsx, base, ".xlsx");
      const { buffer } = geojsonToXlsxBuffer(z.geojson);
      fs.writeFileSync(path.join(xlsxDir, xlsxName), buffer);
      filesWritten++;

      zonesWritten++;
    }
  }

  return { groups: byGroup.size, zones: zonesWritten, files: filesWritten };
}

/**
 * Записать набор зон в одну папку в выбранном формате (для массового «Скачать»).
 * @param {string} dir
 * @param {Array<{name:string, geojson:string}>} zones
 * @param {"geojson"|"xlsx"} format
 * @returns {{count:number}}
 */
function writeZonesToFolder(dir, zones, format) {
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set();
  let count = 0;
  for (const z of zones || []) {
    const base = sanitizeName(z.name);
    if (format === "xlsx") {
      const name = uniqueFileName(used, base, ".xlsx");
      const { buffer } = geojsonToXlsxBuffer(z.geojson);
      fs.writeFileSync(path.join(dir, name), buffer);
    } else {
      const name = uniqueFileName(used, base, ".geojson");
      fs.writeFileSync(path.join(dir, name), z.geojson, "utf-8");
    }
    count++;
  }
  return { count };
}

module.exports = { writeAllToFolders, writeZonesToFolder, sanitizeName, UNASSIGNED };
