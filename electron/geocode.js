"use strict";

// Разбор ответа OSM Nominatim /search. Чистый модуль — тестируется без сети.

// JSON-массив Nominatim → [{ displayName, lat, lon }] (только валидные числа).
function parseNominatim(json) {
  const arr = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const r of arr) {
    if (!r) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      displayName: String(r.display_name == null ? "" : r.display_name),
      lat: lat,
      lon: lon,
    });
  }
  return out;
}

// Сборка URL запроса подсказок (регион — Россия, рус. язык).
function buildSearchUrl(query) {
  const q = encodeURIComponent(String(query == null ? "" : query).trim());
  return (
    "https://nominatim.openstreetmap.org/search" +
    "?format=jsonv2&addressdetails=1&limit=5&accept-language=ru&countrycodes=ru&q=" + q
  );
}

module.exports = { parseNominatim, buildSearchUrl };
