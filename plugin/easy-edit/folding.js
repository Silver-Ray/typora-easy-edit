"use strict";
const core = require("./core");

// View-only heading folds. Markdown and undo history are untouched by folding.
class HeadingFolding {
  constructor(win) {
    this.win = win;
    this.headers = new Set();
    this.hidden = new Set();
    this.marks = new Set();
    this.root = win.document.getElementById("write");
    this.observer = new win.MutationObserver(() => this.refresh());
    this.observer.observe(this.root, { childList: true });
  }

  refresh() {
    this.hidden.forEach(node => node.classList.remove("ee-fold-hidden"));
    this.hidden.clear();
    this.headers.forEach(header => {
      if (!header.isConnected) { this.headers.delete(header); return; }
      const level = Number(header.tagName.slice(1));
      for (let next = header.nextElementSibling; next; next = next.nextElementSibling) {
        if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName.slice(1)) <= level) break;
        next.classList.add("ee-fold-hidden"); this.hidden.add(next);
      }
    });
  }

  toggleRich(header) {
    if (!header || header.parentElement !== this.root || !/^H[1-6]$/.test(header.tagName)) return false;
    if (this.headers.has(header)) this.headers.delete(header); else this.headers.add(header);
    header.classList.toggle("ee-folded-heading", this.headers.has(header));
    this.refresh();
    return true;
  }

  toggle(adapter, ctx) {
    if (!adapter.cm) return this.toggleRich(ctx.heading);
    if (adapter.isFence) return false;
    const heading = ctx.line.text.match(/^(#{1,6})\s+/);
    if (!heading || ctx.line.protected || ctx.code) return false;
    const cm = adapter.cm;
    const existing = cm.getAllMarks().find(mark => {
      const found = mark.find();
      return mark.__isFold && found && found.from.line === ctx.index;
    });
    if (existing) { existing.clear(); this.marks.delete(existing); return true; }
    let last = ctx.index;
    for (let i = ctx.index + 1; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const next = !line.protected && !line.code && line.text.match(/^(#{1,6})\s+/);
      if (next && next[1].length <= heading[1].length) break;
      last = i;
    }
    if (last === ctx.index) return false;
    const widget = this.win.document.createElement("span");
    widget.className = "ee-fold-widget"; widget.textContent = " … "; widget.title = "点击展开标题内容";
    const mark = cm.markText({ line: ctx.index, ch: ctx.line.text.length }, { line: last, ch: ctx.lines[last].text.length }, { collapsed: true, replacedWith: widget, clearOnEnter: false });
    mark.__isFold = true;
    this.marks.add(mark);
    if (mark.on) mark.on("clear", () => this.marks.delete(mark));
    widget.addEventListener("mousedown", e => { e.preventDefault(); mark.clear(); this.marks.delete(mark); });
    return true;
  }

  clear() {
    this.headers.forEach(header => header.classList.remove("ee-folded-heading"));
    this.headers.clear();
    this.marks.forEach(mark => mark.clear()); this.marks.clear();
    this.refresh();
  }

  destroy() { this.observer.disconnect(); this.clear(); }
}
module.exports = { HeadingFolding };
