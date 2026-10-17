/* ==========================================================================
 * BiliPlay · page-bridge.js —— 页面主世界（MAIN world）脚本
 *
 * 隔离世界的内容脚本读不到页面自己的 window.__INITIAL_STATE__，
 * 所以这个脚本运行在页面主世界，负责把当前视频的 id 通过 postMessage 传回去。
 *   · 番剧页拿 ep_id / season_id
 *   · 合集 / 稍后再看 / 列表页拿当前播放项的 bvid / aid
 *
 * 注意：它在 MAIN world，不能使用 browser.* 扩展 API，也污染不了隔离世界。
 * ========================================================================== */
(() => {
  'use strict';

  const CHANNEL = '__biliplay_bridge__';

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const str = (v) => (typeof v === 'string' && v ? v : undefined);

  /** 从页面全局状态里尽量挖出 id。不同页面结构不同，逐个兜底。 */
  function pick() {
    const out = {};
    const st = window.__INITIAL_STATE__;

    if (st && typeof st === 'object') {
      const vd = st.videoData || {}; // 普通视频
      const ep = st.epInfo || {}; // 番剧当前集
      const mi = st.mediaInfo || {}; // 番剧剧集
      const up = st.upData || st.upInfo || {}; // UP 主

      out.bvid = str(ep.bvid) || str(vd.bvid) || str(st.bvid);
      out.aid = num(ep.aid) || num(vd.aid) || num(st.aid);
      out.cid = num(ep.cid) || num(vd.cid) || num(st.cid);
      out.epId = num(ep.ep_id) || num(ep.id) || num(st.ep_id);
      out.seasonId = num(mi.season_id) || num(st.season_id);
      out.mid = num(up.mid) || num(st.mid);
      out.page = num(st.p);
    }

    // URL 兜底（SPA 切换后 __INITIAL_STATE__ 有时还没更新）
    const path = location.pathname;
    const mEp = path.match(/\/ep(\d+)/);
    if (mEp) out.epId = out.epId || num(mEp[1]);
    const mSs = path.match(/\/ss(\d+)/);
    if (mSs) out.seasonId = out.seasonId || num(mSs[1]);
    const mBv = path.match(/(BV[0-9A-Za-z]{10})/);
    if (mBv) out.bvid = out.bvid || mBv[1];

    return out;
  }

  let lastJson = '';

  function send(reason) {
    let data;
    try {
      data = pick();
    } catch (err) {
      return;
    }
    let json;
    try {
      json = JSON.stringify(data);
    } catch (err) {
      return;
    }
    // 内容脚本主动来问时一定回答；主动推送则去重
    if (reason !== 'request' && json === lastJson) return;
    lastJson = json;
    window.postMessage({ __biliplay__: true, type: 'ids', reason, data }, '*');
  }

  // 内容脚本会主动请求（每次操作前都问一次，保证拿到最新值）
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__biliplay__ === true && d.type === 'request') send('request');
  });

  // SPA 路由变化时重新推送
  for (const method of ['pushState', 'replaceState']) {
    try {
      const orig = history[method];
      history[method] = function patched(...args) {
        const ret = orig.apply(this, args);
        setTimeout(() => send('route'), 0);
        return ret;
      };
    } catch (err) {
      /* 忽略 */
    }
  }
  window.addEventListener('popstate', () => setTimeout(() => send('route'), 0));

  // document_start 时 __INITIAL_STATE__ 还没生成，先轮询等它出现
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const data = pick();
    if (data && (data.bvid || data.aid || data.epId)) {
      send('poll');
      clearInterval(timer);
      return;
    }
    if (tries >= 40) clearInterval(timer); // 最多等 ~16s
  }, 400);

  send('init');
})();
