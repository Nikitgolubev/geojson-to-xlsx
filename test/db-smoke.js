"use strict";

// Смоук-тест слоя данных. Запускается ВНУТРИ Electron (better-sqlite3 собран под
// ABI Electron). См. package.json → "test:db".
// Проверяет: CRUD городов/зон, открепление при удалении города, неизменность
// geojson при переименовании, журнал действий.

const path = require("path");
const os = require("os");
const fs = require("fs");
const assert = require("assert");
const db = require("../electron/db");

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zones-test-"));
  db.init(tmp);

  // --- города ---
  const moscow = db.cities.create("Москва");
  const spb = db.cities.create("Санкт-Петербург");
  let list = db.cities.list();
  assert.strictEqual(list.length, 2, "должно быть 2 города");

  // --- зона без города ---
  const gj = '{"type":"Point","coordinates":[37.6,55.7]}';
  const z = db.zones.create({ name: "Зона A", geojson: gj, pointCount: 1 });
  assert.strictEqual(db.zones.listUnassigned().length, 1, "1 зона без города");
  assert.strictEqual(db.zones.listByCity(moscow.id).length, 0, "у Москвы пока 0 зон");

  // --- назначение города ---
  db.zones.assignCity(z.id, moscow.id);
  assert.strictEqual(db.zones.listUnassigned().length, 0, "после назначения — 0 без города");
  assert.strictEqual(db.zones.listByCity(moscow.id).length, 1, "у Москвы 1 зона");

  // --- переименование не меняет geojson ---
  db.zones.rename(z.id, "Зона А-переименованная");
  const got = db.zones.get(z.id);
  assert.strictEqual(got.name, "Зона А-переименованная", "имя сменилось");
  assert.strictEqual(got.geojson, gj, "geojson не изменился при переименовании");

  // --- удаление города открепляет зоны ---
  db.cities.delete(moscow.id);
  assert.strictEqual(db.zones.listUnassigned().length, 1, "зона откреплена, не удалена");
  assert.strictEqual(db.zones.get(z.id).city_id, null, "city_id стал NULL");

  // --- журнал действий пишется ---
  const logs = db.log.list(20);
  assert.ok(logs.length >= 5, "в журнале есть записи");

  // чистим временную БД
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("DB SMOKE OK ✔  (городов было:", list.length, ", записей в журнале:", logs.length + ")");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("DB SMOKE FAILED ✗:", err && err.message ? err.message : err);
  process.exit(1);
}
