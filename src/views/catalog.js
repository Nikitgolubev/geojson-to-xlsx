"use strict";

// Вкладка «Города»: справочник городов (CRUD).
// Удаление города не удаляет зоны — они открепляются (см. db.js, ON DELETE SET NULL).
(function () {
  const App = window.App;
  const { el, icon, formatDate, toast, confirm, prompt } = App;

  async function show(container) {
    const actions = document.getElementById("viewActions");
    actions.appendChild(
      el("button", { class: "btn primary", text: "+ Добавить город", onclick: () => addCity(container) })
    );
    actions.appendChild(
      el("button", { class: "btn small secondary", text: "Раскрыть все", onclick: () => toggleAll(true) })
    );
    actions.appendChild(
      el("button", { class: "btn small secondary", text: "Свернуть все", onclick: () => toggleAll(false) })
    );
    await render(container);
  }

  // Раскрыть/свернуть все города (ленивая подгрузка зон сработает по событию toggle).
  function toggleAll(open) {
    document.querySelectorAll(".view-body .city-node").forEach((d) => {
      d.open = open;
    });
  }

  async function render(container) {
    container.innerHTML = "";
    const cities = await window.api.cities.list();
    if (!cities.length) {
      container.appendChild(
        el("div", { class: "empty", text: "Городов пока нет. Добавьте первый." })
      );
      return;
    }
    const list = el("div", { class: "card-list" });
    cities.forEach((c, i) => list.appendChild(cityCard(c, container, i + 1)));
    container.appendChild(list);
  }

  // Город — раскрываемый узел (свёрнут по умолчанию). Список зон грузится лениво
  // при первом раскрытии (чтобы не тянуть зоны всех городов сразу).
  function cityCard(c, container, index) {
    const details = el("details", { class: "city-node" });
    const summary = el("summary", { class: "city-summary" }, [
      el("span", { class: "city-name" }, [
        el("span", { class: "card-num", text: `${index}. ` }),
        el("span", { text: c.name }),
      ]),
      el("span", { class: "city-zcount", text: `${c.zone_count}` }),
      el("span", { class: "city-sub", text: `создан ${formatDate(c.created_at)}` }),
      el("span", { class: "summary-actions" }, [
        btnStop("Переименовать", "btn small secondary", () => renameCity(c, container)),
        btnStop("Удалить", "btn small danger", () => deleteCity(c, container)),
      ]),
    ]);
    details.appendChild(summary);

    const body = el("div", { class: "city-zones" });
    details.appendChild(body);

    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (details.open && !loaded) {
        loaded = true;
        await loadCityZones(c, body);
      }
    });
    return details;
  }

  // Кнопка в summary, не сворачивающая узел при клике.
  function btnStop(text, cls, fn) {
    return el("button", {
      class: cls,
      text,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      },
    });
  }

  // Ленивая загрузка зон города: просмотр на карте + скачивание GeoJSON/XLSX.
  async function loadCityZones(c, body) {
    body.innerHTML = "";
    const zones = await window.api.zones.listByCity(c.id);
    if (!zones.length) {
      body.appendChild(el("div", { class: "empty small", text: "В этом городе нет зон." }));
      return;
    }
    zones.forEach((z, i) => {
      body.appendChild(
        el("div", { class: "zone-row" }, [
          el("div", { class: "zone-num", text: `${i + 1}.` }),
          el("div", { class: "zone-info" }, [el("div", { class: "zone-name" }, [el("span", { text: z.name })])]),
          el("div", { class: "zone-controls" }, [
            el("button", { class: "btn tiny btn-map", title: "На карте", onclick: () => App.navigate("map", { zoneId: z.id }) }, [icon("map"), " На карте"]),
            el("button", { class: "btn tiny", title: "Скачать GeoJSON", onclick: () => exportZone("geojson", z) }, [icon("download"), " GeoJSON"]),
            el("button", { class: "btn tiny btn-xlsx", title: "Скачать XLSX", onclick: () => exportZone("xlsx", z) }, [icon("download"), " XLSX"]),
          ]),
        ])
      );
    });
  }

  async function exportZone(fmt, z) {
    try {
      const res = fmt === "xlsx"
        ? await window.api.zones.exportXlsx(z.id)
        : await window.api.zones.exportGeojson(z.id);
      if (!res.canceled) toast(fmt === "xlsx" ? "XLSX сохранён" : "GeoJSON сохранён", "ok");
    } catch (err) {
      toast(errText(err, "Ошибка экспорта"), "error");
    }
  }

  async function addCity(container) {
    const name = await prompt("Название города:", "", { title: "Новый город", okLabel: "Создать" });
    if (!name) return;
    try {
      await window.api.cities.create(name);
      toast(`Город «${name}» создан`, "ok");
      await render(container);
    } catch (err) {
      toast(errText(err, "Не удалось создать город"), "error");
    }
  }

  async function renameCity(c, container) {
    const name = await prompt("Новое название города:", c.name, { title: "Переименовать город" });
    if (!name || name === c.name) return;
    try {
      await window.api.cities.rename(c.id, name);
      toast("Город переименован", "ok");
      await render(container);
    } catch (err) {
      toast(errText(err, "Не удалось переименовать"), "error");
    }
  }

  async function deleteCity(c, container) {
    const ok = await confirm(
      `Удалить город «${c.name}»? Его зоны (${c.zone_count}) не будут удалены — они станут «без города».`,
      { title: "Удаление города", danger: true, okLabel: "Удалить город" }
    );
    if (!ok) return;
    try {
      const res = await window.api.cities.delete(c.id);
      toast(`Город удалён. Откреплено зон: ${res.detached}`, "ok");
      await render(container);
      App.refreshUnassignedBadge(); // зоны откреплены → счётчик «без города» изменился
    } catch (err) {
      toast(errText(err, "Не удалось удалить"), "error");
    }
  }

  function errText(err, fallback) {
    const m = err && err.message ? err.message : String(err);
    // IPC оборачивает ошибку; вытащим суть после двоеточия, если есть.
    if (/UNIQUE constraint/i.test(m)) return "Город с таким именем уже существует";
    return m && m.length < 120 ? m : fallback;
  }

  App.registerView("catalog", { show });
})();
