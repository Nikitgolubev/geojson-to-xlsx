"use strict";

// Устойчивый запуск Electron.
// VSCode (сам написан на Electron) выставляет в интегрированном терминале
// переменную ELECTRON_RUN_AS_NODE=1. Из-за неё `electron .` стартует как обычный
// Node, и require('electron') не отдаёт API (app === undefined). Чтобы `npm start`
// работал в т.ч. из терминала VSCode, сбрасываем эту переменную для дочернего процесса.

const { spawn } = require("child_process");
const electronBinary = require("electron"); // в обычном Node возвращает путь к бинарю

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electronBinary, ["."], { stdio: "inherit", env });

child.on("close", (code) => process.exit(code == null ? 0 : code));
