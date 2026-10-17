# 发布流程（AMO）

本扩展发布在 [addons.mozilla.org](https://addons.mozilla.org)（AMO）公开列表。
下面分三段：**首次上架要做的准备**、**每次发版的固定动作**、**上架之后的维护**。

---

## 0. 一次性准备

1. 注册 [Mozilla 账号](https://accounts.firefox.com/)（就是登录 Firefox 那个），
   然后在 [AMO](https://addons.mozilla.org) 右上角 **Log in** 登录一次，
   Mozilla 会把账号和 AMO 关联起来。
2. 确认 `manifest.json` 里这两项没问题，**签过名之后就再也改不了了**：
   - `browser_specific_settings.gecko.id` —— 现在是 `guanyuchen.cs@gmail.com`
   - `name` —— 现在是 `BiliPlay — 哔哩哔哩播放器快捷键`
3. 准备列表页素材（`store/` 目录）：
   - `icon-512.png` —— 列表页图标，Mozilla 建议 512×512
   - 截图（可选但**强烈建议**，没有截图的扩展转化率差很多）
4. 确认 [`PRIVACY.md`](PRIVACY.md) 的内容和代码实际行为一致。
   这是 Mozilla 的硬要求：**隐私政策里写的、manifest 里声明的、代码真正做的，三者必须一致。**

---

## 1. 每次发版的固定动作

```bash
# 1) 改版本号（见下方「版本号规则」）
$EDITOR manifest.json

# 2) 更新 README 里的变更说明 / 已知限制

# 3) 打包（只用 python3，不需要 node）
tools/build.sh                      # → dist/biliplay-<版本>.zip

# 4) 打包体检：结构 + 让 Firefox 真实装载一遍
python3 tests/check-package.py

# 5) 功能回归
tests/run.sh
```

第 4 步会真的起一个 headless Firefox 把 zip 装进去，
所以「manifest 里某个字段被当成保留属性拒收」这种情况在上传 AMO 之前就能发现。

### 版本号规则

- AMO **不允许重复使用版本号**，也不允许把新版本号改成比线上更低的。
  已经上传过的 `0.1.0` 就永远属于那一次提交，改完代码要发新版必须提升。
- 格式是 1~4 段数字，如 `0.1.1` / `0.2.0` / `1.0.0`。别用 `-beta` 这种后缀
  （AMO 不接受）。

---

## 2. 提交到 AMO

1. 进 [开发者后台](https://addons.mozilla.org/developers/) → **Submit a New Add-on**。
2. 选 **On this site**（上架 AMO，用户能搜到）。
3. 上传 `dist/biliplay-<版本>.zip`。**不要上传整个项目目录的 zip** ——
   里面会带上 `tests/`、`.git` 之类的东西；用 `tools/build.sh` 出的包。
4. 看校验结果：
   - 有 **error** → 不能继续，按提示改了重来；
   - 只有 **warning** → 可以继续，但安全/隐私相关的警告**优先处理**，
     它们很可能导致人工审核不通过。
5. 选兼容平台：**Firefox for Desktop**（本扩展只处理桌面版；
   `strict_min_version` 是 140）。
6. 问是否要提交源码包 → 选 **否**。本扩展是纯手写 JS，
   没有压缩/混淆/构建步骤，压缩包里就是可读源码。
7. 填列表页（Listing）信息 —— **文案已经写好了，见 [`store/listing.md`](store/listing.md)**，
   直接复制粘贴：
   - **名称 / 简介 / 详细描述**：名称、250 字符上限的简介、详细描述都在里面
   - **分类**：建议 `Photos, Music & Videos`
   - **标签**：里面列了一组关键词，有助于被搜到
   - **许可证**：选 MPL-2.0（和仓库里的 `LICENSE` 一致）
   - **隐私政策**：贴 [`PRIVACY.md`](PRIVACY.md) 的内容，或托管成公开 URL
   - **审核员备注**：`store/listing.md` 最后一节针对 host 权限和读 Cookie
     做了说明，**粘贴进去能省掉一轮来回**
   - **支持邮箱 / 主页**：填一个你愿意公开的
8. 提交时选 **self-reviewed（自己审核）** 通道 —— 新扩展默认走这条，
   审核通常几小时到几天。
9. 审核通过后扩展就上线了。注意首次提交后还会有一轮**人工复核**，
   期间可能被要求补充说明。

### 如果被要求补充说明

审核员常问的两类问题，本扩展的答案：

- **为什么要 `*://*.bilibili.com/*` 这个 host 权限？**
  → 需要在 B 站视频页注入键盘监听，并按用户按键调用 B 站自己的接口
  （`api.bilibili.com`）。扩展不访问该域名之外的任何站点。
- **为什么读取 Cookie？**
  → 只读 `bili_jct`（CSRF token）和 `DedeUserID`，用于调用 B 站自己的
  点赞/投币/收藏接口；这些动作**默认没有绑定按键**，且 Cookie 不离开
  `bilibili.com`，不发送给任何第三方或开发者。

更好的做法是**别等他们问**：`store/listing.md` 最后一节已经把这些答案写成
英文的「审核员备注」，提交时直接贴进 **Notes for Reviewers** 字段，
通常就能省掉这一轮来回。

---

## 3. 上架之后

### 发新版本

重复第 1 节的 5 步，然后在
[开发者后台](https://addons.mozilla.org/developers/) 找到本扩展 →
**Upload New Version** → 上传新 zip。老用户会自动更新。

### 用命令行签名 / 上传（可选）

装了 node 之后可以用 `web-ext`。先去
[AMO API 密钥页](https://addons.mozilla.org/developers/addon/api/key/)
生成一对 key：

```bash
npx web-ext sign \
  --api-key    "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET" \
  --channel listed \
  --source-dir .
```

`--channel listed` 是「上传到 AMO 走正常审核」，会得到签名后的 `.xpi`；
`--channel unlisted` 是「只签名、不上架」，用来自己分发。
**别漏掉 `--channel`** —— 漏了会默认按 `listed` 走。

> 密钥是账号级的凭据，别提交进仓库。建议放 `~/.web-ext-config.js`
> 或环境变量里。
