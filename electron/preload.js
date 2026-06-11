"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Безопасный мост между renderer (UI) и главным процессом.
// UI обращается к данным ТОЛЬКО через window.api — прямого доступа к Node/SQL нет.

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

// События main→renderer разрешены только из белого списка каналов.
const ALLOWED_EVENTS = new Set([
  "menu:help", "data:changed", "menu:set-theme", "menu:feedback", "menu:bug",
]);

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
    countUnassigned: () => invoke("zones:countUnassigned"),
    get: (id) => invoke("zones:get", id),
    // payload: { name, geojson, cityId?, pointCount?, sourceFilename? }
    create: (payload) => invoke("zones:create", payload),
    findByName: (name) => invoke("zones:findByName", name),
    updateGeojson: (id, payload) => invoke("zones:updateGeojson", id, payload),
    rename: (id, name) => invoke("zones:rename", id, name),
    assignCity: (id, cityId) => invoke("zones:assignCity", id, cityId),
    assignCityBulk: (ids, cityId) => invoke("zones:assignCityBulk", ids, cityId),
    move: (id, newCityId) => invoke("zones:move", id, newCityId),
    delete: (id) => invoke("zones:delete", id),
    deleteBulk: (ids) => invoke("zones:deleteBulk", ids),
    exportGeojson: (id) => invoke("zones:exportGeojson", id),
    exportXlsx: (id) => invoke("zones:exportXlsx", id),
    exportManyToFolder: (ids, format) => invoke("zones:exportManyToFolder", ids, format),
  },
  log: {
    list: (limit) => invoke("log:list", limit),
    append: (level, message) => invoke("log:append", level, message),
    clear: () => invoke("log:clear"),
  },
  system: {
    openExternal: (url) => invoke("system:openExternal", url),
    pickAttachment: () => invoke("system:pickAttachment"),
    sendBugReport: (payload) => invoke("system:sendBugReport", payload),
  },
  // Подписка на события из main (только разрешённые каналы). Возвращает отписку.
  on: (channel, callback) => {
    if (!ALLOWED_EVENTS.has(channel) || typeof callback !== "function") return () => {};
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
