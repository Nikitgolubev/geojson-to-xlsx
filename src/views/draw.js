"use strict";

// Вкладка «Создание полигона»: рисование полигона кликами по карте → сохранение
// в неразобранные зоны (window.api.zones.create, без города) + скачивание .geojson
// в папку «Загрузки». На странице — сворачиваемый журнал действий.
(function () {
  const App = window.App;
  const { el, toast, modal } = App;
  const GJ = window.GeoJSONLib;

  let map = null;
  let points = []; // [{lat,lng}]
  let polyline = null;
  let polygon = null;
  let vertexMarkers = [];
  let logEl = null;
  let logCountEl = null;
  let logCount = 0;
  let placeMarker = null; // временный маркер найденного адреса (не вершина полигона)
  let debounceTimer = null;

  async function show(container) {
    map = null; points = []; polyline = null; polygon = null; vertexMarkers = []; logCount = 0; placeMarker = null;

    const actions = document.getElementById("viewActions");
    actions.appendChild(el("button", { class: "btn small secondary", text: "Отменить точку", onclick: undoPoint }));
    actions.appendChild(el("button", { class: "btn small secondary", text: "Начать заново", onclick: resetDrawing }));
    actions.appendChild(el("button", { class: "btn primary", text: "Сохранить", onclick: savePolygon }));

    // Поиск/позиционирование по адресу: открыть нужное место перед рисованием.
    const search = el("input", {
      type: "search",
      class: "search-input addr-input",
      placeholder: "Найти место по адресу… (например: Москва, Тверская 1)",
      autocomplete: "off",
    });
    const suggest = el("div", { class: "addr-suggest", hidden: "" });
    search.addEventListener("input", () => {
      const q = search.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 3) { suggest.hidden = true; return; }
      debounceTimer = setTimeout(() => fetchSuggest(q, suggest, search), 450);
    });
    document.addEventListener("click", (e) => {
      if (!suggest.contains(e.target) && e.target !== search) suggest.hidden = true;
    });
    const searchRow = el("div", { class: "addr-input-row" }, [
      el("label", { class: "addr-input-label", text: "Найти место:" }),
      el("div", { class: "addr-input-wrap" }, [search, suggest]),
    ]);

    const hint = el("div", { class: "draw-hint", text: "Найдите место по адресу, затем кликайте по карте, чтобы добавить вершины полигона (минимум 3). Затем «Сохранить»." });

    const mapEl = el("div", { class: "map-canvas draw-map", id: "drawMapCanvas" });
    const mapWrap = el("div", { class: "map-wrap" }, [mapEl]);

    // Журнал (сворачиваемый, по умолчанию свёрнут).
    logEl = el("ul", { class: "addr-log-list" });
    logCountEl = el("span", { class: "addr-log-count", text: "0" });
    const logDetails = el("details", { class: "addr-log" }, [
      el("summary", { class: "addr-log-head" }, [
        el("span", { text: "Журнал" }),
        logCountEl,
        el("button", { class: "btn tiny secondary", text: "Очистить журнал", onclick: (e) => { e.preventDefault(); clearLog(); } }),
      ]),
      logEl,
    ]);

    container.appendChild(searchRow);
    container.appendChild(hint);
    container.appendChild(mapWrap);
    container.appendChild(logDetails);

    initMap(mapEl);
    log("Готово к рисованию. Кликайте по карте.", "info");
  }

  // ---------- карта и рисование ----------
  function initMap(mapEl) {
    if (map) { map.remove(); map = null; }
    map = L.map(mapEl, { zoomControl: true }).setView([55.751244, 37.618423], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    map.on("click", (e) => addPoint(e.latlng));
    setTimeout(() => map && map.invalidateSize(), 60);
    // Тест-хуки (используются Electron-смоуком GZ_DRAWTEST; в обычной работе не мешают).
    window.__drawMapForTest = map;
    window.__drawSaveForTest = (name) => doSave(name);
  }

  function addPoint(latlng) {
    points.push({ lat: latlng.lat, lng: latlng.lng });
    log(`Точка ${points.length}: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`, "info");
    redraw();
  }

  // ---------- поиск/позиционирование по адресу ----------
  async function fetchSuggest(q, suggest, input) {
    log(`Поиск места: «${q}»`, "info");
    try {
      const list = await window.api.system.geocode(q);
      suggest.innerHTML = "";
      if (!list || !list.length) { suggest.hidden = true; log("Места не найдены", "info"); return; }
      list.forEach((item) => {
        suggest.appendChild(el("div", {
          class: "addr-suggest-item",
          text: item.displayName,
          onclick: () => {
            input.value = item.displayName;
            suggest.hidden = true;
            positionTo(item);
          },
        }));
      });
      suggest.hidden = false;
    } catch (err) {
      suggest.hidden = true;
      log(`✗ Ошибка поиска места: ${(err && err.message) || err}`, "err");
      toast("Ошибка поиска адреса", "error");
    }
  }

  function positionTo(item) {
    if (!map) return;
    if (placeMarker) { map.removeLayer(placeMarker); placeMarker = null; }
    placeMarker = L.marker([item.lat, item.lon], { opacity: 0.9 }).addTo(map);
    map.setView([item.lat, item.lon], 14);
    log(`Карта спозиционирована: ${item.displayName}`, "ok");
  }

  function undoPoint() {
    if (!points.length) return;
    points.pop();
    log("Отменена последняя точка", "info");
    redraw();
  }

  function redraw() {
    if (!map) return;
    if (polyline) { map.removeLayer(polyline); polyline = null; }
    if (polygon) { map.removeLayer(polygon); polygon = null; }
    vertexMarkers.forEach((m) => map.removeLayer(m));
    vertexMarkers = [];

    const latlngs = points.map((p) => [p.lat, p.lng]);
    if (latlngs.length >= 3) {
      polygon = L.polygon(latlngs, { color: "#007aff", weight: 2, fillColor: "#007aff", fillOpacity: 0.15 }).addTo(map);
    } else if (latlngs.length >= 2) {
      polyline = L.polyline(latlngs, { color: "#007aff", weight: 2 }).addTo(map);
    }
    points.forEach((p) => {
      const m = L.circleMarker([p.lat, p.lng], { radius: 5, color: "#0a4fff", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);
      vertexMarkers.push(m);
    });
  }

  function resetDrawing() {
    points = [];
    redraw();
    log("Рисование начато заново", "info");
  }

  // ---------- сохранение ----------
  async function savePolygon() {
    if (points.length < 3) {
      toast("Нужно минимум 3 точки", "error");
      log("✗ Недостаточно точек для полигона (минимум 3)", "err");
      return;
    }
    const nameInput = el("input", { class: "modal-input", type: "text", value: "polygon", placeholder: "Имя файла" });
    const ok = await modal({
      title: "Сохранить полигон",
      bodyNode: el("div", {}, [
        el("label", { class: "modal-label", text: "Как назвать файл (без расширения):" }),
        nameInput,
      ]),
      actions: [
        { label: "Отмена", value: false, kind: "secondary" },
        { label: "Сохранить", value: true, kind: "primary" },
      ],
    });
    if (!ok) { log("Сохранение отменено", "info"); return; }

    const name = (nameInput.value || "polygon").trim() || "polygon";
    await doSave(name);
  }

  // Сохранение по готовому имени (без модалки) — общий путь для UI и теста.
  async function doSave(name) {
    if (points.length < 3) {
      toast("Нужно минимум 3 точки", "error");
      log("✗ Недостаточно точек для полигона (минимум 3)", "err");
      return;
    }
    try {
      const gj = GJ.buildPolygonGeojson(points, name);
      const text = JSON.stringify(gj);
      const pointCount = GJ.parseAndExtract(text).count;
      log(`Построен GeoJSON: вершин ${points.length}, точек ${pointCount}`, "info");

      await window.api.zones.create({
        name: name,
        geojson: text,
        cityId: null,
        pointCount: pointCount,
        sourceFilename: name + ".geojson",
      });
      log(`✓ Зона «${name}» добавлена в «Зоны» (без города)`, "ok");

      const res = await window.api.system.saveToDownloads(name + ".geojson", text);
      log(`✓ Файл скачан: ${res.path}`, "ok");

      toast("Полигон сохранён в «Зоны» и скачан в «Загрузки»", "ok");
      App.refreshUnassignedBadge();
      resetDrawing();
    } catch (err) {
      const m = (err && err.message) || String(err);
      log(`✗ Ошибка сохранения: ${m}`, "err");
      toast("Не удалось сохранить полигон", "error");
    }
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

  App.registerView("draw", { show });
})();
