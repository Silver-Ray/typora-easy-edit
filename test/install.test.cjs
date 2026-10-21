const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const { install, uninstall, BEGIN, stripInjection } = require("../scripts/install.cjs");

test("安装、重复安装、保留第三方修改、卸载、备份与 dry-run", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-installer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = '<html><body><script src="another-plugin.js"></script></body></html>';
  const entry = path.join(root, "window.html"); fs.writeFileSync(entry, original);
  install(root, { dryRun: true }); assert.deepEqual(fs.readdirSync(root), ["window.html"]);
  install(root); const once = fs.readFileSync(entry, "utf8"); assert.ok(once.includes(BEGIN));
  install(root); assert.equal(fs.readFileSync(entry, "utf8"), once);
  assert.equal(fs.readFileSync(entry + ".easy-edit.backup", "utf8"), original);
  fs.writeFileSync(entry, once.replace("</body>", "<div>后来修改</div></body>"));
  uninstall(root);
  assert.equal(fs.readFileSync(entry, "utf8"), original.replace("</body>", "<div>后来修改</div></body>"));
  assert.equal(fs.existsSync(path.join(root, "easy-edit")), false);
  uninstall(root); assert.ok(fs.existsSync(entry + ".easy-edit.backup"));
});
test("入口损坏、安装包缺失或目录冲突时拒绝覆盖", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-installer-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, "window.html");
  fs.writeFileSync(entry, "broken"); assert.throws(() => install(root), /body/);
  fs.writeFileSync(entry, "<body></body>"); assert.throws(() => install(root, { source: path.join(root, "missing") }), /缺失/);
  fs.mkdirSync(path.join(root, "easy-edit")); assert.throws(() => install(root), /不属于/);
  assert.equal(fs.readFileSync(entry, "utf8"), "<body></body>");
  assert.throws(() => stripInjection("<body>" + BEGIN + "</body>"), /标记/);
});

test("权限错误使用专用退出码，且申请权限前没有修改入口", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "window.html"), "<body></body>");
  const installer = path.resolve(__dirname, "../scripts/install.cjs");
  for (const code of ["EACCES", "EPERM"]) {
    const source = 'require("node:fs").mkdtempSync = () => { const e = new Error("test permission denial"); e.code = ' + JSON.stringify(code) + '; throw e; }; process.argv = ' + JSON.stringify([process.execPath, installer, "--resources", root]) + '; require("node:module").runMain();';
    const child = spawnSync(process.execPath, ["-e", source], { encoding: "utf8" });
    assert.equal(child.status, 5, child.stderr);
    assert.equal(fs.readFileSync(path.join(root, "window.html"), "utf8"), "<body></body>");
    assert.deepEqual(fs.readdirSync(root), ["window.html"]);
  }
});
