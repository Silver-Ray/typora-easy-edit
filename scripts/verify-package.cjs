"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { version } = require("../package.json");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-package-check-"));
try {
  let packaged = path.join(root, "dist", "typora-easy-edit");
  if (process.platform === "win32") {
    const zip = path.join(root, "dist", "typora-easy-edit-" + version + ".zip");
    const literal = value => "'" + value.replace(/'/g, "''") + "'";
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath " + literal(zip) + " -DestinationPath " + literal(temporary)], { windowsHide: true });
    packaged = path.join(temporary, "typora-easy-edit");
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(packaged, "package.json"), "utf8")).version, version);
  for (const relative of ["plugin/easy-edit/symbols.js", "scripts/install.cjs", "scripts/asar.cjs", "install.ps1", "theme-fixes/inline-code-caret.css"]) {
    assert.deepEqual(fs.readFileSync(path.join(packaged, relative)), fs.readFileSync(path.join(root, relative)), relative);
  }
  assert.equal(fs.existsSync(path.join(packaged, "plugin/easy-edit/main.js")), false);
  const host = path.join(temporary, "fixture-resources"); fs.mkdirSync(host);
  const original = "<html><body></body></html>", archive = Buffer.from("opaque original application archive");
  fs.writeFileSync(path.join(host, "window.html"), original); fs.writeFileSync(path.join(host, "app.asar"), archive);
  const installer = require(path.join(packaged, "scripts/install.cjs"));
  installer.install(host);
  assert.equal(fs.readFileSync(path.join(host, "easy-edit/.typora-easy-edit"), "utf8"), "typora-easy-edit " + version + "\n");
  assert.deepEqual(fs.readFileSync(path.join(host, "app.asar")), archive);
  installer.uninstall(host);
  assert.equal(fs.readFileSync(path.join(host, "window.html"), "utf8"), original);
  assert.deepEqual(fs.readFileSync(path.join(host, "app.asar")), archive);
  console.log("Verified packaged installer, version, runtime files and unchanged application archive: " + version);
} finally {
  if (path.dirname(temporary).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(temporary).startsWith("easy-edit-package-check-")) throw new Error("Unexpected package test directory");
  fs.rmSync(temporary, { recursive: true, force: true });
}
