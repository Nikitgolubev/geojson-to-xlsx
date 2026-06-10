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

function isEnabled() {
  return !!(process.env.GZ_DEBUG || process.env.GZ_SELFTEST || process.env.GZ_FUNCTEST);
}

// Навешивает отладочные хуки на окно. app нужен для app.exit().
function attach(mainWindow, app) {
  const wc = mainWindow.webContents;

  if (process.env.GZ_DEBUG) {
    wc.on("console-message", (_e, _level, message) => console.log("[renderer]", message));
    wc.on("did-fail-load", (_e, code, desc) => console.log("[did-fail-load]", code, desc));
  }

  const mode = process.env.GZ_FUNCTEST
    ? { label: "FUNCTEST", js: FUNCTEST_JS, delay: 1500 }
    : process.env.GZ_SELFTEST
    ? { label: "SELFTEST", js: SELFTEST_JS, delay: 2500 }
    : null;

  if (mode) {
    wc.on("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const r = await wc.executeJavaScript(mode.js);
          console.log(mode.label + " " + JSON.stringify(r));
        } catch (e) {
          console.log(mode.label + "_ERROR " + (e && e.message ? e.message : e));
        }
        app.exit(0);
      }, mode.delay);
    });
  }
}

module.exports = { attach, isEnabled };
