const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { encodeArchive, patchArchive, recoveryArchive } = require("../scripts/asar.cjs");
const { install, uninstall } = require("../scripts/install.cjs");

function fixture(text = 'require("./original.js");') {
  const launch = Buffer.from(text), compiled = Buffer.from([0, 255, 10, 42]);
  return encodeArchive({ files: {
    "launch.dist.js": { size: launch.length, offset: "0", integrity: { algorithm: "SHA256", hash: "old", blockSize: 8, blocks: [] } },
    "original.js": { size: compiled.length, offset: String(launch.length) }
  } }, Buffer.concat([launch, compiled]));
}
function host(t, archive) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-asar-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "app.asar"), archive);
  fs.writeFileSync(path.join(root, "window.html"), "<body></body>");
  return root;
}
function legacy(t, { removed = false, backup = fixture() } = {}) {
  const original = fixture(), patched = patchArchive(original);
  const current = removed ? patchArchive(patched, true) : patched;
  const root = host(t, current);
  if (backup) fs.writeFileSync(path.join(root, "app.asar.easy-edit.backup"), backup);
  fs.mkdirSync(path.join(root, "easy-edit"));
  fs.writeFileSync(path.join(root, "easy-edit", ".typora-easy-edit"), "typora-easy-edit 1.1.0\n");
  fs.writeFileSync(path.join(root, "easy-edit", "main.js"), "legacy hook");
  return { root, original, current, archive: path.join(root, "app.asar") };
}

test("全新安装、重复安装和卸载保持整个 app.asar 逐字节不变", t => {
  const original = fixture();
  const root = host(t, original), archive = path.join(root, "app.asar");
  install(root, { dryRun: true }); assert.deepEqual(fs.readFileSync(archive), original);
  install(root); install(root);
  assert.deepEqual(fs.readFileSync(archive), original);
  assert.equal(fs.existsSync(archive + ".easy-edit.backup"), false);
  assert.equal(fs.existsSync(path.join(root, "easy-edit", "main.js")), false);
  uninstall(root); assert.deepEqual(fs.readFileSync(archive), original);
});
test("全新安装不会解析或重建未知格式的归档", t => {
  const original = Buffer.from([0, 255, 34, 128, 2, 0, 3]);
  const root = host(t, original), archive = path.join(root, "app.asar");
  install(root);
  assert.deepEqual(fs.readFileSync(archive), original);
  uninstall(root);
  assert.deepEqual(fs.readFileSync(archive), original);
});
test("升级 v1.1.0 精确恢复备份，包括 ASAR 文件头和整个 payload", t => {
  const { root, original, archive } = legacy(t);
  install(root);
  assert.deepEqual(fs.readFileSync(archive), original);
  assert.deepEqual(fs.readFileSync(archive + ".easy-edit.backup"), original);
  assert.equal(fs.existsSync(path.join(root, "easy-edit", "main.js")), false);
  install(root); uninstall(root);
  assert.deepEqual(fs.readFileSync(archive), original);
});
for (const removed of [false, true]) {
  test("卸载旧版恢复整个归档，兼容之前已经卸载过的归档：" + removed, t => {
    const { root, original, archive } = legacy(t, { removed });
    uninstall(root); assert.deepEqual(fs.readFileSync(archive), original);
    assert.equal(fs.existsSync(path.join(root, "easy-edit")), false);
  });
}
test("旧版恢复预览没有写入副作用", t => {
  const { root, current, archive } = legacy(t);
  install(root, { dryRun: true }); uninstall(root, { dryRun: true });
  assert.deepEqual(fs.readFileSync(archive), current);
  assert.equal(fs.readFileSync(path.join(root, "window.html"), "utf8"), "<body></body>");
  assert.equal(fs.readFileSync(path.join(root, "easy-edit", "main.js"), "utf8"), "legacy hook");
});
test("缺少或不匹配的旧版备份不会覆盖未知内容", t => {
  for (const backup of [null, fixture("different app version")]) {
    const { root, current, archive } = legacy(t, { backup });
    assert.throws(() => install(root), /备份/);
    assert.throws(() => uninstall(root), /备份/);
    assert.deepEqual(fs.readFileSync(archive), current);
    assert.equal(fs.readFileSync(path.join(root, "window.html"), "utf8"), "<body></body>");
  }
});
test("Typora 更新后的归档不会被过期备份覆盖", t => {
  const updated = fixture("new version");
  const root = host(t, updated), archive = path.join(root, "app.asar");
  fs.writeFileSync(archive + ".easy-edit.backup", fixture());
  install(root); uninstall(root);
  assert.deepEqual(fs.readFileSync(archive), updated);
});
test("恢复识别旧版反复安装卸载，同时拒绝任意第三方修改", () => {
  const original = fixture(); let current = original;
  for (let i = 0; i < 6; i++) {
    current = patchArchive(current, i % 2 === 1);
    assert.deepEqual(recoveryArchive(current, original), original);
  }
  const changed = Buffer.from(current); changed[changed.length - 1] ^= 1;
  assert.equal(recoveryArchive(changed, original), null);
  const hooked = patchArchive(current), corruptedHook = Buffer.from(hooked);
  // Change the untouched original payload while retaining the visible hook.
  corruptedHook[corruptedHook.length - 500] ^= 1;
  assert.throws(() => recoveryArchive(corruptedHook, original));
});
