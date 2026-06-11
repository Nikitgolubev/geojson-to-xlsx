"use strict";

// Генерация иконки приложения «карта с локатором».
// Рисуем SVG → растрируем через Electron-canvas → build/icon.png (256),
// затем собираем build/icon.ico (контейнер вокруг PNG, без внешних зависимостей).
// Запуск: env -u ELECTRON_RUN_AS_NODE <electron> scripts/make-icon.js
// (или npm run make:icon). Результат коммитим; CI его просто использует.

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a93ff"/>
      <stop offset="1" stop-color="#0057d8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#bg)"/>
  <!-- сложенная карта -->
  <g>
    <path d="M40 135 L95 118 L150 135 L210 118 L210 200 L150 217 L95 200 L40 217 Z"
          fill="#ffffff" opacity="0.96"/>
    <path d="M95 118 L95 200 M150 135 L150 217" stroke="#9bbce6" stroke-width="5" fill="none"/>
    <path d="M52 152 H198 M52 170 H198 M52 188 H198" stroke="#dbe7f7" stroke-width="4"
          fill="none" stroke-linecap="round" opacity="0.8"/>
  </g>
  <!-- локатор (пин) -->
  <g>
    <path d="M128 40 a44 44 0 0 1 44 44 c0 33 -44 80 -44 80 s-44 -47 -44 -80 a44 44 0 0 1 44 -44 z"
          fill="#ff5a3c"/>
    <circle cx="128" cy="84" r="20" fill="#ffffff"/>
  </g>
</svg>`;

// ICO-контейнер вокруг одного 256×256 PNG (width/height=0 означает 256).
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width 256
  entry.writeUInt8(0, 1); // height 256
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

app.whenReady().then(async () => {
  const outDir = path.join(__dirname, "..", "build");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "icon.svg"), SVG, "utf-8");

  const win = new BrowserWindow({ width: 256, height: 256, show: false });
  await win.loadURL("data:text/html,<html><body></body></html>");

  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const svg = ${JSON.stringify(SVG)};
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 256, 256);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('SVG не загрузился'));
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  })`);

  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(path.join(outDir, "icon.png"), png);
  fs.writeFileSync(path.join(outDir, "icon.ico"), pngToIco(png));

  console.log("ICON OK png=" + png.length + " ico=" + (png.length + 22));
  app.exit(0);
});
