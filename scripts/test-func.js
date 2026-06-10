"use strict";

// Функциональный тест пути renderer→IPC→БД (GZ_FUNCTEST) в изолированной БД.

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.GZ_DEBUG = "1";
env.GZ_FUNCTEST = "1";
env.GZ_TESTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "gz-func-"));

const root = path.join(__dirname, "..");
const child = spawn(electronBinary, ["."], { stdio: "inherit", env, cwd: root });
child.on("close", (code) => {
  try { fs.rmSync(env.GZ_TESTDIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(code == null ? 0 : code);
});
