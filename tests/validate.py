#!/usr/bin/env python3
"""用 Firefox 的 Marionette 协议，把 BiliPlay 的脚本真实加载进页面跑一遍。

默认打印一份「人看的」断言报告；--json 则打印原始结果，方便排查。

用法：
  tests/run.sh                      # 起一个临时 Firefox，跑完自动关掉（推荐）
  python3 tests/validate.py         # 假定 127.0.0.1:2828 上已有带 --marionette 的 Firefox
  python3 tests/validate.py --json  # 原始 JSON

依赖：本机有 firefox，且 Python 能连到 Marionette 的 2828 端口。
"""
import json, os, socket, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, os.pardir, "src")
MARIONETTE_PORT = int(os.environ.get("MARIONETTE_PORT", "2828"))

FILES = {}
for name in ("common.js", "toast.js", "bridge-client.js", "content.js", "page-bridge.js",
             "options.js", "popup.js"):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        FILES[name] = f.read()

PAGE = "<!doctype html><html><head><title>t</title></head><body></body></html>"


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()


def recv_packet(s):
    buf = b""
    while b":" not in buf:
        buf += s.recv(1)
    length, _, rest = buf.partition(b":")
    need = int(length)
    while len(rest) < need:
        rest += s.recv(need - len(rest))
    return json.loads(rest[:need])


def send_packet(s, msg):
    data = json.dumps(msg).encode()
    s.sendall(str(len(data)).encode() + b":" + data)


TEST = r"""
const FILES = __FILES__;
const out = { syntax: {}, tests: {} };
for (const [name, src] of Object.entries(FILES)) {
  try { new Function(src); out.syntax[name] = 'ok'; }
  catch (e) { out.syntax[name] = 'SYNTAX FAIL: ' + e.message; }
}
return (async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toastText = () => {
    const t = document.querySelector('.biliplay-toast');
    return t ? t.textContent : null;
  };
  try {
    // 模拟页面全局状态（主世界脚本会读它）
    window.__INITIAL_STATE__ = {
      videoData: { bvid: 'BV1xx411c7mD', aid: 111, cid: 222 },
      upData: { mid: 42 },
    };

    const store = {};
    globalThis.browser = {
      storage: {
        sync: {
          async get(defaults) { return Object.assign({}, defaults, store); },
          async set(o) { Object.assign(store, o); },
        },
        onChanged: { addListener() {} },
      },
      runtime: { onMessage: { addListener(fn) { globalThis.__onMessage = fn; } } },
    };

    document.body.innerHTML =
      '<div id="bilibili-player"><div class="bpx-player-video-wrap">' +
      '<video></video></div>' +
      '<div class="bpx-player-dm-switch"></div>' +
      '<div class="bpx-player-ctrl-wide"></div>' +
      '<div class="bpx-player-ctrl-web"></div>' +
      '<div class="bpx-player-ctrl-full"></div>' +
      '<div class="bpx-player-ctrl-setting"></div></div>';
    const video = document.querySelector('#bilibili-player video');

    // 给媒体元素加可测的替身属性
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true });
    Object.defineProperty(video, 'duration', { value: 100, configurable: true });
    let played = false, paused = false;
    video.play = () => { played = true; return Promise.resolve(); };
    video.pause = () => { paused = true; };

    let danmakuClicks = 0, wideClicks = 0, webClicks = 0, fullClicks = 0, gearClicks = 0;
    document.querySelector('.bpx-player-dm-switch').click = () => { danmakuClicks++; };
    document.querySelector('.bpx-player-ctrl-wide').click = () => { wideClicks++; };
    document.querySelector('.bpx-player-ctrl-web').click = () => { webClicks++; };
    document.querySelector('.bpx-player-ctrl-full').click = () => { fullClicks++; };

    // 「关灯」在新版里是设置面板中的复选框：面板初始收起（display:none），
    // 点齿轮才展开 —— 正好验证 content.js 里那套「先开面板再点复选框」的分支
    const lightPanel = document.createElement('div');
    lightPanel.className = 'bpx-player-ctrl-setting-checkbox bpx-player-ctrl-setting-lightoff';
    lightPanel.style.display = 'none';
    const lightInput = document.createElement('input');
    lightInput.type = 'checkbox';
    let lightClicks = 0;
    lightInput.click = () => { lightClicks++; };
    lightPanel.appendChild(lightInput);
    document.querySelector('#bilibili-player').appendChild(lightPanel);
    document.querySelector('.bpx-player-ctrl-setting').click = () => {
      gearClicks++;
      lightPanel.style.display = 'block';
    };

    (0, eval)(FILES['common.js']);

    // 先记录默认（未绑定）状态，再模拟「取消注释恢复功能」，验证保留的代码仍可用
    const B0 = globalThis.BiliPlay;
    out.tests.defaultActions = B0.ACTIONS.map((a) => a.id);
    out.tests.defaultKeys = Object.keys(B0.DEFAULT_KEYS);
    out.tests.everyActionHasKey = B0.ACTIONS.every((a) => !!B0.DEFAULT_KEYS[a.id]);
    B0.ACTIONS.push(
      { id: 'like', label: '点赞 / 取消点赞', icon: '👍', group: '互动' },
      { id: 'coin', label: '投币', icon: '🪙', group: '互动' },
      { id: 'fav', label: '收藏 / 取消收藏', icon: '⭐', group: '互动' },
      { id: 'triple', label: '一键三连', icon: '💖', group: '互动' },
      { id: 'playPause', label: '播放 / 暂停', icon: '⏯️', group: '播放器' },
      { id: 'seekForward', label: '快进', icon: '⏭️', group: '播放器' },
      { id: 'seekBackward', label: '快退', icon: '⏮️', group: '播放器' },
      { id: 'danmaku', label: '弹幕 开 / 关', icon: '🈁', group: '播放器' },
      { id: 'fullscreen', label: '全屏', icon: '⛶', group: '播放器' }
    );
    store.keys = {
      like: 'z', coin: 'x', fav: 'c', triple: 'b',
      playPause: 'k', seekForward: '>', seekBackward: 'j', danmaku: 'n', fullscreen: 'f',
    };

    (0, eval)(FILES['toast.js']);
    (0, eval)(FILES['page-bridge.js']);   // 平时跑在 MAIN world
    (0, eval)(FILES['bridge-client.js']);
    (0, eval)(FILES['content.js']);

    const B = globalThis.BiliPlay;
    await B.load();
    out.tests.namespace = typeof B === 'object' && !!B.normalizeKey;
    out.tests.bridgeInstalled = !!(B.bridge && typeof B.bridge.getIds === 'function');

    const nk = (o) => B.normalizeKey(Object.assign(
      { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, o));
    out.tests.normalizeKey = {
      z: nk({ key: 'z' }), equal: nk({ key: '=' }),
      plus: nk({ key: '+', shiftKey: true }), minus: nk({ key: '-' }), zero: nk({ key: '0' }),
      ctrl_shift_p: nk({ key: 'P', ctrlKey: true, shiftKey: true }),
      arrowup: nk({ key: 'ArrowUp' }), space: nk({ key: ' ' }),
    };
    out.tests.prettyKey = {
      equal: B.prettyKey('='), minus: B.prettyKey('-'),
      plus: B.prettyKey('+'), csp: B.prettyKey('ctrl+shift+p'),
    };
    out.tests.getVideo = B.getVideo() === video;

    // 页面桥：URL 里没有 bvid 时也应拿到
    await sleep(80);
    out.tests.idsFromBridge = await B.getIds();

    const key = (k, extra) => document.dispatchEvent(new KeyboardEvent(
      'keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));

    // 播放器类动作
    const before = video.playbackRate;
    key('=');
    out.tests.speedUp = { before, after: video.playbackRate };
    key('='); // 连按应继续加速（可长按重复）
    out.tests.speedUpTwice = video.playbackRate;
    key('-');
    out.tests.speedDown = video.playbackRate;
    key('0');
    out.tests.speedReset = video.playbackRate;

    key('k');
    await sleep(60);
    out.tests.playPause = { played, paused };

    key('>', { shiftKey: true });
    out.tests.seekForward = video.currentTime;
    key('j');
    out.tests.seekBackward = video.currentTime;

    key('n');
    key('t');
    out.tests.danmakuClicks = danmakuClicks;
    out.tests.wideClicks = wideClicks;

    // ---- 逐帧 ----
    // 让 video 假装正在播放，验证逐帧会先暂停再跳
    Object.defineProperty(video, 'paused', { get: () => false, configurable: true });
    paused = false;
    video.currentTime = 10;
    key('.');
    out.tests.frameForward = { paused, time: video.currentTime };
    key(',');
    out.tests.frameBackward = video.currentTime;

    // 步长跟着 frameRate 设置走：24fps 一帧是 1/24 秒
    await B.save({ frameRate: 24 });
    key('.');
    out.tests.frameForward24 = video.currentTime;
    await B.save({ frameRate: 30 });
    Object.defineProperty(video, 'paused', { get: () => true, configurable: true });

    // ---- 网页全屏 / 全屏 ----
    key('i');
    key('f');
    out.tests.webFullscreenClicks = webClicks;
    out.tests.fullscreenClicks = fullClicks;

    // ---- 关灯 ----
    // 第一次：面板是收起的，应该先点「设置」齿轮展开，再点复选框
    key('l');
    await sleep(300);
    out.tests.lightsOffFirst = { gear: gearClicks, light: lightClicks };
    // 第二次：面板已经展开，不该再动齿轮
    key('l');
    await sleep(80);
    out.tests.lightsOffSecond = { gear: gearClicks, light: lightClicks };

    // 输入框内不应触发
    const input = document.createElement('input');
    document.body.appendChild(input);
    const rate = video.playbackRate;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true }));
    out.tests.inputGuard = rate === video.playbackRate;

    // ---- 全屏下的提示：必须挂进全屏元素，否则浏览器根本不渲染它 ----
    const fsWrap = document.createElement('div');
    document.body.appendChild(fsWrap);
    const setFs = (value) =>
      Object.defineProperty(document, 'fullscreenElement', { value, configurable: true });

    B.toast('未全屏的提示');
    const toastEl = document.querySelector('.biliplay-toast');
    out.tests.toastOnBody = !!toastEl && toastEl.parentNode === document.body;

    setFs(fsWrap);
    document.dispatchEvent(new Event('fullscreenchange'));
    out.tests.toastMovedOnFullscreen = !!toastEl && toastEl.parentNode === fsWrap;

    B.toast('全屏中的提示');
    out.tests.toastInFullscreen = toastEl.parentNode === fsWrap;

    setFs(null);
    document.dispatchEvent(new Event('fullscreenchange'));
    out.tests.toastBackOnExit = toastEl.parentNode === document.body;

    // <video> 自身全屏时子节点不会被渲染，退回 body 尽力而为，至少不能抛错
    setFs(video);
    B.toast('video 全屏');
    out.tests.toastVideoFallback = toastEl.parentNode === document.body;
    setFs(null);

    // 网络替身
    document.cookie = 'bili_jct=csrf123';
    document.cookie = 'DedeUserID=42';
    const calls = [];
    let favoured = false, pgcFav = false;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      calls.push({ url: u.replace('https://api.bilibili.com', ''), method: (opts && opts.method) || 'GET', body: (opts && opts.body) || '' });
      if (u.includes('has/like')) return { json: async () => ({ code: 0, data: 0 }) };
      if (u.includes('like/triple')) return { json: async () => ({ code: 0, data: { like: true, coin: true, fav: true } }) };
      if (u.includes('/x/web-interface/view')) return { json: async () => ({ code: 0, data: { aid: 111 } }) };
      if (u.includes('folder/created/list-all')) return { json: async () => ({ code: 0, data: { list: [
        { id: 999, attr: 0, title: '默认收藏夹' }, { id: 888, attr: 1, title: '学习' } ] } }) };
      if (u.includes('video/favoured')) return { json: async () => ({ code: 0, data: { favoured } }) };
      if (u.includes('/pgc/view/web/season')) return { json: async () => ({ code: 0, result: { user_status: { favorite: pgcFav ? 1 : 0 } } }) };
      return { json: async () => ({ code: 0, data: {} }) };
    };

    // ---- 普通视频互动 ----
    key('z');
    await sleep(150);
    out.tests.likeCalls = calls.slice();
    out.tests.likeToast = toastText();

    calls.length = 0;
    key('b');
    await sleep(150);
    out.tests.tripleCalls = calls.slice();

    calls.length = 0;
    key('c');
    await sleep(200);
    out.tests.favAddToast = toastText();
    out.tests.favAdd = calls.slice();

    calls.length = 0;
    favoured = true;
    key('c');
    await sleep(200);
    out.tests.favDel = calls.slice();

    calls.length = 0;
    key('x');
    await sleep(150);
    out.tests.coin = calls.slice();

    // ---- 番剧（PGC）----
    window.__INITIAL_STATE__ = {
      epInfo: { ep_id: 999, aid: 555, bvid: 'BV1yy411c7mD', cid: 333 },
      mediaInfo: { season_id: 777, media_id: 666 },
      upInfo: { mid: 43 },
    };
    window.postMessage({ __biliplay__: true, type: 'request' }, '*');
    await sleep(120);
    out.tests.pgcIds = await B.getIds();

    calls.length = 0;
    pgcFav = false;
    key('c');
    await sleep(220);
    out.tests.pgcFavAdd = calls.slice();
    out.tests.pgcFavAddToast = toastText();

    // ---- 未登录 ----
    document.cookie = 'bili_jct=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    calls.length = 0;
    key('z');
    await sleep(60);
    out.tests.likeWithoutLogin = calls.length;

    // ---- DOM 点击模式 ----
    store.mode = 'dom';
    await B.load();
    let domLikeClicks = 0;
    const domLike = document.createElement('div');
    domLike.className = 'video-like';
    domLike.addEventListener('click', () => { domLikeClicks++; });
    document.body.appendChild(domLike);
    calls.length = 0;
    key('z');
    await sleep(80);
    out.tests.domModeLikeClicks = domLikeClicks;
    out.tests.domModeNoApiCall = calls.length;

    // ---- 冲突检测 ----
    // 默认一套键不应该有任何重复
    await B.save({ keys: { ...B.DEFAULT_KEYS } });
    out.tests.noConflictByDefault = Object.keys(B.findConflicts()).length;

    // 故意把两个动作绑到同一颗键上（y 没被任何动作占用）
    await B.save({ keys: { subtitle: 'y', speedUp: 'y' } });
    out.tests.conflicts = B.findConflicts();
    await B.save({ keys: { subtitle: 'v', speedUp: '=' } });

    // ---- 兜底查找要能排除「网页全屏」----
    // 去掉真正的全屏按钮，只留文案含「全屏」的网页全屏按钮：
    // 按 f 应该「找不到」而不是误点网页全屏
    document.querySelector('.bpx-player-ctrl-full').remove();
    const webLabeled = document.createElement('button');
    webLabeled.className = 'bpx-player-ctrl-btn';
    webLabeled.setAttribute('aria-label', '网页全屏');
    let webLabeledClicks = 0;
    webLabeled.addEventListener('click', () => { webLabeledClicks++; });
    document.querySelector('#bilibili-player').appendChild(webLabeled);

    key('f');
    await sleep(60);
    out.tests.fullscreenExclude = { unrelated: webLabeledClicks, toast: toastText() };
  } catch (e) {
    out.FATAL = e.message + '\n' + (e.stack || '');
  }
  return out;
})();
"""
TEST = TEST.replace("__FILES__", json.dumps(FILES))


def report(d):
    """把页面里收回来的结果转成人看的 PASS/FAIL 报告。"""
    t = d.get("tests", {})
    rows = []

    def check(label, ok, detail=""):
        rows.append((label, bool(ok), detail))

    bad = [k for k, v in d.get("syntax", {}).items() if v != "ok"]
    check(f"{len(d.get('syntax', {}))} 个脚本语法通过", not bad, ", ".join(bad))

    # —— 默认动作表 ——
    want = ["subtitle", "speedUp", "speedDown", "speedReset", "frameBackward",
            "frameForward", "wideScreen", "webFullscreen", "lightsOff", "screenshot", "pip"]
    check("默认只留 B 站没有的 11 个动作", t.get("defaultActions") == want, t.get("defaultActions"))
    check("默认键与动作表一一对应", sorted(t.get("defaultKeys") or []) == sorted(want),
          t.get("defaultKeys"))
    check("每个默认动作都有键", t.get("everyActionHasKey"))

    # —— 按键归一化 / 展示 ——
    nk, pk = t["normalizeKey"], t["prettyKey"]
    check("归一化：= 与 - 原样保留", nk["equal"] == "=" and nk["minus"] == "-", nk)
    check("归一化：Shift+符号 只留符号本身", nk["plus"] == "+")
    check("归一化：Ctrl+Shift+P", nk["ctrl_shift_p"] == "ctrl+shift+p", nk["ctrl_shift_p"])
    check("展示文本（含 + 与拼接符撞车的还原）",
          pk["equal"] == "=" and pk["minus"] == "-" and pk["plus"] == "+"
          and pk["csp"] == "Ctrl + Shift + P", pk)

    # —— 播放器动作 ——
    check("倍速 = → 1.25", t["speedUp"]["after"] == 1.25, t["speedUp"])
    check("倍速 = 连按 → 1.5", t["speedUpTwice"] == 1.5, t["speedUpTwice"])
    check("倍速 - → 1.25", t["speedDown"] == 1.25, t["speedDown"])
    check("倍速复位 0 → 1.0", t["speedReset"] == 1, t["speedReset"])
    check("宽屏按钮点了 1 次", t["wideClicks"] == 1)
    check("网页全屏按钮点了 1 次", t["webFullscreenClicks"] == 1)
    check("全屏按钮点了 1 次（默认未绑定的实现）", t["fullscreenClicks"] == 1)
    check("输入框内不触发", t["inputGuard"])

    ff = t["frameForward"]
    check("下一帧：先暂停、再前进 1/30 秒",
          ff["paused"] and abs(ff["time"] - (10 + 1 / 30)) < 1e-6, ff)
    check("上一帧：回到原处", abs(t["frameBackward"] - 10) < 1e-6, t["frameBackward"])
    check("frameRate 改成 24 后步长跟着变",
          abs(t["frameForward24"] - (10 + 1 / 24)) < 1e-6, t["frameForward24"])

    check("关灯：面板收起时先点「设置」再点复选框",
          t["lightsOffFirst"] == {"gear": 1, "light": 1}, t["lightsOffFirst"])
    check("关灯：面板已展开时不再动「设置」",
          t["lightsOffSecond"] == {"gear": 1, "light": 2}, t["lightsOffSecond"])

    # —— 冲突检测 ——
    check("冲突检测：默认键没有重复", t["noConflictByDefault"] == 0, t["noConflictByDefault"])
    c = t["conflicts"]
    check("冲突检测：能算出重复的动作",
          c.get("subtitle") == ["speedUp"] and c.get("speedUp") == ["subtitle"] and len(c) == 2, c)

    fe = t["fullscreenExclude"]
    check("兜底查找排除「网页全屏」：不会误点，而是提示找不到",
          fe["unrelated"] == 0 and fe["toast"] == "未找到全屏按钮", fe)

    # —— 页面桥 ——
    check("页面桥：从 __INITIAL_STATE__ 补出 aid",
          (t["idsFromBridge"] or {}).get("aid") == 111, t["idsFromBridge"])
    check("页面桥：番剧拿到 epId / seasonId",
          (t["pgcIds"] or {}).get("epId") == 999 and (t["pgcIds"] or {}).get("seasonId") == 777,
          t["pgcIds"])

    # —— 全屏 toast ——
    for label, name in [("toast 非全屏挂在 body", "toastOnBody"),
                        ("toast 进全屏自动搬进全屏元素", "toastMovedOnFullscreen"),
                        ("toast 全屏中弹的也在全屏元素内", "toastInFullscreen"),
                        ("toast 退出全屏搬回 body", "toastBackOnExit"),
                        ("toast video 全屏时退回 body 不报错", "toastVideoFallback")]:
        check(label, t[name])

    # —— 互动：默认未绑定，测试里临时启用后才可触发 ——
    check("点赞链路", t["likeToast"] == "点赞成功 👍", t["likeToast"])
    check("三连", any("like/triple" in x["url"] for x in t["tripleCalls"]))
    check("收藏：rid=111&type=2", any("rid=111&type=2" in x["body"] for x in t["favAdd"]))
    check("番剧收藏：rid=777&type=21", any("rid=777&type=21" in x["body"] for x in t["pgcFavAdd"]))
    check("投币", any("coin/add" in x["url"] for x in t["coin"]))
    check("未登录时不发请求", t["likeWithoutLogin"] == 0)
    check("DOM 模式：点了按钮且不发请求",
          t["domModeLikeClicks"] == 1 and t["domModeNoApiCall"] == 0,
          [t["domModeLikeClicks"], t["domModeNoApiCall"]])
    check("播放暂停 / 快进 / 快退 / 弹幕",
          t["playPause"]["played"] and t["seekForward"] == 15 and t["seekBackward"] == 10
          and t["danmakuClicks"] == 1,
          [t["seekForward"], t["seekBackward"], t["danmakuClicks"]])

    width = max(len(r[0]) for r in rows)
    for label, ok, detail in rows:
        line = f"{'PASS' if ok else 'FAIL'}  {label.ljust(width)}"
        if not ok and detail not in ("", None):
            line += "   ← " + json.dumps(detail, ensure_ascii=False)
        print(line)

    passed = sum(1 for r in rows if r[1])
    print()
    print(f"{passed}/{len(rows)} 通过")
    return 0 if passed == len(rows) else 1


s = socket.create_connection(("127.0.0.1", MARIONETTE_PORT), timeout=15)
recv_packet(s)  # Marionette 握手包
send_packet(s, [0, 1, "WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}}}])
r = recv_packet(s)
if r[2]:
    print("NewSession 失败:", r[2]); sys.exit(1)

send_packet(s, [0, 2, "WebDriver:Navigate", {"url": f"http://127.0.0.1:{PORT}/video/BV1xx411c7mD/"}])
recv_packet(s)
send_packet(s, [0, 3, "WebDriver:ExecuteScript", {"script": TEST, "args": [], "newSandbox": False}])
r = recv_packet(s)
srv.shutdown()

if r[2]:
    print("执行返回错误:", json.dumps(r[2], ensure_ascii=False, indent=2))
    sys.exit(1)

# WebDriver 会把脚本返回值包一层 {"value": ...}
result = r[3].get("value", r[3]) if isinstance(r[3], dict) else r[3]

if "--json" in sys.argv:
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0)

if result.get("FATAL"):
    print("页面里抛异常了：")
    print(result["FATAL"])
    sys.exit(1)

try:
    sys.exit(report(result))
except KeyError as err:
    print(f"读结果时缺字段 {err}，改成原始输出方便排查：")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(1)
