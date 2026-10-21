const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const wrapper = path.resolve(__dirname, "../install.ps1");
const psLiteral = value => "'" + value.replace(/'/g, "''") + "'";
const run = (shell, args, options = {}) => spawnSync(shell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"].concat(args), Object.assign({ encoding: "utf8", timeout: 30000 }, options));
const encoded = source => ["-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")];

test("PowerShell 安装入口保持 ASCII，避免 5.1 的默认 ANSI 解码损坏", () => {
  assert.ok(fs.readFileSync(wrapper).every(byte => byte < 128));
});

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(shell + "：真实安装、预览、卸载及包含中文/单引号的目录", { skip: process.platform !== "win32" }, t => {
    const available = run(shell, ["-Command", "$PSVersionTable.PSVersion.ToString()"]);
    if (available.error && available.error.code === "ENOENT") { t.skip("此 PowerShell 未安装"); return; }
    assert.equal(available.status, 0, available.stderr);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-powershell-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const resources = path.join(root, "中文 Typora's resources");
    fs.mkdirSync(resources);
    fs.writeFileSync(path.join(resources, "window.html"), "<body></body>");
    const args = ["-File", wrapper, "-NodePath", process.execPath, "-TyporaPath", resources, "-NoElevation"];
    const preview = run(shell, args.concat("-DryRun"));
    assert.equal(preview.status, 0, preview.stderr); assert.deepEqual(fs.readdirSync(resources), ["window.html"]);
    const detected = run(shell, ["-File", wrapper, "-TyporaPath", resources, "-DryRun", "-NoElevation"]);
    assert.equal(detected.status, 0, detected.stderr);
    const relative = run(shell, ["-File", wrapper, "-NodePath", process.execPath, "-TyporaPath", path.basename(resources), "-DryRun"], { cwd: root });
    assert.equal(relative.status, 0, relative.stderr); assert.ok(relative.stdout.includes(resources));
    const install = run(shell, args); assert.equal(install.status, 0, install.stderr);
    assert.ok(fs.readFileSync(path.join(resources, "window.html"), "utf8").includes("typora-easy-edit:start"));
    const uninstall = run(shell, args.concat("-Uninstall")); assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.readFileSync(path.join(resources, "window.html"), "utf8"), "<body></body>");
  });

  test(shell + "：权限失败可返回 5，UAC 重试参数与取消处理正确（模拟提权，不弹窗）", { skip: process.platform !== "win32" }, t => {
    const available = run(shell, ["-Command", "$PSVersionTable.PSVersion.ToString()"]);
    if (available.error && available.error.code === "ENOENT") { t.skip("此 PowerShell 未安装"); return; }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "easy-edit-uac-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "scripts"));
    const copied = path.join(root, "install.ps1"); fs.copyFileSync(wrapper, copied);
    fs.writeFileSync(path.join(root, "scripts/install.cjs"), 'console.error("Simulated permission failure"); process.exitCode = 5;');
    const plain = run(shell, ["-File", copied, "-NodePath", process.execPath, "-NoElevation"]);
    assert.equal(plain.status, 5, plain.stderr);

    const admin = run(shell, encoded('$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'));
    if (admin.stdout.trim() === "True") { t.diagnostic("当前已是管理员，跳过 UAC 触发分支"); return; }
    const capture = path.join(root, "captured.json");
    const target = path.join(root, "中文 Typora's resources");
    const invocation = '& ' + psLiteral(copied) + ' -NodePath ' + psLiteral(process.execPath) + ' -TyporaPath ' + psLiteral(target) + ' -Uninstall; exit $LASTEXITCODE';
    const mock = 'function Start-Process { param($FilePath, $ArgumentList, $Verb, $WindowStyle, [switch]$Wait, [switch]$PassThru) $record = @{ file = $FilePath; command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($ArgumentList[-1])); verb = $Verb; style = $WindowStyle }; [IO.File]::WriteAllText(' + psLiteral(capture) + ', (ConvertTo-Json $record)); return [pscustomobject]@{ ExitCode = 0 } }; ';
    const retry = run(shell, encoded(mock + invocation));
    assert.equal(retry.status, 0, retry.stderr);
    const record = JSON.parse(fs.readFileSync(capture, "utf8").replace(/^\uFEFF/, ""));
    assert.equal(record.verb, "RunAs"); assert.equal(record.style, "Hidden");
    assert.ok(record.command.includes("-NoElevation"));
    assert.ok(record.command.includes("-NodePath " + psLiteral(process.execPath)));
    assert.ok(record.command.includes("-TyporaPath " + psLiteral(target)));
    assert.ok(record.command.includes("-Uninstall"));
    // Execute the generated child command without elevation as well. This covers
    // the actual 5.1 quoting/redirect/exit-code path while the stub cannot install.
    const replay = run("powershell.exe", encoded(record.command));
    const logMatch = record.command.match(/ \*> '((?:''|[^'])*)'; exit \$LASTEXITCODE$/);
    assert.ok(logMatch);
    const log = logMatch[1].replace(/''/g, "'");
    assert.equal(path.dirname(log).toLowerCase(), os.tmpdir().toLowerCase());
    assert.match(path.basename(log), /^typora-easy-edit-[a-f0-9]+\.log$/);
    t.after(() => { if (fs.existsSync(log)) fs.unlinkSync(log); });
    assert.equal(replay.status, 5, replay.stderr);
    assert.ok(fs.readFileSync(log).includes(Buffer.from("Simulated permission failure", "utf16le")));
    const cancelled = run(shell, encoded('function Start-Process { throw "Simulated UAC cancellation" }; ' + invocation));
    assert.equal(cancelled.status, 5, cancelled.stderr);
    assert.match(cancelled.stdout, /permission was not granted/);
  });
}
