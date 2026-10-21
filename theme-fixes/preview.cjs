"use strict";
// Render a disposable copy of Typora's real inline DOM and theme styles.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { pathToFileURL } = require("node:url");
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "typora-inline-code-preview-"));
if (path.dirname(root).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(root).startsWith("typora-inline-code-preview-")) throw new Error("Unexpected preview directory");
const themeDir = path.join(process.env.APPDATA, "Typora", "themes");
const base = "C:/Program Files/Typora/resources/style/";
const themes = {};
for (const [name, file] of [["light", "claude.css"], ["dark", "claude-dark.css"]]) {
  themes[name] = {
    before: fs.readFileSync(path.join(themeDir, file + ".inline-code-caret.bak"), "utf8"),
    after: fs.readFileSync(path.join(themeDir, file), "utf8")
  };
}
const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(themeDir + path.sep).href}">
<link rel="stylesheet" href="${pathToFileURL(base + "base.css").href}">
<link rel="stylesheet" href="${pathToFileURL(base + "base-control.css").href}">
<style id="theme"></style><style>
html,body{min-height:100%;margin:0}body{padding:56px;background:var(--bg-color);color:var(--text-color,var(--font-color))}
#write{position:static!important;margin:0!important;padding:24px!important;max-width:900px!important;min-height:250px!important;overflow:visible!important}
.qa-caption{font:16px/1.8 system-ui,sans-serif;margin:12px 24px;color:var(--text-color,var(--font-color))}
</style></head><body><div class="qa-caption" id="caption"></div><div id="write" contenteditable="true" spellcheck="false">
<p><span md-inline="plain">正文 </span><span md-inline="code" class="md-pair-s md-expand"><span class="md-meta md-before">\x60</span><code>inline_code</code><span class="md-meta md-after">\x60</span></span><span md-inline="plain"> 正文</span></p>
<p><span md-inline="strong" class="md-pair-s md-expand"><span class="md-meta md-before">**</span><strong>加粗保持原样</strong><span class="md-meta md-after">**</span></span></p>
</div><script>
const themes=${JSON.stringify(themes).replace(/<\//g, "<\\/")};
window.inspectCaret=(theme,version,position)=>{
  document.getElementById("theme").textContent=themes[theme][version];
  document.getElementById("caption").textContent=theme+" / "+version+" / "+position;
  const wrapper=document.querySelector('[md-inline="code"]');
  const start=wrapper.querySelector('.md-before'),end=wrapper.querySelector('.md-after');
  const points={beforeStart:[start.firstChild,0],insideStart:[start.firstChild,1],insideEnd:[end.firstChild,0],afterEnd:[end.firstChild,1]};
  const [node,offset]=points[position];
  document.getElementById("write").focus();
  const range=document.createRange();range.setStart(node,offset);range.collapse(true);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  const style=getComputedStyle(start),rect=range.getBoundingClientRect(),markerRect=start.getBoundingClientRect();
  return {height:rect.height,left:rect.left,markerWidth:markerRect.width,markerHeight:markerRect.height,markerFont:style.fontSize,opacity:style.opacity,display:style.display,outline:getComputedStyle(wrapper).outlineStyle,strongOpacity:getComputedStyle(document.querySelector('[md-inline="strong"]>.md-before')).opacity};
};
inspectCaret("light","after","insideStart");
</script></body></html>`;
fs.writeFileSync(path.join(root, "preview.html"), html);
console.log(JSON.stringify({ root, url: pathToFileURL(path.join(root, "preview.html")).href }));
