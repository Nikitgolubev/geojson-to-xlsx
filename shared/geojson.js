/**
 * Разбор GeoJSON → массив точек {longitude, latitude}.
 *
 * Перенос проверенной логики из исходного конвертера (geojson to xlxs2.html).
 * Глобальный log() заменён на колбэк onWarn(message) — модуль чистый (без DOM),
 * поэтому работает и в main-процессе (require), и в renderer (<script> → window).
 *
 * ВАЖНО: координаты берутся «как есть», без округления/форматирования.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(); // CommonJS (main-процесс Electron)
  } else {
    root.GeoJSONLib = factory(); // браузер/renderer → window.GeoJSONLib
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function makePointPusher(points, contextLabel, warn) {
    return function addPoint(coord) {
      if (!Array.isArray(coord)) {
        warn(`Пропуск не-массива координат (${contextLabel}).`);
        return;
      }
      if (coord.length < 2) {
        warn(`Пропуск точки с длиной массива < 2 (${JSON.stringify(coord)}) в ${contextLabel}.`);
        return;
      }
      const lonRaw = coord[0];
      const latRaw = coord[1];
      const lonNum = Number(lonRaw);
      const latNum = Number(latRaw);
      if (!Number.isFinite(lonNum) || !Number.isFinite(latNum)) {
        warn(`Пропуск точки с нечисловыми координатами (${JSON.stringify(coord)}) в ${contextLabel}.`);
        return;
      }
      // Кладём исходные значения (без округлений/сокращений).
      points.push({ longitude: lonRaw, latitude: latRaw });
    };
  }

  /**
   * @param {object} geojson
   * @param {object} [options] { removeClosingPoint?: boolean, onWarn?: (msg)=>void }
   * @returns {{ points: Array<{longitude:any, latitude:any}> }}
   */
  function extractLonLat(geojson, options) {
    const opts = options || {};
    const warn = typeof opts.onWarn === "function" ? opts.onWarn : function () {};
    const removeClosingPoint = !!opts.removeClosingPoint;
    const points = [];
    const addPoint = makePointPusher(points, "coordinates", warn);

    function processLineString(coords, ctx) {
      if (!Array.isArray(coords)) {
        warn(`Ожидался массив координат LineString, получено: ${typeof coords} (${ctx}).`);
        return;
      }
      const pushPoint = makePointPusher(points, ctx || "LineString", warn);
      for (const c of coords) pushPoint(c);
    }

    function processPolygon(coords, ctx) {
      if (!Array.isArray(coords)) {
        warn(`Ожидался массив колец Polygon, получено: ${typeof coords} (${ctx}).`);
        return;
      }
      let ringIndex = 0;
      for (let ring of coords) {
        const ringCtx = `${ctx || "Polygon"}[ring ${ringIndex}]`;
        if (!Array.isArray(ring)) {
          warn(`Ожидался массив точек в кольце Polygon, получено: ${typeof ring} (${ringCtx}).`);
          ringIndex++;
          continue;
        }
        if (removeClosingPoint && ring.length > 1) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (
            Array.isArray(first) && Array.isArray(last) &&
            first.length >= 2 && last.length >= 2 &&
            Number(first[0]) === Number(last[0]) &&
            Number(first[1]) === Number(last[1])
          ) {
            ring = ring.slice(0, ring.length - 1);
          }
        }
        const pushPoint = makePointPusher(points, ringCtx, warn);
        for (const c of ring) pushPoint(c);
        ringIndex++;
      }
    }

    function traverse(node, ctx) {
      if (!node || typeof node !== "object") {
        warn(`Пропуск узла GeoJSON (не объект) в контексте: ${ctx || "root"}.`);
        return;
      }
      const type = node.type;
      switch (type) {
        case "FeatureCollection":
          if (!Array.isArray(node.features)) {
            warn("FeatureCollection.features не является массивом.");
            return;
          }
          node.features.forEach((f, idx) => traverse(f, `FeatureCollection.features[${idx}]`));
          break;
        case "Feature":
          if (!node.geometry) {
            warn(`Feature без geometry (${ctx || ""}). Пропускаем.`);
            return;
          }
          traverse(node.geometry, `${ctx || "Feature"}.geometry`);
          break;
        case "GeometryCollection":
          if (!Array.isArray(node.geometries)) {
            warn("GeometryCollection.geometries не является массивом.");
            return;
          }
          node.geometries.forEach((g, idx) => traverse(g, `GeometryCollection.geometries[${idx}]`));
          break;
        case "Point":
          addPoint(node.coordinates);
          break;
        case "MultiPoint":
          if (!Array.isArray(node.coordinates)) {
            warn("MultiPoint.coordinates не является массивом.");
            return;
          }
          {
            const pushPoint = makePointPusher(points, "MultiPoint", warn);
            for (const c of node.coordinates) pushPoint(c);
          }
          break;
        case "LineString":
          processLineString(node.coordinates, "LineString");
          break;
        case "MultiLineString":
          if (!Array.isArray(node.coordinates)) {
            warn("MultiLineString.coordinates не является массивом.");
            return;
          }
          node.coordinates.forEach((ls, idx) => processLineString(ls, `MultiLineString[${idx}]`));
          break;
        case "Polygon":
          processPolygon(node.coordinates, "Polygon");
          break;
        case "MultiPolygon":
          if (!Array.isArray(node.coordinates)) {
            warn("MultiPolygon.coordinates не является массивом.");
            return;
          }
          node.coordinates.forEach((poly, idx) => processPolygon(poly, `MultiPolygon[${idx}]`));
          break;
        default:
          warn(`Неизвестный или неподдерживаемый тип геометрии: "${type}" (${ctx || "root"}).`);
      }
    }

    traverse(geojson, "root");
    return { points };
  }

  /**
   * Удобная обёртка: распарсить текст и посчитать точки.
   * @returns {{ points: Array, count: number, warnings: string[], geojson: object }}
   */
  function parseAndExtract(text, options) {
    const warnings = [];
    const geojson = JSON.parse(text);
    const { points } = extractLonLat(geojson, {
      removeClosingPoint: options && options.removeClosingPoint,
      onWarn: (m) => warnings.push(m),
    });
    return { points, count: points.length, warnings, geojson };
  }

  // ---------- Входимость точки в полигон (ray-casting) ----------
  // ВАЖНО: координаты GeoJSON — [lon, lat]; функции принимают (lon, lat) именно
  // в этом порядке. Алгоритм — чётность пересечений горизонтального луча с рёбрами.

  // Точка внутри одного кольца? ring: [[lon,lat], ...].
  function pointInRing(lon, lat, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const xi = Number(a[0]);
      const yi = Number(a[1]);
      const xj = Number(b[0]);
      const yj = Number(b[1]);
      const intersect =
        (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Точка внутри полигона (rings[0] — внешнее кольцо, rings[1..] — дырки).
  function pointInPolygon(lon, lat, rings) {
    if (!Array.isArray(rings) || !rings.length) return false;
    if (!pointInRing(lon, lat, rings[0])) return false; // вне внешнего кольца
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lon, lat, rings[i])) return false; // в дырке → снаружи
    }
    return true;
  }

  // Точка внутри хоть одного полигона геометрии GeoJSON?
  // Обходит те же типы, что extractLonLat; не-полигональные геометрии игнорирует.
  function pointInGeojson(lon, lat, geojson) {
    const x = Number(lon);
    const y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    function walk(node) {
      if (!node || typeof node !== "object") return false;
      switch (node.type) {
        case "FeatureCollection":
          return Array.isArray(node.features) && node.features.some(walk);
        case "Feature":
          return node.geometry ? walk(node.geometry) : false;
        case "GeometryCollection":
          return Array.isArray(node.geometries) && node.geometries.some(walk);
        case "Polygon":
          return pointInPolygon(x, y, node.coordinates);
        case "MultiPolygon":
          return (
            Array.isArray(node.coordinates) &&
            node.coordinates.some((poly) => pointInPolygon(x, y, poly))
          );
        default:
          return false; // Point/LineString/прочее — без площади
      }
    }
    return walk(geojson);
  }

  return { extractLonLat, parseAndExtract, pointInRing, pointInPolygon, pointInGeojson };
});
