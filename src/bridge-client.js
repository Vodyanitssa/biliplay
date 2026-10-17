/* ==========================================================================
 * BiliPlay · bridge-client.js —— 隔离世界侧，接主世界传来的视频 id
 *
 * 与 page-bridge.js 通过 window.postMessage 通信（postMessage 可以跨世界）。
 * 挂到 BiliPlay.bridge，供 common.js 的 getIds() 使用。
 * ========================================================================== */
(() => {
  'use strict';

  const B = globalThis.BiliPlay;
  if (!B) return;

  let cached = null;
  let cachedAt = 0;

  function isIdsPayload(data) {
    if (!data || typeof data !== 'object') return false;
    return ['bvid', 'aid', 'cid', 'epId', 'seasonId', 'mid'].some((k) => data[k]);
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || d.__biliplay__ !== true || d.type !== 'ids') return;
    if (!isIdsPayload(d.data)) return;
    cached = d.data;
    cachedAt = Date.now();
  });

  /** 主动向主世界要一次 id（内容脚本每次操作前调用）。 */
  function request(timeout = 400) {
    try {
      window.postMessage({ __biliplay__: true, type: 'request' }, '*');
    } catch (err) {
      /* 忽略 */
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (cached) return resolve(cached);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  /** 先吃缓存，再问一次主世界。 */
  async function getIds() {
    if (cached) return cached;
    return request();
  }

  B.bridge = {
    request,
    getIds,
    get cached() {
      return cached;
    },
    get cachedAt() {
      return cachedAt;
    },
  };
})();
