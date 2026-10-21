"use strict";
const core = require("./core");
const symbols = require("./symbols");
const { CodeMirrorAdapter } = require("./adapters");

class SymbolInput {
  constructor(controller) {
    this.controller = controller;
    this.win = controller.win;
    this.mirrors = new Map();
    this.pending = new WeakMap();
    this.applying = false;
  }

  start() {
    const listen = (name, fn) => this.controller.listen(name, fn);
    listen("focusin", () => this.discover());
    listen("beforeinput", e => this.beforeInput(e));
    listen("compositionstart", e => this.compositionStart(e));
    listen("compositionend", e => this.compositionEnd(e));
    listen("input", () => this.flushPending());
    this.observer = new this.win.MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1 && (node.matches(".CodeMirror") || node.querySelector(".CodeMirror"))))) this.discover();
    });
    this.observer.observe(this.win.document.body, { childList: true, subtree: true });
    this.discover();
    return this;
  }

  discover() {
    this.mirrors.forEach((handlers, cm) => {
      if (cm.getWrapperElement().isConnected) return;
      cm.off("beforeChange", handlers.before); cm.off("changes", handlers.after);
      this.mirrors.delete(cm); this.pending.delete(cm);
    });
    this.win.document.querySelectorAll("#typora-source .CodeMirror,#write .md-fences .CodeMirror").forEach(wrapper => {
      const cm = wrapper.CodeMirror;
      if (!cm || this.mirrors.has(cm)) return;
      const before = (_cm, change) => this.beforeChange(cm, change);
      const after = () => {
        const result = this.pending.get(cm);
        if (!result) return;
        this.pending.delete(cm);
        cm.setSelection(cm.posFromIndex(result.anchor), cm.posFromIndex(result.head));
        if (cm.doc.changeGeneration) cm.doc.changeGeneration(true);
      };
      cm.on("beforeChange", before); cm.on("changes", after);
      this.mirrors.set(cm, { before, after });
    });
  }

  beforeChange(cm, change) {
    if (this.applying || !change.update || !/^(?:\+input|\*compose|input\.type(?:\.compose)?)$/.test(change.origin || "")) return;
    const settings = this.controller.settings.value;
    const file = this.win.File;
    if (!settings.enabled || file.isLocked || file.inBusyMode || cm.getOption("readOnly") || cm.listSelections().length !== 1) return;
    const wrapper = cm.getWrapperElement();
    const adapter = new CodeMirrorAdapter(cm, file, settings, !!wrapper.closest(".md-fences"));
    const ctx = adapter.snapshot();
    if (!ctx) return;
    ctx.from = cm.indexFromPos(change.from); ctx.to = cm.indexFromPos(change.to);
    // Composition polling can replace an input-buffer range different from the
    // current cursor. Derive line and code scope from the actual changed range.
    const actual = core.context(ctx.text, ctx.from, ctx.to, { indent: ctx.indent, indentSize: ctx.indentSize });
    if (adapter.isFence) { actual.code = ctx.code; actual.line.code = ctx.code; }
    const result = symbols.transform(actual, change.text.join("\n"), settings);
    if (!result) return;
    const edit = result.changes[0];
    change.update(cm.posFromIndex(edit.from), cm.posFromIndex(edit.to), edit.insert.split("\n"), "easy-edit-symbol");
    this.pending.set(cm, result);
  }

  beforeInput(event) {
    if (this.applying || event.defaultPrevented || this.controller.composing || event.isComposing || this.finishing || event.inputType !== "insertText") return;
    const adapter = this.controller.adapter(event.target);
    if (!adapter || adapter.cm) return;
    const ctx = adapter.snapshot();
    if (!ctx) return;
    const result = symbols.transform(ctx, event.data, this.controller.settings.value);
    if (!result) return;
    if (!event.cancelable) { this.deferred = { ctx, data: event.data, target: event.target }; return; }
    this.applying = true;
    try { if (adapter.apply(result)) { this.controller.cycle = null; this.controller.consume(event); } }
    finally { this.applying = false; }
  }

  compositionStart(event) {
    this.cancelTimer(); this.finishing = false; this.deferred = null;
    const adapter = this.controller.adapter(event.target);
    this.composition = adapter && !adapter.cm && { ctx: adapter.snapshot(), target: event.target };
  }

  compositionEnd(event) {
    const composition = this.composition;
    this.composition = null;
    if (!composition || !composition.ctx || !event.data) return;
    this.finishing = true;
    this.deferred = { ctx: composition.ctx, target: composition.target, data: event.data };
    this.flushPending();
  }

  flushPending() {
    if (!this.deferred || this.controller.composing) return;
    this.cancelTimer();
    this.timer = this.win.setTimeout(() => {
      this.timer = null; this.finishing = false;
      const pending = this.deferred; this.deferred = null;
      if (!pending) return;
      const adapter = this.controller.adapter(pending.target);
      const current = adapter && !adapter.cm && adapter.snapshot();
      if (!current) return;
      const old = pending.ctx, data = pending.data;
      const expected = old.text.slice(0, old.from) + data + old.text.slice(old.to);
      if (current.text !== expected || current.from !== old.from + data.length || current.from !== current.to) return;
      const result = symbols.transform(old, data, this.controller.settings.value);
      if (!result) return;
      result.changes[0].to += data.length - (old.to - old.from);
      this.applying = true;
      try { adapter.apply(result); }
      finally { this.applying = false; }
    }, 0);
  }

  cancelTimer() { if (this.timer != null) this.win.clearTimeout(this.timer); this.timer = null; }
  destroy() {
    this.cancelTimer(); this.deferred = null; this.composition = null;
    this.observer.disconnect();
    this.mirrors.forEach((handlers, cm) => { cm.off("beforeChange", handlers.before); cm.off("changes", handlers.after); });
    this.mirrors.clear();
  }
}
module.exports = { SymbolInput };
