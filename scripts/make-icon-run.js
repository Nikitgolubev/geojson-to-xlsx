"use strict";

// Запуск генератора иконки внутри Electron (нужен Electron-canvas для растрирования).
// Сбрасывает ELECTRON_RUN_AS_NODE (см. scripts/start.js).

const path = require("path");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const script = path.join(__dirname, "make-icon.js");
const child = spawn(electronBinary, [script], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code == null ? 0 : code));
