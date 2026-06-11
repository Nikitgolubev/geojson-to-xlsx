"use strict";

// Вкладка «Зоны»: drag&drop загрузка, секция «не выбран город», иерархия город→зоны,
// поиск, нумерация, множественный выбор и массовые операции.
// Поток: сначала загружают зону(-ы) → они попадают в «без города» → затем назначают город.
(function () {
  const App = window.App;
  const { el, formatDate, toast, confirm, prompt, modal } = App;

  let citiesCache = [];
  let searchQuery = "";
  const selected = new Set(); // id выбранных зон
  let importRejected = []; // отклонённые при загрузке файлы: {name, reason}

  async function show(container) {
    // Свежий вход во вкладку — без «хвостов» выбора.
    selected.clear();
    searchQuery = "";

    const actions = document.getElementById("viewActions");

    // Поиск по названию зоны (в шапке — переживает перерисовку тела).
    const search = el("input", {
      type: "search",
      class: "search-input",
      placeholder: "Поиск зоны по названию…",
      value: searchQuery,
      oninput: (e) => {
        searchQuery = e.target.value;
        render(container);
      },
    });
    actions.appendChild(search);

    // Кнопка выбора файлов (альтернатива drag&drop).
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

  // Подходит ли зона под текущий поиск.
  function matches(z) {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return String(z.name || "").toLowerCase().includes(q);
  }

  async function render(container) {
    container.innerHTML = "";
    citiesCache = await window.api.cities.list();
    const filtering = !!searchQuery.trim();

    // Панель массовых действий (видна при ≥1 выбранной зоне).
    if (selected.size) container.appendChild(buildBulkBar(container));

    // Дропзона + сообщения об отклонённых файлах.
    container.appendChild(buildDropzone(container));
    if (importRejected.length) container.appendChild(buildRejectedNotice(container));

    let anyShown = false;

    // Секция «не выбран город».
    const unassigned = (await window.api.zones.listUnassigned()).filter(matches);
    if (unassigned.length) {
      anyShown = true;
      const ids = unassigned.map((z) => z.id);
      const sec = el("div", { class: "zone-section unassigned" });
      sec.appendChild(
        el("div", { class: "section-head" }, [
          groupSelectAll(ids, container),
          el("span", { class: "badge warn", text: "не выбран город" }),
          el("span", { class: "section-count", text: `${unassigned.length} зон(ы) ждут назначения города` }),
        ])
      );
      unassigned.forEach((z, i) => sec.appendChild(zoneRow(z, container, true, i + 1)));
      container.appendChild(sec);
    }

    // Иерархия город → зоны.
    if (!filtering && !citiesCache.length) {
      container.appendChild(
        el("div", { class: "hint-line", text: "Городов пока нет — создайте их во вкладке «Города», затем назначайте зоны." })
      );
    }
    for (const city of citiesCache) {
      const zones = (await window.api.zones.listByCity(city.id)).filter(matches);
      if (filtering && !zones.length) continue; // при поиске пустые города скрываем
      if (zones.length) anyShown = true;
      const ids = zones.map((z) => z.id);
      const details = el("details", { class: "city-node", open: zones.length ? "open" : null });
      const summary = el("summary", { class: "city-summary" }, [
        groupSelectAll(ids, container),
        el("span", { class: "city-name", text: city.name }),
        el("span", { class: "city-zcount", text: `${zones.length}` }),
      ]);
      details.appendChild(summary);
      if (!zones.length) {
        details.appendChild(el("div", { class: "empty small", text: "Нет зон. Перетащите файлы или назначьте зону из «без города»." }));
      } else {
        zones.forEach((z, i) => details.appendChild(zoneRow(z, container, false, i + 1)));
      }
      container.appendChild(details);
    }

    if (filtering && !anyShown) {
      container.appendChild(el("div", { class: "empty", text: `Зоны с названием «${searchQuery.trim()}» не найдены.` }));
    }
  }

  // ---------- панель массовых действий ----------
  function buildBulkBar(container) {
    const bar = el("div", { class: "bulk-bar" });
    bar.appendChild(el("span", { class: "bulk-count", text: `Выбрано: ${selected.size}` }));

    const sel = el("select", { class: "city-select" });
    sel.appendChild(el("option", { value: "", text: "Назначить город…" }));
    citiesCache.forEach((c) => sel.appendChild(el("option", { value: String(c.id), text: c.name })));
    sel.addEventListener("change", () => {
      if (sel.value) bulkAssign(Number(sel.value), container);
    });
    bar.appendChild(sel);

    bar.appendChild(el("button", { class: "btn small secondary", text: "Очистить город", onclick: () => bulkAssign(null, container) }));
    bar.appendChild(el("button", { class: "btn small", text: "Скачать", onclick: () => bulkDownload(container) }));
    bar.appendChild(el("button", { class: "btn small danger", text: "Удалить зоны", onclick: () => bulkDelete(container) }));
    bar.appendChild(el("button", { class: "btn small secondary", text: "Снять выделение", onclick: () => { selected.clear(); render(container); } }));
    return bar;
  }

  async function bulkAssign(cityId, container) {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await window.api.zones.assignCityBulk(ids, cityId);
      selected.clear();
      toast(cityId == null ? "Город очищен у выбранных зон" : "Город назначен выбранным зонам", "ok");
      await render(container);
      App.refreshUnassignedBadge();
    } catch (err) {
      toast(errText(err, "Не удалось изменить город"), "error");
    }
  }

  async function bulkDelete(container) {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirm(`Удалить выбранные зоны (${ids.length})? Это действие необратимо.`, {
      title: "Удаление зон",
      danger: true,
      okLabel: "Удалить зоны",
    });
    if (!ok) return;
    try {
      await window.api.zones.deleteBulk(ids);
      selected.clear();
      toast("Выбранные зоны удалены", "ok");
      await render(container);
      App.refreshUnassignedBadge();
    } catch (err) {
      toast(errText(err, "Не удалось удалить"), "error");
    }
  }

  async function bulkDownload(container) {
    const ids = [...selected];
    if (!ids.length) return;
    const fmt = await modal({
      title: "Скачать выбранные зоны",
      bodyNode: el("p", { class: "modal-text", text: `Выбрано зон: ${ids.length}. В каком формате сохранить в папку?` }),
      actions: [
        { label: "Отмена", value: null, kind: "secondary" },
        { label: "GeoJSON", value: "geojson", kind: "primary" },
        { label: "XLSX", value: "xlsx", kind: "primary" },
      ],
    });
    if (!fmt) return;
    try {
      const res = await window.api.zones.exportManyToFolder(ids, fmt);
      if (!res.canceled) {
        toast(`Сохранено файлов: ${res.count}`, "ok");
        if (fmt === "xlsx") await render(container); // обновить даты генерации XLSX
      }
    } catch (err) {
      toast(errText(err, "Ошибка экспорта"), "error");
    }
  }

  // Чекбокс «выбрать все в группе».
  function groupSelectAll(ids, container) {
    const cb = el("input", { type: "checkbox", class: "group-check", title: "Выбрать все в группе" });
    cb.checked = ids.length > 0 && ids.every((id) => selected.has(id));
    cb.addEventListener("click", (e) => e.stopPropagation()); // не сворачивать details
    cb.addEventListener("change", () => {
      if (cb.checked) ids.forEach((id) => selected.add(id));
      else ids.forEach((id) => selected.delete(id));
      render(container);
    });
    return cb;
  }

  // ---------- строка зоны ----------
  function zoneRow(z, container, isUnassigned, index) {
    const checkbox = el("input", { type: "checkbox", class: "zone-check" });
    checkbox.checked = selected.has(z.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(z.id);
      else selected.delete(z.id);
      render(container);
    });

    const meta = el("div", { class: "zone-meta" }, [
      el("span", { class: "zone-date", text: `создана ${formatDate(z.created_at, false)}` }),
      el("span", { class: "zone-date", text: `GeoJSON ${formatDate(z.geojson_updated_at, false)}` }),
      el("span", { class: "zone-date", text: `XLSX ${z.xlsx_generated_at ? formatDate(z.xlsx_generated_at, false) : "—"}` }),
      el("span", { class: "zone-date", text: `точек: ${z.point_count == null ? "?" : z.point_count}` }),
    ]);

    return el("div", { class: "zone-row" + (isUnassigned ? " is-unassigned" : "") + (selected.has(z.id) ? " selected" : "") }, [
      checkbox,
      el("div", { class: "zone-num", text: index != null ? `${index}.` : "" }),
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
        App.refreshUnassignedBadge();
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
      el("div", { class: "dropzone-sub", text: "можно несколько сразу · только .geojson или .json · попадут в «не выбран город»" }),
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

  // Поясняющий блок об отклонённых файлах (не .geojson/.json или битый JSON).
  function buildRejectedNotice(container) {
    const box = el("div", { class: "reject-box" });
    box.appendChild(
      el("button", {
        class: "reject-close",
        text: "✕",
        title: "Скрыть",
        onclick: () => {
          importRejected = [];
          render(container);
        },
      })
    );
    box.appendChild(el("div", { class: "reject-title", text: "Не удалось загрузить файлы:" }));
    const ul = el("ul", { class: "reject-list" });
    importRejected.forEach((r) => ul.appendChild(el("li", {}, [
      el("b", { text: r.name }),
      el("span", { text: ` — ${r.reason}` }),
    ])));
    box.appendChild(ul);
    box.appendChild(el("div", { class: "reject-hint", text: "Загружать можно только файлы .geojson или .json с корректным содержимым." }));
    return box;
  }

  async function importFiles(fileList, container) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    importRejected = [];
    let ok = 0, empty = 0;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      // Проверка расширения — поясняющая надпись при «не том» файле.
      if (!lower.endsWith(".geojson") && !lower.endsWith(".json")) {
        importRejected.push({ name: file.name, reason: "не .geojson и не .json" });
        await safeLog("warn", `Импорт отклонён (не geojson/json): «${file.name}»`);
        continue;
      }

      let text;
      try {
        text = await file.text();
      } catch (e) {
        importRejected.push({ name: file.name, reason: "не удалось прочитать файл" });
        continue;
      }

      let parsed;
      try {
        parsed = window.GeoJSONLib.parseAndExtract(text);
      } catch (e) {
        importRejected.push({ name: file.name, reason: "файл не является корректным JSON" });
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
        importRejected.push({ name: file.name, reason: errText(e, "ошибка сохранения") });
      }
    }

    const parts = [];
    if (ok) parts.push(`загружено: ${ok}`);
    if (empty) parts.push(`без точек: ${empty}`);
    if (importRejected.length) parts.push(`отклонено: ${importRejected.length}`);
    toast(parts.join(" · ") || "Файлы не обработаны", importRejected.length && !ok ? "error" : "ok");
    await render(container);
    App.refreshUnassignedBadge();
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
      selected.delete(z.id);
      toast("Зона удалена", "ok");
      await render(container);
      App.refreshUnassignedBadge();
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
