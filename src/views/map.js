"use strict";

// Вкладка «Карта»: отображение полигона выбранной зоны (Leaflet + OpenStreetMap).
// Тайлы загружаются из сети (нужен интернет); сам Leaflet — локально из vendor.
(function () {
  const App = window.App;
  const { el, toast } = App;

  let map = null;
  let currentLayer = null;

  async function show(container, payload) {
    // Соберём плоский список зон для выпадающего выбора.
    const cities = await window.api.cities.list();
    const groups = [];
    const unassigned = await window.api.zones.listUnassigned();
    if (unassigned.length) groups.push({ label: "Без города", zones: unassigned });
    for (const c of cities) {
      const zs = await window.api.zones.listByCity(c.id);
      if (zs.length) groups.push({ label: c.name, zones: zs });
    }

    const select = el("select", { class: "map-select" });
    select.appendChild(el("option", { value: "", text: "— выберите зону —" }));
    groups.forEach((g) => {
      const og = el("optgroup", { label: g.label });
      g.zones.forEach((z) => og.appendChild(el("option", { value: String(z.id), text: z.name })));
      select.appendChild(og);
    });
    select.addEventListener("change", () => {
      if (select.value) loadZone(Number(select.value));
    });

    const bar = el("div", { class: "map-bar" }, [
      el("span", { class: "map-bar-label", text: "Зона:" }),
      select,
    ]);
    const mapEl = el("div", { class: "map-canvas", id: "mapCanvas" });

    container.appendChild(bar);
    container.appendChild(mapEl);

    if (!groups.length) {
      container.appendChild(el("div", { class: "hint-line", text: "Зон пока нет — загрузите их во вкладке «Зоны»." }));
    }

    // Инициализация Leaflet (после вставки в DOM).
    initMap(mapEl);

    // Если пришли с кнопки «На карте» — сразу показать нужную зону.
    if (payload && payload.zoneId) {
      select.value = String(payload.zoneId);
      await loadZone(payload.zoneId);
    }
  }

  function initMap(mapEl) {
    // Каждый показ вкладки пересоздаёт DOM, поэтому создаём карту заново.
    if (map) {
      map.remove();
      map = null;
      currentLayer = null;
    }
    map = L.map(mapEl, { zoomControl: true }).setView([55.751244, 37.618423], 9); // Москва по умолчанию
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    // Leaflet корректно считает размеры только после отрисовки контейнера.
    setTimeout(() => map && map.invalidateSize(), 60);
  }

  async function loadZone(id) {
    let zone;
    try {
      zone = await window.api.zones.get(id);
    } catch (err) {
      toast("Не удалось загрузить зону", "error");
      return;
    }
    if (!zone) return;

    let geojson;
    try {
      geojson = JSON.parse(zone.geojson);
    } catch (e) {
      toast("Зона содержит некорректный GeoJSON", "error");
      return;
    }

    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
    try {
      currentLayer = L.geoJSON(geojson, {
        style: { color: "#007aff", weight: 2, fillColor: "#007aff", fillOpacity: 0.15 },
      }).addTo(map);
      const bounds = currentLayer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    } catch (e) {
      toast("Не удалось отрисовать геометрию зоны", "error");
    }
  }

  App.registerView("map", { show });
})();
