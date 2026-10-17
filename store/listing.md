# AMO 列表页文案

提交到 [addons.mozilla.org](https://addons.mozilla.org/developers/) 时，把这里的内容贴进对应字段。
AMO 的 Markdown 是**受限子集**：只支持粗体、斜体、等宽、链接、列表、引用、代码块，
**不支持标题（`#`）和表格**，所以下面刻意只用列表和粗体。

---

## Name（名称）

> BiliPlay — 哔哩哔哩播放器快捷键

⚠️ 这个名字和 manifest 里的 `name` 一致。**签名发布后不能再改**。

---

## Summary（简介，上限 250 字符）

> 给 B 站网页播放器补上官方没有的 11 个快捷键：字幕开关、倍速增减、逐帧、关灯、网页全屏、截图、画中画，全部可以自己改键。刻意只补官方没绑的键，不与官方快捷键打架；不收集任何数据。

---

## Description（详细描述）

**B 站官方播放器有快捷键，但缺的那几个恰恰很常用**：想关字幕、想微调倍速、
想逐帧看一个动作、想关灯，都得去摸鼠标。BiliPlay 把这 11 个功能补成键盘操作。

**默认按键**

- **字幕 开 / 关** — `V`（自动挑中文轨，再按一次关掉）
- **加快倍速** — `=`
- **减慢倍速** — `-`
- **恢复 1x** — `0`
- **上一帧** — `,`
- **下一帧** — `.`
- **宽屏模式** — `T`
- **网页全屏** — `I`
- **关灯 / 开灯** — `L`
- **截图** — `S`（存成 PNG）
- **画中画** — `P`

**按键全部可以自己改**

右键扩展图标 →「管理扩展」→「首选项」，点一下按钮再按下你想绑的键就行。
两个动作不小心绑到同一个键时，设置页会把冲突的行标黄提示出来，
不会让它悄悄吃掉一个键。

**刻意「不重复造键」**

B 站官方播放器已经占了空格（播放暂停）、左右方向键（快进快退）、
`Q` `W` `E`（点赞 / 投币 / 收藏）、`D`（弹幕）、`F`（全屏）……
BiliPlay **不再重复绑定**这些键，只补官方没有的。
所以按下去的结果永远是确定的，不会出现「两个功能抢一个键、其中一个静默失效」。

**几个打磨过的细节**

- 倍速用 `=` / `-`，单手就能按，不用像 `+` 那样按住 Shift
- 逐帧会先自动暂停再挪一帧，步长可在设置里按 24 / 30 / 60 fps 调
  （看 24fps 的番剧时改成 24 更准）
- 真·全屏时，屏幕上的轻提示也会跟着搬进全屏层，不会「按了没反应」

**适用范围**

`www.bilibili.com` 的普通视频页、合集 / 列表、番剧、课程、稍后再看页面。
需要 **Firefox 140 或更高版本**。

**权限说明**

- `*://*.bilibili.com/*` — 在视频页注入键盘监听，并调用 B 站自己的接口
- `storage` — 保存你的快捷键设置

**不收集、不上传任何数据。** 没有后台脚本、没有统计、没有广告；
所有请求只发往 bilibili.com 自己，不经过任何第三方。

---

## 其他字段

**分类（Category）**

> Photos, Music & Videos

**标签（Tags）**

> 哔哩哔哩, bilibili, 快捷键, 键盘, 播放器, 倍速, 字幕, 画中画, 截图, 网页全屏, keyboard shortcuts

**隐私政策**

勾选「This add-on has a privacy policy」，然后把仓库里 [`../PRIVACY.md`](../PRIVACY.md)
的内容贴进去（或托管成公开 URL 后填链接）。

---

## Notes for Reviewers（审核员备注）

> The code is hand-written JavaScript — no minification, no obfuscation, no build step.
> The uploaded package contains the complete readable source, so no separate source
> package is needed.
>
> **What it does:** the extension listens for `keydown` in the capture phase on Bilibili
> video pages and implements shortcuts the official player does not provide. Every
> shortcut is user-customizable from the options page.
>
> **Why the `*://*.bilibili.com/*` host permission:** to inject the content script on
> `www.bilibili.com` video / bangumi / cheese / watch-later pages, and to call Bilibili's
> own Web API (`api.bilibili.com`) when the user presses a shortcut. The extension never
> touches any host outside this domain.
>
> **Why `storage`:** to persist the user's key bindings (`storage.sync`).
>
> **Cookies:** on a logged-in Bilibili page the extension reads `bili_jct` (CSRF token)
> and `DedeUserID` to call Bilibili's own write endpoints. Those requests go directly to
> `api.bilibili.com` and are never sent to any third party or to the developer.
>
> **Note:** the implementations for like / coin / favorite / triple are present in the
> source but are **not bound to any key by default**, so a default installation never
> issues a write request.
>
> **Data collection:** none. Declared in the manifest as
> `data_collection_permissions.required = ["none"]`.
>
> **How to test:** install, open any `www.bilibili.com/video/...` page, and press
> `V` `=` `-` `0` `,` `.` `T` `I` `L` `S` `P`. A small toast appears in the corner for
> each. No login is required to test everything except the (unbound) like/coin/favorite
> actions.
