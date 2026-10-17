/* ==========================================================================
 * BiliPlay · content.js —— 内容脚本主逻辑
 *
 * 流程：document 上挂 capture 阶段的 keydown -> 匹配按键 -> 执行动作。
 *
 * 默认只启用 B 站官方【没有】快捷键的动作
 * （字幕 / 倍速 / 上下帧 / 宽屏 / 网页全屏 / 关灯 / 截图 / 画中画）。
 * 互动类（点赞/投币/收藏/三连）与播放暂停/快进快退/弹幕/全屏的实现都还在下面，
 * 但默认不在 common.js 的 ACTIONS 里，所以永远不会被触发；想要就取消那边的注释。
 *
 * 互动类有两种实现，由设置 mode 决定：
 *   · 'api'：直接调 B 站 Web API（默认，确定性强）
 *   · 'dom'：模拟点击页面上的按钮（页面 UI 会立刻刷新，但依赖 DOM 选择器）
 * 播放器类（字幕/倍速/播放暂停/快进/弹幕/宽屏/截图/画中画）走 DOM / 媒体元素 API。
 * ========================================================================== */
(() => {
  'use strict';

  const B = globalThis.BiliPlay;
  if (!B) return;

  const {
    api,
    state,
    ACTIONS,
    getVideo,
    getIds,
    resolveAid,
    getCsrf,
    getMid,
    biliGet,
    biliPost,
    isEditable,
    normalizeKey,
    queryFirst,
    sleep,
    clamp,
  } = B;

  /* ====================================================================== *
   * 播放器控件选择器
   * ====================================================================== */

  const CTRL = {
    danmaku: ['.bpx-player-dm-switch', '.bilibili-player-video-danmaku-switch'],
    wideScreen: [
      '.bpx-player-ctrl-wide',
      '.bilibili-player-video-btn-widescreen',
      '.squirtle-video-widescreen',
    ],
    webFullscreen: [
      '.bpx-player-ctrl-web',
      '.bilibili-player-video-web-fullscreen',
      '.squirtle-video-pagefullscreen',
    ],
    fullscreen: [
      '.bpx-player-ctrl-full',
      '.bilibili-player-video-btn-fullscreen',
      '.squirtle-video-fullscreen',
    ],
    lightsOff: [
      '.bpx-player-ctrl-lights-off',
      '.bpx-player-ctrl-lightsoff',
      '.bilibili-player-video-btn-lightsoff',
    ],
    setting: [
      '.bpx-player-ctrl-setting',
      '.bilibili-player-video-btn-setting',
      '.squirtle-setting',
    ],
  };

  // 「关灯」在新版播放器里被 B 站藏进了「设置」面板，实际是个复选框
  const LIGHT_OFF_SWITCH = [
    '.bpx-player-ctrl-setting-checkbox.bpx-player-ctrl-setting-lightoff input',
    '.bpx-player-ctrl-setting-checkbox.bpx-player-ctrl-setting-lightoff',
    '.bilibili-player-video-btn-setting-right-others-content-lightoff input',
    '.squirtle-single-setting-other-choice.squirtle-lightoff input',
  ];

  /**
   * 兜底：按按钮上的文字找控件。
   * B 站改版时 class 会变，但「关灯 / 网页全屏 / 设置」这些文案一般不会变。
   *
   * @param {string[]} keywords 命中任一即可
   * @param {string[]} [exclude] 文案里含这些词就跳过（例如找「全屏」时要排除「网页全屏」）
   */
  function findButtonByText(keywords, exclude) {
    const buttons = document.querySelectorAll(
      '.bpx-player-ctrl-btn, .bpx-player-control-bottom button, .bilibili-player-video-btn'
    );
    for (const btn of buttons) {
      const text = [
        btn.getAttribute('aria-label'),
        btn.getAttribute('title'),
        btn.getAttribute('data-title'),
        btn.textContent,
      ]
        .filter(Boolean)
        .join(' ');
      if (exclude && exclude.some((word) => text.includes(word))) continue;
      if (keywords.some((word) => text.includes(word))) return btn;
    }
    return null;
  }

  // DOM 模式下要点的工作栏按钮（投币/收藏还会弹出确认层）
  const TOOLBAR = {
    like: [
      '#arc_toolbar_report .like',
      '.video-toolbar-left-item.like',
      '.video-like',
      '.toolbar-left-item-wrap .like',
    ],
    coin: [
      '#arc_toolbar_report .coin',
      '.video-toolbar-left-item.coin',
      '.video-coin',
    ],
    fav: [
      '#arc_toolbar_report .collect',
      '.video-toolbar-left-item.collect',
      '.video-fav',
    ],
    // 下面两组是「尽力而为」的确认按钮，不同版本类名不同
    coinConfirm: [
      '.bili-coin .coin-bottom .btn-primary',
      '.bili-coin .btn-primary',
      '.bili-coin .coin-bottom .btn',
      '.coin-bottom button',
    ],
    favConfirm: [
      '.bili-collect .collection-mask .btn-primary',
      '.bili-collect .btn-primary',
      '.collect-mask .btn-primary',
    ],
  };

  /* ====================================================================== *
   * 播放器类动作
   * ====================================================================== */

  function requireVideo() {
    const video = getVideo();
    if (!video) B.toast('未找到播放器', 'warn');
    return video;
  }

  /* ---- 倍速 ---- */

  function setSpeed(value) {
    const video = requireVideo();
    if (!video) return;

    const min = state.settings.minSpeed ?? 0.25;
    const max = state.settings.maxSpeed ?? 4;
    const speed = Math.round(clamp(value, min, max) * 100) / 100;

    video.playbackRate = speed;
    B.toast(`倍速 ${speed}x`, 'ok');

    if (state.settings.rememberSpeed) B.save({ lastSpeed: speed });
  }

  function changeSpeed(direction) {
    const video = requireVideo();
    if (!video) return;
    const step = state.settings.speedStep || 0.25;
    setSpeed(video.playbackRate + direction * step);
  }

  /* ---- 播放 / 暂停 ---- */

  async function togglePlay() {
    const video = requireVideo();
    if (!video) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch (err) {
      B.toast('播放被浏览器阻止', 'warn');
    }
  }

  /* ---- 快进 / 快退 ---- */

  function seek(direction) {
    const video = requireVideo();
    if (!video) return;
    const step = Number(state.settings.seekStep) || 5;
    const end = isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(end, video.currentTime + direction * step));
    B.toast(direction > 0 ? `快进 ${step}s` : `快退 ${step}s`, 'info');
  }

  /* ---- 逐帧 ---- */

  /**
   * 上一帧 / 下一帧。
   * 浏览器不暴露真实帧率，所以按设置里的 frameRate（默认 30）估算单帧时长；
   * 看 24fps 的番剧时把它改成 24 会更准（设置页可改）。
   */
  function stepFrame(direction) {
    const video = requireVideo();
    if (!video) return;
    if (!video.paused) video.pause(); // 不暂停的话画面马上被播放覆盖掉

    const fps = Number(state.settings.frameRate) || 30;
    const end = isFinite(video.duration) ? video.duration : Infinity;
    const next = clamp(video.currentTime + direction / fps, 0, end);
    video.currentTime = next;
    B.toast(`${direction > 0 ? '下一帧' : '上一帧'} · ${next.toFixed(2)}s`, 'info');
  }

  /* ---- 弹幕 / 宽屏 ---- */

  function toggleDanmaku() {
    const btn = queryFirst(CTRL.danmaku);
    if (!btn) return B.toast('未找到弹幕开关', 'warn');
    btn.click();
    B.toast('弹幕已切换', 'ok');
  }

  function toggleWideScreen() {
    const btn = queryFirst(CTRL.wideScreen) || findButtonByText(['宽屏'], ['网页']);
    if (!btn) return B.toast('未找到宽屏按钮', 'warn');
    btn.click();
  }

  /* ---- 网页全屏 / 关灯 ---- */

  function toggleWebFullscreen() {
    const btn = queryFirst(CTRL.webFullscreen) || findButtonByText(['网页全屏']);
    if (!btn) return B.toast('未找到网页全屏按钮', 'warn');
    btn.click();
  }

  /** 取「设置」面板里的关灯复选框。 */
  function lightOffCheckbox() {
    const box = queryFirst(LIGHT_OFF_SWITCH);
    if (!box) return null;
    return box.matches('input') ? box : box.querySelector('input');
  }

  /**
   * 关灯。
   * B 站新版把这个按钮从控制栏挪进了「设置」面板（而且是个复选框），所以：
   *   1) 先看控制栏上有没有现成的按钮（少数版本还有）；
   *   2) 没有就点开「设置」面板，再点里面的「关灯」复选框。
   */
  async function toggleLightsOff() {
    const direct = queryFirst(CTRL.lightsOff) || findButtonByText(['关灯', '开灯']);
    if (direct && !direct.matches('input')) {
      direct.click();
      return;
    }

    let input = lightOffCheckbox();
    if (!input || input.offsetParent === null) {
      // 面板没展开：元素可能压根没渲染，也可能只是 display:none
      const gear = queryFirst(CTRL.setting) || findButtonByText(['设置']);
      if (!gear) return B.toast('未找到关灯开关', 'warn');
      gear.click();
      await sleep(150); // 等面板展开的过渡动画
      input = lightOffCheckbox();
    }
    if (!input) return B.toast('未找到关灯开关', 'warn');
    input.click();
  }

  /* ---- 画中画 ---- */

  async function togglePip() {
    const video = requireVideo();
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      B.toast('当前无法开启画中画', 'warn');
    }
  }

  /* ---- 截图 ---- */

  async function screenshot() {
    const video = requireVideo();
    if (!video || !video.videoWidth) return B.toast('无法截图：没有画面', 'warn');

    // 视频多为 CDN 跨域，直接 drawImage 会让 canvas 被污染而无法导出。
    // 优先用 ImageCapture.grabFrame()（不受 CORS 污染影响），失败再退回 canvas。
    let bitmap = null;
    let track = null;
    try {
      if (globalThis.ImageCapture && video.captureStream) {
        track = video.captureStream().getVideoTracks()[0];
        bitmap = await new ImageCapture(track).grabFrame();
      }
    } catch (err) {
      bitmap = null;
    } finally {
      if (track && track.stop) track.stop();
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap ? bitmap.width : video.videoWidth;
      canvas.height = bitmap ? bitmap.height : video.videoHeight;
      canvas.getContext('2d').drawImage(bitmap || video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob(resolve, 'image/png');
        } catch (err) {
          reject(err);
        }
      });
      if (!blob) throw new Error('toBlob 返回空');

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `biliplay_${Math.floor(video.currentTime)}s.png`;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      B.toast('截图已保存 📷', 'ok');
    } catch (err) {
      console.error('[BiliPlay] 截图失败', err);
      B.toast('截图失败：视频被跨域保护', 'err');
    }
  }

  /* ---- 字幕 ---- */

  const SUBTITLE_BTN_SELECTORS = [
    '.bpx-player-ctrl-subtitle > button',
    '.bpx-player-ctrl-subtitle',
    '.squirtle-subtitle-wrap > button',
    '.bilibili-player-video-btn-subtitle',
  ];

  const SUBTITLE_ACTIVE_SELECTORS = [
    '.bpx-player-ctrl-subtitle-language-item.bpx-state-active',
    '.bpx-player-ctrl-subtitle-language-item.is-active',
    '.bpx-player-ctrl-subtitle-language-item.active',
    '.bpx-player-ctrl-subtitle-language-item[aria-checked="true"]',
    '.bpx-player-ctrl-subtitle-language-item[aria-selected="true"]',
  ];

  function openSubtitleMenu() {
    const wrap = document.querySelector('.bpx-player-ctrl-subtitle');
    if (!wrap) return false;
    const box = document.querySelector('.bpx-player-ctrl-subtitle-box');
    const alreadyOpen = box && box.style.display !== 'none' && box.offsetParent !== null;
    if (!alreadyOpen) wrap.click();
    return true;
  }

  async function toggleSubtitle() {
    if (!queryFirst(SUBTITLE_BTN_SELECTORS)) {
      return B.toast('当前视频没有字幕', 'warn');
    }
    openSubtitleMenu();
    await sleep(350);

    const active = queryFirst(SUBTITLE_ACTIVE_SELECTORS);
    if (active) {
      const close =
        document.querySelector('.bpx-player-ctrl-subtitle-close-switch') ||
        document.querySelector('[data-action="close"]');
      (close || active).click();
      return B.toast('字幕已关闭', 'ok');
    }

    const target =
      document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]') ||
      document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan="zh-CN"]') ||
      document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan]');
    if (!target) return B.toast('该视频没有可用字幕', 'warn');
    target.click();
    B.toast('字幕已开启', 'ok');
  }

  /* ====================================================================== *
   * 互动类：id 参数与「番剧 / 普通视频」分流
   * ====================================================================== */

  /** 普通视频用 bvid/aid；番剧页优先用当集的 aid。 */
  function idParams(ids) {
    if (ids.epId && ids.aid) return { aid: ids.aid };
    if (ids.bvid) return { bvid: ids.bvid };
    if (ids.aid) return { aid: ids.aid };
    return null;
  }

  function isPgc(ids) {
    return !!(ids.epId || ids.seasonId);
  }

  /* ====================================================================== *
   * DOM 点击模式
   * ====================================================================== */

  function useDomMode() {
    return state.settings.mode === 'dom';
  }

  /**
   * 尝试用「模拟点击」完成互动。
   * @returns {Promise<boolean>} 是否已处理（false 表示调用方应退回 API 模式）
   */
  async function clickInteraction(kind) {
    if (!useDomMode()) return false;
    const btn = queryFirst(TOOLBAR[kind]);
    if (!btn) return false; // 找不到按钮 -> 交给 API

    btn.click();
    if (kind === 'coin' || kind === 'fav') {
      await sleep(320); // 等弹层出现
      const confirm = queryFirst(TOOLBAR[kind === 'coin' ? 'coinConfirm' : 'favConfirm']);
      if (confirm) confirm.click();
      else B.toast('按钮已点击，请在弹层里确认', 'info');
    }
    return true;
  }

  /* ====================================================================== *
   * 点赞
   * ====================================================================== */

  // API 改的是服务端状态，工具栏按钮不会自动刷新。这里尽量同步视觉状态（纯装饰）。
  function syncLikeUi(liked) {
    const btn =
      document.querySelector('#arc_toolbar_report .like') ||
      document.querySelector('.video-toolbar-left-item.like') ||
      document.querySelector('.video-like');
    if (btn) btn.classList.toggle('on', liked);
  }

  async function toggleLike() {
    if (await clickInteraction('like')) return;
    if (!getCsrf()) return B.toast('请先登录 B 站', 'warn');

    const ids = await getIds();
    const params = idParams(ids);
    if (!params) return B.toast('无法识别当前视频', 'warn');

    try {
      const hasRes = await biliGet('/x/web-interface/archive/has/like', params);
      const liked = !!hasRes && hasRes.data === 1;

      const res = await biliPost('/x/web-interface/archive/like', {
        ...params,
        like: liked ? 2 : 1,
      });

      if (res.code === 0) {
        B.toast(liked ? '已取消点赞' : '点赞成功 👍', 'ok');
        syncLikeUi(!liked);
      } else if (res.code === 65006) {
        B.toast('已经点过赞了', 'info');
        syncLikeUi(true);
      } else {
        B.toast(`点赞失败：${res.message || res.code}`, 'err');
      }
    } catch (err) {
      console.error('[BiliPlay] 点赞出错', err);
      B.toast('点赞请求失败', 'err');
    }
  }

  /* ====================================================================== *
   * 投币
   * ====================================================================== */

  async function addCoin() {
    if (await clickInteraction('coin')) return;
    if (!getCsrf()) return B.toast('请先登录 B 站', 'warn');

    const ids = await getIds();
    const params = idParams(ids);
    if (!params) return B.toast('无法识别当前视频', 'warn');

    const multiply = clamp(Number(state.settings.coinCount) || 1, 1, 2);
    try {
      const res = await biliPost('/x/web-interface/coin/add', {
        ...params,
        multiply,
        select_like: 0,
      });

      if (res.code === 0) {
        B.toast(`投币成功 +${multiply} 🪙`, 'ok');
      } else if (res.code === 34005) {
        B.toast('已经投过币了', 'info');
      } else if (res.code === 34002) {
        B.toast('不能给自己投币', 'warn');
      } else if (res.code === 104) {
        B.toast('硬币不足', 'warn');
      } else {
        B.toast(`投币失败：${res.message || res.code}`, 'err');
      }
    } catch (err) {
      console.error('[BiliPlay] 投币出错', err);
      B.toast('投币请求失败', 'err');
    }
  }

  /* ====================================================================== *
   * 收藏
   * ====================================================================== */

  /** 番剧（PGC）的收藏状态，从剧集详情里取。 */
  async function pgcFavState(seasonId) {
    try {
      const res = await biliGet('/pgc/view/web/season', { season_id: seasonId });
      const us = res && res.result && res.result.user_status;
      if (us) {
        if (typeof us.favorite !== 'undefined') return !!us.favorite;
        if (typeof us.favored !== 'undefined') return !!us.favored;
      }
    } catch (err) {
      /* 忽略，按未收藏处理 */
    }
    return false;
  }

  async function getFolders(mid) {
    const res = await biliGet('/x/v3/fav/folder/created/list-all', { up_mid: mid });
    return (res && res.data && res.data.list) || [];
  }

  async function toggleFav() {
    if (await clickInteraction('fav')) return;
    if (!getCsrf()) return B.toast('请先登录 B 站', 'warn');

    const ids = await getIds();
    const mid = getMid();
    if (!mid) return B.toast('未登录，无法收藏', 'warn');

    try {
      const folders = await getFolders(mid);
      if (!folders.length) return B.toast('没有可用的收藏夹', 'warn');
      const def = folders.find((f) => f.attr === 0) || folders[0];
      const allIds = folders.map((f) => f.id).join(',');

      let rid;
      let type;
      let favoured;

      if (isPgc(ids)) {
        // 番剧收藏的是整个剧集：type=21，rid=season_id
        rid = ids.seasonId;
        type = 21;
        if (!rid) return B.toast('无法识别剧集', 'warn');
        favoured = await pgcFavState(rid);
      } else {
        rid = await resolveAid(ids);
        type = 2;
        if (!rid) return B.toast('无法识别当前视频', 'warn');
        const favRes = await biliGet('/x/v2/fav/video/favoured', { aid: rid });
        favoured = !!(favRes && favRes.data && favRes.data.favoured);
      }

      const res = await biliPost('/x/v3/fav/resource/deal', {
        rid,
        type,
        add_media_ids: favoured ? '' : def.id,
        del_media_ids: favoured ? allIds : '',
      });

      if (res.code === 0) {
        B.toast(favoured ? '已取消收藏' : `已收藏到「${def.title}」`, 'ok');
      } else {
        B.toast(`收藏失败：${res.message || res.code}`, 'err');
      }
    } catch (err) {
      console.error('[BiliPlay] 收藏出错', err);
      B.toast('收藏请求失败', 'err');
    }
  }

  /* ====================================================================== *
   * 一键三连
   * ====================================================================== */

  async function triple() {
    if (!getCsrf()) return B.toast('请先登录 B 站', 'warn');
    const ids = await getIds();
    const params = idParams(ids);
    if (!params) return B.toast('无法识别当前视频', 'warn');

    try {
      const res = await biliPost('/x/web-interface/archive/like/triple', params);
      if (res.code === 0) {
        const d = res.data || {};
        const mark = (ok) => (ok ? '✓' : '✗');
        B.toast(`一键三连  点赞${mark(d.like)} 投币${mark(d.coin)} 收藏${mark(d.fav)}`, 'ok');
        syncLikeUi(!!d.like);
      } else {
        B.toast(`三连失败：${res.message || res.code}`, 'err');
      }
    } catch (err) {
      console.error('[BiliPlay] 三连出错', err);
      B.toast('三连请求失败', 'err');
    }
  }

  /* ====================================================================== *
   * 动作分发表
   * ====================================================================== */

  // 动作分发表。
  // 注意：被 common.js 注释掉的那些动作（互动四件套 / 播放暂停 / 快进快退 / 弹幕 / 全屏）
  // 的实现都还在这里，只是默认不在 ACTIONS 里，所以永远不会被触发。
  // 想把某个功能加回来：common.js 里取消对应条目注释 + 给个默认键，就这一处。
  const RUN = {
    // —— 默认启用 ——
    subtitle: toggleSubtitle,
    speedUp: () => changeSpeed(1),
    speedDown: () => changeSpeed(-1),
    speedReset: () => setSpeed(1),
    frameBackward: () => stepFrame(-1),
    frameForward: () => stepFrame(1),
    wideScreen: toggleWideScreen,
    webFullscreen: toggleWebFullscreen,
    lightsOff: toggleLightsOff,
    screenshot,
    pip: togglePip,

    // —— 已实现，默认未绑定（B 站官方已有快捷键）——
    like: toggleLike,
    coin: addCoin,
    fav: toggleFav,
    triple,
    playPause: togglePlay,
    seekForward: () => seek(1),
    seekBackward: () => seek(-1),
    danmaku: toggleDanmaku,
    fullscreen: () => {
      // 注意排除「网页全屏」，它的文案里也含「全屏」
      const btn = queryFirst(CTRL.fullscreen) || findButtonByText(['全屏'], ['网页']);
      if (!btn) return B.toast('未找到全屏按钮', 'warn');
      btn.click();
    },
  };

  // 长按可连续触发的动作（其余忽略 auto-repeat，避免误连发）
  const REPEATABLE = new Set([
    'speedUp',
    'speedDown',
    'seekForward',
    'seekBackward',
    'frameBackward',
    'frameForward',
  ]);

  function runAction(id) {
    const fn = RUN[id];
    if (!fn) return;
    Promise.resolve(fn()).catch((err) => console.error('[BiliPlay]', id, err));
  }

  /* ====================================================================== *
   * 键盘监听
   * ====================================================================== */

  function onKeyDown(e) {
    if (!state.settings.enabled) return;
    if (e.isComposing || e.keyCode === 229) return; // 中文输入法组合中
    if (isEditable(e.target)) return; // 在输入框里打字

    const key = normalizeKey(e);
    let hit = null;
    for (const action of ACTIONS) {
      const bound = state.settings.keys[action.id];
      if (bound && bound === key) {
        hit = action.id;
        break;
      }
    }
    if (!hit) return;
    if (e.repeat && !REPEATABLE.has(hit)) return;

    // 吃掉事件，避免 B 站或浏览器再处理一次
    e.preventDefault();
    e.stopPropagation();
    runAction(hit);
  }

  document.addEventListener('keydown', onKeyDown, true);

  /* ====================================================================== *
   * 「记住倍速」：仅在新视频加载时应用，不覆盖用户手动改的倍速
   * ====================================================================== */

  function applyRememberedSpeed() {
    if (!state.settings.rememberSpeed) return;
    const target = state.settings.lastSpeed;
    if (!target || target === 1) return;
    const video = getVideo();
    if (video && Math.abs(video.playbackRate - target) > 0.001) {
      video.playbackRate = target;
    }
  }

  function watchVideo() {
    document.addEventListener(
      'loadedmetadata',
      (e) => {
        if (e.target instanceof HTMLVideoElement) applyRememberedSpeed();
      },
      true
    );

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!node || node.nodeType !== 1) continue;
          if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
            setTimeout(applyRememberedSpeed, 0);
            return;
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ====================================================================== *
   * 与 popup / options 通信
   * ====================================================================== */

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.source !== 'biliplay') return;
    if (msg.command === 'setSpeed') setSpeed(Number(msg.value));
  });

  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((_changes, area) => {
      if (area === B.storageArea) B.load().catch(() => {});
    });
  }

  /* ====================================================================== *
   * 启动
   * ====================================================================== */

  (async () => {
    await B.load();
    watchVideo();
  })();
})();
