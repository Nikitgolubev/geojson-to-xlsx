"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Безопасный мост между renderer (UI) и главным процессом.
// UI обращается к данным ТОЛЬКО через window.api — прямого доступа к Node/SQL нет.
// Полный набор методов появляется на Этапе 1 (cities/zones/log).

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("api", {
  cities: {
    list: () => invoke("cities:list"),
    create: (name) => invoke("cities:create", name),
    rename: (id, name) => invoke("cities:rename", id, name),
    delete: (id) => invoke("cities:delete", id),
  },
  zones: {
    listByCity: (cityId) => invoke("zones:listByCity", cityId),
    listUnassigned: () => invoke("zones:listUnassigned"),
    get: (id) => invoke("zones:get", id),
    create: (name, geojson, cityId) => invoke("zones:create", name, geojson, cityId),
    rename: (id, name) => invoke("zones:rename", id, name),
    assignCity: (id, cityId) => invoke("zones:assignCity", id, cityId),
    move: (id, newCityId) => invoke("zones:move", id, newCityId),
    delete: (id) => invoke("zones:delete", id),
    importFiles: (files, cityId) => invoke("zones:importFiles", files, cityId),
    exportGeojson: (id) => invoke("zones:exportGeojson", id),
    exportXlsx: (id) => invoke("zones:exportXlsx", id),
  },
  log: {
    list: (limit) => invoke("log:list", limit),
    append: (level, message) => invoke("log:append", level, message),
    clear: () => invoke("log:clear"),
  },
});
