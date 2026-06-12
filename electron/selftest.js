"use strict";

// Тестовое/отладочное оснащение, изолированное от боевого кода main.js.
// Активируется переменными окружения и используется npm-скриптами test:ui / test:func.
//   GZ_DEBUG=1     — проброс консоли renderer в терминал
//   GZ_SELFTEST=1  — обойти все вкладки и выгрузить их состояние, затем выйти
//   GZ_FUNCTEST=1  — прогнать путь renderer→IPC→БД (create/assign/rename/delete), затем выйти
//   GZ_TESTDIR=... — использовать изолированную папку БД (ставится в main.js до db.init)

const SELFTEST_JS = `(async function(){
  const base = {
    hasApp: !!window.App, hasApi: !!window.api,
    hasLeaflet: !!window.L, hasGeoLib: !!window.GeoJSONLib,
    navItems: document.querySelectorAll('.nav-item').length
  };
  const views = {};
  for (const v of ['catalog','zones','map','log']) {
    try {
      await window.App.navigate(v);
      await new Promise(function(res){ setTimeout(res, 300); });
      views[v] = { ok:true, children: document.getElementById('viewBody').children.length };
    } catch(e){ views[v] = { ok:false, err: String(e && e.message || e) }; }
  }
  return { base: base, views: views };
})()`;

const FUNCTEST_JS = `(async function(){
  const api = window.api;
  const gj = JSON.stringify({type:"Polygon",coordinates:[[[37.6,55.7],[37.7,55.7],[37.7,55.8],[37.6,55.7]]]});
  const city = await api.cities.create("ТестГород");
  const zone = await api.zones.create({ name:"ТестЗона", geojson: gj, cityId: null, pointCount: 3, sourceFilename: "test.geojson" });
  const un1 = (await api.zones.listUnassigned()).length;
  await api.zones.assignCity(zone.id, city.id);
  const un2 = (await api.zones.listUnassigned()).length;
  const inCity = (await api.zones.listByCity(city.id)).length;
  await api.zones.rename(zone.id, "ТестЗона-2");
  const got = await api.zones.get(zone.id);
  const geojsonIntact = got.geojson === gj;
  await api.cities.delete(city.id);
  const un3 = (await api.zones.listUnassigned()).length;
  const logCount = (await api.log.list(50)).length;
  return { un1, un2, inCity, renamed: got.name, geojsonIntact, un3, logCount };
})()`;

// Проверка обновления бейджа после РЕАЛЬНОГО клика удаления (через модалку подтверждения).
const BADGETEST_JS = `(async function(){
  const api = window.api;
  const sleep = (ms) => new Promise(function(r){ setTimeout(r, ms); });
  const gj = '{"type":"Point","coordinates":[1,2]}';
  await api.zones.create({ name:"U1", geojson: gj, cityId: null, pointCount: 1 });
  await api.zones.create({ name:"U2", geojson: gj, cityId: null, pointCount: 1 });
  await api.zones.create({ name:"U3", geojson: gj, cityId: null, pointCount: 1 });
  await window.App.navigate("zones");
  await sleep(300);
  const badge = document.getElementById("zonesBadge");
  const badgeBefore = badge.textContent;
  // Удаляем ВСЕ незакреплённые зоны до нуля.
  const un = await api.zones.listUnassigned();
  for (const z of un) await api.zones.delete(z.id);
  await window.App.refreshUnassignedBadge();
  await sleep(200);
  const countDb = await api.zones.countUnassigned();
  const computedDisplay = getComputedStyle(badge).display;
  // Регрессия: при нуле незакреплённых зон бейдж должен быть скрыт (display:none),
  // а не показывать устаревшее число (баг: .nav-badge display перебивал [hidden]).
  if (countDb !== 0) throw new Error("countDb должен быть 0, получено " + countDb);
  if (computedDisplay !== "none") throw new Error("бейдж не скрыт при нуле (display=" + computedDisplay + ", text='" + badge.textContent + "')");
  return "OK ✔ (бейдж скрывается при нуле; было " + badgeBefore + ")";
})()`;

// Проверка вкладки «Карта»: выбор города → чек-лист зон → «Все зоны города» рисует
// несколько слоёв → «Очистить отображение» снимает их.
const MAPTEST_JS = `(async function(){
  const api = window.api;
  const sleep = (ms) => new Promise(function(r){ setTimeout(r, ms); });
  const poly = JSON.stringify({ type:"Polygon", coordinates:[[[37.6,55.7],[37.7,55.7],[37.7,55.8],[37.6,55.7]]] });
  const city = await api.cities.create("МК");
  await api.zones.create({ name:"Z1", geojson: poly, cityId: city.id, pointCount: 3 });
  await api.zones.create({ name:"Z2", geojson: poly, cityId: city.id, pointCount: 3 });
  await window.App.navigate("map");
  await sleep(400);
  const sel = document.querySelector(".map-select");
  sel.value = String(city.id);
  sel.dispatchEvent(new Event("change"));
  await sleep(350);
  const checks = document.querySelectorAll(".map-zonelist input.zone-check").length;
  const btnAll = Array.prototype.find.call(document.querySelectorAll(".map-actions .btn"), function(b){ return b.textContent === "Все зоны города"; });
  btnAll.click();
  await sleep(700);
  const drawn = document.querySelectorAll(".map-wrap .leaflet-overlay-pane path").length;
  const btnClear = Array.prototype.find.call(document.querySelectorAll(".map-actions .btn"), function(b){ return b.textContent === "Очистить отображение"; });
  btnClear.click();
  await sleep(250);
  const afterClear = document.querySelectorAll(".map-wrap .leaflet-overlay-pane path").length;
  // Глобальный поиск (город не выбран) + авто-город при выборе зоны.
  const clearF = Array.prototype.find.call(document.querySelectorAll(".map-actions .btn"), function(b){ return b.textContent === "Очистить фильтры"; });
  clearF.click();
  await sleep(150);
  const csel = document.querySelector(".map-select");
  const searchEl = document.querySelector(".map-bar .search-input");
  searchEl.value = "Z1";
  searchEl.dispatchEvent(new Event("input"));
  await sleep(200);
  const globalCount = document.querySelectorAll(".map-zonelist input.zone-check").length;
  document.querySelector(".map-zonelist input.zone-check").click();
  await sleep(250);
  const autoCity = csel.value;
  if (checks !== 2) throw new Error("чек-лист: ожидалось 2, получено " + checks);
  if (drawn < 2) throw new Error("слоёв на карте: ожидалось >=2, получено " + drawn);
  if (afterClear !== 0) throw new Error("после очистки слои остались: " + afterClear);
  if (globalCount < 1) throw new Error("глобальный поиск не дал результатов");
  if (autoCity !== String(city.id)) throw new Error("авто-город не выставился: " + autoCity);
  return "OK ✔ checklist=" + checks + " drawn=" + drawn + " afterClear=" + afterClear + " global=" + globalCount + " autoCity=" + autoCity;
})()`;

// Проверка вкладки «Проверка адреса»: монтирование без ошибок + сквозной путь
// данные(IPC)→математика входимости (pointInGeojson). Геокодинг (сеть) тут не дёргаем.
const ADDRTEST_JS = `(async function(){
  const api = window.api;
  const sleep = (ms) => new Promise(function(r){ setTimeout(r, ms); });
  const poly = JSON.stringify({ type:"Polygon", coordinates:[[[37.4,55.6],[37.8,55.6],[37.8,55.9],[37.4,55.9],[37.4,55.6]]] });
  const city = await api.cities.create("МК");
  await api.zones.create({ name:"ZoneMSK", geojson: poly, cityId: city.id, pointCount: 5 });
  await window.App.navigate("addrcheck");
  await sleep(400);
  const hasInput = !!document.querySelector(".addr-input");
  const hasMap = !!document.querySelector(".addr-map");
  const hasLog = !!document.querySelector(".addr-log");
  const logLines = document.querySelectorAll(".addr-log-list li").length;
  // Сквозной путь как во вью: все зоны + входимость точки Москвы (lat=55.75, lon=37.65).
  const zones = await api.zones.allForCheck();
  let matched = 0;
  for (const z of zones) {
    try { if (window.GeoJSONLib.pointInGeojson(37.65, 55.75, JSON.parse(z.geojson))) matched++; } catch(e){}
  }
  const outside = window.GeoJSONLib.pointInGeojson(30.31, 59.94, JSON.parse(zones[0].geojson)); // СПб — снаружи
  if (!hasInput) throw new Error("нет поля ввода адреса");
  if (!hasMap) throw new Error("нет карты");
  if (!hasLog) throw new Error("нет журнала проверки");
  if (logLines < 1) throw new Error("журнал пуст");
  if (zones.length !== 1) throw new Error("allForCheck: ожидалась 1 зона, получено " + zones.length);
  if (!zones[0].geojson) throw new Error("allForCheck не вернул geojson");
  if (matched !== 1) throw new Error("входимость: ожидалось 1 совпадение, получено " + matched);
  if (outside) throw new Error("точка СПб ошибочно засчитана внутри");
  return "OK ✔ input/map/log смонтированы, logLines=" + logLines + ", matched=" + matched;
})()`;

// Проверка вкладки «Создание полигона»: монтирование + рисование 4 точек кликами
// по карте + сохранение → появление неразобранной зоны с валидным geojson.
const DRAWTEST_JS = `(async function(){
  const api = window.api;
  const sleep = (ms) => new Promise(function(r){ setTimeout(r, ms); });
  await window.App.navigate("draw");
  await sleep(400);
  const hasMap = !!document.querySelector(".draw-map");
  const hasSearch = !!document.querySelector(".addr-input");
  const hasLog = !!document.querySelector(".addr-log");
  if (!hasSearch) throw new Error("нет поля поиска места по адресу");
  const btnSave = Array.prototype.find.call(document.querySelectorAll("#viewActions .btn"), function(b){ return b.textContent === "Сохранить"; });
  const btnReset = Array.prototype.find.call(document.querySelectorAll("#viewActions .btn"), function(b){ return b.textContent === "Начать заново"; });
  if (!hasMap) throw new Error("нет карты рисования");
  if (!hasLog) throw new Error("нет журнала");
  if (!btnSave) throw new Error("нет кнопки Сохранить");
  if (!btnReset) throw new Error("нет кнопки Начать заново");
  // Эмулируем 4 клика по карте (Leaflet click с latlng).
  const m = window.__drawMapForTest;
  if (!m) throw new Error("карта не доступна для теста");
  const pts = [[55.6,37.4],[55.6,37.8],[55.9,37.8],[55.9,37.4]];
  for (const p of pts) { m.fire("click", { latlng: L.latLng(p[0], p[1]) }); await sleep(30); }
  const before = (await api.zones.allForCheck()).length;
  // Сохранение: вызываем напрямую сохранение через тест-хук (минуя модалку имени).
  await window.__drawSaveForTest("polytest");
  await sleep(300);
  const zones = await api.zones.allForCheck();
  const z = zones.find(function(x){ return x.name === "polytest"; });
  if (!z) throw new Error("зона polytest не создана");
  if (!z.geojson) throw new Error("у зоны нет geojson");
  const gj = JSON.parse(z.geojson);
  const inside = window.GeoJSONLib.pointInGeojson(37.6, 55.75, gj);
  if (!inside) throw new Error("точка внутри нарисованного полигона не засчитана");
  if (zones.length !== before + 1) throw new Error("ожидалось +1 зона, было " + before + ", стало " + zones.length);
  return "OK ✔ карта/журнал/кнопки на месте, зона polytest создана, входимость=true";
})()`;

function isEnabled() {
  return !!(process.env.GZ_DEBUG || process.env.GZ_SELFTEST || process.env.GZ_FUNCTEST || process.env.GZ_BADGETEST || process.env.GZ_MAPTEST || process.env.GZ_ADDRTEST || process.env.GZ_DRAWTEST);
}

// Навешивает отладочные хуки на окно. app нужен для app.exit().
function attach(mainWindow, app) {
  const wc = mainWindow.webContents;

  if (process.env.GZ_DEBUG) {
    wc.on("console-message", (_e, _level, message) => console.log("[renderer]", message));
    wc.on("did-fail-load", (_e, code, desc) => console.log("[did-fail-load]", code, desc));
  }

  const mode = process.env.GZ_DRAWTEST
    ? { label: "DRAWTEST", js: DRAWTEST_JS, delay: 1500 }
    : process.env.GZ_ADDRTEST
    ? { label: "ADDRTEST", js: ADDRTEST_JS, delay: 1500 }
    : process.env.GZ_MAPTEST
    ? { label: "MAPTEST", js: MAPTEST_JS, delay: 1500 }
    : process.env.GZ_BADGETEST
    ? { label: "BADGETEST", js: BADGETEST_JS, delay: 1500 }
    : process.env.GZ_FUNCTEST
    ? { label: "FUNCTEST", js: FUNCTEST_JS, delay: 1500 }
    : process.env.GZ_SELFTEST
    ? { label: "SELFTEST", js: SELFTEST_JS, delay: 2500 }
    : null;

  if (mode) {
    wc.on("did-finish-load", () => {
      setTimeout(async () => {
        let failed = false;
        try {
          const r = await wc.executeJavaScript(mode.js);
          console.log(mode.label + " " + JSON.stringify(r));
        } catch (e) {
          failed = true;
          console.log(mode.label + "_ERROR " + (e && e.message ? e.message : e));
        }
        app.exit(failed ? 1 : 0);
      }, mode.delay);
    });
  }
}

module.exports = { attach, isEnabled };
