"use strict";

// Тест чистой логики синхронизации с GitHub. Чистый node:
// node test/sync-logic.js

const assert = require("assert");
const { normalizeForHash, computeHash, buildManifest, nextVersion, decideVerdict } =
  require("../electron/github-sync");

// 1) Детерминизм хэша: перестановка городов/зон не меняет хэш
{
  const a = {
    exportedAt: "2026-01-01T00:00:00Z",
    cities: [{ name: "Москва" }, { name: "Тверь" }],
    zones: [
      { name: "Z1", cityName: "Москва", geojson: "{}", point_count: 3 },
      { name: "Z2", cityName: "Тверь", geojson: "{}", point_count: 5 },
    ],
  };
  const b = {
    exportedAt: "2099-12-31T23:59:59Z", // волатильное поле игнорируется
    cities: [{ name: "Тверь" }, { name: "Москва" }],
    zones: [
      { name: "Z2", cityName: "Тверь", geojson: "{}", point_count: 5 },
      { name: "Z1", cityName: "Москва", geojson: "{}", point_count: 3 },
    ],
  };
  assert.strictEqual(computeHash(a), computeHash(b), "перестановка/дата не меняют хэш");
}

// 2) Изменение данных меняет хэш
{
  const a = { cities: [{ name: "Москва" }], zones: [] };
  const b = { cities: [{ name: "Москва" }, { name: "Тверь" }], zones: [] };
  assert.notStrictEqual(computeHash(a), computeHash(b), "добавление города меняет хэш");
}

// 3) nextVersion
{
  assert.strictEqual(nextVersion(undefined), 1);
  assert.strictEqual(nextVersion(0), 1);
  assert.strictEqual(nextVersion(7), 8);
  assert.strictEqual(nextVersion("12"), 13);
}

// 4) buildManifest
{
  const m = buildManifest({ version: 3, savedAt: "2026-06-12T10:00:00Z", hash: "abc", cities: [{}, {}], zones: [{}] });
  assert.strictEqual(m.app, "geojson-zones-sync");
  assert.strictEqual(m.version, 3);
  assert.strictEqual(m.dataHash, "abc");
  assert.deepStrictEqual(m.counts, { cities: 2, zones: 1 });
}

// 5) Матрица вердиктов
{
  assert.strictEqual(decideVerdict("h", null, null).status, "empty");
  assert.strictEqual(decideVerdict("h", "h", { hash: "h" }).status, "ok");
  // локально поменяли (local != state), удалённое = state → надо отправить
  assert.strictEqual(decideVerdict("hNew", "hOld", { hash: "hOld" }).status, "local-ahead");
  // удалённое поменяли (remote != state), локальное = state → надо получить
  assert.strictEqual(decideVerdict("hOld", "hNew", { hash: "hOld" }).status, "remote-ahead");
  // оба разошлись
  assert.strictEqual(decideVerdict("hA", "hB", { hash: "hOld" }).status, "diverged");
  // без state, но хэши разные
  assert.strictEqual(decideVerdict("hA", "hB", null).status, "diverged");
}

console.log("SYNC LOGIC OK ✔");
