"use strict";

// Генерация XLSX из GeoJSON. Используется только в main-процессе (экспорт по
// диалогу). Логика портирована из исходного конвертера (processSingleFile):
// два столбца longitude/latitude, значения координат «как есть».

const XLSX = require("xlsx");
const { extractLonLat } = require("../shared/geojson");

// Порядок столбцов сохранён как в исходном инструменте (longitude, latitude).
// TODO(уточнить у пользователя): возможно нужен порядок широта/долгота.
const HEADER = ["longitude", "latitude"];

/**
 * @param {string|object} geojsonInput — текст GeoJSON или уже распарсенный объект
 * @param {object} [options] { removeClosingPoint?: boolean }
 * @returns {{ buffer: Buffer, count: number }}
 */
function geojsonToXlsxBuffer(geojsonInput, options) {
  const geojson =
    typeof geojsonInput === "string" ? JSON.parse(geojsonInput) : geojsonInput;
  const { points } = extractLonLat(geojson, {
    removeClosingPoint: options && options.removeClosingPoint,
  });

  const ws = XLSX.utils.json_to_sheet(points.length ? points : [], {
    header: HEADER,
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return { buffer, count: points.length };
}

module.exports = { geojsonToXlsxBuffer, HEADER };
