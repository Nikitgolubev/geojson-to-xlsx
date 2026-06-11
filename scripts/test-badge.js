"use strict";

// Регресс-тест бейджа «без города»: при нуле незакреплённых зон счётчик должен
// скрываться (а не показывать устаревшее число). Запуск внутри Electron в
// изолированной временной БД. Сбрасывает ELECTRON_RUN_AS_NODE (см. scripts/start.js).

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.GZ_BADGETEST = "1";
env.GZ_TESTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "gz-badge-"));

const child = spawn(electronBinary, ["."], { stdio: "inherit", env });
child.on("close", (code) => {
  try { fs.rmSync(env.GZ_TESTDIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(code == null ? 0 : code);
});
