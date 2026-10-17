/* ==========================================================================
 * BiliPlay · common.js —— 公共层
 *
 * 被 content script / options 页 / popup 页共同加载。
 * 职责：
 *   1. 默认设置与设置的读写（storage.sync）
 *   2. 键盘事件 -> 稳定字符串 的归一化
 *   3. 播放器元素、视频 id、Cookie 的定位
 *   4. 调用 B 站 Web API 的小封装
 * ========================================================================== */
(() => {
  'use strict';

  // Firefox 提供 browser.*；为将来兼容 Chrome 保留 chrome.* 兜底。
  const api = globalThis.browser ?? globalThis.chrome;

  /* ------------------------------------------------------------------ *
   * 默认设置
   * ------------------------------------------------------------------ */

  // 默认键。只绑定 B 站官方播放器【没有】快捷键的功能，避免与官方键位重复。
  // 官方已占用：Q 点赞(长按三连) / W 投币 / E 收藏 / G 关注 / D 弹幕 /
  //            F 全屏 / M 静音 / 空格 播放暂停 / ← → 快进快退 / [ ] 上下一集 / Enter 发弹幕
  const DEFAULT_KEYS = {
    subtitle: 'v', // 字幕 开 / 关
    speedUp: '=', // 键盘上 "+ / =" 那一颗，不按 Shift 就是 =
    speedDown: '-',
    speedReset: '0', // 恢复正常速度
    frameBackward: ',', // 逐帧：沿用 YouTube 的 , / .
    frameForward: '.',
    wideScreen: 't',
    webFullscreen: 'i',
    lightsOff: 'l',
    screenshot: 's',
    pip: 'p',

    // —— 以下已实现，但默认不绑定（B 站官方已有同功能快捷键）——
    // 想启用：取消对应行注释，并把同名条目在上面的 ACTIONS 里也取消注释。
    // like: 'z',
    // coin: 'x',
    // fav: 'c',
    // triple: 'b',
    // playPause: 'k',
    // seekForward: '>', // 就是 Shift + .
    // seekBackward: 'j',
    // danmaku: 'n',
    // fullscreen: 'f',
  };

  // 动作表：options / popup 页据此渲染界面，content script 据此分发。
  const ACTIONS = [
    { id: 'subtitle', label: '字幕 开 / 关', icon: '💬', group: '播放器' },
    { id: 'speedUp', label: '加快播放速度', icon: '⏩', group: '播放器' },
    { id: 'speedDown', label: '减慢播放速度', icon: '⏪', group: '播放器' },
    { id: 'speedReset', label: '恢复正常速度', icon: '↩️', group: '播放器' },
    { id: 'frameBackward', label: '上一帧', icon: '◀️', group: '播放器' },
    { id: 'frameForward', label: '下一帧', icon: '▶️', group: '播放器' },
    { id: 'wideScreen', label: '宽屏模式', icon: '🖥️', group: '播放器' },
    { id: 'webFullscreen', label: '网页全屏', icon: '🔳', group: '播放器' },
    { id: 'lightsOff', label: '关灯 / 开灯', icon: '💡', group: '播放器' },
    { id: 'screenshot', label: '截图', icon: '📷', group: '播放器' },
    { id: 'pip', label: '画中画', icon: '🪟', group: '播放器' },

    // —— 以下已实现，但默认不启用（B 站官方播放器已有同功能快捷键）——
    // 实现代码保留在 content.js 的 RUN 表里，取消下面某行注释即可启用。
    // { id: 'like', label: '点赞 / 取消点赞', icon: '👍', group: '互动' },
    // { id: 'coin', label: '投币', icon: '🪙', group: '互动' },
    // { id: 'fav', label: '收藏 / 取消收藏', icon: '⭐', group: '互动' },
    // { id: 'triple', label: '一键三连', icon: '💖', group: '互动' },
    // { id: 'playPause', label: '播放 / 暂停', icon: '⏯️', group: '播放器' },
    // { id: 'seekForward', label: '快进', icon: '⏭️', group: '播放器' },
    // { id: 'seekBackward', label: '快退', icon: '⏮️', group: '播放器' },
    // { id: 'danmaku', label: '弹幕 开 / 关', icon: '🈁', group: '播放器' },
    // { id: 'fullscreen', label: '全屏', icon: '⛶', group: '播放器' }, // 官方 F
  ];

  /**
   * 找出重复绑定。
   *
   * content.js 的匹配是「按 ACTIONS 顺序找、命中即停」，所以两个动作绑同一个键时
   * **靠前的那个永远赢**，另一个悄无声息地失效。这里把这种情况算出来，给设置页提示用。
   *
   * @param {Record<string,string>} [keys] 默认取当前设置
   * @returns {Record<string,string[]>} 动作 id -> 与之冲突的动作 id 列表
   */
  function findConflicts(keys) {
    const map = keys || (state && state.settings && state.settings.keys) || {};
    const byKey = new Map();
    for (const action of ACTIONS) {
      const key = map[action.id];
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(action.id);
    }

    const conflicts = {};
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) conflicts[id] = ids.filter((other) => other !== id);
    }
    return conflicts;
  }

  const DEFAULTS = {
    enabled: true, // 总开关
    showToast: true, // 是否弹提示
    rememberSpeed: false, // 是否记住倍速并在切换视频后应用
    mode: 'api', // 点赞/投币/收藏的实现方式：'api'（调接口）| 'dom'（模拟点击按钮）
    coinCount: 1, // 投币枚数：1 或 2
    speedStep: 0.25, // 每次增减的步进
    seekStep: 5, // 快进/快退秒数
    frameRate: 30, // 逐帧步长按 1/帧率 算；B 站番剧多为 24
    minSpeed: 0.25,
    maxSpeed: 4,
    lastSpeed: 1, // rememberSpeed 用
    keys: { ...DEFAULT_KEYS },
  };

  /** 依次尝试一组选择器，返回第一个命中的元素。 */
  function queryFirst(selectors, root) {
    const scope = root || document;
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 按键归一化
   * ------------------------------------------------------------------ */
  /**
   * 把 KeyboardEvent 压成稳定字符串，例如：
   *   "z"           普通字母
   *   "+"           需要 Shift 的符号（符号本身已含 Shift 语义）
   *   "ctrl+shift+p"
   *   "arrowup"
   *
   * 注意：拼接符就是 "+"，所以字面量 "+" 键归一化后就是 "+" 本身；
   *      prettyKey() 会把这种空段还原回来。
   *
   * 规则：字母保留 shift 修饰（可以区分大小写绑定）；
   *      符号（, . / ; [ ] - = ` \ 数字等）本身已区分，不再附加 shift。
   */
  function normalizeKey(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');

    let key = e.key == null ? '' : String(e.key);
    if (key === ' ' || key === 'Spacebar') {
      key = 'space';
    } else if (key.length === 1) {
      const lower = key.toLowerCase();
      if (lower >= 'a' && lower <= 'z') {
        if (e.shiftKey) parts.push('shift');
        key = lower;
      }
      // 其它单字符原样保留
    } else {
      if (e.shiftKey) parts.push('shift');
      key = key.toLowerCase(); // ArrowUp -> arrowup
    }
    parts.push(key);
    return parts.join('+');
  }

  /** 把归一化的按键串转成好看的展示文本。 */
  function prettyKey(key) {
    if (!key) return '（未设置）';
    const named = {
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift',
      meta: 'Meta',
      space: '空格',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
      escape: 'Esc',
      enter: 'Enter',
      backspace: 'Backspace',
    };
    // 归一化串本身用 "+" 连接，而 "+" 也可能就是被绑定的键（倍速加快），
    // 于是 "+" 会被 split 成空串，这里把空串还原回字面量 "+"。
    const parts = [];
    for (const raw of key.split('+')) {
      if (raw === '') {
        if (parts[parts.length - 1] !== '+') parts.push('+');
        continue;
      }
      parts.push(raw);
    }

    return parts
      .map((p) => {
        if (named[p]) return named[p];
        return p.length === 1 ? p.toUpperCase() : p;
      })
      .join(' + ');
  }

  /* ------------------------------------------------------------------ *
   * 设置读写
   * ------------------------------------------------------------------ */

  const storage = api && api.storage ? api.storage.sync || api.storage.local : null;
  const storageArea = api && api.storage && api.storage.sync ? 'sync' : 'local';

  async function readSettings() {
    let stored = {};
    try {
      stored = (await storage.get(DEFAULTS)) || {};
    } catch (err) {
      console.warn('[BiliPlay] 读取设置失败：', err);
    }
    return {
      ...DEFAULTS,
      ...stored,
      keys: { ...DEFAULT_KEYS, ...(stored && stored.keys ? stored.keys : {}) },
    };
  }

  async function writeSettings(patch) {
    const cur = await readSettings();
    const next = {
      ...cur,
      ...patch,
      keys: { ...cur.keys, ...(patch && patch.keys ? patch.keys : {}) },
    };
    try {
      await storage.set(next);
    } catch (err) {
      console.warn('[BiliPlay] 保存设置失败：', err);
    }
    return next;
  }

  // 内存中的当前设置，供同步读取（content script 每个按键都要用）
  const state = { settings: { ...DEFAULTS, keys: { ...DEFAULT_KEYS } } };

  async function load() {
    state.settings = await readSettings();
    return state.settings;
  }

  async function save(patch) {
    state.settings = await writeSettings(patch);
    return state.settings;
  }

  /* ------------------------------------------------------------------ *
   * 播放器 / 视频定位
   * ------------------------------------------------------------------ */

  // 现代(bpx)播放器 / 番剧(squirtle) / 旧版播放器的容器
  const PLAYER_ROOTS = [
    '#bilibili-player',
    '#bilibiliPlayer',
    '.bpx-player-container',
    '#playerWrap',
  ];

  /** 拿到当前真正在用的 <video> 元素；找不到播放器时返回 null。 */
  function getVideo() {
    for (const sel of PLAYER_ROOTS) {
      const root = document.querySelector(sel);
      if (!root) continue;
      const v = root.querySelector('video');
      if (v) return v;
    }
    // 兜底：页面里最像“正在播放”的那个 video
    const videos = Array.from(document.querySelectorAll('video'));
    return (
      videos.find((v) => v.readyState > 0 && isFinite(v.duration) && v.duration > 0) ||
      videos[0] ||
      null
    );
  }

  function parseIdsFromString(str) {
    const out = {};
    if (!str) return out;
    const bv = str.match(/(BV[0-9A-Za-z]{10})/);
    if (bv) out.bvid = bv[1];
    const av = str.match(/av(\d{5,})/i);
    if (av) out.aid = Number(av[1]);
    return out;
  }

  /**
   * 尽量拿到当前视频的 id。
   * 注意：content script 运行在隔离环境，读不到页面的 window.__INITIAL_STATE__，
   * 所以这里走 URL / canonical / DOM 属性 三条路。
   */
  function getVideoId() {
    const ids = {};
    Object.assign(ids, parseIdsFromString(location.pathname + location.search));

    if (!ids.bvid && !ids.aid) {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) Object.assign(ids, parseIdsFromString(canonical.href));
    }

    if (!ids.bvid && !ids.aid) {
      for (const node of document.querySelectorAll('[data-bvid],[data-aid]')) {
        if (!ids.bvid && node.dataset.bvid) ids.bvid = node.dataset.bvid;
        if (!ids.aid && node.dataset.aid) ids.aid = Number(node.dataset.aid);
        if (ids.bvid || ids.aid) break;
      }
    }
    return ids;
  }

  /** 收藏接口需要数字 aid；只有 bvid 时通过 view 接口换算一次。 */
  async function resolveAid(ids) {
    if (ids && ids.aid) return ids.aid;
    if (!ids || !ids.bvid) return 0;
    try {
      const res = await biliGet('/x/web-interface/view', { bvid: ids.bvid });
      return (res && res.data && res.data.aid) || 0;
    } catch (err) {
      return 0;
    }
  }

  /**
   * 拿当前视频的完整 id（异步）。
   * 先用 URL/canonical 得到基础值，再用页面桥（主世界读到的 __INITIAL_STATE__）
   * 覆盖补充 —— 这一步能修好番剧页 / 合集 / 稍后再看这类 URL 里没有 bvid 的页面。
   */
  async function getIds() {
    const ids = getVideoId();
    const bridge = globalThis.BiliPlay && globalThis.BiliPlay.bridge;
    if (bridge && typeof bridge.getIds === 'function') {
      try {
        const remote = await bridge.getIds();
        if (remote) {
          for (const [k, v] of Object.entries(remote)) {
            if (v !== undefined && v !== null && v !== '' && v !== 0) ids[k] = v;
          }
        }
      } catch (err) {
        /* 桥不可用时静默回退 */
      }
    }
    return ids;
  }

  /* ------------------------------------------------------------------ *
   * Cookie / 登录态
   * ------------------------------------------------------------------ */

  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // bili_jct 既是 CSRF token，也是「已登录」的判据
  const getCsrf = () => readCookie('bili_jct');
  const getMid = () => readCookie('DedeUserID');

  /* ------------------------------------------------------------------ *
   * B 站 Web API 封装
   * ------------------------------------------------------------------ */

  const API_BASE = 'https://api.bilibili.com';

  async function biliGet(path, params) {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), { credentials: 'include' });
    return res.json();
  }

  async function biliPost(path, params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) body.set(k, String(v));
    }
    body.set('csrf', getCsrf()); // 所有写操作都要带 CSRF
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      credentials: 'include', // 带上 SESSDATA 等 Cookie
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return res.json();
  }

  /* ------------------------------------------------------------------ *
   * 杂项
   * ------------------------------------------------------------------ */

  /** 焦点是否在输入类元素里（在输入框里不该触发快捷键）。 */
  function isEditable(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('[contenteditable="true"]')) return true;
    return false;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  globalThis.BiliPlay = {
    api,
    state,
    DEFAULTS,
    DEFAULT_KEYS,
    ACTIONS,
    findConflicts,
    storageArea,
    load,
    save,
    readSettings,
    writeSettings,
    normalizeKey,
    prettyKey,
    queryFirst,
    getVideo,
    getVideoId,
    getIds,
    resolveAid,
    getCsrf,
    getMid,
    readCookie,
    biliGet,
    biliPost,
    isEditable,
    sleep,
    clamp,
  };
})();
