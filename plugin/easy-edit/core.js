"use strict";

// Pure Markdown transformations. All positions are UTF-16 offsets, like CodeMirror.
const DEFAULTS = Object.freeze({
  enabled: true,
  codeSelectAll: true,
  codeIndent: true,
  codeBackspace: true,
  codePaste: true,
  codeEnter: true,
  emptyListBackspace: true,
  emptyQuoteBackspace: true,
  tabout: true,
  progressiveSelectAll: true,
  listPaste: true,
  quotePaste: true,
  strictLineBreak: false,
  strictMode: "mix",
  collapsedHeadingEnter: true,
  newLineAfter: true,
  toggleComment: true,
  selectBlock: true,
  selectionWrap: true,
  fullWidthToHalfWidth: true,
  basicSymbolInput: true,
  indentStyle: "auto",
  indentSize: 4
});

function normalizeSettings(value) {
  const out = Object.assign({}, DEFAULTS);
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "boolean" && typeof value[key] === "boolean") out[key] = value[key];
  }
  if (["mix", "two-space", "paragraph"].includes(value.strictMode)) out.strictMode = value.strictMode;
  if (["auto", "spaces", "tabs"].includes(value.indentStyle)) out.indentStyle = value.indentStyle;
  if (Number.isInteger(value.indentSize) && value.indentSize >= 1 && value.indentSize <= 8) out.indentSize = value.indentSize;
  return out;
}

const quotePrefix = text => (text.match(/^[ \t]*(?:>[ \t]?)+/) || [""])[0];
function prefixInfo(text) {
  const quote = quotePrefix(text);
  const rest = text.slice(quote.length);
  const list = rest.match(/^([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/);
  return { quote, list, prefix: quote + (list ? list[0] : ""), rest };
}

function parse(text) {
  const lines = [];
  let start = 0;
  for (const part of text.split("\n")) {
    lines.push({ text: part, start, end: start + part.length, code: null, protected: false });
    start += part.length + 1;
  }
  let active = null;
  let math = false;
  let frontmatter = lines[0].text.trim() === "---" && lines.slice(1).some(l => /^(---|\.\.\.)[ \t]*$/.test(l.text));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = prefixInfo(line.text);
    const body = line.text.slice(info.quote.length);
    if (active) {
      const close = body.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === active.marker[0] && close[1].length >= active.marker.length) {
        active.to = i;
        active.end = line.start;
        line.protected = true;
        line.kind = "fence";
        active = null;
      } else {
        line.code = active;
      }
      continue;
    }
    if (frontmatter) {
      line.protected = true;
      line.kind = "frontmatter";
      if (i > 0 && /^(---|\.\.\.)[ \t]*$/.test(line.text)) frontmatter = false;
      continue;
    }
    if (math) {
      line.protected = true;
      line.kind = "math";
      if (/^[ \t]*\$\$[ \t]*$/.test(body)) math = false;
      continue;
    }
    const fenceBody = info.list ? body.slice(info.list[0].length) : body;
    const fence = fenceBody.match(/^[ \t]*(`{3,}|~{3,})([^`]*)$/);
    if (fence) {
      active = { from: i, to: lines.length, start: line.end + 1, end: text.length, marker: fence[1], language: fence[2].trim().split(/\s/)[0], baseIndent: fenceBody.match(/^[ \t]*/)[0].length + (info.list ? info.list[0].length : 0) };
      line.protected = true;
      line.kind = "fence";
    } else if (/^[ \t]*\$\$[ \t]*$/.test(body)) {
      math = !math;
      line.protected = true;
      line.kind = "math";
    } else if (/^[ \t]*\$\$.*\$\$[ \t]*$/.test(body)) {
      line.protected = true;
      line.kind = "math";
    }
  }
  return lines;
}

function lineAt(lines, pos) {
  let lo = 0, hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lines[mid].start <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function context(text, from, to = from, options = {}) {
  const lines = parse(text);
  const index = lineAt(lines, from);
  const line = lines[index];
  const info = prefixInfo(line.text);
  // A Markdown list item can contain indented continuation paragraphs, not just
  // the line bearing the marker. Retain their structural context when pasting.
  if (!info.list && !line.code && !line.protected) {
    const leading = info.rest.match(/^[ \t]*/)[0];
    const width = s => s.replace(/\t/g, "    ").length;
    if (leading) {
      for (let i = index - 1; i >= 0; i--) {
        const candidate = prefixInfo(lines[i].text);
        if (!lines[i].text.trim()) continue;
        if (candidate.quote !== info.quote) break;
        if (candidate.list) {
          if (width(leading) >= width(candidate.list[0])) {
            info.list = candidate.list;
            info.continuation = true;
            info.continuationIndent = leading;
          }
          break;
        }
        if (width(candidate.rest.match(/^[ \t]*/)[0]) < width(leading)) break;
      }
    }
  }
  return Object.assign({ text, from, to, lines, index, line, info, code: line.code, language: line.code && line.code.language, indent: "    ", indentSize: 4 }, options);
}

function edit(from, to, insert, anchor = from + insert.length, head = anchor) {
  return { changes: [{ from, to, insert }], anchor, head };
}

function codeBase(line, code) {
  const quote = quotePrefix(line.text).length;
  const spaces = line.text.slice(quote).match(/^[ \t]*/)[0].length;
  return quote + Math.min(code && code.baseIndent || 0, spaces);
}

function blockRange(ctx) {
  const { lines, index, code } = ctx;
  if (code) return [code.start, Math.max(code.start, code.end - (code.to < lines.length ? 1 : 0))];
  let first = index, last = index;
  const isQuote = !!ctx.info.quote;
  const compatible = line => !line.code && !line.protected && !!line.text.trim() && (isQuote ? !!quotePrefix(line.text) : !/^(?:[ \t]*>|[ \t]*#{1,6}\s)/.test(line.text));
  if (!compatible(lines[index])) return [lines[index].start, lines[index].end];
  while (first > 0 && compatible(lines[first - 1])) first--;
  while (last + 1 < lines.length && compatible(lines[last + 1])) last++;
  return [lines[first].start, lines[last].end];
}

function indentCode(ctx, reverse) {
  const { lines, from, to, indent, indentSize } = ctx;
  const first = lineAt(lines, from);
  let last = lineAt(lines, to);
  if (last > first && lines[last].start === to) last--;
  if (lines.slice(first, last + 1).some(l => !l.code || l.code !== ctx.code)) return null;
  if (from === to && !reverse) return edit(from, to, indent);
  const changes = [];
  for (let i = first; i <= last; i++) {
    const line = lines[i];
    const base = codeBase(line, ctx.code);
    const prefix = line.text.slice(base).match(/^[ \t]*/)[0];
    const remove = prefix[0] === "\t" ? 1 : Math.min(indentSize, prefix.length);
    if (!reverse || remove) changes.push({ from: line.start + base, to: line.start + base + (reverse ? remove : 0), insert: reverse ? "" : indent });
  }
  if (!changes.length) return null;
  const map = (pos, right) => changes.reduce((p, c) => p + (pos < c.from ? 0 : pos <= c.to ? (right ? c.insert.length : 0) - (pos - c.from) : c.insert.length - (c.to - c.from)), pos);
  return { changes, anchor: map(from, true), head: map(to, true) };
}

function codeBackspace(ctx) {
  if (ctx.from !== ctx.to) return null;
  const col = ctx.from - ctx.line.start;
  const base = codeBase(ctx.line, ctx.code);
  const before = ctx.line.text.slice(base, col);
  if (!before || !/^[ \t]+$/.test(before)) return null;
  if (before.endsWith("\t")) return edit(ctx.from - 1, ctx.from, "");
  const tail = before.match(/ +$/)[0].length;
  const width = Array.from(before).reduce((n, c) => c === "\t" ? n + ctx.indentSize - n % ctx.indentSize : n + 1, 0);
  const count = Math.min(tail, width % ctx.indentSize || ctx.indentSize);
  return edit(ctx.from - count, ctx.from, "");
}

function emptyBackspace(ctx, settings) {
  if (ctx.from !== ctx.to || ctx.from !== ctx.line.end || ctx.code || ctx.line.protected) return null;
  const { info, line } = ctx;
  if (settings.emptyListBackspace && info.list && !info.continuation && !line.text.slice(info.prefix.length).trim()) {
    return edit(line.start + info.quote.length, line.end, info.list[1]);
  }
  if (settings.emptyQuoteBackspace && info.quote && !line.text.slice(info.quote.length).trim()) {
    const quote = info.quote.replace(/>[ \t]?$/, "");
    return edit(line.start, line.end, quote);
  }
  return null;
}

function dedentPaste(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const nonblank = lines.filter(l => l.trim());
  if (!nonblank.length) return lines;
  let common = nonblank[0].match(/^[ \t]*/)[0];
  for (const line of nonblank.slice(1)) {
    let n = 0;
    while (n < common.length && common[n] === line[n]) n++;
    common = common.slice(0, n);
  }
  return lines.map(l => l.slice(0, common.length) === common ? l.slice(common.length) : l);
}

function smartPaste(ctx, text, settings) {
  text = text.replace(/\r\n?/g, "\n");
  if (!text.includes("\n")) return null;
  if (ctx.code) {
    if (!settings.codePaste) return null;
    if (ctx.to > ctx.code.end) return null;
    const before = ctx.line.text.slice(0, ctx.from - ctx.line.start);
    const quote = quotePrefix(before);
    const base = quote + before.slice(quote.length).match(/^[ \t]*/)[0];
    const lines = dedentPaste(text);
    return edit(ctx.from, ctx.to, lines[0] + lines.slice(1).map(l => "\n" + (l ? base + l : quote)).join(""));
  }
  if (ctx.line.protected) return null;
  const { info } = ctx;
  if (info.list && !settings.listPaste || info.quote && !settings.quotePaste) return null;
  if (!info.list && !info.quote) return null;
  // Pasting inside an item continues its body; it does not create extra list items.
  const quote = info.quote;
  const continuation = quote + (info.continuation ? info.continuationIndent : info.list ? info.list[1] + " ".repeat(info.list[0].length - info.list[1].length) : "");
  const lines = text.split("\n");
  const insert = lines[0] + lines.slice(1).map(l => "\n" + (quote && l.startsWith(quote) ? l : continuation + l)).join("");
  return edit(ctx.from, ctx.to, insert);
}

const PAIRS = [
  ["[[", "]]"], ["**", "**"], ["__", "__"], ["~~", "~~"], ["==", "=="], ["$$", "$$"],
  ["〖", "〗"], ["【", "】"], ["（", "）"], ["《", "》"], ["〈", "〉"], ["「", "」"], ["『", "』"], ["“", "”"], ["‘", "’"],
  ["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"], ["\"", "\""], ["'", "'"], ["`", "`"], ["$", "$"], ["*", "*"], ["_", "_"]
];
function escaped(text, pos) {
  let count = 0;
  while (pos > 0 && text[--pos] === "\\") count++;
  return count % 2 === 1;
}
function tabout(ctx) {
  if (ctx.line.protected && ctx.line.kind !== "math") return null;
  const text = ctx.line.text;
  const from = ctx.from - ctx.line.start, to = ctx.to - ctx.line.start;
  if (to > text.length) return null;
  const candidates = [];
  const tokens = PAIRS.concat((text.match(/`{2,}/g) || []).map(t => [t, t])).sort((a, b) => b[0].length - a[0].length);
  const stack = [];
  for (let i = 0; i < text.length;) {
    if (escaped(text, i)) { i++; continue; }
    const top = stack[stack.length - 1];
    if (top && text.startsWith(top.pair[1], i)) {
      stack.pop();
      if (top.start + top.pair[0].length <= from && to <= i) candidates.push({ start: top.start, end: i + top.pair[1].length });
      i += top.pair[1].length;
      continue;
    }
    // Delimiters inside inline code are literal.
    if (top && /^`+$/.test(top.pair[0])) { i++; continue; }
    const pair = tokens.find(p => text.startsWith(p[0], i) && !(p[0] === "'" && /[\p{L}\p{N}]/u.test(text[i - 1] || "") && /[\p{L}\p{N}]/u.test(text[i + 1] || "")) && !(p[0] === "_" && /\w/.test(text[i - 1] || "") && /\w/.test(text[i + 1] || "")));
    if (pair) { stack.push({ start: i, pair }); i += pair[0].length; } else i++;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.start - a.start || a.end - b.end);
  const pos = ctx.line.start + candidates[0].end;
  return { changes: [], anchor: pos, head: pos };
}

function lineBreak(ctx, settings, afterCurrent = false) {
  const { line, info } = ctx;
  const pos = afterCurrent ? line.end : ctx.from;
  if (!afterCurrent && ctx.from !== ctx.to) return null;
  if (ctx.code) {
    if (!afterCurrent && !settings.codeEnter) return null;
    const quote = quotePrefix(line.text);
    const indent = quote + line.text.slice(quote.length).match(/^[ \t]*/)[0];
    return edit(pos, pos, "\n" + indent);
  }
  if (line.protected) return afterCurrent ? edit(pos, pos, "\n") : null;
  if (info.list) {
    if (!afterCurrent) return null;
    if (info.continuation) return edit(pos, pos, "\n" + info.quote + info.continuationIndent);
    let prefix = info.prefix.replace(/\[[xX]\]/, "[ ]");
    prefix = prefix.replace(/\d+(?=[.)][ \t])/, n => String(Number(n) + 1));
    return edit(pos, pos, "\n" + prefix);
  }
  const content = line.text.slice(info.quote.length);
  const ordinary = !/^[ \t]*(?:#{1,6}\s|[-*_]{3,}\s*$|\||(?:[-=]+)\s*$|\[[^\]]+\]:)/.test(content);
  if (!content.trim() || pos <= line.start + info.quote.length || !ordinary) return afterCurrent ? edit(pos, pos, "\n" + info.quote) : null;
  if (!settings.strictLineBreak) return afterCurrent ? edit(pos, pos, "\n" + info.quote) : null;
  const spaces = / {2}$/.test(ctx.text.slice(line.start, pos)) ? "" : "  ";
  const hard = settings.strictMode === "two-space" || settings.strictMode === "mix" && !!info.quote;
  const insert = hard ? spaces + "\n" + info.quote : "\n" + info.quote + "\n" + info.quote;
  return edit(pos, pos, insert);
}

function collapsedHeading(ctx, fold) {
  if (!fold || ctx.from !== ctx.to) return null;
  const heading = ctx.line.text.match(/^(#{1,6})[ \t]+/);
  if (!heading) return null;
  const at = ctx.lines[Math.min(fold.lastLine, ctx.lines.length - 1)].end;
  const insert = "\n\n" + heading[1] + " ";
  return edit(at, at, insert);
}

const COMMENTS = [
  [/^(python|py|ruby|rb|shell|sh|bash|zsh|fish|powershell|ps1|r|perl|yaml|yml|toml|dockerfile|makefile|conf|ini)$/i, "#"],
  [/^(sql|lua|haskell|hs)$/i, "--"],
  [/^(lisp|clojure|clj|scheme|asm)$/i, ";"],
  [/^(matlab|octave|tex|latex|erlang)$/i, "%"],
  [/^(javascript|js|jsx|typescript|ts|tsx|c|cpp|c\+\+|csharp|cs|java|kotlin|kt|go|rust|rs|swift|scala|dart|php|jsonc|verilog|v|systemverilog|sv)$/i, "//"]
];
function toggleComment(ctx) {
  const first = lineAt(ctx.lines, ctx.from);
  let last = lineAt(ctx.lines, ctx.to);
  if (last > first && ctx.lines[last].start === ctx.to) last--;
  const lines = ctx.lines.slice(first, last + 1);
  const marker = ctx.code && COMMENTS.find(c => c[0].test(ctx.language || ""));
  if (ctx.code && lines.some(l => l.code !== ctx.code)) return null;
  if (ctx.code && !marker && !/^(html|xml|svg|vue|svelte|css|scss|less)$/i.test(ctx.language || "")) return null;
  const pair = ctx.code && /^(css|scss|less)$/i.test(ctx.language || "") ? ["/*", "*/"] : ["<!--", "-->"];
  const nonblank = lines.filter(l => l.text.trim());
  if (!nonblank.length) return null;
  const uncomment = nonblank.every(l => marker ? l.text.trimStart().startsWith(marker[1]) : l.text.trim().startsWith(pair[0]) && l.text.trim().endsWith(pair[1]));
  const replacement = lines.map(l => {
    const indent = l.text.match(/^[ \t]*/)[0], body = l.text.slice(indent.length);
    if (!body) return l.text;
    if (marker) return indent + (uncomment ? body.slice(marker[1].length).replace(/^ /, "") : marker[1] + " " + body);
    return indent + (uncomment ? body.slice(pair[0].length, body.lastIndexOf(pair[1])).replace(/^ | $/g, "") : pair[0] + " " + body + " " + pair[1]);
  }).join("\n");
  return edit(lines[0].start, lines[lines.length - 1].end, replacement, lines[0].start, lines[0].start + replacement.length);
}

function apply(text, result) {
  for (const c of result.changes.slice().sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}

module.exports = { DEFAULTS, normalizeSettings, parse, lineAt, prefixInfo, quotePrefix, context, edit, blockRange, indentCode, codeBackspace, emptyBackspace, dedentPaste, smartPaste, tabout, lineBreak, collapsedHeading, toggleComment, apply };
