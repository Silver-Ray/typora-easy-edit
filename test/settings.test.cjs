const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { EasyEdit } = require("../plugin/easy-edit/index");

test("设置无需主进程注入即可通过快捷键打开，总开关关闭时也可用，没有悬浮按钮", () => {
  const dom = new JSDOM("<html><head></head><body><div id='write'></div></body></html>", { url: "https://typora.test" });
  dom.window.File = { isMac: false };
  dom.window.reqnode = () => { throw new Error("Must not require native menu APIs"); };
  const plugin = new EasyEdit(dom.window).start();
  assert.equal(dom.window.document.getElementById("easy-edit-launcher"), null);
  assert.equal(plugin.settings.panel.hidden, true);
  plugin.settings.update({ enabled: false });
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "e", ctrlKey: true, altKey: true, bubbles: true }));
  assert.equal(plugin.settings.panel.hidden, false);
  assert.equal(plugin.settings.panel.querySelectorAll('input[type="checkbox"]').length, 20);
  plugin.destroy(); dom.window.close();
});
