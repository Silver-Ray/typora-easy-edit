"use strict";
const core = require("./core");

// Based on Easy Typing 5.5.15's SelectionEnhance / FW2HWEnhance /
// BaseObEditEnhance rules. No user-supplied expressions are evaluated.
const WRAPS = {
  "￥": ["$", "$"], "¥": ["$", "$"], "·": ["`", "`"], "`": ["`", "`"],
  "【": ["[", "]"], "《": ["《", "》"], "（": ["（", "）"],
  "“": ["“", "”"], "”": ["“", "”"], "‘": ["‘", "’"], "’": ["‘", "’"],
  "「": ["「", "」"], "『": ["『", "』"], "<": ["<", ">"],
  "\"": ["\"", "\""], "'": ["'", "'"]
};
// Accept either side, or an atomic pair committed by a Chinese IME. Keep the
// legacy 【 -> [...] shortcut; the full-width pair 【】 is accepted explicitly.
const CHINESE_PAIRS = ["“”", "‘’", "「」", "『』", "（）", "《》", "〈〉", "〔〕", "〖〗", "｛｝"];
for (const pair of CHINESE_PAIRS) {
  const sides = Array.from(pair);
  for (const input of [sides[0], sides[1], pair]) WRAPS[input] = sides;
}
WRAPS["】"] = WRAPS["【"];
WRAPS["【】"] = ["【", "】"];
Object.freeze(WRAPS);
const HALF = { "。": ".", "！": "!", "；": ";", "，": ",", "：": ":", "？": "?", "》": ">", "｜": "|", "《": "<" };

function replacement(from, to, text, cursor, end = cursor, kind) {
  const result = core.edit(from, to, text, from + cursor, from + end);
  result.restoreSelection = true;
  if (kind) result.kind = kind;
  return result;
}

function transform(ctx, data, settings) {
  if (!settings.enabled || !data || ctx.crossBlock || ctx.code || ctx.line.protected && ctx.line.kind !== "math") return null;
  if (ctx.line.kind === "math" && !(ctx.line.text === "$$" && ctx.from === ctx.line.start + 1 && ctx.to === ctx.from && ["$", "￥", "¥"].includes(data))) return null;
  if (ctx.from !== ctx.to) {
    const pair = settings.selectionWrap && Object.hasOwn(WRAPS, data) && WRAPS[data];
    if (!pair) return null;
    const selected = ctx.text.slice(ctx.from, ctx.to);
    return replacement(ctx.from, ctx.to, pair[0] + selected + pair[1], pair[0].length, pair[0].length + selected.length);
  }
  // Shortcuts are triggered by single typed/committed symbols, never by paste.
  if (data.length !== 1) return null;
  const before = ctx.text.slice(ctx.line.start, ctx.from), after = ctx.text.slice(ctx.from, ctx.line.end);
  const previous = before.slice(-1);
  const from = ctx.from - 1;
  if (settings.fullWidthToHalfWidth) {
    if (previous === data && HALF[data]) {
      const consume = data === "《" && after.startsWith("》") ? 1 : 0;
      return replacement(from, ctx.to + consume, HALF[data], 1);
    }
    const quote = (previous === "“" && (data === "“" || data === "”")) ? ["\"", "”"] : previous === "‘" && (data === "‘" || data === "’") ? ["'", "’"] : null;
    if (quote) return replacement(from, ctx.to + (after.startsWith(quote[1]) ? 1 : 0), quote[0] + quote[0], 1);
    if (previous === "（" && data === "（") return replacement(from, ctx.to + (after.startsWith("）") ? 1 : 0), "()", 1);
  }
  if (!settings.basicSymbolInput) return null;
  if (data === "【" && previous === "【") {
    const bang = before.slice(-2, -1) === "！";
    return replacement(from - (bang ? 1 : 0), ctx.to + (after.startsWith("】") ? 1 : 0), (bang ? "!" : "") + "[[]]", bang ? 3 : 2);
  }
  if (data === "·" && previous === "·") return replacement(from, ctx.to, "``", 1);
  if (data === "·" && previous === "`" && after.startsWith("`") && /^[ \t]*`$/.test(before)) {
    const indent = before.slice(0, -1);
    const text = indent + "```\n" + indent + "\n" + indent + "```";
    return replacement(ctx.line.start, ctx.to + 1, text, indent.length + 4 + indent.length, undefined, "code-block");
  }
  if ((data === "￥" || data === "¥" || data === "$") && (previous === data && data !== "$" || previous === "$")) {
    if (previous === "$" && after.startsWith("$")) return replacement(from, ctx.to + 1, "$$\n\n$$", 3, undefined, "math-block");
    return replacement(from, ctx.to, "$$", 1);
  }
  if (data === "》" && /^[ \t]*(?:>[ \t]?)*$/.test(before)) return replacement(ctx.from, ctx.to, "> ", 2, undefined, "quote");
  if (data === "、" && /^[ \t]*$/.test(before)) return replacement(ctx.from, ctx.to, "/", 1);
  return null;
}

module.exports = { transform, WRAPS, HALF, CHINESE_PAIRS };
