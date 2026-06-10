"use strict";

// Смоук-тест разбора GeoJSON и генерации XLSX. Чистый JS — запускается обычным
// node (без Electron): node test/geojson-smoke.js

const assert = require("assert");
const XLSX = require("xlsx");
const { extractLonLat, parseAndExtract } = require("../shared/geojson");
const { geojsonToXlsxBuffer, HEADER } = require("../electron/xlsx-export");

// 1) Point
{
  const gj = { type: "Point", coordinates: [37.6, 55.7] };
  const { points } = extractLonLat(gj, {});
  assert.strictEqual(points.length, 1, "Point → 1 точка");
  assert.strictEqual(points[0].longitude, 37.6);
  assert.strictEqual(points[0].latitude, 55.7);
}

// 2) Polygon с замыкающей точкой: removeClosingPoint убирает последнюю
{
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const gj = { type: "Polygon", coordinates: [ring] };
  const withClose = extractLonLat(gj, { removeClosingPoint: false }).points;
  const noClose = extractLonLat(gj, { removeClosingPoint: true }).points;
  assert.strictEqual(withClose.length, 4, "без удаления — 4 точки");
  assert.strictEqual(noClose.length, 3, "с удалением замыкающей — 3 точки");
}

// 3) FeatureCollection с разными геометриями
{
  const gj = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} },
      { type: "Feature", geometry: { type: "LineString", coordinates: [[3, 4], [5, 6]] }, properties: {} },
      { type: "Feature", geometry: { type: "MultiPoint", coordinates: [[7, 8]] }, properties: {} },
    ],
  };
  const { points } = extractLonLat(gj, {});
  assert.strictEqual(points.length, 4, "FeatureCollection → 1+2+1 = 4 точки");
}

// 4) Предупреждения о битых координатах
{
  const gj = { type: "MultiPoint", coordinates: [[1, 2], ["x", 3], [4]] };
  const { points, warnings } = parseAndExtract(JSON.stringify(gj), {});
  assert.strictEqual(points.length, 1, "только валидная точка проходит");
  assert.ok(warnings.length >= 2, "есть предупреждения о битых точках");
}

// 5) Генерация XLSX и обратное чтение
{
  const gj = { type: "Polygon", coordinates: [[[10, 20], [30, 40], [50, 60], [10, 20]]] };
  const { buffer, count } = geojsonToXlsxBuffer(gj, { removeClosingPoint: true });
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0, "буфер XLSX не пустой");
  assert.strictEqual(count, 3, "после удаления замыкающей — 3 точки");

  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  assert.strictEqual(rows.length, 3, "в листе 3 строки данных");
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), HEADER.slice().sort(), "заголовки longitude/latitude");
  assert.strictEqual(rows[0].longitude, 10);
  assert.strictEqual(rows[0].latitude, 20);
}

console.log("GEOJSON+XLSX SMOKE OK ✔");
