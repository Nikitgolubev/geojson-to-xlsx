"use strict";

// Верхнее меню приложения (на русском). Пункты, меняющие/экспортирующие данные,
// вызывают переданные коллбэки из main.js; «О программе» уходит в renderer событием.

const { Menu } = require("electron");

function buildAppMenu(actions) {
  const a = actions || {};
  const template = [
    {
      label: "Файл",
      submenu: [
        { label: "Экспортировать все данные в папки…", click: a.onExportFolders },
        { type: "separator" },
        { label: "Сохранить резервную копию…", click: a.onExportBackup },
        { label: "Загрузить резервную копию…", click: a.onImportBackup },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
        { type: "separator" },
        { role: "resetZoom", label: "Сбросить масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
      ],
    },
    {
      label: "Помощь",
      submenu: [{ label: "О программе", click: a.onHelp }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildAppMenu };
