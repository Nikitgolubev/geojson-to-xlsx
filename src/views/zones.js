"use strict";

// Вкладка «Зоны»: drag&drop загрузка, секция «не выбран город», иерархия город→зоны.
// Поток: сначала загружают зону(-ы) → они попадают в «без города» → затем назначают город.
(function () {
  const App = window.App;
  const { el, formatDate, toast, confirm, prompt } = App;

  let citiesCache = [];

  async function show(container) {
    // Кнопка выбора файлов в шапке (альтернатива drag&drop).
    const actions = document.getElementById("viewActions");
    const fileInput = el("input", {
      type: "file",
      accept: ".geojson,.json,application/geo+json,application/json",
      multiple: "multiple",
      style: "display:none",
      onchange: (e) => importFiles(e.target.files, container),
    });
    actions.appendChild(fileInput);
    actions.appendChild(
      el("button", { class: "btn primary", text: "+ Загрузить зоны", onclick: () => fileInput.click() })
    );

    await render(container);
  }

  async function render(container) {
    container.innerHTML = "";
    citiesCache = await window.api.cities.list();

    // Зона drag&drop
    container.appendChild(buildDropzone(container));

    // Секция «не выбран город»
    const unassigned = await window.api.zones.listUnassigned();
    if (unassigned.length) {
      const sec = el("div", { class: "zone-section unassigned" });
      sec.appendChild(
        el("div", { class: "section-head" }, [
          el("span", { class: "badge warn", text: "не выбран город" }),
          el("span", { class: "section-count", text: `${unassigned.length} зон(ы) ждут назначения города` }),
        ])
      );
      unassigned.forEach((z) => sec.appendChild(zoneRow(z, container, true)));
      container.appendChild(sec);
    }

    // Иерархия город → зоны
    if (!citiesCache.length) {
      container.appendChild(
        el("div", { class: "hint-line", text: "Городов пока нет — создайте их во вкладке «Города», затем назначайте зоны." })
      );
    }
    for (const city of citiesCache) {
      const zones = await window.api.zones.listByCity(city.id);
      const details = el("details", { class: "city-node", open: zones.length ? "open" : null });
      const summary = el("summary", { class: "city-summary" }, [
        el("span", { class: "city-name", text: city.name }),
        el("span", { class: "city-zcount", text: `${zones.length}` }),
      ]);
      details.appendChild(summary);
      if (!zones.length) {
        details.appendChild(el("div", { class: "empty small", text: "Нет зон. Перетащите файлы или назначьте зону из «без города»." }));
      } else {
        zones.forEach((z) => details.appendChild(zoneRow(z, container, false)));
      }
      container.appendChild(details);
    }
  }

  // ---------- строка зоны ----------
  function zoneRow(z, container, isUnassigned) {
    const meta = el("div", { class: "zone-meta" }, [
      el("span", { class: "zone-date", text: `создана ${formatDate(z.created_at, false)}` }),
      el("span", { class: "zone-date", text: `GeoJSON ${formatDate(z.geojson_updated_at, false)}` }),
      el("span", { class: "zone-date", text: `XLSX ${z.xlsx_generated_at ? formatDate(z.xlsx_generated_at, false) : "—"}` }),
      el("span", { class: "zone-date", text: `точек: ${z.point_count == null ? "?" : z.point_count}` }),
    ]);

    const row = el("div", { class: "zone-row" + (isUnassigned ? " is-unassigned" : "") }, [
      el("div", { class: "zone-info" }, [
        el("div", { class: "zone-name" }, [
          isUnassigned ? el("span", { class: "badge warn small", text: "без города" }) : null,
          el("span", { text: z.name }),
        ]),
        meta,
      ]),
      el("div", { class: "zone-controls" }, [
        citySelect(z, container),
        el("button", { class: "btn tiny", text: "GeoJSON", title: "Скачать GeoJSON", onclick: () => exportGeojson(z) }),
        el("button", { class: "btn tiny", text: "XLSX", title: "Скачать XLSX", onclick: () => exportXlsx(z, container) }),
        el("button", { class: "btn tiny", text: "На карте", onclick: () => App.navigate("map", { zoneId: z.id }) }),
        el("button", { class: "btn tiny secondary", text: "⋯", title: "Переименовать", onclick: () => renameZone(z, container) }),
        el("button", { class: "btn tiny danger", text: "✕", title: "Удалить", onclick: () => deleteZone(z, container) }),
      ]),
    ]);
    return row;
  }

  // Селект назначения города (включая «без города»).
  function citySelect(z, container) {
    const sel = el("select", { class: "city-select", title: "Город зоны" });
    sel.appendChild(el("option", { value: "", text: "— без города —" }));
    citiesCache.forEach((c) => {
      const opt = el("option", { value: String(c.id), text: c.name });
      if (z.city_id === c.id) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", async () => {
      const val = sel.value ? Number(sel.value) : null;
      try {
        await window.api.zones.assignCity(z.id, val);
        toast(val == null ? "Зона откреплена от города" : "Город назначен", "ok");
        await render(container);
      } catch (err) {
        toast(errText(err, "Не удалось изменить город"), "error");
      }
    });
    return sel;
  }

  // ---------- импорт файлов (drag&drop / выбор) ----------
  function buildDropzone(container) {
    const dz = el("div", { class: "dropzone" }, [
      el("div", { class: "dropzone-ico", text: "⬇" }),
      el("div", { class: "dropzone-text", text: "Перетащите сюда .geojson файлы" }),
      el("div", { class: "dropzone-sub", text: "можно несколько сразу · они попадут в «не выбран город»" }),
    ]);
    ["dragenter", "dragover"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("over");
      })
    );
    ["dragleave", "dragend"].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("over");
      })
    );
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("over");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) importFiles(files, container);
    });
    return dz;
  }

  async function importFiles(fileList, container) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let ok = 0, empty = 0, failed = 0;

    for (const file of files) {
      let text;
      try {
        text = await file.text();
      } catch (e) {
        failed++;
        continue;
      }
      let parsed;
      try {
        parsed = window.GeoJSONLib.parseAndExtract(text);
      } catch (e) {
        failed++;
        await safeLog("error", `Импорт «${file.name}»: ошибка парсинга JSON`);
        continue;
      }
      const name = file.name.replace(/\.[^/.]+$/, "");
      try {
        await window.api.zones.create({
          name: name || file.name,
          geojson: text,
          cityId: null,
          pointCount: parsed.count,
          sourceFilename: file.name,
        });
        if (parsed.count === 0) empty++;
        else ok++;
      } catch (e) {
        failed++;
      }
    }

    const parts = [];
    if (ok) parts.push(`загружено: ${ok}`);
    if (empty) parts.push(`без точек: ${empty}`);
    if (failed) parts.push(`ошибок: ${failed}`);
    toast(parts.join(" · ") || "Файлы не обработаны", failed && !ok ? "error" : "ok");
    await render(container);
  }

  // ---------- экспорт ----------
  async function exportGeojson(z) {
    try {
      const res = await window.api.zones.exportGeojson(z.id);
      if (!res.canceled) toast("GeoJSON сохранён", "ok");
    } catch (err) {
      toast(errText(err, "Ошибка экспорта GeoJSON"), "error");
    }
  }

  async function exportXlsx(z, container) {
    try {
      const res = await window.api.zones.exportXlsx(z.id);
      if (!res.canceled) {
        toast(`XLSX сохранён (точек: ${res.count})`, "ok");
        await render(container); // обновить дату генерации XLSX
      }
    } catch (err) {
      toast(errText(err, "Ошибка экспорта XLSX"), "error");
    }
  }

  // ---------- переименование/удаление ----------
  async function renameZone(z, container) {
    const name = await prompt("Новое имя зоны (содержимое файла не меняется):", z.name, {
      title: "Переименовать зону",
    });
    if (!name || name === z.name) return;
    try {
      await window.api.zones.rename(z.id, name);
      toast("Зона переименована", "ok");
      await render(container);
    } catch (err) {
      toast(errText(err, "Не удалось переименовать"), "error");
    }
  }

  async function deleteZone(z, container) {
    const ok = await confirm(`Удалить зону «${z.name}»? Это действие необратимо.`, {
      title: "Удаление зоны",
      danger: true,
      okLabel: "Удалить зону",
    });
    if (!ok) return;
    try {
      await window.api.zones.delete(z.id);
      toast("Зона удалена", "ok");
      await render(container);
    } catch (err) {
      toast(errText(err, "Не удалось удалить"), "error");
    }
  }

  async function safeLog(level, message) {
    try {
      await window.api.log.append(level, message);
    } catch (_) {}
  }

  function errText(err, fallback) {
    const m = err && err.message ? err.message : String(err);
    return m && m.length < 140 ? m : fallback;
  }

  App.registerView("zones", { show });
})();
