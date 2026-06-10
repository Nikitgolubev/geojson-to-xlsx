"use strict";

// Вкладка «Города»: справочник городов (CRUD).
// Удаление города не удаляет зоны — они открепляются (см. db.js, ON DELETE SET NULL).
(function () {
  const App = window.App;
  const { el, formatDate, toast, confirm, prompt } = App;

  async function show(container) {
    const actions = document.getElementById("viewActions");
    actions.appendChild(
      el("button", { class: "btn primary", text: "+ Добавить город", onclick: () => addCity(container) })
    );
    await render(container);
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
    cities.forEach((c) => list.appendChild(cityCard(c, container)));
    container.appendChild(list);
  }

  function cityCard(c, container) {
    return el("div", { class: "card" }, [
      el("div", { class: "card-main" }, [
        el("div", { class: "card-title", text: c.name }),
        el("div", {
          class: "card-sub",
          text: `Зон: ${c.zone_count} · создан ${formatDate(c.created_at)}`,
        }),
      ]),
      el("div", { class: "card-actions" }, [
        el("button", {
          class: "btn small secondary",
          text: "Переименовать",
          onclick: () => renameCity(c, container),
        }),
        el("button", {
          class: "btn small danger",
          text: "Удалить",
          onclick: () => deleteCity(c, container),
        }),
      ]),
    ]);
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
