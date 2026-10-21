"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { recoveryArchive, readEntry, stripHook } = require("./asar.cjs");
const { version } = require("../package.json");

const BEGIN = "<!-- typora-easy-edit:start -->";
const END = "<!-- typora-easy-edit:end -->";
const INJECTION = BEGIN + '\n<script src="./easy-edit/bootstrap.js" defer="defer"></script>\n' + END;

function archiveRecovery(resources) {
  const archivePath = path.join(resources, "app.asar"), backupPath = archivePath + ".easy-edit.backup";
  if (!fs.existsSync(archivePath)) return null;
  const current = fs.readFileSync(archivePath);
  if (fs.existsSync(backupPath)) return recoveryArchive(current, fs.readFileSync(backupPath));
  // A fresh install never parses or writes the archive. Check only the known
  // legacy entry when a prior plugin installation left its marker behind.
  const marker = path.join(resources, "easy-edit", ".typora-easy-edit");
  if (fs.existsSync(marker) && /\b1\.1\.0\b/.test(fs.readFileSync(marker, "utf8"))) {
    const launch = readEntry(current, "launch.dist.js").data.toString("utf8");
    if (stripHook(launch) !== launch) throw new Error("缺少 app.asar 安装前备份，请用官方安装器修复 Typora。");
  }
  return null;
}

function resolveResources(input) {
  if (input) {
    const absolute = path.resolve(input);
    const candidates = [absolute, path.join(absolute, "resources"), path.join(absolute, "resources", "app")];
    const found = candidates.find(p => fs.existsSync(path.join(p, "window.html")));
    if (found) return found;
    throw new Error("指定目录中没有找到 window.html：" + absolute);
  }
  const candidates = process.platform === "win32" ? [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Typora", "resources"),
    path.join(process.env.LOCALAPPDATA || os.homedir(), "Programs", "Typora", "resources")
  ] : ["/usr/share/typora/resources", "/usr/share/typora/resources/app", "/opt/Typora/resources"];
  const found = candidates.find(p => fs.existsSync(path.join(p, "window.html")));
  if (!found) throw new Error("未找到 Typora，请使用 --resources 指定包含 window.html 的目录。");
  return found;
}

function stripInjection(html) {
  const start = html.indexOf(BEGIN), end = html.indexOf(END);
  if (start === -1 && end === -1) return html;
  if (start === -1 || end < start || html.indexOf(BEGIN, start + BEGIN.length) !== -1) throw new Error("插件注入标记不完整，请先检查 window.html。");
  return html.slice(0, start) + html.slice(end + END.length);
}

function install(resources, options = {}) {
  resources = resolveResources(resources);
  const entry = path.join(resources, "window.html");
  const html = fs.readFileSync(entry, "utf8");
  const clean = stripInjection(html);
  if (!/<\/body\s*>/i.test(clean)) throw new Error("window.html 没有 </body>，未作修改。");
  const target = path.join(resources, "easy-edit");
  const source = options.source || path.resolve(__dirname, "../plugin/easy-edit");
  const files = ["bootstrap.js", "index.js", "core.js", "adapters.js", "folding.js", "settings.js", "settings.css", "symbols.js", "input.js"];
  files.forEach(file => { if (!fs.existsSync(path.join(source, file))) throw new Error("安装文件缺失：" + file); });
  const archivePath = path.join(resources, "app.asar");
  const restoredArchive = archiveRecovery(resources);
  if (options.dryRun) return { resources, target, action: "install", dryRun: true };
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("easy-edit 是符号链接，未作修改。");
  if (fs.existsSync(target) && !fs.existsSync(path.join(target, ".typora-easy-edit"))) throw new Error("easy-edit 目录已存在且不属于本插件，未作修改。");
  // Complete staging before editing the host's entry point.
  const staged = fs.mkdtempSync(path.join(resources, ".easy-edit-stage-"));
  try {
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(staged, file));
    fs.writeFileSync(path.join(staged, ".typora-easy-edit"), "typora-easy-edit " + version + "\n");
    fs.mkdirSync(target, { recursive: true });
    for (const file of files.concat(".typora-easy-edit")) fs.copyFileSync(path.join(staged, file), path.join(target, file));
    const legacyMain = path.join(target, "main.js");
    if (fs.existsSync(legacyMain)) fs.unlinkSync(legacyMain);
    const backup = path.join(resources, "window.html.easy-edit.backup");
    if (!fs.existsSync(backup)) fs.copyFileSync(entry, backup, fs.constants.COPYFILE_EXCL);
    const patched = clean.replace(/<\/body\s*>/i, INJECTION + "$&");
    fs.writeFileSync(path.join(staged, "window.html"), patched, "utf8");
    if (restoredArchive) {
      fs.writeFileSync(path.join(staged, "app.asar"), restoredArchive);
      fs.renameSync(path.join(staged, "app.asar"), archivePath);
    }
    fs.renameSync(path.join(staged, "window.html"), entry);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
  return { resources, target, action: "install", backup: path.join(resources, "window.html.easy-edit.backup") };
}

function uninstall(resources, options = {}) {
  resources = resolveResources(resources);
  const entry = path.join(resources, "window.html");
  const html = fs.readFileSync(entry, "utf8"), clean = stripInjection(html);
  const target = path.join(resources, "easy-edit");
  const archivePath = path.join(resources, "app.asar");
  const restoredArchive = archiveRecovery(resources);
  if (options.dryRun) return { resources, action: "uninstall", dryRun: true };
  if (restoredArchive) {
    const staged = fs.mkdtempSync(path.join(resources, ".easy-edit-stage-"));
    try { fs.writeFileSync(path.join(staged, "app.asar"), restoredArchive); fs.renameSync(path.join(staged, "app.asar"), archivePath); }
    finally { fs.rmSync(staged, { recursive: true, force: true }); }
  }
  if (clean !== html) fs.writeFileSync(entry, clean, "utf8");
  // Only remove our explicitly marked, direct child directory, never a symlink.
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error("easy-edit 是符号链接，已移除注入，但未删除该目录。");
    if (fs.existsSync(path.join(target, ".typora-easy-edit"))) fs.rmSync(target, { recursive: true });
  }
  return { resources, action: "uninstall" };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
      console.log("node scripts/install.cjs [--resources <Typora 安装目录或 resources 目录>] [--uninstall] [--dry-run]\n请先完全退出 Typora。Program Files 下安装需要以管理员身份运行终端。");
    } else {
      const i = args.indexOf("--resources");
      if (i !== -1 && (!args[i + 1] || args[i + 1].startsWith("--"))) throw new Error("--resources 需要目录参数。");
      const result = (args.includes("--uninstall") ? uninstall : install)(i === -1 ? null : args[i + 1], { dryRun: args.includes("--dry-run") });
      console.log((result.dryRun ? "预览：" : "完成：") + (result.action === "install" ? "安装" : "卸载") + " Easy Edit\n" + result.resources + "\n重启 Typora 后生效。");
    }
  } catch (error) {
    console.error("操作失败：" + error.message + (/EACCES|EPERM/.test(error.code || "") ? "\n请完全退出 Typora，然后以管理员身份运行终端重试。" : ""));
    process.exitCode = /EACCES|EPERM/.test(error.code || "") ? 5 : 1;
  }
}

module.exports = { install, uninstall, resolveResources, stripInjection, archiveRecovery, BEGIN, END };
