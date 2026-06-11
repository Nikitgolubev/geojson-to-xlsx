"use strict";

// Вкладка «Карта»: отображение зон (Leaflet + OpenStreetMap).
// Выбор города → видимый список зон с чекбоксами (поиск фильтрует именно его) →
// показ одной или нескольких зон. Зоны всегда из ОДНОГО выбранного города (by design).
(function () {
  const App = window.App;
  const { el, icon, toast } = App;

  let map = null;
  let layers = []; // отрисованные слои Leaflet
  let cityZones = []; // зоны выбранного города (элементы списка)

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function show(container, payload) {
    const cities = await window.api.cities.list();
    const hasUnassigned = (await window.api.zones.countUnassigned()) > 0;

    // --- выбор города ---
    const citySel = el("select", { class: "map-select" });
    citySel.appendChild(el("option", { value: "", text: "— выберите город —" }));
    if (hasUnassigned) citySel.appendChild(el("option", { value: "u", text: "Без города" }));
    cities.forEach((c) => citySel.appendChild(el("option", { value: String(c.id), text: c.name })));

    // --- поиск (фильтрует список зон выбранного города) ---
    const search = el("input", {
      type: "search",
      class: "search-input",
      placeholder: "Поиск зоны…",
      oninput: () => renderChecklist(search.value),
    });

    const listEl = el("div", { class: "map-zonelist" });

    citySel.addEventListener("change", async () => {
      cityZones = await fetchCityZones(citySel.value);
      search.value = "";
      renderChecklist("");
    });

    function renderChecklist(query) {
      listEl.innerHTML = "";
      if (!citySel.value) {
        listEl.appendChild(el("div", { class: "empty small", text: "Выберите город, чтобы увидеть его зоны." }));
        return;
      }
      const q = (query || "").trim().toLowerCase();
      const filtered = q ? cityZones.filter((z) => String(z.name || "").toLowerCase().includes(q)) : cityZones;
      if (!filtered.length) {
        listEl.appendChild(el("div", { class: "empty small", text: q ? "Ничего не найдено." : "В этом городе нет зон." }));
        return;
      }
      filtered.forEach((z) => {
        const cb = el("input", { type: "checkbox", class: "zone-check", value: String(z.id) });
        listEl.appendChild(el("label", { class: "map-zone-item" }, [cb, el("span", { text: z.name })]));
      });
    }

    function checkedIds() {
      return [...listEl.querySelectorAll("input.zone-check:checked")].map((c) => Number(c.value));
    }

    // --- кнопки управления ---
    const btnShow = el("button", { class: "btn small primary", text: "Показать выбранные", onclick: () => loadZones(checkedIds()) });
    const btnAll = el("button", { class: "btn small secondary", text: "Все зоны города", onclick: () => {
      listEl.querySelectorAll("input.zone-check").forEach((c) => (c.checked = true));
      loadZones(cityZones.map((z) => z.id));
    } });
    const btnClear = el("button", { class: "btn small secondary", text: "Очистить отображение", onclick: () => {
      clearLayers();
      listEl.querySelectorAll("input.zone-check").forEach((c) => (c.checked = false));
    } });

    const bar = el("div", { class: "map-bar" }, [
      el("span", { class: "map-bar-label", text: "Город:" }),
      citySel,
      search,
    ]);
    const actionsBar = el("div", { class: "map-actions" }, [btnShow, btnAll, btnClear]);

    const mapEl = el("div", { class: "map-canvas", id: "mapCanvas" });
    const loader = el("div", { class: "map-loading", hidden: "" }, [
      el("div", { class: "spinner" }),
      el("span", { class: "map-loading-text", text: "Отрисовка зон…" }),
    ]);
    const mapWrap = el("div", { class: "map-wrap" }, [mapEl, loader]);

    container.appendChild(bar);
    container.appendChild(listEl);
    container.appendChild(actionsBar);
    container.appendChild(mapWrap);

    if (!cities.length && !hasUnassigned) {
      container.appendChild(el("div", { class: "hint-line", text: "Зон пока нет — загрузите их во вкладке «Зоны»." }));
    }

    initMap(mapEl, loader);
    renderChecklist("");

    // Вход с кнопки «На карте»: выбрать город зоны, отметить и показать её.
    if (payload && payload.zoneId) {
      const zone = await window.api.zones.get(payload.zoneId);
      if (zone) {
        citySel.value = zone.city_id == null ? (hasUnassigned ? "u" : "") : String(zone.city_id);
        cityZones = await fetchCityZones(citySel.value);
        renderChecklist("");
        const cb = listEl.querySelector(`input.zone-check[value="${payload.zoneId}"]`);
        if (cb) cb.checked = true;
        await loadZones([payload.zoneId]);
      }
    }
  }

  // Зоны выбранного города ("" — нет, "u" — без города, иначе id города).
  async function fetchCityZones(value) {
    if (!value) return [];
    if (value === "u") return window.api.zones.listUnassigned();
    return window.api.zones.listByCity(Number(value));
  }

  let loaderEl = null;
  function initMap(mapEl, loader) {
    loaderEl = loader;
    if (map) {
      map.remove();
      map = null;
      layers = [];
    }
    map = L.map(mapEl, { zoomControl: true }).setView([55.751244, 37.618423], 9); // Москва по умолчанию
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    setTimeout(() => map && map.invalidateSize(), 60);
  }

  function showLoader(on) {
    if (loaderEl) loaderEl.hidden = !on;
  }

  function clearLayers() {
    layers.forEach((l) => map && map.removeLayer(l));
    layers = [];
  }

  // Отрисовать набор зон (одну или несколько). Лоадер виден при многих зонах.
  async function loadZones(ids) {
    if (!map) return;
    clearLayers();
    if (!ids || !ids.length) {
      toast("Не выбрано ни одной зоны", "info");
      return;
    }
    showLoader(true);
    await sleep(0); // дать лоадеру отрисоваться
    const allBounds = L.latLngBounds([]);
    let drawn = 0, bad = 0, i = 0;
    for (const id of ids) {
      let zone;
      try {
        zone = await window.api.zones.get(id);
      } catch (e) {
        bad++;
        continue;
      }
      if (zone) {
        try {
          const gj = JSON.parse(zone.geojson);
          const layer = L.geoJSON(gj, {
            style: { color: "#007aff", weight: 2, fillColor: "#007aff", fillOpacity: 0.15 },
          }).addTo(map);
          layers.push(layer);
          const b = layer.getBounds();
          if (b && b.isValid()) allBounds.extend(b);
          drawn++;
        } catch (e) {
          bad++;
        }
      }
      // периодически уступаем поток, чтобы лоадер был виден при большом числе зон
      if (++i % 5 === 0) await sleep(0);
    }
    if (allBounds.isValid()) map.fitBounds(allBounds, { padding: [24, 24] });
    showLoader(false);
    if (bad) toast(`Отрисовано: ${drawn}, с ошибкой: ${bad}`, drawn ? "info" : "error");
  }

  App.registerView("map", { show });
})();
