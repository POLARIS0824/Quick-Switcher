# AltQ Tab Switcher

一个零依赖的 Chrome MV3 扩展：按 `Alt+Q` 弹出横向卡片式的"最近使用标签"切换器（带页面缩略图），
按住 `Alt` 连按 `Q` 跳选，松开 `Alt` 提交切换。**面板内完全禁用鼠标交互**（hover / click /
点击外部关闭 / 滚轮一律无效），从 Lumno 扩展的 Alt+Q 标签切换器抽取而来，纯 vanilla JS，
无构建工具链、无 node_modules，加载解压目录即可运行。

## 安装

1. 打开 `chrome://extensions`，右上角开启"开发者模式"。
2. 点击"加载已解压的扩展程序"，选择本目录（`D:\Code\QuickSwitch`）。
3. 确认 `chrome://extensions/shortcuts` 中 `show-tab-switcher` 已绑定 `Alt+Q`
   （manifest 已给出默认建议键，一般无需手动设置）。

## 键盘操作

| 按键 | 行为 |
|---|---|
| `Alt+Q` | 打开面板并高亮下一个最近使用标签（首次触发键前进已被抑制） |
| 按住 `Alt` 连按 `Q`，或 `→` / `↓` / `Tab` | 选中 +1（循环） |
| `←` / `↑` / `Shift+Tab` | 选中 -1（循环） |
| 松开 `Alt`（keyup） | 提交切换到当前选中标签 |
| `Enter` | 提交切换 |
| `Escape` | 关闭面板，不切换 |

无数字键跳选、无滚轮、无右键菜单。快捷键运行时通过 `chrome.commands.getAll` 实读并解析
（复用 `background/recent-tab-switcher.js` 的三个解析函数），在
`chrome://extensions/shortcuts` 改键后自动适应。

## 全场景行为

- **普通网页 / file:// 页面**（http/https/file）：动态 `chrome.scripting.executeScript` 注入
  `key-observer.js` 与 `panel.js`，面板显示在当前页。
- **本扩展自己的页面**（options 页）：静态引入 `panel.js` + `page-bridge.js`，后台通过
  `'lumno-tab-switcher-extension-page'` long-lived port 通信（断线 1 秒重连）。
- **不可注入页面**（`chrome://`、Web Store、浏览器默认新标签页）：无法显示面板也无法检测
  Alt 释放，按 `Alt+Q` 直接**盲切**到 MRU 下一个标签（类似 macOS `Alt+`` 切窗口）。

## 架构

```
QuickSwitch/
├── manifest.json            # MV3；经典（非 module）background service worker
├── background/
│   ├── main.js              # 命令入口 + 注入编排 + advance/commit 协议 + tab/window 事件源
│   ├── recent-tab-switcher.js  # MRU tracker（从 Lumno 整体复制，零依赖 UMD）
│   └── thumbnails.js        # 截图管线：captureVisibleTab → 320×200 WebP → 2h 缓存
├── content/
│   ├── key-observer.js      # keyup 观察器（含 5 秒缓冲重放，处理极快点按竞态）
│   └── panel.js             # 面板控制器 + vanilla 卡片视图（纯键盘化）+ 抑制状态机
├── pages/
│   ├── options.html/.js     # 极简设置页（启用开关）
│   └── page-bridge.js       # 扩展页 port 桥
└── test/                    # node:test 单元测试
```

关键机制（均照搬 Lumno 语义）：

- **打开链路**：`onCommand` → 注入 key-observer（先于一切异步工作，保证快速松开 Alt 不丢）→
  若面板已开则发 `advanceOpenTabSwitcherFromCommand` → 否则 2000ms 防重入 guard →
  并行取 [状态懒加载 + `tabs.query` + `chrome.commands.getAll`] → 记录当前标签 →
  选宿主注入 panel.js → 打开成功后向同窗口全部标签发
  `armTabSwitcherShortcutRelease{keys:['Alt'], commandStartedAt}`。
- **提交链路**：页面 keyup 检测到 Alt 释放 → `notifyTabSwitcherShortcutModifierReleased` →
  后台校验释放键与快捷键修饰键一致 → 定位宿主标签 → `commitOpenTabSwitcherFromShortcutRelease`
  → 面板提交选中项（面板自身的 keyup 处理器也会直接提交，双路径幂等）。
- **keyup 竞态兜底**：observer 持续记录最近 5 秒的 trusted keydown/keyup；armed 指令到达时
  若发现 Alt 已在 `commandStartedAt` 前后释放过，立即补发提交通知。
- **SW 生命周期**：tracker 状态（stack + 缩略图）存 `chrome.storage.session`（不可用回退
  `local`），懒加载 + dirty-before-load 合并 + 350ms 防抖写回，service worker 被杀后状态不丢。
- **缩略图管线**：`captureVisibleTab`(JPEG q=42) → OffscreenCanvas 居中裁剪 320×200 →
  WebP q=0.68 → base64 入 tracker；优先项延迟 90ms / 普通 220ms，全局节流 650ms，串行链执行；
  捕获前把已开面板 `visibility:hidden`（等待 48ms）避免面板被截进缩略图；command 触发的即时
  捕获成功后立刻推送 `updateTabSwitcherThumbnail` 刷新已开面板。
- **纯键盘化**：卡片无任何 pointer/focus/click 处理器；宿主 div 与面板内所有元素
  `pointer-events: none`（CSS 双保险）；Alt 释放提交直接调用 `switchToSelected()`，
  不再合成 `click()`；键盘处理只响应 `isTrusted` 事件，window 级 capture 注册。
- **缩放补偿**：`chrome.tabs.getZoom` × `visualViewport.scale` 反向缩放面板，标签缩放
  ≠100% 的页面面板不错位、不错焦。
- **明暗主题**：页面主题嗅探（data-* 属性 / class / 背景 luminance / YouTube `ytd-app[dark]`
  特判 / meta theme-color / color-scheme）+ `prefers-color-scheme` 兜底，MutationObserver
  跟随页面动态换肤。面板文案中英双语硬编码，按 `navigator.language` 切换。

存储键（扩展间天然隔离）：sync 区 `enabled`（默认 `true`）；session 区 `state`
（tracker 序列化：stack + thumbnails）。

消息名与 Lumno 保持一致便于对照：`openTabSwitcherFromCommand`、
`advanceOpenTabSwitcherFromCommand`、`commitOpenTabSwitcherFromShortcutRelease`、
`notifyTabSwitcherShortcutModifierReleased`、`armTabSwitcherShortcutRelease`、
`updateTabSwitcherThumbnail`、`switchToTab`、`reportTabVisible`。

## 开发与测试

```bash
node --check background/main.js background/recent-tab-switcher.js background/thumbnails.js content/panel.js content/key-observer.js pages/page-bridge.js pages/options.js
node --test
```

测试覆盖：tracker 排序/去重/上限、`exportState`/`hydrateState` round-trip（含 merge 与 TTL）、
快捷键三解析函数（含 mac symbol 快捷键）、`suppressInitialShortcutAdvance` 状态机、
`focusWindowAndActivateTab` 的 chrome API stub 行为。

## 手动 QA 清单

1. 普通网页 `Alt+Q` → 面板出现并高亮次近标签；连按 `Q` 前进；松开 `Alt` 切换。
2. 鼠标在面板上移动/点击/滚轮 → **无任何反应**（选中不变、不切换、不关闭）。
3. `Escape` 关闭不切换；`Enter` 切换；`←`/`→`/`Tab`/`Shift+Tab` 移动正确且循环。
4. 极速点按 `Alt+Q`（<100ms）→ 仍正确切换（keyup 竞态兜底生效）。
5. 挂机 30s（SW 休眠）后再用 → MRU 顺序与缩略图不丢。
6. `chrome://settings` 按 `Alt+Q` → 盲切一步（直接切到 MRU 下一个标签，无面板）。
7. 在本扩展 options 页按 `Alt+Q` → 面板经 port 桥显示。
8. 暗色/亮色页面主题正确跟随；标签缩放 ≠100% 的页面面板不错位。

## 与 Lumno 共存

若同时安装 Lumno，两者都注册 `Alt+Q` 会冲突（Chrome 只会触发其中一个）。请在
`chrome://extensions/shortcuts` 中改掉其中一个的快捷键。QuickSwitch 运行时会实读
`chrome.commands.getAll`，改键后无需重启即可适应。
