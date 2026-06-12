"use strict";

// Тест входимости точки в полигон (ray-casting). Чистый node:
// node test/geojson-pip.js
// ВАЖНО: координаты в порядке (lon, lat).

const assert = require("assert");
const { pointInRing, pointInPolygon, pointInGeojson } = require("../shared/geojson");

// 1) Квадрат-кольцо: внутри / снаружи / на пустом
{
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.strictEqual(pointInRing(5, 5, square), true, "центр внутри");
  assert.strictEqual(pointInRing(15, 5, square), false, "правее — снаружи");
  assert.strictEqual(pointInRing(-1, 5, square), false, "левее — снаружи");
  assert.strictEqual(pointInRing(5, 11, square), false, "выше — снаружи");
}

// 2) Polygon с дыркой: точка в дырке считается снаружи
{
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const rings = [outer, hole];
  assert.strictEqual(pointInPolygon(1, 1, rings), true, "у края — внутри");
  assert.strictEqual(pointInPolygon(5, 5, rings), false, "в дырке — снаружи");
  assert.strictEqual(pointInPolygon(20, 20, rings), false, "далеко — снаружи");
}

// 3) Polygon как GeoJSON
{
  const gj = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  assert.strictEqual(pointInGeojson(5, 5, gj), true, "Polygon: внутри");
  assert.strictEqual(pointInGeojson(50, 50, gj), false, "Polygon: снаружи");
}

// 4) MultiPolygon: внутри одной из частей
{
  const gj = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
    ],
  };
  assert.strictEqual(pointInGeojson(11, 11, gj), true, "во второй части — внутри");
  assert.strictEqual(pointInGeojson(0.5, 0.5, gj), true, "в первой части — внутри");
  assert.strictEqual(pointInGeojson(5, 5, gj), false, "между частями — снаружи");
}

// 5) Feature / FeatureCollection
{
  const poly = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  const feat = { type: "Feature", geometry: poly, properties: {} };
  const fc = { type: "FeatureCollection", features: [feat] };
  assert.strictEqual(pointInGeojson(5, 5, feat), true, "Feature: внутри");
  assert.strictEqual(pointInGeojson(5, 5, fc), true, "FeatureCollection: внутри");
}

// 6) Порядок lon/lat: реальная точка Москвы внутри квадрата вокруг неё,
//    а «перевёрнутая» (lat,lon) — снаружи.
{
  const around = [[37.0, 55.0], [38.0, 55.0], [38.0, 56.0], [37.0, 56.0], [37.0, 55.0]];
  const gj = { type: "Polygon", coordinates: [around] };
  assert.strictEqual(pointInGeojson(37.6, 55.75, gj), true, "правильный порядок (lon,lat) — внутри");
  assert.strictEqual(pointInGeojson(55.75, 37.6, gj), false, "перепутанный порядок — снаружи");
}

// 7) Не-полигональные геометрии не дают площади
{
  assert.strictEqual(pointInGeojson(1, 1, { type: "Point", coordinates: [1, 1] }), false, "Point — нет площади");
  assert.strictEqual(pointInGeojson(0, 0, { type: "LineString", coordinates: [[0, 0], [1, 1]] }), false, "LineString — нет площади");
}

console.log("GEOJSON PIP OK ✔");
