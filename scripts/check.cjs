"use strict";
const fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
for (const dir of ["plugin/easy-edit", "scripts"]) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (/\.(?:cjs|js)$/.test(file)) execFileSync(process.execPath, ["--check", path.join(root, dir, file)], { stdio: "inherit" });
  }
}
console.log("All plugin and installer JavaScript syntax checks passed.");
