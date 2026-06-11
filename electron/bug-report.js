"use strict";

// Сборка письма в формате .eml (RFC822) с опциональным вложением (base64).
// Чистый модуль без зависимостей — открывается в почтовом клиенте через shell.openPath.

// MIME encoded-word для не-ASCII заголовков (UTF-8 → base64).
function encodeHeader(text) {
  const s = String(text == null ? "" : text);
  if (/^[\x00-\x7F]*$/.test(s)) return s; // eslint-disable-line no-control-regex
  return "=?UTF-8?B?" + Buffer.from(s, "utf-8").toString("base64") + "?=";
}

// Разбить base64 на строки по 76 символов (требование MIME).
function wrap76(b64) {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/**
 * @param {{to:string, from?:string, subject:string, body:string,
 *          attachment?:{filename:string, content:Buffer|Uint8Array, mime?:string}}} opts
 * @returns {string} содержимое .eml
 */
function buildEml(opts) {
  const o = opts || {};
  const lines = [];
  lines.push("To: " + (o.to || ""));
  if (o.from) lines.push("From: " + o.from);
  lines.push("Subject: " + encodeHeader(o.subject || ""));
  lines.push("MIME-Version: 1.0");

  const bodyB64 = wrap76(Buffer.from(o.body || "", "utf-8").toString("base64"));

  if (o.attachment && o.attachment.content != null) {
    const a = o.attachment;
    const boundary = "=_polygons_" + Date.now().toString(36);
    lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    lines.push("");
    lines.push("--" + boundary);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(bodyB64);
    lines.push("--" + boundary);
    lines.push("Content-Type: " + (a.mime || "application/octet-stream") + '; name="' + encodeHeader(a.filename) + '"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push('Content-Disposition: attachment; filename="' + encodeHeader(a.filename) + '"');
    lines.push("");
    lines.push(wrap76(Buffer.from(a.content).toString("base64")));
    lines.push("--" + boundary + "--");
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(bodyB64);
  }

  return lines.join("\r\n") + "\r\n";
}

module.exports = { buildEml, encodeHeader };
