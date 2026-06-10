"use strict";

// Точка инициализации UI. Отдельный файл (а не inline-скрипт), чтобы не ослаблять
// CSP разрешением 'unsafe-inline' для script-src.
document.addEventListener("DOMContentLoaded", () => {
  if (!window.api) {
    document.getElementById("viewBody").textContent =
      "Критическая ошибка: мост window.api недоступен.";
    return;
  }
  window.App.init();
});
