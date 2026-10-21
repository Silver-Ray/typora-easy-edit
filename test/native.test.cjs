const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const core = require("../plugin/easy-edit/core");
const { RichTextAdapter } = require("../plugin/easy-edit/adapters");
const { createNativeTypora } = require("./helpers/native-typora.cjs");
const { EasyEdit } = require("../plugin/easy-edit/index");
const resources = process.env.TYPORA_RESOURCES || "C:/Program Files/Typora/resources";

test("本机 Typora 编辑模块集成（使用真实选区、Markdown 模型及撤销管理器）", { skip: !fs.existsSync(path.join(resources, "appsrc/window/frame.js")) }, async t => {
  const native = createNativeTypora(resources);
  t.after(() => native.close());
  const { win, file, editor, setDocument } = native;
  const adapter = new RichTextAdapter(win, file, Object.assign({}, core.DEFAULTS));
  await t.test("实时预览 beforeinput 包裹选区并保留内部选区，单步撤销", () => {
    const plugin = new EasyEdit(win).start();
    try {
      const mark = setDocument("前中文后"); adapter.select(1, 3, mark[0]);
      const event = new win.InputEvent("beforeinput", { inputType: "insertText", data: "￥", bubbles: true, cancelable: true });
      editor.writingArea.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true); assert.equal(editor.getMarkdown(), "前$中文$后");
      assert.equal(win.getSelection().toString(), "中文");
      editor.undo.undo(); assert.equal(editor.getMarkdown(), "前中文后");
    } finally { plugin.destroy(); }
  });
  await t.test("实时预览全角标点和基础输入转换", () => {
    const plugin = new EasyEdit(win).start();
    try {
      for (const [before, data, expected, cursor] of [["文。", "。", "文.", 2], ["【", "【", "[[]]", 2], ["￥", "￥", "$$", 1], ["·", "·", "``", 1]]) {
        setDocument(before);
        editor.writingArea.dispatchEvent(new win.InputEvent("beforeinput", { inputType: "insertText", data, bubbles: true, cancelable: true }));
        assert.equal(editor.getMarkdown(), expected); assert.equal(adapter.snapshot().from, cursor);
      }
    } finally { plugin.destroy(); }
  });
  await t.test("实时预览中文开/闭引号和整对提交包裹选区、撤销、独立关闭", () => {
    const plugin = new EasyEdit(win).start();
    try {
      for (const [data, expected] of [["“", "前“中文”后"], ["”", "前“中文”后"], ["“”", "前“中文”后"], ["「", "前「中文」后"], ["」", "前「中文」后"], ["「」", "前「中文」后"]]) {
        const mark = setDocument("前中文后"); adapter.select(1, 3, mark[0]);
        const event = new win.InputEvent("beforeinput", { inputType: "insertText", data, bubbles: true, cancelable: true });
        editor.writingArea.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true); assert.equal(editor.getMarkdown(), expected);
        assert.equal(win.getSelection().toString(), "中文");
        editor.undo.undo(); assert.equal(editor.getMarkdown(), "前中文后");
      }
      plugin.settings.update({ selectionWrap: false });
      const mark = setDocument("前中文后"); adapter.select(1, 3, mark[0]);
      const event = new win.InputEvent("beforeinput", { inputType: "insertText", data: "「」", bubbles: true, cancelable: true });
      editor.writingArea.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
      assert.equal(editor.getMarkdown(), "前中文后");
    } finally { plugin.settings.update({ selectionWrap: true }); plugin.destroy(); }
  });
  await t.test("实时预览生成引用、代码块及公式块，生成后进入原生编辑器", () => {
    const plugin = new EasyEdit(win).start();
    try {
      setDocument("x"); adapter.select(0, 1); adapter.apply(core.edit(0, 1, ""));
      editor.writingArea.dispatchEvent(new win.InputEvent("beforeinput", { inputType: "insertText", data: "》", bubbles: true, cancelable: true }));
      assert.ok(win.document.querySelector("#write blockquote"));
      setDocument("``", "#write p", 1);
      editor.writingArea.dispatchEvent(new win.InputEvent("beforeinput", { inputType: "insertText", data: "·", bubbles: true, cancelable: true }));
      assert.ok(win.document.querySelector("#write .md-fences .CodeMirror"));
      assert.equal(editor.getMarkdown(), "```\n\n```");
      editor.undo.undo(); assert.equal(editor.getMarkdown(), "``");
      setDocument("$$", "#write p", 1);
      editor.writingArea.dispatchEvent(new win.InputEvent("beforeinput", { inputType: "insertText", data: "￥", bubbles: true, cancelable: true }));
      assert.ok(win.document.querySelector("#write [mdtype='math_block']"));
    } finally { plugin.destroy(); }
  });
  await t.test("中文输入法提交后包裹原始选区，不在组合输入中途改写", async () => {
    const plugin = new EasyEdit(win).start();
    try {
      const mark = setDocument("前中文后"); adapter.select(1, 3, mark[0]);
      editor.writingArea.dispatchEvent(new win.CompositionEvent("compositionstart", { bubbles: true }));
      assert.equal(plugin.composing, true);
      adapter.apply(core.edit(1, 3, "￥")); // Native IME commits its replacement first.
      editor.writingArea.dispatchEvent(new win.CompositionEvent("compositionend", { data: "￥", bubbles: true }));
      await new Promise(resolve => win.setTimeout(resolve, 5));
      assert.equal(editor.getMarkdown(), "前$中文$后"); assert.equal(win.getSelection().toString(), "中文");
    } finally { plugin.destroy(); }
  });

  await t.test("列表多行粘贴保留单个列表项，撤销一次完整还原", () => {
    setDocument("- item");
    assert.equal(adapter.paste(adapter.snapshot(), "a\nb"), true);
    assert.equal(editor.getMarkdown(), "- itema\n    b");
    assert.equal(win.document.querySelectorAll("#write li").length, 1);
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "- item");
    editor.undo.redo(); assert.equal(editor.getMarkdown(), "- itema\n    b");
  });
  await t.test("引用多行粘贴延续同一引用，开关关闭时交回原生处理", () => {
    setDocument("> 内容");
    assert.equal(adapter.paste(adapter.snapshot(), "a\nb"), true);
    assert.equal(editor.getMarkdown(), "> 内容a\n> b");
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "> 内容");
    adapter.settings.quotePaste = false;
    assert.equal(adapter.paste(adapter.snapshot(), "a\nb"), false);
    adapter.settings.quotePaste = true;
  });
  await t.test("Tabout 使用真实 rangy 选区且不修改 Markdown", () => {
    setDocument("（中文）", "#write p", 2);
    const ctx = adapter.snapshot(); assert.equal(ctx.from, 2);
    assert.equal(adapter.apply(core.tabout(ctx)), true);
    assert.equal(adapter.snapshot().from, 4); assert.equal(editor.getMarkdown(), "（中文）");
  });
  await t.test("严格换行的三个模式及撤销", () => {
    adapter.settings.strictLineBreak = true;
    for (const [mode, expected] of [["two-space", "正文  \n后"], ["paragraph", "正文\n\n后"], ["mix", "正文\n\n后"]]) {
      setDocument("正文后", "#write p", 2); adapter.settings.strictMode = mode;
      assert.equal(adapter.lineBreak(adapter.snapshot(), false), true);
      assert.equal(editor.getMarkdown(), expected);
      editor.undo.undo(); assert.equal(editor.getMarkdown(), "正文后");
    }
    adapter.settings.strictLineBreak = false;
  });
  await t.test("引用严格换行不重复插入 > 前缀", () => {
    setDocument("> 正文后", "#write p", 2);
    adapter.settings.strictLineBreak = true; adapter.settings.strictMode = "mix";
    assert.equal(adapter.lineBreak(adapter.snapshot(), false), true);
    assert.equal(editor.getMarkdown(), "> 正文  \n> 后");
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "> 正文后");
    adapter.settings.strictLineBreak = false;
  });
  await t.test("替换选中范围后一次撤销恢复原始内容", () => {
    const mark = setDocument("abcdef");
    adapter.select(1, 4, mark[0]);
    assert.equal(adapter.apply(core.edit(1, 4, "替换")), true);
    assert.equal(editor.getMarkdown(), "a替换ef");
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "abcdef");
  });
  await t.test("空列表和嵌套引用退格只退出一层", () => {
    setDocument("- ");
    assert.equal(adapter.emptyBackspace(adapter.snapshot()), true);
    assert.equal(editor.getMarkdown().trim(), "");
    editor.undo.undo(); assert.equal(editor.getMarkdown().trim(), "-");
    setDocument("> > ");
    assert.equal(adapter.emptyBackspace(adapter.snapshot()), true);
    assert.equal(editor.getMarkdown().trim(), ">");
  });
  await t.test("Mod+Enter 在列表当前行末尾新建项", () => {
    setDocument("1. abc", "#write p", 1);
    assert.equal(adapter.lineBreak(adapter.snapshot(), true), true);
    assert.equal(win.document.querySelectorAll("#write li").length, 2);
    assert.equal(editor.getMarkdown(), "1. abc\n1. "); // Typora's default repeated-one Markdown style.
  });
  await t.test("正文注释命令可切换并撤销", () => {
    setDocument("正文");
    assert.equal(adapter.apply(core.toggleComment(adapter.snapshot())), true);
    assert.equal(editor.getMarkdown(), "<!-- 正文 -->");
    assert.equal(adapter.apply(core.toggleComment(adapter.snapshot())), true);
    assert.equal(editor.getMarkdown(), "正文");
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "<!-- 正文 -->");
    editor.undo.undo(); assert.equal(editor.getMarkdown(), "正文");
  });
  await t.test("实时预览逐级选择保留行、段落与全文边界", () => {
    const plugin = new EasyEdit(win).start();
    try {
      setDocument("前段\n\n第一行\n第二行\n\n后段", "#write p:nth-child(2)", 1);
      const key = () => editor.writingArea.dispatchEvent(new win.KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }));
      key(); assert.equal(win.getSelection().toString(), "第一行");
      key(); assert.equal(win.getSelection().toString(), "第一行\n第二行");
      key(); assert.ok(win.getSelection().toString().includes("后段"));
    } finally { plugin.destroy(); }
  });
  await t.test("自带实时预览标题折叠不依赖第三方插件", () => {
    const plugin = new EasyEdit(win).start();
    try {
      const heading = setDocument("## 标题\n\n正文\n\n## 后续", "#write h2", 2);
      assert.equal(plugin.command("toggleHeadingFold"), true);
      assert.ok(heading[0].classList.contains("ee-folded-heading"));
      assert.ok(win.document.querySelector("#write p").classList.contains("ee-fold-hidden"));
      editor.writingArea.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      assert.equal(win.document.querySelectorAll("#write h2").length, 3);
      plugin.settings.update({ collapsedHeadingEnter: false });
      assert.equal(win.document.querySelectorAll(".ee-fold-hidden,.ee-folded-heading").length, 0);
    } finally { plugin.destroy(); }
  });
  await t.test("折叠标题在隐藏子内容之后插入同级标题", () => {
    const heading = setDocument("## 标题\n\n内容\n\n### 子标题\n\n子内容\n\n## 后续", "#write h2", 2);
    heading[0].classList.add("plugin-collapsed-paragraph");
    const nodes = Array.from(win.document.querySelector("#write").children);
    nodes.slice(1, 4).forEach(el => { el.style.display = "none"; });
    assert.equal(adapter.collapsedHeading(adapter.snapshot()), true);
    assert.equal(win.document.querySelectorAll("#write h2").length, 3);
    assert.equal(heading[0].classList.contains("plugin-collapsed-paragraph"), true);
    assert.equal(nodes[1].style.display, "none");
    assert.ok(editor.getMarkdown().includes("子内容\n\n## \n\n## 后续"));
  });
});
