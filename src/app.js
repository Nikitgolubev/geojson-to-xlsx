"use strict";

// Ядро renderer: роутинг вкладок + переиспользуемые UI-хелперы.
// Данные берутся только через window.api (мост из preload). DOM-логика вкладок —
// в src/views/*.js, каждая регистрируется через App.registerView().

window.App = (function () {
  const views = {};
  const titles = {
    catalog: "Города",
    zones: "Зоны",
    map: "Карта",
    addrcheck: "Проверка адреса",
    log: "Журнал действий",
  };
  let current = null;

  // ---------- утилиты ----------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Создание DOM-элемента: el('div', {class:'x', onclick:fn}, [children|text])
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "dataset") {
          Object.assign(node.dataset, v);
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  // SQLite хранит datetime('now') в UTC ("YYYY-MM-DD HH:MM:SS"). Показываем локально.
  function formatDate(s, withTime) {
    if (!s) return "—";
    const iso = String(s).replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(s);
    const date = d.toLocaleDateString("ru-RU");
    if (withTime === false) return date;
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
  }

  // ---------- иконки (inline-SVG, без сети, CSP-safe) ----------
  const ICON_PATHS = {
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
    map: ["M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z", "M9 3v15", "M15 6v15"],
    pencil: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"],
    trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"],
    eye: ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
    chevron: ["M6 9l6 6 6-6"],
  };
  function icon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "icon");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    (ICON_PATHS[name] || []).forEach((d) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  // ---------- тосты ----------
  function toast(message, type) {
    const root = document.getElementById("toastRoot");
    const node = el("div", { class: "toast " + (type || "info"), text: message });
    root.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 250);
    }, 3200);
  }

  // ---------- модалки ----------
  // Базовая модалка. actions: [{label, value, kind}]. Возвращает Promise<value>.
  function modal({ title, bodyNode, actions }) {
    return new Promise((resolve) => {
      const root = document.getElementById("modalRoot");
      const overlay = el("div", { class: "modal-overlay" });
      const box = el("div", { class: "modal" });

      box.appendChild(el("div", { class: "modal-title", text: title || "" }));
      const body = el("div", { class: "modal-body" });
      if (bodyNode) body.appendChild(bodyNode);
      box.appendChild(body);

      const foot = el("div", { class: "modal-foot" });
      function close(val) {
        overlay.classList.remove("show");
        setTimeout(() => overlay.remove(), 180);
        resolve(val);
      }
      (actions || [{ label: "OK", value: true, kind: "primary" }]).forEach((a) => {
        foot.appendChild(
          el("button", {
            class: "btn " + (a.kind || "secondary"),
            text: a.label,
            onclick: () => close(a.value),
          })
        );
      });
      box.appendChild(foot);
      overlay.appendChild(box);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(undefined);
      });
      document.addEventListener("keydown", function onEsc(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onEsc);
          close(undefined);
        }
      });
      root.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("show"));
    });
  }

  // Подтверждение (да/нет). danger=true красит кнопку подтверждения.
  function confirm(message, opts) {
    const o = opts || {};
    return modal({
      title: o.title || "Подтверждение",
      bodyNode: el("p", { class: "modal-text", text: message }),
      actions: [
        { label: o.cancelLabel || "Отмена", value: false, kind: "secondary" },
        { label: o.okLabel || "Удалить", value: true, kind: o.danger ? "danger" : "primary" },
      ],
    }).then((v) => v === true);
  }

  // Ввод строки. Возвращает Promise<string|null>.
  function prompt(message, initial, opts) {
    const o = opts || {};
    const input = el("input", { class: "modal-input", type: "text", value: initial || "" });
    const body = el("div", {}, [
      el("p", { class: "modal-text", text: message }),
      input,
    ]);
    const p = modal({
      title: o.title || "Ввод",
      bodyNode: body,
      actions: [
        { label: "Отмена", value: "__CANCEL__", kind: "secondary" },
        { label: o.okLabel || "Сохранить", value: "__OK__", kind: "primary" },
      ],
    }).then((v) => (v === "__OK__" ? input.value.trim() : null));
    setTimeout(() => {
      input.focus();
      input.select();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const btn = document.querySelector(".modal-foot .btn.primary");
          if (btn) btn.click();
        }
      });
    }, 50);
    return p;
  }

  // ---------- роутинг ----------
  function registerView(name, view) {
    views[name] = view;
  }

  function setActiveNav(name) {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
  }

  async function navigate(name, payload) {
    if (!views[name]) return;
    current = name;
    setActiveNav(name);
    document.getElementById("viewTitle").textContent = titles[name] || name;
    document.getElementById("viewActions").innerHTML = "";
    const body = document.getElementById("viewBody");
    body.innerHTML = "";
    try {
      await views[name].show(body, payload || {});
    } catch (err) {
      body.appendChild(el("div", { class: "error-box", text: "Ошибка: " + (err && err.message ? err.message : err) }));
    }
    refreshUnassignedBadge();
  }

  // Счётчик зон «без города» у пункта «Зоны» в навигации.
  async function refreshUnassignedBadge() {
    const badge = document.getElementById("zonesBadge");
    if (!badge) return;
    try {
      const n = await window.api.zones.countUnassigned();
      if (n > 0) {
        badge.textContent = String(n);
        badge.hidden = false;
      } else {
        badge.textContent = "";
        badge.hidden = true;
      }
    } catch (_) {
      badge.textContent = "";
      badge.hidden = true;
    }
  }

  // Окно «О программе» (вызывается из верхнего меню Помощь).
  function showHelp() {
    const body = el("div", { class: "help-body" });
    body.innerHTML = `
      <p><strong>polygons</strong> — программа для хранения и систематизации
      <em>зон</em> (полигонов GeoJSON), сгруппированных по городам. Зоны используются
      для расчёта стоимости перевозки и проверки входимости адреса в зону.</p>
      <p><strong>Разделы (левое меню):</strong></p>
      <ul>
        <li><b>Зоны</b> — загрузка .geojson (перетаскиванием или кнопкой), список
          город→зоны, секция «не выбран город», поиск, множественный выбор и массовые
          операции, скачивание GeoJSON/XLSX, переименование, удаление.</li>
        <li><b>Города</b> — справочник городов: добавление, переименование, удаление
          (зоны при этом не удаляются, а открепляются).</li>
        <li><b>Карта</b> — отображение полигона выбранной зоны на карте (поиск по названию).</li>
        <li><b>Журнал</b> — история действий в программе.</li>
      </ul>
      <p><strong>Верхнее меню:</strong></p>
      <ul>
        <li><b>Файл → Экспортировать все данные в папки</b> — выгрузка всех зон в папки
          по городам (подпапки <i>Город_geojson</i> и <i>Город_xlsx</i>).</li>
        <li><b>Файл → Сохранить / Загрузить резервную копию</b> — перенос всех данных
          (города и зоны) в другой компьютер или копию программы.</li>
        <li><b>Вид → Тема</b> — переключение светлой и тёмной темы (также кнопкой
          у версии в левом нижнем углу).</li>
        <li><b>Помощь → Обратная связь / Сообщить об ошибке</b> — контакты и форма
          письма с вложением.</li>
      </ul>
      <p><b>Важно:</b> переименование города или зоны в программе не меняет содержимое
      исходных файлов GeoJSON.</p>`;
    modal({
      title: "О программе",
      bodyNode: body,
      actions: [{ label: "Закрыть", value: true, kind: "primary" }],
    });
  }

  // Обратная связь: ссылка на репозиторий + почта (открываются во внешних приложениях).
  function showFeedback() {
    const repo = "https://github.com/Nikitgolubev/geojson-to-xlsx";
    const email = "nikitgolubev@gmail.com";
    const open = (url) => {
      if (window.api && window.api.system) window.api.system.openExternal(url);
    };
    const linkGh = el("a", { href: "#", text: repo, onclick: (e) => { e.preventDefault(); open(repo); } });
    const linkMail = el("a", { href: "#", text: email, onclick: (e) => { e.preventDefault(); open("mailto:" + email); } });
    const body = el("div", { class: "help-body" }, [
      el("p", {}, ["Репозиторий проекта на GitHub:"]),
      el("p", {}, [linkGh]),
      el("p", {}, ["Почта для связи:"]),
      el("p", {}, [linkMail]),
    ]);
    modal({ title: "Обратная связь", bodyNode: body, actions: [{ label: "Закрыть", value: true, kind: "primary" }] });
  }

  // Сообщить об ошибке: тема/текст/вложение → формируется .eml и открывается в почте.
  async function showBugReport() {
    const subject = el("input", { class: "modal-input", type: "text", placeholder: "Кратко о проблеме" });
    const text = el("textarea", { class: "modal-input", rows: "6", placeholder: "Опишите, что произошло…" });
    let attachmentPath = null;
    const attachName = el("span", { class: "attach-name", text: "файл не выбран" });
    const attachBtn = el("button", {
      class: "btn small secondary", type: "button", text: "Прикрепить файл",
      onclick: async () => {
        if (!(window.api && window.api.system)) return;
        const f = await window.api.system.pickAttachment();
        if (f) { attachmentPath = f.path; attachName.textContent = f.name; }
      },
    });
    const body = el("div", {}, [
      el("label", { class: "modal-label", text: "Тема:" }), subject,
      el("label", { class: "modal-label", text: "Текст:" }), text,
      el("label", { class: "modal-label", text: "Вложение:" }),
      el("div", { class: "attach-row" }, [attachBtn, attachName]),
    ]);
    const ok = await modal({
      title: "Сообщить об ошибке",
      bodyNode: body,
      actions: [
        { label: "Отмена", value: false, kind: "secondary" },
        { label: "Отправить", value: true, kind: "primary" },
      ],
    });
    if (!ok) return;
    try {
      const res = await window.api.system.sendBugReport({
        subject: subject.value.trim() || "Сообщение об ошибке (polygons)",
        body: text.value,
        attachmentPath,
      });
      if (res && res.ok) toast("Письмо подготовлено — откроется в почтовом клиенте", "ok");
      else toast("Не удалось подготовить письмо", "error");
    } catch (e) {
      toast("Ошибка: " + (e && e.message ? e.message : e), "error");
    }
  }

  // ---------- темы (светлая/тёмная) ----------
  function getTheme() {
    try {
      return localStorage.getItem("theme") === "dark" ? "dark" : "light";
    } catch (_) {
      return "light";
    }
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t === "dark" ? "dark" : "light";
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = t === "dark" ? "☀" : "🌙";
      btn.title = t === "dark" ? "Светлая тема" : "Тёмная тема";
    }
  }
  function setTheme(t) {
    const v = t === "dark" ? "dark" : "light";
    try {
      localStorage.setItem("theme", v);
    } catch (_) {}
    applyTheme(v);
  }
  function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }

  // ---------- ширина сайдбара (перетаскивание) ----------
  const SIDEBAR_MIN = 160, SIDEBAR_MAX = 460;
  let lastSidebarW = null;
  function applySidebarWidth(px) {
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
    document.documentElement.style.setProperty("--sidebar-w", w + "px");
    lastSidebarW = w;
  }
  function setupSidebarResize() {
    const resizer = document.getElementById("sidebarResizer");
    if (!resizer) return;
    const saved = parseInt(localStorage.getItem("sidebarW") || "", 10);
    if (Number.isFinite(saved)) applySidebarWidth(saved);
    let dragging = false;
    resizer.addEventListener("mousedown", (e) => {
      dragging = true;
      resizer.classList.add("dragging");
      document.body.classList.add("resizing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (dragging) applySidebarWidth(e.clientX);
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove("dragging");
      document.body.classList.remove("resizing");
      if (lastSidebarW != null) {
        try { localStorage.setItem("sidebarW", String(lastSidebarW)); } catch (_) {}
      }
    });
  }

  function init() {
    applyTheme(getTheme()); // применяем сохранённую тему до отрисовки
    setupSidebarResize();
    const tt = document.getElementById("themeToggle");
    if (tt) tt.addEventListener("click", () => toggleTheme());

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => navigate(btn.dataset.view));
    });
    // События из верхнего меню и при изменении данных (импорт резервной копии).
    if (window.api && window.api.on) {
      window.api.on("menu:help", () => showHelp());
      window.api.on("menu:feedback", () => showFeedback());
      window.api.on("menu:bug", () => showBugReport());
      window.api.on("menu:set-theme", (v) => setTheme(v));
      window.api.on("data:changed", () => {
        if (current) navigate(current);
      });
    }
    navigate("zones");
    refreshUnassignedBadge();
  }

  return {
    registerView,
    navigate,
    init,
    el,
    icon,
    escapeHtml,
    formatDate,
    toast,
    modal,
    confirm,
    prompt,
    refreshUnassignedBadge,
    showHelp,
    setTheme,
    toggleTheme,
    getTheme,
    get current() {
      return current;
    },
  };
})();
