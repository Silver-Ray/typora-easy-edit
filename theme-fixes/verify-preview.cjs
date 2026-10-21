"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const WebSocket = require("ws");

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9392/json/list")).json();
  const target = targets.find(t => t.type === "page" && /^file:.*\/typora-inline-code-preview-[^/]+\/preview\.html$/.test(t.url));
  assert.ok(target, "Disposable theme preview not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl), requests = new Map(); let sequence = 0;
  socket.on("message", message => {
    const result = JSON.parse(message), request = requests.get(result.id);
    if (!request) return;
    requests.delete(result.id); result.error ? request.reject(new Error(result.error.message)) : request.resolve(result.result);
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(method + " timed out")); }, 10000);
    requests.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    await call("Page.enable");
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off("message", listener); reject(new Error("Preview reload timed out")); }, 10000);
      const listener = message => { if (JSON.parse(message).method === "Page.loadEventFired") { clearTimeout(timer); socket.off("message", listener); resolve(); } };
      socket.on("message", listener);
    });
    await call("Page.reload", { ignoreCache: true }); await loaded;
    await call("Page.bringToFront");
    const dest = path.join(__dirname, "previews"); fs.mkdirSync(dest, { recursive: true });
    const results = [];
    for (const theme of ["light", "dark"]) {
      for (const version of ["before", "after"]) {
        for (const position of ["beforeStart", "insideStart", "insideEnd", "afterEnd"]) {
          const state = await evaluate("inspectCaret(" + [theme, version, position].map(JSON.stringify).join(",") + ")");
          results.push({ theme, version, position, ...state });
          assert.equal(state.strongOpacity, "0", "Bold markers must remain hidden");
          if (version === "before") { assert.equal(state.height, 0); assert.equal(state.markerWidth, 0); }
          else { assert.ok(state.height >= 14); assert.ok(state.markerWidth > 3); assert.equal(state.opacity, "1"); assert.equal(state.outline, "solid"); }
          if (position === "insideStart" || position === "insideEnd") {
            const screenshot = await call("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(dest, theme + "-" + version + "-" + position + ".png"), Buffer.from(screenshot.data, "base64"));
          }
        }
      }
    }
    await call("Emulation.setEmulatedMedia", { media: "print" });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[md-inline=code]>.md-before')).display"), "none");
    await call("Emulation.setEmulatedMedia", { media: "screen" });
    fs.writeFileSync(path.join(dest, "geometry.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ states: results.length, beforeCaretHeight: results[0].height, afterCaretHeight: results[4].height, printMarkersHidden: true, screenshots: dest }));
  } finally { socket.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
