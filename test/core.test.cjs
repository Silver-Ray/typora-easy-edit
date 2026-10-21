const { test } = require("node:test");
const assert = require("node:assert/strict");
const c = require("../plugin/easy-edit/core");
const settings = patch => Object.assign({}, c.DEFAULTS, patch);
function at(input, options = {}) {
  const from = input.indexOf("|");
  assert.notEqual(from, -1);
  return c.context(input.replace("|", ""), from, from, options);
}
function result(ctx, action) { assert.ok(action); return c.apply(ctx.text, action); }

test("配置只接受合法类型，未知配置和非法宽度不污染默认值", () => {
  const value = c.normalizeSettings({ enabled: false, tabout: "false", strictMode: "bad", indentSize: -2, __proto__: { polluted: true } });
  assert.equal(value.enabled, false); assert.equal(value.tabout, true); assert.equal(value.indentSize, 4);
  assert.equal(value.strictMode, "mix"); assert.equal(value.polluted, undefined);
});

for (const pair of [["（", "）"], ["【", "】"], ["〖", "〗"], ["《", "》"], ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"], ["\"", "\""], ["'", "'"], ["`", "`"], ["``", "``"], ["$", "$"], ["$$", "$$"], ["**", "**"], ["*", "*"], ["__", "__"], ["_", "_"], ["~~", "~~"], ["==", "=="], ["[[", "]]"]]) {
  test("Tabout 跳出 " + pair.join(""), () => {
    const ctx = at(pair[0] + "中|文" + pair[1] + "后");
    const action = c.tabout(ctx);
    assert.equal(action.anchor, ctx.text.length - 1); assert.deepEqual(action.changes, []);
  });
}
test("Tabout 从嵌套符号最内层逐层跳出", () => {
  const ctx = at("（外[内|容]外）");
  const first = c.tabout(ctx); assert.equal(ctx.text.slice(first.anchor), "外）");
  const second = c.tabout(c.context(ctx.text, first.anchor)); assert.equal(second.anchor, ctx.text.length);
});
test("Tabout 忽略转义符号、不完整配对、单词内撇号和下划线", () => {
  for (const text of ["\\（内|容\\）", "（内|容", "don'|t", "snake_|case"]) assert.equal(c.tabout(at(text)), null);
});
test("Tabout 行内代码中的括号为普通文本", () => {
  const ctx = at("`a (b|c)`后"); assert.equal(c.tabout(ctx).anchor, ctx.text.length - 1);
});
test("Tabout 支持被选中的配对内容", () => {
  const ctx = c.context("**中文**", 2, 4); assert.equal(c.tabout(ctx).anchor, 6);
});

test("代码区识别覆盖波浪线、嵌套引用和列表围栏", () => {
  for (const text of ["~~~js\ncode|\n~~~", "> ```py\n> code|\n> ```", "- ```js\n  code|\n  ```"]) assert.ok(at(text).code);
  assert.equal(at("```js|\ncode\n```").code, null);
  assert.equal(at("```js\ncode\n```|").code, null);
});
test("代码 Tab / Shift+Tab 不改动围栏，支持选区末尾在下一行开头", () => {
  const text = "```js\na\nb\n```";
  const ctx = c.context(text, 6, 10, { indent: "  ", indentSize: 2 });
  const changed = result(ctx, c.indentCode(ctx, false)); assert.equal(changed, "```js\n  a\n  b\n```");
  const reverse = c.context(changed, 8, 14, { indent: "  ", indentSize: 2 });
  assert.equal(result(reverse, c.indentCode(reverse, true)), text);
});
test("代码 Backspace 删除到上一个缩进停止点", () => {
  for (const [spaces, remaining] of [[8, 4], [6, 4], [4, 0], [1, 0]]) {
    const ctx = at("```\n" + " ".repeat(spaces) + "|\n```");
    assert.equal(result(ctx, c.codeBackspace(ctx)), "```\n" + " ".repeat(remaining) + "\n```");
  }
  assert.equal(c.codeBackspace(at("```\na |\n```")), null);
});
test("代码粘贴去除公共缩进并保留相对层次及 CRLF", () => {
  const ctx = at("```python\n    |\n```");
  const action = c.smartPaste(ctx, "  if x:\r\n    print(x)", settings());
  assert.equal(result(ctx, action), "```python\n    if x:\n      print(x)\n```");
  assert.equal(c.smartPaste(ctx, "a\nb", settings({ codePaste: false })), null);
});
test("引用中的代码换行/粘贴保留引用前缀，反缩进不删除列表容器缩进", () => {
  const quote = at("> ```py\n>   a|\n> ```");
  assert.equal(result(quote, c.lineBreak(quote, settings())), "> ```py\n>   a\n>   \n> ```");
  assert.equal(result(quote, c.smartPaste(quote, "b\nc", settings())), "> ```py\n>   ab\n>   c\n> ```");
  const list = at("- ```js\n    a|\n  ```", { indentSize: 4 });
  assert.equal(result(list, c.indentCode(list, true)), "- ```js\n  a\n  ```");
});
test("代码 Enter 延续缩进且有单独开关", () => {
  const ctx = at("```js\n  a|\n```");
  assert.equal(result(ctx, c.lineBreak(ctx, settings())), "```js\n  a\n  \n```");
  assert.equal(c.lineBreak(ctx, settings({ codeEnter: false })), null);
});

for (const prefix of ["- ", "* ", "+ ", "1. ", "2) ", "- [ ] ", "- [x] "]) {
  test("空列表退格：" + prefix, () => {
    const ctx = at(prefix + "|"); assert.equal(result(ctx, c.emptyBackspace(ctx, settings())), "");
    assert.equal(c.emptyBackspace(ctx, settings({ emptyListBackspace: false })), null);
  });
}
test("空引用退格只删除一层，非空或光标不在末尾不处理", () => {
  const ctx = at("> > |"); assert.equal(result(ctx, c.emptyBackspace(ctx, settings())), "> ");
  assert.equal(c.emptyBackspace(at("> 内容|"), settings()), null);
  assert.equal(c.emptyBackspace(at("-| "), settings()), null);
});
test("智能粘贴：有序列表、任务列表、嵌套引用列表", () => {
  for (const [input, expected] of [["12. x|", "12. xa\n    b"], ["- [ ] x|", "- [ ] xa\n      b"], ["> > - x|", "> > - xa\n> >   b"]]) {
    const ctx = at(input); assert.equal(result(ctx, c.smartPaste(ctx, "a\nb", settings())), expected);
  }
});
test("智能粘贴：引用前缀不重复，开关单独生效", () => {
  const ctx = at("> x|"); assert.equal(result(ctx, c.smartPaste(ctx, "a\n> b", settings())), "> xa\n> b");
  assert.equal(c.smartPaste(ctx, "a\nb", settings({ quotePaste: false })), null);
  assert.equal(c.smartPaste(at("- x|"), "a\nb", settings({ listPaste: false })), null);
});
test("列表延续段落内的粘贴继续缩进，普通缩进不会凭空变成列表", () => {
  const ctx = at("- first\n  second|");
  assert.equal(result(ctx, c.smartPaste(ctx, "a\nb", settings())), "- first\n  seconda\n  b");
  assert.equal(c.smartPaste(at("first\n  second|"), "a\nb", settings()), null);
});
test("未闭合 YAML 分隔线不吞掉普通正文，公式中的围栏不是代码", () => {
  assert.equal(at("---\n正文|").line.protected, false);
  const ctx = at("$$\n```\n公式|\n$$");
  assert.equal(ctx.code, null); assert.equal(ctx.line.protected, true);
});

for (const mode of ["two-space", "paragraph", "mix"]) {
  test("严格换行模式：" + mode, () => {
    const normal = at("正文|尾");
    const s = settings({ strictLineBreak: true, strictMode: mode });
    assert.equal(result(normal, c.lineBreak(normal, s)), mode === "two-space" ? "正文  \n尾" : "正文\n\n尾");
    const quote = at("> 正文|尾");
    assert.equal(result(quote, c.lineBreak(quote, s)), mode === "paragraph" ? "> 正文\n> \n> 尾" : "> 正文  \n> 尾");
  });
}
test("严格换行跳过代码、公式、frontmatter、列表、标题、表格及空行", () => {
  const s = settings({ strictLineBreak: true, codeEnter: false });
  for (const input of ["```\na|\n```", "$$\nx|\n$$", "---\na: b|\n---", "- x|", "# 标题|", "\n|", "| a | b |\n|c | d| |"] ) {
    // Pipe is the cursor sentinel, so table cases use an explicit context below.
    if (input.startsWith("| a")) continue;
    assert.equal(c.lineBreak(at(input), s), null, input);
  }
  assert.equal(c.lineBreak(c.context("| a | b |", 8), s), null);
});
test("严格换行不会重复追加两个空格", () => {
  const ctx = at("text  |"); assert.equal(result(ctx, c.lineBreak(ctx, settings({ strictLineBreak: true, strictMode: "two-space" }))), "text  \n");
});
test("New Line After 在行尾插入，列表编号递增、任务状态清空", () => {
  const ctx = at("12. [x] a|bc");
  assert.equal(result(ctx, c.lineBreak(ctx, settings(), true)), "12. [x] abc\n13. [ ] ");
  const plain = at("a|bc"); assert.equal(result(plain, c.lineBreak(plain, settings(), true)), "abc\n");
});
test("折叠标题 Enter 越过整个折叠范围后插入同级标题", () => {
  const ctx = at("## 标题|\n正文\n### 子标题\n正文\n## 之后");
  const action = c.collapsedHeading(ctx, { lastLine: 3 });
  assert.equal(result(ctx, action), "## 标题\n正文\n### 子标题\n正文\n\n## \n## 之后");
});
test("块选择只覆盖当前文本块 / 引用块 / 代码块正文", () => {
  for (const [input, expected] of [["首段\n\na|\nb\n\n末段", "a\nb"], ["> a|\n> b\n\n外", "> a\n> b"], ["```\na|\nb\n```", "a\nb"]]) {
    const ctx = at(input), range = c.blockRange(ctx); assert.equal(ctx.text.slice(...range), expected);
  }
});
test("切换注释识别语言且可还原", () => {
  for (const [lang, marker] of [["js", "//"], ["python", "#"], ["sql", "--"], ["matlab", "%"]]) {
    const ctx = at("```" + lang + "\n  a|\n```");
    const action = c.toggleComment(ctx), text = result(ctx, action); assert.ok(text.includes("  " + marker + " a"));
    const restore = c.context(text, action.anchor, action.head); assert.equal(result(restore, c.toggleComment(restore)), ctx.text);
  }
  assert.equal(c.toggleComment(at("```unknown\na|\n```")), null);
});
test("正文与 CSS 注释分别使用 HTML 与块注释", () => {
  const plain = at("abc|"); assert.equal(result(plain, c.toggleComment(plain)), "<!-- abc -->");
  const css = at("```css\na {}|\n```"); assert.equal(result(css, c.toggleComment(css)), "```css\n/* a {} */\n```");
});
