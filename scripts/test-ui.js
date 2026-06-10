"use strict";

// UI-самопроверка: обойти все вкладки и выгрузить их состояние (GZ_SELFTEST).
// Использует изолированную временную БД, чтобы не трогать данные пользователя.

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.GZ_DEBUG = "1";
env.GZ_SELFTEST = "1";
env.GZ_TESTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "gz-ui-"));

const root = path.join(__dirname, "..");
const child = spawn(electronBinary, ["."], { stdio: "inherit", env, cwd: root });
child.on("close", (code) => {
  try { fs.rmSync(env.GZ_TESTDIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(code == null ? 0 : code);
});
