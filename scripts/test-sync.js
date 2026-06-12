"use strict";

// Регресс-тест вкладки «Обновление данных»: монтирование (токен/лампочка/кнопки/
// шкала/журнал) + IPC токена. Запуск внутри Electron в изолированной БД/userData.

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const electronBinary = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
env.GZ_SYNCTEST = "1";
env.GZ_TESTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "gz-sync-"));

const child = spawn(electronBinary, ["."], { stdio: "inherit", env });
child.on("close", (code) => {
  try { fs.rmSync(env.GZ_TESTDIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(code == null ? 0 : code);
});
