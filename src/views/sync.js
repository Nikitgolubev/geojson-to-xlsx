"use strict";

// Вкладка «Обновление данных»: синхронизация городов+зон с GitHub.
// Отправить (push, нужен токен) / Получить (pull = полная замена) / Проверить
// актуальность. Токен видим и редактируем; лампочка доступности GitHub. Шкала
// загрузки + сворачиваемый журнал.
(function () {
  const App = window.App;
  const { el, toast, confirm } = App;

  let logEl = null, logCountEl = null, logCount = 0;
  let progressEl = null, lampEl = null, verdictEl = null, versionEl = null;
  let unsubProgress = null;

  async function show(container) {
    logCount = 0;

    // --- Токен + лампочка ---
    const tokenInput = el("input", { type: "text", class: "search-input sync-token", placeholder: "GitHub Personal Access Token (Contents: read/write)" });
    lampEl = el("span", { class: "sync-lamp", title: "Проверка доступа к GitHub…" });
    const saveTokenBtn = el("button", { class: "btn small", text: "Сохранить токен", onclick: () => saveToken(tokenInput) });
    const helpBtn = el("button", { class: "btn small secondary", text: "Как создать токен", onclick: () => {
      window.api.system.openExternal("https://github.com/settings/tokens?type=beta");
    } });
    const tokenRow = el("div", { class: "sync-token-row" }, [
      el("label", { class: "addr-input-label", text: "Токен:" }),
      lampEl,
      el("div", { class: "addr-input-wrap" }, [tokenInput]),
      saveTokenBtn,
      helpBtn,
    ]);

    // --- Статус версии + вердикт ---
    versionEl = el("div", { class: "sync-version", text: "Версия данных в хранилище: —" });
    verdictEl = el("div", { class: "sync-verdict", text: "Нажмите «Проверить актуальность»." });

    // --- Кнопки действий ---
    const checkBtn = el("button", { class: "btn", text: "Проверить актуальность", onclick: doCheck });
    const pushBtn = el("button", { class: "btn primary", text: "Отправить данные в хранилище", onclick: doPush });
    const pullBtn = el("button", { class: "btn secondary", text: "Получить данные из хранилища", onclick: doPull });
    const actions = el("div", { class: "sync-actions" }, [checkBtn, pushBtn, pullBtn]);

    // --- Шкала загрузки ---
    progressEl = el("progress", { class: "sync-progress", value: "0", max: "100", hidden: "" });
    const progressText = el("span", { class: "sync-progress-text" });
    progressEl._text = progressText;
    const progressWrap = el("div", { class: "sync-progress-wrap" }, [progressEl, progressText]);

    // --- Журнал (сворачиваемый) ---
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

    container.appendChild(tokenRow);
    container.appendChild(versionEl);
    container.appendChild(verdictEl);
    container.appendChild(actions);
    container.appendChild(progressWrap);
    container.appendChild(logDetails);

    // Подписка на прогресс из main.
    if (unsubProgress) unsubProgress();
    unsubProgress = window.api.on("sync:progress", (p) => setProgress(p.percent, p.text));

    // Загрузить токен и проверить доступность (лампочка).
    try {
      const { token } = await window.api.sync.getToken();
      if (token) tokenInput.value = token;
    } catch (_) {}
    pingLamp();
  }

  async function saveToken(tokenInput) {
    try {
      await window.api.sync.setToken(tokenInput.value.trim());
      toast("Токен сохранён", "ok");
      log("Токен сохранён", "ok");
      pingLamp();
    } catch (err) {
      toast("Не удалось сохранить токен", "error");
      log(`✗ ${errText(err)}`, "err");
    }
  }

  // Лампочка доступности GitHub с текущим токеном.
  async function pingLamp() {
    if (lampEl) { lampEl.className = "sync-lamp"; lampEl.title = "Проверка доступа к GitHub…"; }
    try {
      const r = await window.api.sync.ping();
      if (lampEl) {
        lampEl.className = "sync-lamp " + (r.ok ? "ok" : "err");
        lampEl.title = r.ok ? "GitHub доступен с этим токеном" : `Недоступно (код ${r.status})`;
      }
      log(r.ok ? "GitHub доступен (лампочка зелёная)" : `GitHub недоступен: код ${r.status}`, r.ok ? "ok" : "err");
    } catch (err) {
      if (lampEl) { lampEl.className = "sync-lamp err"; lampEl.title = "Ошибка проверки доступа"; }
      log(`✗ Проверка доступа: ${errText(err)}`, "err");
    }
  }

  async function doCheck() {
    log("Проверка актуальности…", "info");
    try {
      const r = await window.api.sync.check();
      if (!r.ok) { setVerdict("err", "Ошибка: " + r.error); log("✗ " + r.error, "err"); return; }
      if (r.remote) {
        versionEl.textContent = `Версия данных в хранилище: №${r.remote.version} от ${fmt(r.remote.savedAt)} (городов: ${r.remote.counts.cities}, зон: ${r.remote.counts.zones})`;
      } else {
        versionEl.textContent = "Версия данных в хранилище: — (пусто)";
      }
      const cls = r.verdict.status === "ok" ? "ok" : (r.verdict.status === "diverged" || r.verdict.status === "remote-ahead" ? "err" : "warn");
      setVerdict(cls, r.verdict.message);
      log("Итог: " + r.verdict.message, cls === "ok" ? "ok" : (cls === "err" ? "err" : "info"));
    } catch (err) {
      setVerdict("err", errText(err));
      log("✗ " + errText(err), "err");
    }
  }

  async function doPush() {
    const ok = await confirm("Отправить текущие данные (города и зоны) в хранилище GitHub? Будет создана новая версия.", {
      title: "Отправка данных", okLabel: "Отправить",
    });
    if (!ok) return;
    showProgress(true);
    log("Отправка данных в хранилище…", "info");
    try {
      const r = await window.api.sync.push();
      toast(`Данные отправлены (версия ${r.version})`, "ok");
      log(`✓ Отправлено: версия ${r.version} (городов: ${r.counts.cities}, зон: ${r.counts.zones})`, "ok");
      await doCheck();
    } catch (err) {
      toast("Ошибка отправки", "error");
      log("✗ " + errText(err), "err");
    } finally {
      setTimeout(() => showProgress(false), 600);
    }
  }

  async function doPull() {
    const ok = await confirm("Получить данные из хранилища? Текущие локальные данные будут ПОЛНОСТЬЮ ЗАМЕНЕНЫ версией из GitHub. Перед заменой будет сохранена резервная копия в «Загрузки».", {
      title: "Получение данных", okLabel: "Заменить локальные", danger: true,
    });
    if (!ok) return;
    showProgress(true);
    log("Получение данных из хранилища…", "info");
    try {
      const r = await window.api.sync.pull();
      toast(`Данные получены (городов: ${r.counts.cities}, зон: ${r.counts.zones})`, "ok");
      log(`✓ Данные заменены: городов ${r.counts.cities}, зон ${r.counts.zones}`, "ok");
      await doCheck();
    } catch (err) {
      toast("Ошибка получения", "error");
      log("✗ " + errText(err), "err");
    } finally {
      setTimeout(() => showProgress(false), 600);
    }
  }

  // ---------- хелперы UI ----------
  function setVerdict(cls, text) {
    if (!verdictEl) return;
    verdictEl.className = "sync-verdict " + cls;
    verdictEl.textContent = text;
  }
  function showProgress(on) {
    if (progressEl) progressEl.hidden = !on;
    if (!on) setProgress(0, "");
  }
  function setProgress(percent, text) {
    if (progressEl) { progressEl.hidden = false; progressEl.value = percent || 0; }
    if (progressEl && progressEl._text) progressEl._text.textContent = text ? `${percent}% — ${text}` : "";
  }
  function fmt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }
  function errText(err) { return (err && err.message) ? err.message : String(err); }

  function log(text, kind) {
    if (!logEl) return;
    logEl.appendChild(el("li", { class: kind || "info" }, [
      el("span", { class: "addr-log-time", text: new Date().toLocaleTimeString() }),
      el("span", { text: text }),
    ]));
    logCount++;
    if (logCountEl) logCountEl.textContent = String(logCount);
  }
  function clearLog() { if (logEl) logEl.innerHTML = ""; logCount = 0; if (logCountEl) logCountEl.textContent = "0"; }

  App.registerView("sync", { show });
})();
