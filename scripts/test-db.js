"use strict";

// Запуск смоук-теста слоя данных внутри Electron (нужен ABI Electron для
// better-sqlite3). Сбрасывает ELECTRON_RUN_AS_NODE — см. scripts/start.js.

const path = require("path");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const testFile = path.join(__dirname, "..", "test", "db-smoke.js");
const child = spawn(electronBinary, [testFile], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code == null ? 0 : code));
