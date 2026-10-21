const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plugin/easy-edit/core");
const { transform, WRAPS } = require("../plugin/easy-edit/symbols");
const settings = Object.assign({}, core.DEFAULTS);
function expectInput(text, pos, data, expected, cursor, patch = {}) {
  const result = transform(core.context(text, pos), data, Object.assign({}, settings, patch));
  assert.ok(result, text + " + " + data);
  assert.equal(core.apply(text, result), expected); assert.equal(result.anchor, cursor);
  return result;
}

test("中文选区包裹支持开符号、闭符号和输入法整对提交", () => {
  for (const [inputs, expected] of [
    [["“", "”", "“”"], "前“中文”后"],
    [["「", "」", "「」"], "前「中文」后"],
    [["『", "』", "『』"], "前『中文』后"],
    [["（", "）", "（）"], "前（中文）后"],
    [["〈", "〉", "〈〉"], "前〈中文〉后"]
  ]) {
    for (const input of inputs) {
      const ctx = core.context("前中文后", 1, 3), result = transform(ctx, input, settings);
      assert.equal(core.apply(ctx.text, result), expected);
      assert.equal(result.anchor, 2); assert.equal(result.head, 4);
      assert.equal(transform(ctx, input, { ...settings, selectionWrap: false }), null);
    }
  }
});
test("选区内的普通文字提交和无选区整对标点不会误触发包裹", () => {
  for (const input of ["constructor", "toString", "__proto__", "普通文字", "，", "。"]) {
    assert.equal(transform(core.context("前中文后", 1, 3), input, settings), null);
  }
  for (const input of ["“”", "「」", "『』"]) assert.equal(transform(core.context("正文", 2), input, settings), null);
});
for (const [key, pair] of Object.entries(WRAPS)) {
  test("选区包裹：" + key, () => {
    const ctx = core.context("前中文后", 1, 3);
    const result = transform(ctx, key, settings);
    assert.equal(core.apply(ctx.text, result), "前" + pair[0] + "中文" + pair[1] + "后");
    assert.equal(result.anchor, 1 + pair[0].length); assert.equal(result.head, 3 + pair[0].length);
    assert.equal(transform(ctx, key, Object.assign({}, settings, { selectionWrap: false })), null);
  });
}
test("连续全角标点转换覆盖所有基础映射", () => {
  for (const [input, output] of Object.entries({ "。": ".", "！": "!", "；": ";", "，": ",", "：": ":", "？": "?", "》": ">", "｜": "|", "《": "<" })) {
    expectInput("文" + input, 2, input, "文" + output, 2);
    assert.equal(transform(core.context("文" + input, 2), input, Object.assign({}, settings, { fullWidthToHalfWidth: false })), null);
  }
});
test("连续全角括号和引号处理已有右侧配对，避免留下孤立符号", () => {
  expectInput("（）", 1, "（", "()", 1);
  expectInput("“”", 1, "“", '""', 1); expectInput("“”", 1, "”", '""', 1);
  expectInput("‘’", 1, "‘", "''", 1); expectInput("‘’", 1, "’", "''", 1);
  expectInput("《》", 1, "《", "<", 1);
});
test("基础双链、嵌入及行内代码输入", () => {
  expectInput("【", 1, "【", "[[]]", 2);
  expectInput("【】", 1, "【", "[[]]", 2);
  expectInput("！【】", 2, "【", "![[]]", 3);
  expectInput("文·", 2, "·", "文``", 2);
});
test("基础行首输入和代码块升级", () => {
  expectInput("", 0, "》", "> ", 2);
  expectInput("> ", 2, "》", "> > ", 4);
  expectInput("  ", 2, "、", "  /", 3);
  expectInput("``", 1, "·", "```\n\n```", 4);
  expectInput("  ``", 3, "·", "  ```\n  \n  ```", 8);
  assert.equal(transform(core.context("文", 1), "、", settings), null);
});
test("人民币、美元和块公式转换", () => {
  expectInput("￥", 1, "￥", "$$", 1);
  expectInput("¥", 1, "¥", "$$", 1);
  expectInput("$", 1, "$", "$$", 1);
  for (const key of ["￥", "¥", "$"]) expectInput("$$", 1, key, "$$\n\n$$", 3);
});
test("三个开关互相独立，总开关与代码/frontmatter 保护生效", () => {
  assert.equal(transform(core.context("·", 1), "·", Object.assign({}, settings, { basicSymbolInput: false })), null);
  expectInput("。", 1, "。", ".", 1, { basicSymbolInput: false });
  assert.equal(transform(core.context("。", 1), "。", Object.assign({}, settings, { enabled: false })), null);
  assert.equal(transform(core.context("```\n。\n```", 5), "。", settings), null);
  assert.equal(transform(core.context("---\nx: 。\n---", 8), "。", settings), null);
  assert.equal(transform(core.context("$$\nx。\n$$", 5), "。", settings), null);
});
