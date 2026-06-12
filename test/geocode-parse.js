"use strict";

// Тест разбора ответа Nominatim. Чистый node (без сети):
// node test/geocode-parse.js

const assert = require("assert");
const { parseNominatim, buildSearchUrl } = require("../electron/geocode");

// 1) Нормальный ответ
{
  const sample = JSON.stringify([
    { display_name: "Москва, Россия", lat: "55.7504461", lon: "37.6174943" },
    { display_name: "Московская область", lat: "55.5", lon: "38.0" },
  ]);
  const out = parseNominatim(sample);
  assert.strictEqual(out.length, 2, "две подсказки");
  assert.strictEqual(out[0].displayName, "Москва, Россия");
  assert.strictEqual(out[0].lat, 55.7504461, "lat — число");
  assert.strictEqual(out[0].lon, 37.6174943, "lon — число");
}

// 2) Битые/пустые записи отсеиваются
{
  const sample = [
    { display_name: "ok", lat: "1.0", lon: "2.0" },
    { display_name: "bad", lat: "x", lon: "2.0" },
    null,
    { display_name: "no-coords" },
  ];
  const out = parseNominatim(sample);
  assert.strictEqual(out.length, 1, "только валидная запись");
  assert.strictEqual(out[0].displayName, "ok");
}

// 3) Не-массив → пустой результат
{
  assert.deepStrictEqual(parseNominatim("{}"), [], "объект → []");
  assert.deepStrictEqual(parseNominatim("[]"), [], "пустой массив → []");
}

// 4) URL: регион RU, язык RU, экранирование запроса
{
  const url = buildSearchUrl("Тверская 1");
  assert.ok(url.indexOf("countrycodes=ru") !== -1, "ограничение страной RU");
  assert.ok(url.indexOf("accept-language=ru") !== -1, "язык RU");
  assert.ok(url.indexOf("q=") !== -1 && url.indexOf(" ") === -1, "запрос экранирован, без пробелов");
}

console.log("GEOCODE PARSE OK ✔");
