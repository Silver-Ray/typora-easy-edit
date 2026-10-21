/* Browser entry: Typora exposes Node through reqnode and hides window.require. */
(function () {
  "use strict";
  function load() {
    try {
      const nodeRequire = window.reqnode || window.require;
      if (!nodeRequire) throw new Error("Typora 未提供 reqnode");
      const path = nodeRequire("path");
      const base = window.dirname || window.__dirname || path.dirname(nodeRequire("url").fileURLToPath(window.location.href));
      nodeRequire(path.join(base, "easy-edit", "index.js")).boot(window);
    } catch (error) { console.error("[Easy Edit] 加载失败：", error); }
  }
  if (document.readyState === "complete") load();
  else window.addEventListener("load", load, { once: true });
})();
