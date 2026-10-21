"use strict";
const fs = require("node:fs"), path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

// Optional integration harness: reads the user's installed Typora, never vendors or
// modifies its source. Only Electron/file-system bridge calls are replaced.
function createNativeTypora(resources) {
  const html = fs.readFileSync(path.join(resources, "window.html"), "utf8").replace("</body>", fs.readFileSync(path.join(resources, "html/content.html"), "utf8") + "</body>");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://typora.test", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const win = dom.window;
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 10, bottom: 20, width: 10, height: 20 });
  win.Range.prototype.getClientRects = () => [];
  win._options = {};
  win.JSBridge = { invoke: () => Promise.resolve(), putSetting() {}, getSetting() {}, on() {}, menu: { update() {} } };
  win.bridge = { registerHandler() {} };
  win.matchMedia = () => ({ matches: false, addListener() {} });
  // Expose Typora's bundled module loader without launching the Electron entry.
  const original = fs.readFileSync(path.join(resources, "appsrc/window/frame.js"), "utf8");
  const marker = "a(t);t=l(i[0]);";
  if (!original.includes(marker)) throw new Error("此版本 Typora 的模块格式与本测试工具不兼容。");
  win.eval(original.replace(marker, "a(t);window.__typoraLoad=function(e){return l(e).__useDefault};return {};t=l(i[0]);"));
  win.File = win.__typoraLoad("4a");
  win.$ = win.__typoraLoad("e");
  win.$.localize = { getString: s => s, localeOption: { language: "Base" } };
  win.$.fn.localize = function () { return this; };
  win.$.fn.rawText = function () { return this.length ? this[0].rawText() : ""; };
  const file = win.File;
  ["loadFile", "setup", "exitOversize", "readOption", "setTheme", "updateChangeCount"].forEach(name => { file[name] = () => {}; });
  file.setEditor = editor => { file.editor = editor; win.editor = editor; };
  file.option = { codeIndentSize: 4, indentSize: 4 };
  const Editor = win.__typoraLoad("48");
  const editor = new Editor("#write", file);
  editor.tryEnterBusyModeWithDelay = () => {};
  win.getCodeMirrorMode = () => "null";
  win.__typoraLoad("32").rangy.init();
  const Node = win.__typoraLoad("13").Node;
  function setDocument(text, selector = "#write p", offset) {
    editor.undo.reset(); editor.brush.clearAndPause(); editor.nodeMap.reset();
    const root = new Node({ type: "paragraph", text, in: editor.nodeMap, attachTo: editor.nodeMap });
    editor.writingArea.innerHTML = root.parseFrom()[0];
    editor.writingArea.setAttribute("contenteditable", "true");
    const mark = win.$(selector).first();
    editor.writingArea.focus();
    if (offset === undefined) editor.selection.jumpIntoElemEnd(mark);
    else editor.selection.restoreSelection(mark[0], { start: offset, end: offset });
    editor.refocus(mark.attr("cid"));
    return mark;
  }
  return { win, file, editor, setDocument, close: () => dom.window.close() };
}
module.exports = { createNativeTypora };
