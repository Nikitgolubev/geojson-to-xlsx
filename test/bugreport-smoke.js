"use strict";

// Смоук-тест сборки письма .eml. Чистый node: node test/bugreport-smoke.js

const assert = require("assert");
const { buildEml, encodeHeader } = require("../electron/bug-report");

// 1) Без вложения: заголовки + тело декодируется.
{
  const eml = buildEml({ to: "a@b.com", subject: "Привет мир", body: "Тело письма" });
  assert.ok(/^To: a@b\.com\r\n/m.test(eml), "заголовок To");
  assert.ok(eml.includes("Subject: =?UTF-8?B?"), "тема не-ASCII → encoded-word");
  assert.ok(eml.includes('Content-Type: text/plain; charset="UTF-8"'), "text/plain");
  const bodyB64 = eml.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assert.strictEqual(Buffer.from(bodyB64, "base64").toString("utf-8"), "Тело письма", "тело декодируется");
}

// 2) С вложением: multipart + base64 вложения и тела присутствуют.
{
  const content = Buffer.from("file-content-123");
  const eml = buildEml({
    to: "x@y.z", subject: "Bug", body: "see attach",
    attachment: { filename: "лог.txt", content },
  });
  assert.ok(/multipart\/mixed; boundary="/.test(eml), "multipart/mixed");
  assert.ok(eml.includes("Content-Disposition: attachment"), "disposition attachment");
  assert.ok(eml.includes(content.toString("base64")), "вложение в base64 присутствует");
  assert.ok(eml.includes(Buffer.from("see attach", "utf-8").toString("base64")), "тело в base64 присутствует");
  assert.ok(eml.includes("=?UTF-8?B?"), "кириллическое имя файла → encoded-word");
}

// 3) ASCII-заголовок не кодируется.
assert.strictEqual(encodeHeader("Hello"), "Hello");

console.log("BUGREPORT SMOKE OK ✔");
