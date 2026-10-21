"use strict";
const { normalizeSettings, DEFAULTS } = require("./core");
const KEY = "typora-easy-edit.settings.v1";

const GROUPS = [
  ["符号输入增强", [
    ["selectionWrap", "选区包裹：中文“”/「」等引号与括号、￥公式、·行内代码"],
    ["fullWidthToHalfWidth", "连续全角符号转半角：。。 → .，！！ → ! 等"],
    ["basicSymbolInput", "基础符号输入：【【 → 双括号、·· → 行内代码、￥￥ → 公式"]
  ]],
  ["代码块编辑 · Better Code Edit", [
    ["codeSelectAll", "Ctrl / ⌘ + A 仅选择代码块内容"],
    ["codeIndent", "Tab 缩进 / Shift + Tab 反缩进"],
    ["codeBackspace", "Backspace 按缩进级别删除空白"],
    ["codePaste", "粘贴时适配当前缩进"],
    ["codeEnter", "Enter 延续当前行缩进"]
  ]],
  ["退格与跳出", [
    ["emptyListBackspace", "Backspace 清除空列表项（含任务列表）"],
    ["emptyQuoteBackspace", "Backspace 清除空引用的一层前缀"],
    ["tabout", "Tab 跳出括号、引号、行内代码与 Markdown 标记"]
  ]],
  ["选择与粘贴", [
    ["progressiveSelectAll", "Ctrl / ⌘ + A 逐级选择：当前行 → 当前块 → 全文"],
    ["listPaste", "列表内多行粘贴自动添加延续缩进"],
    ["quotePaste", "引用内多行粘贴自动延续引用"]
  ]],
  ["换行", [
    ["strictLineBreak", "严格换行（Enter，默认关闭）"],
    ["collapsedHeadingEnter", "折叠标题按 Enter，在折叠内容之后新建同级标题"]
  ]],
  ["编辑命令", [
    ["newLineAfter", "Ctrl / ⌘ + Enter：在当前行后换行"],
    ["toggleComment", "Ctrl / ⌘ + /：切换注释（代码按语言识别）"],
    ["selectBlock", "启用「选择当前块」命令"]
  ]]
];

class Settings {
  constructor(win, onChange) {
    this.win = win;
    this.onChange = onChange;
    this.value = this.read();
    this.storageListener = e => {
      if (e.key === KEY) {
        this.value = this.read();
        if (this.onChange) this.onChange(this.value);
        if (this.panel && !this.panel.hidden) this.refresh();
      }
    };
    win.addEventListener("storage", this.storageListener);
  }

  read() {
    try { return normalizeSettings(JSON.parse(this.win.localStorage.getItem(KEY))); }
    catch (_) { return normalizeSettings(null); }
  }

  update(patch) {
    const next = normalizeSettings(Object.assign({}, this.value, patch));
    try { this.win.localStorage.setItem(KEY, JSON.stringify(next)); }
    catch (error) {
      this.win.alert("设置保存失败，未应用本次更改：" + error.message);
      this.refresh();
      return false;
    }
    this.value = next;
    if (this.onChange) this.onChange(next);
    return true;
  }

  mount(onCommand) {
    const doc = this.win.document;
    const fs = require("fs"), path = require("path");
    this.style = doc.createElement("style");
    this.style.id = "easy-edit-style";
    this.style.textContent = fs.readFileSync(path.join(__dirname, "settings.css"), "utf8");
    doc.head.appendChild(this.style);

    this.panel = doc.createElement("div");
    this.panel.id = "easy-edit-panel";
    this.panel.hidden = true;
    this.panel.innerHTML = '<div class="ee-dialog" role="dialog" aria-modal="true" aria-labelledby="ee-title"><div class="ee-header"><div><div id="ee-title">Easy Edit · 编辑增强</div><div class="ee-subtitle">每项功能独立开关，修改即时保存</div></div><button type="button" class="ee-close" aria-label="关闭设置">×</button></div><div class="ee-body"></div><div class="ee-footer"><span class="ee-status" role="status">设置保存在本机</span><button type="button" class="ee-select-block">选择当前块</button><button type="button" class="ee-reset">恢复默认</button><button type="button" class="ee-done">完成</button></div></div>';
    doc.body.appendChild(this.panel);
    this.panel.querySelector(".ee-close").addEventListener("click", () => this.close());
    this.panel.querySelector(".ee-done").addEventListener("click", () => this.close());
    this.panel.querySelector(".ee-reset").addEventListener("click", () => { if (this.update(DEFAULTS)) this.refresh(); });
    this.panel.querySelector(".ee-select-block").addEventListener("click", () => { this.close(); onCommand("selectBlock"); });
    this.panel.addEventListener("click", e => { if (e.target === this.panel) this.close(); });
    this.panel.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
      if (e.key === "Tab") {
        const items = Array.from(this.panel.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled)"));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    this.refresh();
  }

  refresh() {
    if (!this.panel) return;
    const doc = this.win.document;
    const body = this.panel.querySelector(".ee-body");
    body.textContent = "";
    const checkbox = (key, label, parent) => {
      const row = doc.createElement("label"); row.className = "ee-row";
      const text = doc.createElement("span"); text.textContent = label;
      const input = doc.createElement("input"); input.type = "checkbox"; input.checked = this.value[key]; input.dataset.setting = key;
      input.addEventListener("change", () => {
        const saved = this.update({ [key]: input.checked });
        if (saved) this.panel.querySelector(".ee-status").textContent = "已保存，立即生效";
        this.updateDisabledState();
      });
      row.appendChild(text); row.appendChild(input); parent.appendChild(row);
    };
    checkbox("enabled", "启用 Easy Edit", body);
    for (const group of GROUPS) {
      const section = doc.createElement("div"); section.className = "ee-section";
      const title = doc.createElement("div"); title.className = "ee-section-title"; title.textContent = group[0]; section.appendChild(title);
      group[1].forEach(item => checkbox(item[0], item[1], section));
      body.appendChild(section);
    }
    const options = doc.createElement("div"); options.className = "ee-section";
    const dropdown = (key, title, values) => {
      const row = doc.createElement("label"); row.className = "ee-row";
      const text = doc.createElement("span"); text.textContent = title;
      const select = doc.createElement("select"); select.dataset.setting = key;
      for (const item of values) {
        const option = doc.createElement("option"); option.value = item[0]; option.textContent = item[1]; select.appendChild(option);
      }
      select.value = this.value[key];
      select.addEventListener("change", () => { this.update({ [key]: key === "indentSize" ? Number(select.value) : select.value }); this.updateDisabledState(); });
      row.appendChild(text); row.appendChild(select); options.appendChild(row);
    };
    dropdown("strictMode", "严格换行模式", [["two-space", "Two Space · 两空格 + 换行"], ["paragraph", "Enter Twice · 双换行"], ["mix", "Mix · 正文双换行，引用两空格"]]);
    dropdown("indentStyle", "代码缩进风格", [["auto", "跟随 Typora"], ["spaces", "空格"], ["tabs", "Tab"]]);
    dropdown("indentSize", "自定义缩进宽度", [1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, String(n)]));
    body.appendChild(options);
    const note = doc.createElement("div"); note.className = "ee-note";
    note.textContent = "标题折叠：Ctrl / ⌘ + Alt + H；实时预览也可 Alt + 点击标题。兼容 typora_plugin 的 collapse_paragraph。代码块全选优先于逐级选择，代码块缩进优先于 Tabout。Shift + Enter 保持原生行为。";
    body.appendChild(note);
    this.updateDisabledState();
  }

  updateDisabledState() {
    this.panel.querySelectorAll("[data-setting]").forEach(input => {
      const key = input.dataset.setting;
      input.disabled = key !== "enabled" && (!this.value.enabled || key === "strictMode" && !this.value.strictLineBreak || key === "indentSize" && this.value.indentStyle === "auto");
    });
    this.panel.querySelector(".ee-select-block").disabled = !this.value.enabled || !this.value.selectBlock;
  }

  open() {
    if (!this.panel.hidden) return;
    const selection = this.win.getSelection();
    this.savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    this.savedFocus = this.win.document.activeElement;
    this.panel.hidden = false;
    this.refresh();
    this.panel.querySelector(".ee-close").focus();
  }

  close() {
    this.panel.hidden = true;
    if (this.savedFocus && this.savedFocus.isConnected) this.savedFocus.focus();
    if (this.savedRange && this.savedRange.startContainer.isConnected) {
      const selection = this.win.getSelection(); selection.removeAllRanges(); selection.addRange(this.savedRange);
    }
  }

  destroy() {
    this.win.removeEventListener("storage", this.storageListener);
    [this.panel, this.style].forEach(el => { if (el) el.remove(); });
  }
}
module.exports = { Settings, GROUPS, KEY };
