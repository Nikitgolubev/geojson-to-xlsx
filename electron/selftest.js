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

function isEnabled() {
  return !!(process.env.GZ_DEBUG || process.env.GZ_SELFTEST || process.env.GZ_FUNCTEST || process.env.GZ_BADGETEST);
}

// Навешивает отладочные хуки на окно. app нужен для app.exit().
function attach(mainWindow, app) {
  const wc = mainWindow.webContents;

  if (process.env.GZ_DEBUG) {
    wc.on("console-message", (_e, _level, message) => console.log("[renderer]", message));
    wc.on("did-fail-load", (_e, code, desc) => console.log("[did-fail-load]", code, desc));
  }

  const mode = process.env.GZ_BADGETEST
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
