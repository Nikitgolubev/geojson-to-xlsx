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
  }

  function init() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => navigate(btn.dataset.view));
    });
    navigate("catalog");
  }

  return {
    registerView,
    navigate,
    init,
    el,
    escapeHtml,
    formatDate,
    toast,
    modal,
    confirm,
    prompt,
    get current() {
      return current;
    },
  };
})();
