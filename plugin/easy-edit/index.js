"use strict";
const core = require("./core");
const { getAdapter } = require("./adapters");
const { Settings } = require("./settings");
const { HeadingFolding } = require("./folding");
const { SymbolInput } = require("./input");

class EasyEdit {
  constructor(win, options = {}) {
    this.win = win;
    this.adapterFactory = options.getAdapter || getAdapter;
    this.settings = new Settings(win, value => {
      this.cycle = null;
      if (this.folding && (!value.enabled || !value.collapsedHeadingEnter)) this.folding.clear();
    });
    this.composing = false;
    this.listeners = [];
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.folding = new HeadingFolding(this.win);
    this.listen("compositionstart", () => { this.composing = true; });
    this.listen("compositionend", () => { this.composing = false; });
    this.symbolInput = new SymbolInput(this).start();
    this.listen("blur", () => { this.composing = false; }, this.win);
    this.listen("keydown", event => this.onKey(event));
    this.listen("paste", event => this.onPaste(event));
    this.listen("mousedown", event => { if (!event.target.closest("#easy-edit-panel")) this.cycle = null; });
    this.listen("click", event => {
      if (!this.settings.value.enabled || !this.settings.value.collapsedHeadingEnter || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.win.File.isLocked) return;
      const header = event.target.closest("#write > h1,#write > h2,#write > h3,#write > h4,#write > h5,#write > h6");
      if (header && !header.classList.contains("plugin-collapsed-paragraph") && this.folding.toggleRich(header)) this.consume(event);
    });
    this.settings.mount(name => this.command(name));
    return this;
  }

  listen(type, fn, target = this.win.document) {
    target.addEventListener(type, fn, true);
    this.listeners.push(() => target.removeEventListener(type, fn, true));
  }

  adapter(target) { return this.adapterFactory(this.win, this.settings.value, target || this.win.document.activeElement); }
  consume(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  owner(adapter) { return adapter.cm || adapter.editor; }

  selectAll(adapter, ctx) {
    const settings = this.settings.value;
    if (ctx.code && settings.codeSelectAll) return adapter.selectCode(ctx);
    if (!settings.progressiveSelectAll) return false;
    const previous = this.cycle;
    const continues = previous && previous.owner === this.owner(adapter) && previous.text === ctx.text && previous.from === ctx.from && previous.to === ctx.to;
    const stage = ctx.crossBlock ? 2 : continues ? previous.stage + 1 : 0;
    let handled;
    if (stage === 0) handled = adapter.select(ctx.line.start, ctx.line.end);
    else if (stage === 1) handled = adapter.selectBlock(ctx);
    else handled = adapter.selectDocument();
    const next = adapter.snapshot();
    this.cycle = next && { owner: this.owner(adapter), text: next.text, from: next.from, to: next.to, stage: Math.min(stage, 2) };
    return handled;
  }

  onKey(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || this.composing) return;
    const mod = this.win.File && this.win.File.isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.altKey && !event.shiftKey && event.key.toLowerCase() === "e") {
      this.consume(event); this.settings.open(); return;
    }
    const settings = this.settings.value;
    if (!settings.enabled) return;
    if (mod && event.altKey && !event.shiftKey && event.key.toLowerCase() === "h" && settings.collapsedHeadingEnter) {
      if (this.command("toggleHeadingFold")) this.consume(event);
      return;
    }
    const interested = ["Tab", "Backspace", "Enter"].includes(event.key) || mod && (event.key.toLowerCase() === "a" || event.key === "/" || event.code === "Slash");
    if (!interested) { this.cycle = null; return; }
    const adapter = this.adapter(event.target);
    if (!adapter) return;
    try {
      const ctx = adapter.snapshot();
      if (!ctx) return;
      let handled = false;
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") handled = this.selectAll(adapter, ctx);
      else {
        this.cycle = null;
        if (event.altKey || event.metaKey && !mod || event.ctrlKey && !mod) return;
        if (mod && !event.shiftKey && event.key === "Enter" && settings.newLineAfter) {
          handled = adapter.cm ? adapter.apply(core.lineBreak(ctx, settings, true)) : adapter.lineBreak(ctx, true);
        } else if (mod && !event.shiftKey && (event.key === "/" || event.code === "Slash") && settings.toggleComment) {
          handled = !ctx.crossBlock && adapter.apply(core.toggleComment(ctx));
        } else if (!mod && event.key === "Tab") {
          if (adapter.hasTabstop()) return;
          if (ctx.code && settings.codeIndent) handled = adapter.apply(core.indentCode(ctx, event.shiftKey));
          else if (!event.shiftKey && settings.tabout && !ctx.crossBlock) handled = adapter.apply(core.tabout(ctx));
        } else if (!mod && !event.shiftKey && event.key === "Backspace") {
          if (ctx.code && settings.codeBackspace) handled = adapter.apply(core.codeBackspace(ctx));
          else handled = adapter.cm ? adapter.apply(core.emptyBackspace(ctx, settings)) : adapter.emptyBackspace(ctx);
        } else if (!mod && !event.shiftKey && event.key === "Enter") {
          if (settings.collapsedHeadingEnter) handled = adapter.cm ? adapter.apply(adapter.foldedHeading(ctx)) : adapter.collapsedHeading(ctx);
          if (!handled && (ctx.code && settings.codeEnter || !ctx.code && settings.strictLineBreak)) handled = adapter.cm ? adapter.apply(core.lineBreak(ctx, settings)) : adapter.lineBreak(ctx, false);
        }
      }
      if (handled) this.consume(event);
    } catch (error) { this.win.console.error("[Easy Edit] 编辑增强未完成：", error); }
  }

  onPaste(event) {
    if (event.defaultPrevented || this.composing || !this.settings.value.enabled || !event.clipboardData || event.clipboardData.files.length) return;
    const adapter = this.adapter(event.target);
    if (!adapter) return;
    try {
      const ctx = adapter.snapshot();
      if (!ctx) return;
      const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      const handled = adapter.cm ? adapter.apply(core.smartPaste(ctx, text, this.settings.value)) : adapter.paste(ctx, text);
      if (handled) { this.cycle = null; this.consume(event); }
    } catch (error) { this.win.console.error("[Easy Edit] 粘贴增强未完成：", error); }
  }

  command(name) {
    const settings = this.settings.value;
    if (!settings.enabled || !(name === "toggleHeadingFold" ? settings.collapsedHeadingEnter : settings[name])) return false;
    const adapter = this.adapter();
    const ctx = adapter && adapter.snapshot();
    if (!ctx) return false;
    if (name === "toggleHeadingFold") return this.folding.toggle(adapter, ctx);
    if (name === "selectBlock") return adapter.selectBlock(ctx);
    if (name === "newLineAfter") return adapter.cm ? adapter.apply(core.lineBreak(ctx, settings, true)) : adapter.lineBreak(ctx, true);
    if (name === "toggleComment") return adapter.apply(core.toggleComment(ctx));
    return false;
  }

  destroy() {
    this.listeners.splice(0).forEach(remove => remove());
    if (this.symbolInput) this.symbolInput.destroy();
    if (this.folding) this.folding.destroy();
    this.settings.destroy();
    this.started = false;
    if (this.win.TyporaEasyEdit === this) delete this.win.TyporaEasyEdit;
  }
}

function boot(win) {
  if (win.TyporaEasyEdit || win.__easyEditBooting) return;
  win.__easyEditBooting = true;
  let attempts = 0;
  const timer = win.setInterval(() => {
    if (win.File && win.File.editor && win.File.editor.selection && win.document.getElementById("write")) {
      win.clearInterval(timer);
      delete win.__easyEditBooting;
      win.TyporaEasyEdit = new EasyEdit(win).start();
    } else if (++attempts >= 120) {
      win.clearInterval(timer);
      delete win.__easyEditBooting;
      win.console.warn("[Easy Edit] 等待 Typora 编辑器超时。请检查插件与 Typora 版本。");
    }
  }, 500);
}

module.exports = { EasyEdit, boot };
