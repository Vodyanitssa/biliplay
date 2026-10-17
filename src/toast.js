/* ==========================================================================
 * BiliPlay · toast.js —— 页面内轻提示
 * 依赖 common.js，向 BiliPlay 命名空间挂上 toast()。
 * ========================================================================== */
(() => {
  'use strict';

  const B = globalThis.BiliPlay;
  if (!B) return;

  let el = null;
  let hideTimer = 0;

  /**
   * 提示该挂在哪个元素下。
   *
   * 关键点：真·全屏时浏览器**只渲染全屏元素及其子树**，挂在 <body> 上的提示会被
   * 整个忽略掉——这就是之前“全屏下看不到 toast”的原因，所以必须挂进全屏元素里。
   * 另外 <video> 自身全屏时它的子节点不会被渲染，那种情况没法显示，退回 body 尽力而为。
   */
  function host() {
    const fs = document.fullscreenElement;
    if (fs && fs.tagName !== 'VIDEO') return fs;
    return document.body || document.documentElement;
  }

  function ensure() {
    const target = host();
    if (el && el.isConnected && el.parentNode === target) return el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'biliplay-toast';
      el.setAttribute('role', 'status');
    }
    // 在「全屏元素」和「body」之间搬家；对已有节点 appendChild 等价于移动
    target.appendChild(el);
    return el;
  }

  /** 进出全屏时立刻搬家，免得提示留在不可见的那一层里（比如淡出动画还没结束就进了全屏）。 */
  function rehome() {
    if (!el || !el.isConnected) return;
    const target = host();
    if (el.parentNode !== target) target.appendChild(el);
  }

  document.addEventListener('fullscreenchange', rehome, true);

  /**
   * @param {string} text 提示文案
   * @param {'info'|'ok'|'warn'|'err'} [kind]
   */
  B.toast = function toast(text, kind = 'info') {
    if (B.state && B.state.settings && B.state.settings.showToast === false) return;
    const node = ensure();
    node.textContent = String(text);
    node.dataset.kind = kind;
    // 先移除再强制回流，保证连续调用也能重放动画
    node.classList.remove('biliplay-toast--show');
    void node.offsetWidth;
    node.classList.add('biliplay-toast--show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => node.classList.remove('biliplay-toast--show'), 1600);
  };
})();
