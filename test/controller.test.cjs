const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { JSDOM } = require("jsdom");
const core = require("../plugin/easy-edit/core");
const { EasyEdit } = require("../plugin/easy-edit/index");
const { GROUPS, KEY } = require("../plugin/easy-edit/settings");
let dom, win, cm, controller, input, reachedNative;
before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body><div id="typora-source"></div><div id="write" contenteditable="true"></div><input id="search"></body></html>', { url: "https://typora.test", pretendToBeVisual: true });
  win = dom.window;
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 10, bottom: 20, width: 10, height: 20 });
  win.Range.prototype.getClientRects = () => [];
  global.window = win; global.document = win.document;
  const CodeMirror = require("codemirror");
  cm = CodeMirror(win.document.getElementById("typora-source"), { value: "", indentUnit: 4 });
  input = cm.getInputField();
  win.File = { isMac: false, option: { codeIndentSize: 4 }, editor: { selection: {}, sourceView: { inSourceMode: true, cm } } };
  controller = new EasyEdit(win).start();
  win.document.addEventListener("keydown", () => { reachedNative = true; });
});
after(() => { controller.destroy(); dom.window.close(); delete global.window; delete global.document; });
beforeEach(() => {
  controller.settings.update(core.DEFAULTS); controller.cycle = null;
  cm.setOption("readOnly", false); cm.setOption("indentWithTabs", false); cm.setValue("");
  cm.getAllMarks().forEach(mark => mark.clear());
  reachedNative = false; win.File.isLocked = false; win.File.isMac = false;
  input.focus();
});
function set(inputText) {
  const from = inputText.indexOf("|");
  cm.setValue(inputText.replace("|", "")); cm.setCursor(cm.posFromIndex(from)); cm.clearHistory();
}
function key(name, options = {}, target = input) {
  reachedNative = false;
  const event = new win.KeyboardEvent("keydown", Object.assign({ key: name, bubbles: true, cancelable: true }, options));
  target.dispatchEvent(event); return event;
}
function paste(text, files = []) {
  const event = new win.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files, getData: type => type === "text/plain" ? text : "" } });
  input.dispatchEvent(event); return event;
}
function type(text, origin = "+input") { cm.replaceSelection(text, "end", origin); }
test("真实 CodeMirror 文字输入：选区包裹、光标留在内部、单步撤销", () => {
  set("前中文后|"); cm.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 3 });
  type("￥"); assert.equal(cm.getValue(), "前$中文$后"); assert.equal(cm.getSelection(), "中文");
  cm.undo(); assert.equal(cm.getValue(), "前中文后");
});

test("真实 CodeMirror 中文开/闭引号和整对提交包裹正反向选区，单步撤销与重做", () => {
  for (const [data, expected] of [["“", "前“中文”后"], ["”", "前“中文”后"], ["“”", "前“中文”后"], ["「", "前「中文」后"], ["」", "前「中文」后"], ["「」", "前「中文」后"]]) {
    for (const backwards of [false, true]) {
      set("前中文后|");
      cm.setSelection({ line: 0, ch: backwards ? 3 : 1 }, { line: 0, ch: backwards ? 1 : 3 });
      type(data, "*compose");
      assert.equal(cm.getValue(), expected); assert.equal(cm.getSelection(), "中文");
      cm.undo(); assert.equal(cm.getValue(), "前中文后");
      cm.redo(); assert.equal(cm.getValue(), expected);
    }
  }
});
test("真实 CodeMirror 输入：全角转换、中文 IME 提交及基础符号", () => {
  set("文。|"); type("。", "*compose"); assert.equal(cm.getValue(), "文.");
  cm.undo(); assert.equal(cm.getValue(), "文。");
  set("【|"); type("【"); assert.equal(cm.getValue(), "[[]]"); assert.equal(cm.getCursor().ch, 2);
  set("·|"); type("·"); assert.equal(cm.getValue(), "``"); assert.equal(cm.getCursor().ch, 1);
  type("·"); assert.equal(cm.getValue(), "```\n\n```"); assert.equal(cm.getCursor().line, 1); assert.equal(cm.getCursor().ch, 0);
});
test("新功能的三个开关独立禁用，粘贴和程序化变更不触发转换", () => {
  controller.settings.update({ fullWidthToHalfWidth: false }); set("文。|"); type("。"); assert.equal(cm.getValue(), "文。。");
  controller.settings.update({ basicSymbolInput: false }); set("·|"); type("·"); assert.equal(cm.getValue(), "··");
  controller.settings.update({ selectionWrap: false }); set("中文|"); cm.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 2 }); type("￥"); assert.equal(cm.getValue(), "￥");
  controller.settings.update(core.DEFAULTS);
  set("·|"); type("·", "paste"); assert.equal(cm.getValue(), "··");
  set("。|"); type("。", "+easy-edit"); assert.equal(cm.getValue(), "。。");
});
function disabled(name, inputText, action) {
  set(inputText); controller.settings.update({ [name]: false }); action(); assert.equal(reachedNative, true, name + " 应交还原生快捷键");
}
test("源码模式：Tab / Shift+Tab 与撤销使用真实 CodeMirror", () => {
  set("```js\n  a|\n```"); key("Tab"); assert.equal(cm.getValue(), "```js\n  a    \n```");
  cm.undo(); assert.equal(cm.getValue(), "```js\n  a\n```");
  set("```js\n    a|\n```"); key("Tab", { shiftKey: true }); assert.equal(cm.getValue(), "```js\na\n```");
});
test("代码块全选只选正文；关闭后逐级选择继续独立工作", () => {
  set("首段\n\n```js\na|\nb\n```\n末段"); key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "a\nb");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "a\nb");
  controller.settings.update({ codeSelectAll: false });
  cm.setCursor({ line: 3, ch: 1 }); key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "a");
});
test("逐级全选：行、块、全文，单行块仍保留三步", () => {
  set("前\n\n第|一行\n第二行\n\n后");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "第一行");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "第一行\n第二行");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), cm.getValue());
  set("前\n\n单|行\n\n后");
  key("a", { ctrlKey: true }); key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "单行");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), cm.getValue());
});
test("鼠标或其他按键重置逐级选择状态", () => {
  set("第一|行\n第二行"); key("a", { ctrlKey: true }); key("ArrowLeft");
  key("a", { ctrlKey: true }); assert.equal(cm.getSelection(), "第一行");
});
test("每个快捷键功能关闭后交回原生，不阻断键盘事件", () => {
  disabled("codeIndent", "```js\na|\n```", () => key("Tab"));
  disabled("codeBackspace", "```js\n    |\n```", () => key("Backspace"));
  disabled("codeEnter", "```js\n  a|\n```", () => key("Enter"));
  disabled("emptyListBackspace", "- |", () => key("Backspace"));
  disabled("emptyQuoteBackspace", "> |", () => key("Backspace"));
  disabled("tabout", "（文|本）", () => key("Tab"));
  disabled("progressiveSelectAll", "正|文", () => key("a", { ctrlKey: true }));
  disabled("strictLineBreak", "正|文", () => key("Enter"));
  disabled("newLineAfter", "正|文", () => key("Enter", { ctrlKey: true }));
  disabled("toggleComment", "正|文", () => key("/", { ctrlKey: true }));
});
test("代码全选和所有粘贴开关独立关闭", () => {
  set("```js\na|\n```"); controller.settings.update({ codeSelectAll: false, progressiveSelectAll: false }); key("a", { ctrlKey: true }); assert.equal(reachedNative, true);
  for (const [name, text] of [["codePaste", "```js\n  |\n```"], ["listPaste", "- x|"], ["quotePaste", "> x|"]]) {
    set(text); controller.settings.update({ [name]: false }); assert.equal(paste("a\nb").defaultPrevented, false);
  }
});
test("开关启用后列表和引用退格、粘贴、严格换行会生效", () => {
  set("- |"); key("Backspace"); assert.equal(cm.getValue(), "");
  set("> |"); key("Backspace"); assert.equal(cm.getValue(), "");
  set("- x|"); assert.equal(paste("a\nb").defaultPrevented, true); assert.equal(cm.getValue(), "- xa\n  b");
  set("> x|"); paste("a\nb"); assert.equal(cm.getValue(), "> xa\n> b");
  set("正|文"); controller.settings.update({ strictLineBreak: true }); key("Enter"); assert.equal(cm.getValue(), "正\n\n文");
});
test("Tabout 不抢占代码缩进或活动占位符", () => {
  set("```js\n(a|)\n```"); key("Tab"); assert.equal(cm.getValue(), "```js\n(a    )\n```");
  set("（文|本）"); cm.markText({ line: 0, ch: 1 }, { line: 0, ch: 3 }, { className: "snippet-tabstop" });
  key("Tab"); assert.equal(reachedNative, true);
});
test("折叠标题功能和其开关使用真实 CodeMirror 折叠标记", () => {
  set("## 标|题\n内容\n### 子标题\n正文\n## 后续");
  const mark = cm.markText({ line: 0, ch: 5 }, { line: 3, ch: 2 }, { collapsed: true }); mark.__isFold = true;
  controller.settings.update({ collapsedHeadingEnter: false }); key("Enter"); assert.equal(reachedNative, true);
  controller.settings.update({ collapsedHeadingEnter: true }); key("Enter"); assert.ok(cm.getValue().includes("正文\n\n## \n## 后续")); assert.equal(mark.find().from.line, 0);
});
test("独立插件自带源码标题折叠，关闭功能后自动恢复", () => {
  set("## 标|题\n内容\n### 子标题\n正文\n## 后续");
  key("h", { ctrlKey: true, altKey: true }); assert.equal(cm.getAllMarks().length, 1);
  key("Enter"); assert.ok(cm.getValue().includes("## \n## 后续"));
  controller.settings.update({ collapsedHeadingEnter: false }); assert.equal(cm.getAllMarks().length, 0);
});
test("输入法组合、只读、搜索框和 Shift+Enter 保留原生行为", () => {
  set("（文|本）"); key("Tab", { isComposing: true }); assert.equal(reachedNative, true);
  win.File.isLocked = true; key("Tab"); assert.equal(reachedNative, true); win.File.isLocked = false;
  cm.setOption("readOnly", true); key("Tab"); assert.equal(reachedNative, true); cm.setOption("readOnly", false);
  key("a", { ctrlKey: true }, win.document.getElementById("search")); assert.equal(reachedNative, true);
  key("Enter", { shiftKey: true }); assert.equal(reachedNative, true);
  assert.equal(paste("text", [{}]).defaultPrevented, false);
});
test("全局关闭时所有快捷键失效，设置面板仍然可用", () => {
  set("（文|本）"); controller.settings.update({ enabled: false }); key("Tab"); assert.equal(reachedNative, true);
  key("e", { ctrlKey: true, altKey: true }); assert.equal(controller.settings.panel.hidden, false);
  controller.settings.close();
});
test("macOS 使用 Meta 修饰键且不把 Ctrl 当作 Mod", () => {
  set("一|行\n二行"); win.File.isMac = true;
  key("a", { ctrlKey: true }); assert.equal(reachedNative, true);
  key("a", { metaKey: true }); assert.equal(cm.getSelection(), "一行");
});
test("所有功能在中文面板中有独立复选框，设置可持久化并跨窗口同步", () => {
  const keys = GROUPS.flatMap(g => g[1].map(item => item[0]));
  const bools = Object.keys(core.DEFAULTS).filter(k => typeof core.DEFAULTS[k] === "boolean" && k !== "enabled");
  assert.deepEqual(keys.slice().sort(), bools.sort());
  keys.forEach(k => assert.ok(win.document.querySelector('[data-setting="' + k + '"]')));
  controller.settings.update({ tabout: false }); assert.equal(JSON.parse(win.localStorage.getItem(KEY)).tabout, false);
  win.localStorage.setItem(KEY, JSON.stringify(Object.assign({}, core.DEFAULTS, { listPaste: false })));
  win.dispatchEvent(new win.StorageEvent("storage", { key: KEY })); assert.equal(controller.settings.value.listPaste, false);
});
test("源码选择块命令能独立关闭，重载设置仍保留开关", () => {
  set("a|\nb\n\nc"); assert.equal(controller.command("selectBlock"), true); assert.equal(cm.getSelection(), "a\nb");
  controller.settings.update({ selectBlock: false }); assert.equal(controller.command("selectBlock"), false);
  assert.equal(controller.settings.read().selectBlock, false);
});
test("浏览器入口使用 reqnode 并从当前 resources 目录定位模块", () => {
  const other = new JSDOM("<html><head></head><body></body></html>", { runScripts: "outside-only", url: "file:///C:/Typora/resources/window.html" });
  const calls = [];
  other.window.dirname = "C:/Typora/resources";
  other.window.reqnode = name => name === "path" ? path : { boot: target => calls.push(target) };
  other.window.eval(fs.readFileSync(path.join(__dirname, "../plugin/easy-edit/bootstrap.js"), "utf8"));
  other.window.dispatchEvent(new other.window.Event("load")); assert.equal(calls[0], other.window);
  other.window.close();
});
