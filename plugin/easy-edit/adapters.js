"use strict";

const core = require("./core");

function indentation(settings, cm, file) {
  const size = settings.indentStyle === "auto" ? Number(cm && cm.getOption("indentUnit") || file.option.codeIndentSize || 4) : settings.indentSize;
  const tabs = settings.indentStyle === "tabs" || settings.indentStyle === "auto" && cm && cm.getOption("indentWithTabs");
  return { indentSize: Math.max(1, Math.min(8, size)), indent: tabs ? "\t" : " ".repeat(Math.max(1, Math.min(8, size))) };
}

class CodeMirrorAdapter {
  constructor(cm, file, settings, isFence) {
    this.cm = cm;
    this.file = file;
    this.settings = settings;
    this.isFence = isFence;
  }

  snapshot() {
    const cm = this.cm;
    if (cm.getOption("readOnly") || cm.listSelections().length !== 1) return null;
    const from = cm.indexFromPos(cm.getCursor("from")), to = cm.indexFromPos(cm.getCursor("to"));
    const ctx = core.context(cm.getValue("\n"), from, to, indentation(this.settings, cm, this.file));
    if (this.isFence) {
      const wrapper = cm.getWrapperElement().closest("[lang]");
      const code = { start: 0, end: ctx.text.length, from: -1, to: ctx.lines.length, language: wrapper && wrapper.getAttribute("lang") || cm.getOption("mode") };
      ctx.lines.forEach(line => { line.code = code; line.protected = false; });
      ctx.code = code;
      ctx.language = typeof code.language === "string" ? code.language : "";
    }
    return ctx;
  }

  apply(result) {
    if (!result) return false;
    const cm = this.cm;
    cm.operation(() => {
      if (result.changes.length) {
        if (cm.doc && cm.doc.changeGeneration) cm.doc.changeGeneration(true);
        result.changes.slice().sort((a, b) => b.from - a.from).forEach(c => {
          cm.replaceRange(c.insert, cm.posFromIndex(c.from), cm.posFromIndex(c.to), "+easy-edit");
        });
      }
      cm.setSelection(cm.posFromIndex(result.anchor), cm.posFromIndex(result.head));
      cm.scrollIntoView(cm.posFromIndex(result.head));
    });
    return true;
  }

  select(from, to) { return this.apply({ changes: [], anchor: from, head: to }); }
  selectDocument() { return this.select(0, this.cm.getValue("\n").length); }
  selectCode(ctx) { const range = core.blockRange(ctx); return this.select(range[0], range[1]); }
  selectBlock(ctx) { const range = core.blockRange(ctx); return this.select(range[0], range[1]); }

  foldedHeading(ctx) {
    if (this.isFence || !/^#{1,6}\s/.test(ctx.line.text)) return null;
    const mark = this.cm.getAllMarks().find(m => {
      if (!m.__isFold) return false;
      const range = m.find();
      return range && range.from.line === ctx.index;
    });
    if (!mark) return null;
    const range = mark.find();
    return core.collapsedHeading(ctx, { lastLine: range.to.line });
  }

  hasTabstop() {
    return this.cm.getAllMarks().some(m => m.className && /(?:tabstop|snippet)/i.test(m.className));
  }
}

class RichTextAdapter {
  constructor(win, file, settings) {
    this.win = win;
    this.file = file;
    this.editor = file.editor;
    this.settings = settings;
    this.isFence = false;
  }

  snapshot() {
    const selection = this.win.getSelection();
    const range = this.editor.selection.getRangy();
    if (!selection || !range || selection.rangeCount !== 1) return null;
    const mark = this.editor.getMarkElem(range.startContainer);
    const endMark = this.editor.getMarkElem(range.endContainer);
    if (!mark || !mark[0] || !endMark || !endMark[0]) return null;
    if (!this.win.document.getElementById("write").contains(mark[0])) return null;
    // Rich formula/HTML editors and tables have their own editing semantics.
    if (mark[0].closest(".md-fences,.md-rawblock,table,[mdtype='math_block'],[mdtype='html_block']")) return null;
    const bookmark = range.getBookmark(mark[0]);
    const ctx = core.context(mark.rawText(), bookmark.start, mark[0] === endMark[0] ? bookmark.end : bookmark.start, indentation(this.settings, null, this.file));
    ctx.mark = mark;
    ctx.range = range;
    ctx.crossBlock = mark[0] !== endMark[0];
    ctx.list = mark[0].closest("li");
    ctx.quote = mark[0].closest("blockquote");
    ctx.heading = /^H[1-6]$/.test(mark[0].tagName) ? mark[0] : null;
    return ctx;
  }

  select(from, to, container) {
    const ctx = this.snapshot();
    if (!ctx && !container) return false;
    const range = this.editor.selection.rangy.createRange();
    range.moveToBookmark({ start: from, end: to, containerNode: container || ctx.mark[0] });
    range.select();
    return true;
  }

  apply(result) {
    if (!result) return false;
    const ctx = this.snapshot();
    if (!ctx || ctx.crossBlock) return false;
    if (!result.changes.length) return this.select(result.anchor, result.head, ctx.mark[0]);
    if (result.changes.length !== 1) return false;
    const change = result.changes[0];
    this.select(change.from, change.to, ctx.mark[0]);
    this.editor.undo.endSnap();
    const op = this.editor.UserOp;
    const undo = this.editor.undo;
    const node = this.editor.findNodeByElem(ctx.mark);
    // Inserting via the clipboard parser splits a list body into extra items.
    // Use the same inline edit transaction as Typora's native typing instead.
    let command = op.backspaceHandler(this.editor, null, "delSelection", true, false) || undo.UndoManager.makeEmptyCommand(this.editor.selection.buildUndo());
    if (change.insert) op.insertInlineText(this.editor, node, change.insert, change.from, command, true);
    else command.redo.push(this.editor.selection.buildUndo());
    const parsed = result.kind && this.editor.simpleParse(node);
    if (parsed) {
      command = undo.UndoManager.append(command, parsed[0]);
      this.editor.findElemById(parsed[2]).replaceWith(parsed[1]);
      const block = parsed[3][0];
      if (block.get("type") === "fences") {
        const cm = this.editor.fences.addCodeBlock(block.cid);
        if (cm) { cm.focus(); cm.setCursor({ line: 0, ch: 0 }); }
      } else if (block.get("type") === "math_block") {
        this.editor.mathBlock.startEditing(block.cid, "begin");
      } else {
        const target = block.getVeryFirst(true);
        this.editor.selection.jumpIntoElemBegin(this.editor.findElemById(target.cid));
        this.editor.refocus(target.cid);
      }
      command.redo.push(this.editor.selection.buildUndo());
      this.editor.brush.resume();
    }
    undo.register(command);
    this.editor.undo.endSnap();
    if (result.restoreSelection && !parsed) {
      const mark = this.editor.findElemById(node.cid);
      if (mark && mark[0]) this.select(result.anchor, result.head, mark[0]);
    }
    return true;
  }

  selectDocument() {
    const range = this.editor.selection.rangy.createRange();
    range.selectNodeContents(this.win.document.getElementById("write"));
    range.select();
    return true;
  }

  selectBlock(ctx) {
    const container = ctx.quote || ctx.list || ctx.mark[0];
    const range = this.editor.selection.rangy.createRange();
    range.selectNodeContents(container);
    range.select();
    return true;
  }

  emptyBackspace(ctx) {
    if (ctx.crossBlock || ctx.from !== ctx.to || ctx.text.replace(/[\u200b\ufeff\s]/g, "")) return false;
    if (ctx.list && this.settings.emptyListBackspace || ctx.quote && this.settings.emptyQuoteBackspace) {
      if (typeof this.editor.UserOp.lessIndent !== "function") return false;
      this.editor.UserOp.lessIndent(this.editor);
      return true;
    }
    return false;
  }

  paste(ctx, text) {
    if (ctx.crossBlock || !text.includes("\n")) return false;
    if (ctx.list && !this.settings.listPaste || ctx.quote && !this.settings.quotePaste) return false;
    if (!ctx.list && !ctx.quote) return false;
    // The model's parent already provides quote/list prefixes when serializing.
    return this.apply(core.edit(ctx.from, ctx.to, text));
  }

  lineBreak(ctx, afterCurrent) {
    if (ctx.crossBlock || ctx.from !== ctx.to) return false;
    if (ctx.list) {
      if (!afterCurrent) return false;
      this.select(ctx.line.end, ctx.line.end, ctx.mark[0]);
      // Let Typora continue a real list item, including ordered/task metadata.
      const $ = this.win.$;
      if (!$ || !$.Event) return false;
      $(this.editor.writingArea).trigger($.Event("keydown", { which: 13, keyCode: 13, key: "Enter" }));
      return true;
    }
    const local = Object.assign({}, ctx);
    if (ctx.quote) local.info = { quote: "> ", list: null };
    if (ctx.heading) return afterCurrent ? this.insertParagraph(ctx.mark) : false;
    // Do not put literal quote prefixes into a rendered quote container.
    if (ctx.quote) {
      const pos = afterCurrent ? ctx.line.end : ctx.from;
      if (!ctx.text.trim()) return afterCurrent ? this.apply(core.edit(pos, pos, "\n")) : false;
      if (!afterCurrent && !this.settings.strictLineBreak) return false;
      const hard = this.settings.strictLineBreak && this.settings.strictMode !== "paragraph";
      return this.apply(core.edit(pos, pos, hard ? "  \n" : this.settings.strictLineBreak ? "\n\n" : "\n"));
    }
    return this.apply(core.lineBreak(local, this.settings, afterCurrent));
  }

  insertParagraph(mark) {
    if (!this.editor.UserOp.insertParagraph) return false;
    this.editor.UserOp.insertParagraph(false, this.editor, mark);
    return true;
  }

  collapsedHeading(ctx) {
    const header = ctx.heading;
    if (!header || ctx.from !== ctx.to || !(header.classList.contains("plugin-collapsed-paragraph") || header.classList.contains("ee-folded-heading"))) return false;
    const level = Number(header.tagName.slice(1));
    let last = header;
    for (let next = header.nextElementSibling; next; next = next.nextElementSibling) {
      if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName.slice(1)) <= level) break;
      last = next;
    }
    if (!this.insertParagraph(this.win.$(last))) return false;
    this.editor.stylize.changeBlock("header" + level);
    return true;
  }

  hasTabstop() {
    return !!this.win.document.querySelector("#write .tabstop-active,#write .snippet-placeholder-active");
  }
}

function getAdapter(win, settings, target) {
  const file = win.File;
  if (!file || !file.editor || file.isLocked || file.inBusyMode) return null;
  const editor = file.editor;
  const element = target && (target.nodeType === 1 ? target : target.parentElement);
  if (!element || element.closest("#easy-edit-panel")) return null;
  const wrapper = element.closest(".CodeMirror");
  if (editor.sourceView && editor.sourceView.inSourceMode) {
    const cm = editor.sourceView.cm;
    return cm && wrapper === cm.getWrapperElement() ? new CodeMirrorAdapter(cm, file, settings, false) : null;
  }
  if (wrapper && wrapper.CodeMirror && wrapper.closest("#write .md-fences")) return new CodeMirrorAdapter(wrapper.CodeMirror, file, settings, true);
  if (!element.closest("#write") || element.closest("input,textarea,[contenteditable='false']")) return null;
  return new RichTextAdapter(win, file, settings);
}

module.exports = { indentation, CodeMirrorAdapter, RichTextAdapter, getAdapter };
