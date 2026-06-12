"use strict";

// Сравнение версий и разбор ответа GitHub Releases. Чистый модуль — тестируется.

function normalize(v) {
  return String(v == null ? "" : v).trim().replace(/^v/i, "");
}

// Числовое посекционное сравнение. true, если latest строго новее current.
function isNewer(latest, current) {
  const a = normalize(latest).split(".").map((n) => parseInt(n, 10) || 0);
  const b = normalize(current).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Разбор ответа GitHub /releases/latest → { tag, htmlUrl, assetUrl }.
function parseLatest(json) {
  const obj = typeof json === "string" ? JSON.parse(json) : json;
  if (!obj || !obj.tag_name) throw new Error("Некорректный ответ GitHub");
  let assetUrl = obj.html_url;
  if (Array.isArray(obj.assets)) {
    const exe = obj.assets.find((a) => /\.exe$/i.test((a && a.name) || ""));
    if (exe && exe.browser_download_url) assetUrl = exe.browser_download_url;
  }
  return { tag: obj.tag_name, htmlUrl: obj.html_url, assetUrl: assetUrl };
}

module.exports = { isNewer, normalize, parseLatest };
