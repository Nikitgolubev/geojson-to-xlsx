"use strict";

// Тест построения GeoJSON-полигона из вершин. Чистый node:
// node test/polygon-build.js

const assert = require("assert");
const { buildPolygonGeojson, parseAndExtract, pointInGeojson } = require("../shared/geojson");
const { geojsonToXlsxBuffer } = require("../electron/xlsx-export");

// 1) Базовый: 4 вершины {lat,lng} → валидный FeatureCollection/Polygon, кольцо замкнуто
{
  const pts = [
    { lat: 55.6, lng: 37.4 },
    { lat: 55.6, lng: 37.8 },
    { lat: 55.9, lng: 37.8 },
    { lat: 55.9, lng: 37.4 },
  ];
  const gj = buildPolygonGeojson(pts, "Тест");
  assert.strictEqual(gj.type, "FeatureCollection");
  assert.strictEqual(gj.features.length, 1);
  const geom = gj.features[0].geometry;
  assert.strictEqual(geom.type, "Polygon");
  const ring = geom.coordinates[0];
  assert.strictEqual(ring.length, 5, "4 вершины + замыкающая = 5");
  assert.deepStrictEqual(ring[0], ring[ring.length - 1], "кольцо замкнуто");
  assert.deepStrictEqual(ring[0], [37.4, 55.6], "формат [lng,lat]");
  assert.strictEqual(gj.features[0].properties.name, "Тест");
}

// 2) Пригодность к XLSX (блок «Зоны»): geojsonToXlsxBuffer считает точки
{
  const pts = [[37.4, 55.6], [37.8, 55.6], [37.8, 55.9]];
  const gj = buildPolygonGeojson(pts, "P");
  const text = JSON.stringify(gj);
  const cnt = parseAndExtract(text).count;
  assert.ok(cnt >= 4, "точек (с замыкающей) >= 4, получено " + cnt);
  const { buffer, count } = geojsonToXlsxBuffer(gj);
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0, "XLSX-буфер не пуст");
  assert.strictEqual(count, cnt, "XLSX-счётчик совпадает");
}

// 3) Входимость точки в построенный полигон (контроль порядка координат)
{
  const pts = [{ lat: 55.6, lng: 37.4 }, { lat: 55.6, lng: 37.8 }, { lat: 55.9, lng: 37.8 }, { lat: 55.9, lng: 37.4 }];
  const gj = buildPolygonGeojson(pts, "M");
  assert.strictEqual(pointInGeojson(37.6, 55.75, gj), true, "центр внутри");
  assert.strictEqual(pointInGeojson(30.0, 59.9, gj), false, "далеко — снаружи");
}

console.log("POLYGON BUILD OK ✔");
