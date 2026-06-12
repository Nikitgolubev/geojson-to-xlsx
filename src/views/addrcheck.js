"use strict";

// Вкладка «Проверка адреса»: ввод адреса → геокодинг (OSM Nominatim через
// main) → проверка входимости координат в сохранённые зоны (математически,
// GeoJSONLib.pointInGeojson) → результат зелёным/красным + карта + журнал проверки.
(function () {
  const App = window.App;
  const { el, toast } = App;
  const GJ = window.GeoJSONLib;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let map = null;
  let layers = [];
  let marker = null;
  let logEl = null; // <ul> журнала
  let logCountEl = null;
  let logCount = 0;
  let debounceTimer = null;
  let ctx = null; // { coordsEl, resultEl, loader } текущего показа

  async function show(container) {
    map = null; layers = []; marker = null; logCount = 0;

    // --- Поле ввода адреса с автокомплитом ---
    const input = el("input", {
      type: "search",
      class: "search-input addr-input",
      placeholder: "Введите адрес… (например: Москва, Тверская 1)",
      autocomplete: "off",
    });
    const suggest = el("div", { class: "addr-suggest", hidden: "" });

    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 3) { hideSuggest(suggest); return; }
      debounceTimer = setTimeout(() => fetchSuggest(q, suggest, input), 450);
    });
    // Закрытие подсказок по клику вне поля.
    document.addEventListener("click", (e) => {
      if (!suggest.contains(e.target) && e.target !== input) hideSuggest(suggest);
    });

    const inputWrap = el("div", { class: "addr-input-wrap" }, [input, suggest]);

    // Подпись + выделенное поле ввода + кнопка «Очистить результаты».
    const clearBtn = el("button", {
      class: "btn small secondary",
      text: "Очистить результаты",
      onclick: () => clearResults(input, suggest),
    });
    const inputRow = el("div", { class: "addr-input-row" }, [
      el("label", { class: "addr-input-label", text: "Адрес:" }),
      inputWrap,
      clearBtn,
    ]);

    // --- Блок координат ---
    const coordsEl = el("div", { class: "addr-coords", text: "Адрес не выбран." });

    // --- Блок результата (скрыт до выбора адреса) ---
    const resultEl = el("div", { class: "addr-result", hidden: "" });

    // --- Карта ---
    const mapEl = el("div", { class: "map-canvas addr-map", id: "addrMapCanvas" });
    const loader = el("div", { class: "map-loading", hidden: "" }, [
      el("span", { class: "spinner" }),
      el("span", { class: "map-loading-text", text: "Проверка…" }),
    ]);
    const mapWrap = el("div", { class: "map-wrap" }, [mapEl, loader]);

    // --- Журнал проверки (сворачиваемый) ---
    logEl = el("ul", { class: "addr-log-list" });
    logCountEl = el("span", { class: "addr-log-count", text: "0" });
    const logDetails = el("details", { class: "addr-log" }, [
      el("summary", { class: "addr-log-head" }, [
        el("span", { text: "Журнал проверки" }),
        logCountEl,
        el("button", {
          class: "btn tiny secondary",
          text: "Очистить журнал",
          onclick: (e) => { e.preventDefault(); clearLog(); },
        }),
      ]),
      logEl,
    ]);

    container.appendChild(inputRow);
    container.appendChild(coordsEl);
    container.appendChild(resultEl);
    container.appendChild(mapWrap);
    container.appendChild(logDetails);

    initMap(mapEl);

    ctx = { coordsEl, resultEl, loader };
    log("Откройте подсказку и выберите адрес для проверки.", "info");
  }

  // ---------- подсказки ----------
  async function fetchSuggest(q, suggest, input) {
    log(`Запрос подсказок для: «${q}»`, "info");
    try {
      const list = await window.api.system.geocode(q);
      if (!list || !list.length) {
        log("Подсказок нет", "info");
        renderSuggest(suggest, [], input);
        return;
      }
      log(`Получено подсказок: ${list.length}`, "ok");
      renderSuggest(suggest, list, input);
    } catch (err) {
      const m = (err && err.message) || String(err);
      log(`✗ Ошибка геокодинга: ${m}`, "err");
      toast("Ошибка геокодинга", "error");
      hideSuggest(suggest);
    }
  }

  function renderSuggest(suggest, list, input) {
    suggest.innerHTML = "";
    if (!list.length) { suggest.hidden = true; return; }
    list.forEach((item) => {
      suggest.appendChild(
        el("div", {
          class: "addr-suggest-item",
          text: item.displayName,
          onclick: () => {
            input.value = item.displayName;
            suggest.hidden = true;
            onAddressChosen(item);
          },
        })
      );
    });
    suggest.hidden = false;
  }

  function hideSuggest(suggest) {
    suggest.hidden = true;
  }

  // Сброс результатов проверки (поле, координаты, результат, маркер, слои, карта).
  function clearResults(input, suggest) {
    if (input) input.value = "";
    if (suggest) { suggest.innerHTML = ""; suggest.hidden = true; }
    if (ctx && ctx.coordsEl) { ctx.coordsEl.innerHTML = ""; ctx.coordsEl.textContent = "Адрес не выбран."; }
    if (ctx && ctx.resultEl) { ctx.resultEl.innerHTML = ""; ctx.resultEl.className = "addr-result"; ctx.resultEl.hidden = true; }
    if (marker && map) { map.removeLayer(marker); marker = null; }
    clearLayers();
    if (map) map.setView([55.751244, 37.618423], 9);
    log("Результаты очищены", "info");
  }

  // ---------- выбор адреса → проверка ----------
  async function onAddressChosen(item) {
    const root = ctx;
    log(`Выбран адрес: ${item.displayName}`, "info");
    log(`Координаты: ${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`, "info");
    if (root && root.coordsEl) {
      root.coordsEl.innerHTML = "";
      root.coordsEl.appendChild(el("div", { class: "addr-coords-name", text: item.displayName }));
      root.coordsEl.appendChild(el("div", { class: "addr-coords-ll", text: `Широта: ${item.lat.toFixed(6)}   Долгота: ${item.lon.toFixed(6)}` }));
    }
    placeMarker(item.lat, item.lon);
    await checkZones(item, root);
  }

  async function checkZones(item, root) {
    if (root && root.loader) root.loader.hidden = false;
    await sleep(0);
    let zones = [];
    try {
      zones = await window.api.zones.allForCheck();
    } catch (err) {
      log(`✗ Не удалось получить зоны: ${(err && err.message) || err}`, "err");
      if (root && root.loader) root.loader.hidden = true;
      return;
    }
    log(`Проверка по ${zones.length} зон(ам)…`, "info");
    const matches = [];
    for (const z of zones) {
      let gj;
      try { gj = JSON.parse(z.geojson); } catch (_) { continue; }
      if (GJ.pointInGeojson(item.lon, item.lat, gj)) {
        matches.push(z);
        log(`✓ внутри: ${z.name} (${z.city_name || "без города"})`, "ok");
      }
    }
    showResult(matches, root);
    drawMatchedZones(matches);
    if (root && root.loader) root.loader.hidden = true;
  }

  function showResult(matches, root) {
    const resultEl = root && root.resultEl;
    if (!resultEl) return;
    resultEl.innerHTML = "";
    resultEl.hidden = false;
    if (!matches.length) {
      resultEl.className = "addr-result out";
      resultEl.appendChild(el("div", { class: "addr-result-title", text: "Адрес не входит ни в одну зону" }));
      log("Итог: не входит ни в одну зону", "err");
      return;
    }
    resultEl.className = "addr-result in";
    resultEl.appendChild(el("div", { class: "addr-result-title", text: `Входит в зону(ы): ${matches.length}` }));
    const ul = el("ul", { class: "addr-result-list" });
    matches.forEach((z) => ul.appendChild(el("li", { text: `${z.name} — ${z.city_name || "без города"}` })));
    resultEl.appendChild(ul);
    log(`Итог: входит в ${matches.length} зон(ы)`, "ok");
  }

  // ---------- карта ----------
  function initMap(mapEl) {
    if (map) { map.remove(); map = null; layers = []; marker = null; }
    map = L.map(mapEl, { zoomControl: true }).setView([55.751244, 37.618423], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    setTimeout(() => map && map.invalidateSize(), 60);
  }

  function placeMarker(lat, lon) {
    if (!map) return;
    if (marker) { map.removeLayer(marker); marker = null; }
    marker = L.marker([lat, lon]).addTo(map);
    map.setView([lat, lon], 13);
  }

  function clearLayers() {
    layers.forEach((l) => map && map.removeLayer(l));
    layers = [];
  }

  function drawMatchedZones(matches) {
    if (!map) return;
    clearLayers();
    const bounds = L.latLngBounds([]);
    matches.forEach((z) => {
      try {
        const gj = JSON.parse(z.geojson);
        const layer = L.geoJSON(gj, {
          style: { color: "#34c759", weight: 2, fillColor: "#34c759", fillOpacity: 0.18 },
        }).addTo(map);
        layers.push(layer);
        const b = layer.getBounds();
        if (b && b.isValid()) bounds.extend(b);
      } catch (_) {}
    });
    if (marker) bounds.extend(marker.getLatLng());
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  // ---------- журнал ----------
  function log(text, kind) {
    if (!logEl) return;
    const time = new Date().toLocaleTimeString();
    logEl.appendChild(el("li", { class: kind || "info" }, [
      el("span", { class: "addr-log-time", text: time }),
      el("span", { text: text }),
    ]));
    logCount++;
    if (logCountEl) logCountEl.textContent = String(logCount);
  }

  function clearLog() {
    if (logEl) logEl.innerHTML = "";
    logCount = 0;
    if (logCountEl) logCountEl.textContent = "0";
  }

  App.registerView("addrcheck", { show });
})();
