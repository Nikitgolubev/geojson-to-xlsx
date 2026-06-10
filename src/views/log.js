"use strict";

// Вкладка «Журнал действий»: таблица из action_log (время, уровень, сообщение).
(function () {
  const App = window.App;
  const { el, formatDate, toast, confirm } = App;

  async function show(container) {
    const actions = document.getElementById("viewActions");
    actions.appendChild(
      el("button", { class: "btn small secondary", text: "Обновить", onclick: () => render(container) })
    );
    actions.appendChild(
      el("button", { class: "btn small danger", text: "Очистить журнал", onclick: () => clearLog(container) })
    );
    await render(container);
  }

  async function render(container) {
    container.innerHTML = "";
    const rows = await window.api.log.list(1000);
    if (!rows.length) {
      container.appendChild(el("div", { class: "empty", text: "Журнал пуст." }));
      return;
    }
    const table = el("table", { class: "log-table" });
    const thead = el("thead", {}, el("tr", {}, [
      el("th", { text: "Время" }),
      el("th", { text: "Уровень" }),
      el("th", { text: "Сообщение" }),
    ]));
    const tbody = el("tbody");
    rows.forEach((r) => {
      tbody.appendChild(
        el("tr", { class: "log-row level-" + r.level }, [
          el("td", { class: "log-ts", text: formatDate(r.ts) }),
          el("td", {}, el("span", { class: "log-level " + r.level, text: r.level })),
          el("td", { class: "log-msg", text: r.message }),
        ])
      );
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
  }

  async function clearLog(container) {
    const ok = await confirm("Очистить весь журнал действий?", {
      title: "Очистка журнала",
      danger: true,
      okLabel: "Очистить",
    });
    if (!ok) return;
    await window.api.log.clear();
    toast("Журнал очищен", "ok");
    await render(container);
  }

  App.registerView("log", { show });
})();
