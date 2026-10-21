"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const dest = path.join(root, "dist", "typora-easy-edit");
// Remove only our generated package tree so obsolete startup hooks cannot ship.
if (path.dirname(dest) !== path.join(root, "dist") || path.basename(dest) !== "typora-easy-edit") throw new Error("Unexpected package directory");
if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) throw new Error("Package directory must not be a symlink");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const file of ["plugin/easy-edit/bootstrap.js", "plugin/easy-edit/index.js", "plugin/easy-edit/core.js", "plugin/easy-edit/adapters.js", "plugin/easy-edit/folding.js", "plugin/easy-edit/settings.js", "plugin/easy-edit/settings.css", "plugin/easy-edit/symbols.js", "plugin/easy-edit/input.js", "scripts/install.cjs", "scripts/asar.cjs", "install.ps1", "package.json", "README.md", "CHANGELOG.md", "LICENSE", "docs/settings.png", "theme-fixes/inline-code-caret.css", "theme-fixes/apply.cjs", "theme-fixes/README.md"]) {
  const target = path.join(dest, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
if (process.platform === "win32") {
  const quote = s => "'" + s.replace(/'/g, "''") + "'";
  const zip = path.join(root, "dist", "typora-easy-edit-" + version + ".zip");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Compress-Archive -LiteralPath " + quote(dest) + " -DestinationPath " + quote(zip) + " -Force"]);
  const sha256 = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  const dist = path.dirname(dest);
  fs.writeFileSync(path.join(dist, "SHA256SUMS"), sha256 + "  " + path.basename(zip) + "\n");
  fs.writeFileSync(path.join(dist, "release-info.json"), JSON.stringify({ version, archive: path.basename(zip), sha256 }, null, 2) + "\n");
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const start = changelog.indexOf("## [" + version + "]");
  if (start === -1) throw new Error("CHANGELOG.md is missing release notes for " + version);
  const end = changelog.indexOf("\n## [", start + 1);
  fs.writeFileSync(path.join(dist, "release-notes.md"), changelog.slice(start, end === -1 ? undefined : end).trim() + "\n");
  console.log(zip);
} else console.log("安装包目录：" + dest);
