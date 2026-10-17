# BiliPlay — 哔哩哔哩播放器快捷键（Firefox 扩展）

给 B 站网页播放器补上一套**可自定义的快捷键**，只挑 B 站官方**没有**的功能：
**字幕开关、倍速增减 / 复位、上下帧、宽屏、网页全屏、关灯、截图、画中画**。

点赞、投币、收藏、播放暂停、快进快退、弹幕这些 B 站官方播放器**已经自带快捷键**
（<kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>空格</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>D</kbd> …），
所以本扩展默认**不再重复绑定**——不过它们的实现代码都保留着，想要随时取消一行注释就能启用。

纯 Firefox 的 WebExtension（MV3），不依赖 Chrome 专有 API。**需要 Firefox 128 或更高版本**
（用到了 `content_scripts` 的 `world: "MAIN"` 来读取页面状态）。

---

## 1. 快速开始

### 临时加载（开发调试，最常用）

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点「**临时载入附加组件…**」
3. 选择本目录下的 `manifest.json`
4. 打开任意 B 站视频页，按下默认键即可

> 临时载入的扩展在重启 Firefox 后会消失；要长期使用见第 9 节。

### 用 web-ext（可选，推荐用于开发）

```bash
npm i -g web-ext
web-ext run                 # 自动开一个带扩展的 Firefox
web-ext lint                # 校验 manifest / API 用法
web-ext build -o            # 打包成 .zip（可再转 .xpi）
```

---

## 2. 默认快捷键

只绑定 B 站官方没有的功能，一共 11 个：

| 功能 | 默认键 | 说明 |
| --- | --- | --- |
| 字幕 开 / 关 | <kbd>V</kbd> | 自动挑中文轨（`ai-zh` / `zh-CN`） |
| 加快倍速 | <kbd>=</kbd> | 键盘上 <kbd>+</kbd> / <kbd>=</kbd> 那一颗，**不用按 Shift** |
| 减慢倍速 | <kbd>-</kbd> | 紧挨着 <kbd>=</kbd> 的减号，同一对 |
| 恢复 1x | <kbd>0</kbd> | |
| 上一帧 | <kbd>,</kbd> | 逐帧，会自动先暂停 |
| 下一帧 | <kbd>.</kbd> | 键位沿用 YouTube |
| 宽屏模式 | <kbd>T</kbd> | 把播放器横向拉宽 |
| 网页全屏 | <kbd>I</kbd> | 铺满浏览器窗口（不是真全屏） |
| 关灯 / 开灯 | <kbd>L</kbd> | B 站把它藏起来了，见 4.7 |
| 截图 | <kbd>S</kbd> | 存成 PNG |
| 画中画 | <kbd>P</kbd> | |

<kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd> 就是 Chrome 上「哔哩哔哩播放器扩展」那套倍速键位
（那边是 <kbd>+</kbd>，但 <kbd>+</kbd> 要按住 <kbd>Shift</kbd> 才打得出来，单手略别扭；
<kbd>=</kbd> 和 <kbd>+</kbd> 是同一颗物理键，所以这里用不按 Shift 的 <kbd>=</kbd>）。

逐帧的步长按 `1 / 帧率` 算，帧率在设置页里可切（默认 30，看 24fps 的番剧时改成 24 更准）。

**为什么只剩这么几个？** 因为 B 站官方播放器已经占掉了大量常用键，
本扩展再绑一遍必然打架：

| 功能 | 官方键 | 本扩展 |
| --- | --- | --- |
| 点赞 / 长按三连 | <kbd>Q</kbd> / <kbd>R</kbd> | 代码保留，默认不绑定 |
| 投币 | <kbd>W</kbd> | 代码保留，默认不绑定 |
| 收藏 | <kbd>E</kbd> | 代码保留，默认不绑定 |
| 播放 / 暂停 | <kbd>空格</kbd> | 代码保留，默认不绑定 |
| 快进 / 快退 | <kbd>→</kbd> / <kbd>←</kbd> | 代码保留，默认不绑定 |
| 弹幕 开 / 关 | <kbd>D</kbd> | 代码保留，默认不绑定 |
| 关注 UP 主 | <kbd>G</kbd> | 未实现 |
| 全屏 | <kbd>F</kbd> | 代码保留，默认不绑定 |
| 静音 | <kbd>M</kbd> | 未实现 |
| 上一集 / 下一集 | <kbd>[</kbd> / <kbd>]</kbd> | 未实现 |

「代码保留，默认不绑定」= 实现还在 `content.js` 的 `RUN` 表里、跑得通，
只是不在 `ACTIONS` 里，**既不占键也不出现在设置页**。想启用见第 6 节，取消一行注释即可。

改键：右键扩展图标 →「管理扩展」→「首选项」，或从弹窗点「打开设置」。
点按钮 → 按下你想绑的键（<kbd>Esc</kbd> 取消录制）。

**重复绑定会被指出来。** 两个动作绑同一颗键时，`content.js` 的匹配是
「按 `ACTIONS` 顺序找、命中即停」，所以**列表靠上的那个赢**，另一个静默失效。
设置页会在表格上方把重复项列出来、并把冲突的行标黄，别让它悄悄吃掉一个键。

---

## 3. 项目结构

```
biliplay/
├── manifest.json           # MV3 清单；两个内容脚本（隔离世界 + 主世界）
├── icons/icon.svg          # 图标（Firefox 支持 SVG 图标）
├── tests/                  # 冒烟测试（Marionette + 真实 Firefox）
│   ├── run.sh              # 起临时 Firefox 跑一遍，跑完自动关
│   └── validate.py         # 注入脚本 + 断言报告
└── src/
    ├── page-bridge.js      # ★ 运行在页面主世界，读 __INITIAL_STATE__ 取视频 id
    ├── bridge-client.js    # ★ 隔离世界侧，接主世界传来的 id
    ├── common.js           # 公共层：设置 / 按键归一化 / DOM 与接口定位
    ├── toast.js            # 页面内轻提示
    ├── toast.css
    ├── content.js          # 核心：键盘监听 + 各动作实现（含默认未绑定的互动功能）
    ├── options.html/.css/.js   # 设置页（自定义按键、倍速步进等）
    └── popup.html/.css/.js     # 工具栏弹窗（总开关、倍速快捷）
```

`common.js` 被 content script、设置页、弹窗三处共同加载，向 `globalThis.BiliPlay` 挂载 API。

---

## 4. 工作原理（几个关键设计点）

### 4.1 用内容脚本直接监听键盘，而不是 `commands` API

`commands` 只能在 manifest 里声明少数几个快捷键，改键要用户去 `about:addons` 手动设置。
要支持「任意按键 + 页面内自定义」，直接用内容脚本的 `keydown` 最灵活。

监听挂在 **捕获阶段**（`addEventListener('keydown', fn, true)`），并且
`run_at: "document_start"`，这样能**抢在 B 站自己的键盘处理之前**拿到事件，
必要时 `preventDefault()` + `stopPropagation()` 吃掉它。

### 4.2 页面桥：绕过「隔离世界」的限制

内容脚本运行在**隔离世界**，**读不到页面自己的 `window.__INITIAL_STATE__`**。
而 B 站把当前视频信息全放在里面。解决办法是加一个运行在**页面主世界**的脚本：

```
page-bridge.js (MAIN world)              桥                    content.js (隔离世界)
  读 __INITIAL_STATE__  ──►  window.postMessage({__biliplay__, type:'ids'})  ──►  缓存 id
  监听 type:'request'          ◄── window.postMessage({type:'request'})  ◄──  操作前主动要一次
```

manifest 里对应的是第二个 `content_scripts` 条目，带 `"world": "MAIN"`（**Firefox 128+**）。
这一步让 **番剧页、合集、稍后再看、列表页** 也能拿到正确的 `bvid / aid / ep_id / season_id`，
而不再只靠 URL 里有没有 `BV...`。

`postMessage` 是唯一能跨世界传数据的通道，所以用它而不是 `CustomEvent.detail`
（Firefox 里页面的 `event.detail` 在隔离世界取不到，除非用 `cloneInto`）。

### 4.3 互动功能有两种实现，可切换（**默认未绑定**）

> 点赞 / 投币 / 收藏 / 三连在 B 站官方播放器上已有快捷键，所以本扩展**默认不绑定**它们。
> 想启用请按第 6 节取消注释；启用之后，设置页才会出现下面这个选项。

设置里的「点赞/投币/收藏的实现方式」有两档：

| 模式 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| `api`（默认） | 调 B 站 Web API | 确定、不依赖 DOM | 页面按钮不会立刻变红 |
| `dom` | 模拟点击页面按钮 | 页面 UI 立刻刷新 | 依赖随时会变的选择器 |

`dom` 模式下，投币/收藏点完按钮后还会尝试点弹层里的确认按钮；
找不到确认按钮时会提示你手动确认。任何一步找不到按钮，都会**自动退回 API 模式**。

### 4.4 API 一览（对应上面那些默认未绑定的互动功能）

| 操作 | 接口 |
| --- | --- |
| 是否已赞 | `GET /x/web-interface/archive/has/like` |
| 点赞 / 取消 | `POST /x/web-interface/archive/like`（`like=1/2`） |
| 投币 | `POST /x/web-interface/coin/add` |
| 是否已收藏（普通视频） | `GET /x/v2/fav/video/favoured` |
| 是否已收藏（番剧） | `GET /pgc/view/web/season` → `result.user_status` |
| 收藏 / 取消 | `POST /x/v3/fav/resource/deal`（视频 `type=2`，番剧 `type=21`） |
| 一键三连 | `POST /x/web-interface/archive/like/triple` |
| bvid → aid | `GET /x/web-interface/view` |

`csrf` 取自 `bili_jct` Cookie（B 站前端也是这么读的，所以它不是 HttpOnly）。

### 4.5 字幕 / 倍速 / 其他播放器功能

- 倍速（<kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>）：拿到 `<video>` 直接设 `video.playbackRate`
- 逐帧（<kbd>,</kbd> / <kbd>.</kbd>）：先 `pause()`，再按 `1 / frameRate` 挪 `currentTime`；
  浏览器不暴露真实帧率，所以步长取自设置
- 截图 / 画中画：操作 `<video>`、`<canvas>` 或 `document.pictureInPictureElement`
- 宽屏 / 网页全屏：点击播放器控件（弹幕开关同理，但默认未绑定）
- 播放暂停 / 快进快退：操作 `<video>`（默认未绑定，B 站已有 <kbd>空格</kbd> 和 <kbd>←</kbd> <kbd>→</kbd>）
- 字幕：操作播放器 DOM
  - 字幕按钮 `.bpx-player-ctrl-subtitle`
  - 语言项 `.bpx-player-ctrl-subtitle-language-item[data-lan]`（中文 `ai-zh` / `zh-CN`）
  - 关闭开关 `.bpx-player-ctrl-subtitle-close-switch`
  - 番剧播放器退回 `.squirtle-subtitle-wrap > button`

### 4.6 轻提示（toast）在全屏下得「搬家」

第一版把提示节点挂在 `<body>` 上。非全屏一切正常，但**真·全屏时浏览器只渲染全屏元素
及其子树**，挂在 `body` 上的节点会被整个忽略——于是全屏里按 <kbd>=</kbd> 画面毫无反馈，
看着像没生效。

修法是让提示跟着全屏元素走：

```js
function host() {
  const fs = document.fullscreenElement;
  // <video> 自身全屏时它的子节点不会被渲染，那种情况退回 body 尽力而为
  if (fs && fs.tagName !== 'VIDEO') return fs;
  return document.body || document.documentElement;
}
```

- 每次弹提示前都问一次 `host()`，不在里面就 `appendChild` 搬过去
  （对已有节点调用 `appendChild` 等价于移动）；
- 另外监听 `fullscreenchange`，进出全屏时立刻搬一次，
  免得「淡出动画还没结束就进了全屏」把提示留在不可见的那一层里。

（B 站的「网页全屏」不是真全屏，`document.fullscreenElement` 为 `null`，
此时仍挂在 `body` 上就能看见，不用特殊处理。）

### 4.7 「关灯」被 B 站藏起来了，得先把面板点开

别的功能都是「找到按钮 → `click()`」，关灯是个例外：**新版 B 站把它从控制栏挪进了
「设置」面板，而且是个复选框**（社区 user script 也是因为这个才专门去"把它揪出来"）。
所以 `toggleLightsOff()` 分两步：

```js
let input = lightOffCheckbox();
if (!input || input.offsetParent === null) {   // 面板没展开
  const gear = queryFirst(CTRL.setting) || findButtonByText(['设置']);
  gear.click();                                 // 先展开设置面板
  await sleep(150);                             // 等展开动画
  input = lightOffCheckbox();
}
input.click();
```

两个容易踩的点：

- `offsetParent === null` 用来判断「在 DOM 里但不可见」。面板收起时复选框往往**还在 DOM 里**
  （只是 `display:none`），这时直接 `click()` 不一定算数，所以得先把它点出来；
  反过来面板已经开着时元素可见，就**不能**再点齿轮——那会把面板关掉。
- 控制栏上直接有关灯按钮的老版本仍走快路（`CTRL.lightsOff`）。

顺带一提，所有"找按钮"的地方现在都多了一层兜底：

```js
findButtonByText(['关灯', '开灯'])   // 扫 aria-label / title / 文案
```

class 名会随改版变，中文按钮名一般不变，所以这是最后一道保险。
`findButtonByText()` 还带一个 `exclude` 参数：找「全屏」时要排除「**网页**全屏」——
否则按全屏键可能点到隔壁那颗按钮上。

---

## 5. 已做的验证

开发时用 Firefox 的 **Marionette 协议**把脚本真实加载到页面里跑了一遍（本地起 http 服务 +
mock `fetch`）。测试脚本已经收进项目，可以直接跑：

```bash
tests/run.sh          # 起一个临时 headless Firefox，跑完自动关
tests/run.sh --json   # 拿原始结果排查
```

当前 **39 项断言全部通过**：

- 七个脚本（含 `options.js` / `popup.js`）语法全部通过；
- **默认动作表**恰好是 11 个，且每个动作都有默认键（不多不少、没有漏配）；
- 按键归一化：<kbd>=</kbd> → `=`、<kbd>-</kbd> → `-`、`Ctrl+Shift+P` → `ctrl+shift+p`、方向键 → `arrowup`；
- 展示文本：`=` → `=`、`-` → `-`、`+` → `+`、`ctrl+shift+p` → `Ctrl + Shift + P`；
- 倍速 <kbd>=</kbd> → 1.25、连按两次 → 1.5、<kbd>-</kbd> → 1.25、<kbd>0</kbd> → 1.0；
- **逐帧**：假装正在播放 → <kbd>.</kbd> 会先暂停再前进 1/30 秒，<kbd>,</kbd> 回到原处；
  把 `frameRate` 改成 24 后步长变成 1/24；
- **关灯**：面板收起时先点「设置」再点复选框（齿轮 1 次、复选框 1 次）；
  面板已展开时不碰齿轮（齿轮仍是 1 次、复选框 2 次）；
- 宽屏 / 网页全屏 / 全屏 按钮各点击 1 次；
- **重复绑定检测**：默认键 0 冲突；把两个动作绑到同一颗键后能算出双方；
- **文案兜底查找**：只剩一个文案为「网页全屏」的按钮时，按全屏键不会误点它，而是提示找不到
  （`exclude` 参数排掉了「网页」）；
- 焦点在输入框（弹幕/评论）时**不触发**；
- **全屏 toast**：非全屏时挂在 `body`；模拟进入全屏后自动搬进全屏元素，
  全屏中弹出的提示也在全屏元素内；退出全屏后搬回 `body`；
  把 `fullscreenElement` 设成 `<video>` 时退回 `body` 且不抛错；
- **页面桥**：URL 里只有 `bvid` 时，仍从 `__INITIAL_STATE__` 补齐了 `aid/cid/mid`；
  切到番剧状态后正确拿到 `epId / seasonId`；
- 然后再**把默认未绑定的 9 个功能临时加回去**，证明保留的代码没烂：
  - 点赞：`GET has/like` → `POST like`（`bvid=...&like=1&csrf=...`）；三连：`POST like/triple`；
  - 收藏（普通视频）：`rid=111&type=2`，已收藏时 `del_media_ids=999,888`；
  - 收藏（番剧）：`rid=777&type=21`；（番剧互动接口**未在真机登录态下验证**，见第 7 节）
  - 播放暂停、快进 10→15、快退 15→10、弹幕按钮各 1 次；
  - 未登录（无 `bili_jct`）时不发请求，只提示；
  - **DOM 模式**：点击了页面 `.video-like` 按钮，且**没有**发出任何 API 请求。

### 顺手修掉的一个坑：`+` 和拼接符撞车

归一化后的按键串是用 `+` 拼起来的（`ctrl+shift+p`）。设置页允许把 <kbd>+</kbd> 录成快捷键
（倍速键一度也真的就是 <kbd>+</kbd>），这时 `prettyKey()` 里的 `split('+')` 会把 `'+'`
切成两个空串，界面上就显示成「 + 」。
现在 `prettyKey()` 会把空段还原成字面量 `+`，`Ctrl` + <kbd>+</kbd> 这类组合也能正常显示。

---

## 6. 改功能 / 加功能

### 6.1 启用默认未绑定的功能

点赞、投币、收藏、三连、播放暂停、快进快退、弹幕、全屏——实现全都在，
只差两处注释。在 `common.js` 里把**同名条目**的注释各取消一处：

```js
const ACTIONS = [
  { id: 'subtitle', /* ... */ },
  // ...
  // { id: 'like', label: '点赞 / 取消点赞', icon: '👍', group: '互动' },   // ← 取消注释
];

const DEFAULT_KEYS = {
  // ...
  // like: 'z',                                                            // ← 取消注释
};
```

设置页和弹窗会自动多出这一行（界面按 `ACTIONS` 渲染，不用改 HTML）。
想换键直接在设置页录一个新键即可。

> 注意：`点赞/投币/收藏的实现方式`、`每次投币枚数`、`快进/快退秒数` 这几项设置
> 也只对上面的功能有意义，所以同样被注释掉了，在 `options.html` 里一起恢复。

### 6.2 加一个全新的功能

以「静音」为例（B 站官方有 <kbd>M</kbd>，所以这里只用来演示流程）：

1. `common.js` 的 `DEFAULT_KEYS` 与 `ACTIONS` 各加一条：
   ```js
   // DEFAULT_KEYS
   mute: 'm',
   // ACTIONS
   { id: 'mute', label: '静音 / 取消静音', icon: '🔇', group: '播放器' },
   ```
2. `content.js` 写实现并挂到 `RUN`：
   ```js
   function toggleMute() {
     const video = requireVideo();
     if (!video) return;
     video.muted = !video.muted;
     B.toast(video.muted ? '已静音' : '已取消静音', 'ok');
   }
   const RUN = { /* ... */ mute: toggleMute };
   ```

设置页和弹窗会自动多出这一行——它们是根据 `ACTIONS` 渲染的，不用改。

---

## 7. 已知限制

- **番剧的点赞/投币/收藏走的是「尽力而为」的接口组合**（用当集的 `aid` 调 archive 接口、
  收藏用 `season_id` + `type=21`）。开发环境没有 B 站登录态，**这部分没有做过真机验证**。
  如果报错，改 `content.js` 里 `toggleLike / addCoin / toggleFav` 的分流逻辑即可
  （或先把模式切成 `dom` 用点击方式绕开）。这几项**默认未绑定**（B 站官方有
  <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd>），所以默认不会被触发到。
- **`api` 模式下点赞后按钮不立即变红**（默认未绑定）：接口改的是服务端状态，
  工具栏 DOM 不会自动刷新。`syncLikeUi()` 会尽力同步，找不到按钮就静默忽略。
  想要 UI 即时刷新就切到 `dom` 模式。
- **字幕 / DOM 模式的选择器**依赖播放器结构，B 站改版可能失效——坏了改 `content.js`
  顶部那几个常量即可。
- **「关灯」最脆弱**：它藏在设置面板里的复选框，选择器是社区脚本里扒来的
  （`.bpx-player-ctrl-setting-checkbox.bpx-player-ctrl-setting-lightoff input`），
  而且**没有真机验证过**——开发环境打不开 B 站播放器。失效时按 4.7 的思路
  补 `LIGHT_OFF_SWITCH` 里的选择器即可，`findButtonByText()` 还能兜一层。
- **重复绑定不会自动拦**：只会标黄提示（见第 2 节），不会阻止你保存。
  真撞上了就改其中一个。
- **逐帧是估算的**：浏览器不暴露真实帧率，步长按设置里的 `1 / frameRate` 算。
  默认 30；24fps 的番剧要手动改成 24，否则偶尔会跳 0 帧或 2 帧。
- **截图**：B 站视频多在跨域 CDN 上。优先用 `ImageCapture.grabFrame()` 绕开 canvas 污染；
  若浏览器不支持，会提示「视频被跨域保护」。
- 只匹配 `www.bilibili.com`；未处理 `m.bilibili.com`（移动端）。

---

## 8. 打包 / 长期安装

```bash
web-ext lint                      # 先过一遍校验
web-ext build -o --ignore-files "tests/**"   # 生成 dist/*.zip（不打进测试）
```

要长期安装有两种方式：

1. **Firefox 开发者版 / Nightly / ESR**：`about:config` 把 `xpinstall.signatures.required`
   设为 `false`，即可安装未签名的 `.xpi`（把 zip 改后缀）。
2. **正式版**：必须提交到 [addons.mozilla.org](https://addons.mozilla.org/developers/)
   签名后才能安装。用 `web-ext sign --api-key ... --api-secret ...` 可直接签名发布。

`browser_specific_settings.gecko.id` 已经填成本项目的固定 ID（用的是作者邮箱，
AMO 要求的格式就是「像邮箱的字符串」；这个值一旦签名发布就**不能再改**了）。

---

## 9. 后续可以做的方向

1. **进页面自动设置**：自动开字幕 / 自动应用倍速（`rememberSpeed` 已经能用，扩成开关即可）。
2. **走签名流程上架**（第 8 节）。
3. **把 `dom` 模式做得更稳**：为投币/收藏弹层的确认按钮补齐各版本选择器。
4. **可移植到 Chrome**：`page-bridge.js` 的 `world: "MAIN"` 在 Chrome 111+ 同样支持，
   另外可在 `manifest.json` 加 `background.service_worker` 做成双浏览器通用（本扩展
   目前没有后台脚本，基本零改动）。

（关注 UP 主、上/下一集、静音官方已有 <kbd>G</kbd>、<kbd>[</kbd> <kbd>]</kbd>、
<kbd>M</kbd>，按「不重复造键」的原则不做。）
