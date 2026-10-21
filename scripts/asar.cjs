"use strict";
const crypto = require("node:crypto");
const BEGIN = "/* typora-easy-edit:main:start */";
const END = "/* typora-easy-edit:main:end */";
const HOOK = '\n' + BEGIN + '\ntry { require("../easy-edit/main.js").start(); } catch (error) { console.error("[Easy Edit] Native menu hook failed", error); }\n' + END;

function readArchive(buffer) {
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) throw new Error("无法识别 Typora app.asar 文件头。");
  const headerLength = buffer.readUInt32LE(4), jsonLength = buffer.readUInt32LE(12);
  if (jsonLength > headerLength - 8 || 8 + headerLength > buffer.length) throw new Error("Typora app.asar 文件头损坏。");
  const header = JSON.parse(buffer.subarray(16, 16 + jsonLength).toString("utf8"));
  return { header, payload: buffer.subarray(8 + headerLength) };
}
function readEntry(buffer, name) {
  const archive = readArchive(buffer);
  let entry = archive.header;
  for (const part of name.split("/")) entry = entry.files && entry.files[part];
  if (!entry || entry.unpacked || entry.link || !Number.isSafeInteger(entry.size)) throw new Error("app.asar 中缺少可编辑入口：" + name);
  const offset = Number(entry.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + entry.size > archive.payload.length) throw new Error("app.asar 入口偏移无效。");
  return { archive, entry, data: archive.payload.subarray(offset, offset + entry.size) };
}
function encodeArchive(header, payload) {
  const json = Buffer.from(JSON.stringify(header));
  const pickle = Buffer.alloc(8 + json.length + (4 - json.length % 4) % 4);
  pickle.writeUInt32LE(pickle.length - 4, 0); pickle.writeUInt32LE(json.length, 4); json.copy(pickle, 8);
  const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(pickle.length, 4);
  return Buffer.concat([size, pickle, payload]);
}
function stripHook(text) {
  const start = text.indexOf(BEGIN), end = text.indexOf(END);
  if (start < 0 && end < 0) return text;
  if (start < 0 || end < start || text.indexOf(BEGIN, start + BEGIN.length) >= 0) throw new Error("主进程插件注入标记损坏。");
  return text.slice(0, start > 0 && text[start - 1] === "\n" ? start - 1 : start) + text.slice(end + END.length);
}
function patchArchive(buffer, remove = false) {
  const { archive, entry, data } = readEntry(buffer, "launch.dist.js");
  const original = data.toString("utf8"), clean = stripHook(original), next = clean + (remove ? "" : HOOK);
  if (original === next) return buffer;
  const replacement = Buffer.from(next);
  entry.offset = String(archive.payload.length); entry.size = replacement.length;
  if (entry.integrity) {
    const blockSize = entry.integrity.blockSize || 4 * 1024 * 1024;
    const hash = data => crypto.createHash("sha256").update(data).digest("hex");
    entry.integrity = { algorithm: "SHA256", hash: hash(replacement), blockSize, blocks: [] };
    for (let i = 0; i < replacement.length; i += blockSize) entry.integrity.blocks.push(hash(replacement.subarray(i, i + blockSize)));
  }
  return encodeArchive(archive.header, Buffer.concat([archive.payload, replacement]));
}
// Legacy v1.1.0 archives must be restored byte for byte. Removing the hook and
// re-encoding an ASAR still changes its hash and fails Typora's own checks.
function recoveryArchive(current, backup) {
  if (current.equals(backup)) return null;
  const originalLaunch = readEntry(backup, "launch.dist.js").data.toString("utf8");
  if (stripHook(originalLaunch) !== originalLaunch) throw new Error("app.asar 备份包含旧版插件代码，请重新安装官方 Typora 后再安装插件。");
  let candidate = backup;
  // Recognize only archives produced by our legacy installer, including a
  // previous uninstall. Never overwrite unrelated changes or an app update.
  for (let i = 0; i < 32; i++) {
    candidate = patchArchive(candidate, i % 2 === 1);
    if (current.equals(candidate)) return backup;
  }
  const launch = readEntry(current, "launch.dist.js").data.toString("utf8");
  if (stripHook(launch) !== launch) throw new Error("app.asar 与安装前备份不匹配，未覆盖文件。请用官方安装器修复 Typora。");
  return null;
}
module.exports = { readArchive, readEntry, encodeArchive, patchArchive, stripHook, recoveryArchive, BEGIN, END };
