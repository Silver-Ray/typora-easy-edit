"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const themes = process.argv[2] || path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "Typora", "themes");
const patch = fs.readFileSync(path.join(__dirname, "inline-code-caret.css"), "utf8");
const begin = "/* easy-edit:inline-code-caret:start */", end = "/* easy-edit:inline-code-caret:end */";

for (const name of ["claude.css", "claude-dark.css"]) {
  const target = path.join(themes, name);
  if (!fs.existsSync(target)) continue;
  let css = fs.readFileSync(target, "utf8");
  const before = css;
  // These selectors used to hide ALL paired inline syntax, including the
  // inline code delimiters on which Chromium can place the native caret.
  css = css.replace(/#write \.md-pair-s\.md-expand( > \.md-meta\.md-(?:before|after))(?=\s*[,\{])/g,
    '#write .md-pair-s.md-expand:is([md-inline="strong"], [md-inline="em"])$1');
  css = css.replace(/#write \.md-pair-s\.md-expand\s*\{/g,
    '#write .md-pair-s.md-expand:is([md-inline="strong"], [md-inline="em"]) {');
  const start = css.indexOf(begin), finish = css.indexOf(end);
  if (start >= 0 || finish >= 0) {
    if (start < 0 || finish < start) throw new Error("Incomplete inline-code patch in " + target);
    css = css.slice(0, start) + css.slice(finish + end.length);
  }
  css = css.trimEnd() + "\n\n" + begin + "\n" + patch.trim() + "\n" + end + "\n";
  if (css === before) { console.log("Already updated: " + target); continue; }
  const backup = target + ".inline-code-caret.bak";
  if (!fs.existsSync(backup)) fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(target, css, "utf8");
  console.log("Updated: " + target);
  console.log("Backup: " + backup);
}
