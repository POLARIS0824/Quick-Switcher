# QuickSwitcher

零依赖的 Chrome MV3 标签切换扩展：按 `Alt+Q` 弹出最近使用标签的卡片面板（带页面实时缩略图），按住 `Alt` 连按 `Q` 跳选，松开 `Alt` 提交切换，也可直接点击卡片直达目标标签。鼠标悬停不会改变键盘选取，右键卡片可直接关闭对应标签。

本项目受 [Lumno](https://github.com/kubai087/lumno-extension) 启发：其 Alt+Q 标签切换器是本项目的直接来源——MRU tracker（`background/recent-tab-switcher.js`）为整体复制，keyup 观察器、缩略图截图管线、面板样式与主题嗅探等实现亦提取或参考自 Lumno 源码，并在其基础上做了纯键盘化改造与简化。感谢 [kubai087](https://github.com/kubai087) 的开源工作。

## 安装

1. 打开 `chrome://extensions`，开启右上角**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择本目录。
3. 可选：在 `chrome://extensions/shortcuts` 确认 `Alt+Q` 已绑定。

## 操作

| 操作 | 行为 |
|---|---|
| `Alt+Q` | 打开面板，高亮次近使用的标签 |
| 按住 `Alt` 连按 `Q`，或 `→` / `↓` / `Tab` | 选中 +1（循环） |
| `←` / `↑` / `Shift+Tab` | 选中 -1（循环） |
| 松开 `Alt`，或 `Enter` | 切换到选中标签 |
| 鼠标点击卡片 | 直接切换到该标签（悬停不影响键盘选取） |
| 右键点击卡片 | 关闭该标签（面板保持打开，可连续清理） |
| `Delete` / `Backspace` | 关闭选中的标签（面板保持打开） |
| `Escape` | 关闭面板，不切换 |

关闭面板上误关的标签可用浏览器原生的 `Ctrl+Shift+T` 撤销；面板内清到只剩最后一张卡片后再关，面板会随之关闭。

普通网页正常显示面板；本扩展自身页面经 port 桥显示面板。`chrome://`、Web Store、浏览器默认新标签页等无法注入的页面上有两种可选方案（点击扩展图标设置）：默认**弹窗面板**——原标签保持不动，面板在迷你弹窗中打开，`Escape` 取消后回到原页面；或**借用相邻标签**——切到相邻的最近标签、面板显示在那里（与 Lumno 行为一致）。弹窗不可用时自动退化为借用相邻标签，仅当最近列表里也没有可宿主标签时才盲切一步（直接切换，无面板）。视频全屏时页面内面板会被全屏元素遮挡，同样自动改用弹窗显示——全屏视频继续播放，取消后原地继续观看。

## 说明

- 快捷键运行时实读 `chrome.commands.getAll`，在 shortcuts 页改键后自动适应；若与 Lumno 共存，两者都注册 `Alt+Q` 会冲突，需改掉其中一个。
- favicon 依次取 `tab.favIconUrl` → 本扩展 `_favicon` 服务 → gstatic；渲染时图标加载失败会先按页面 URL 改用 `_favicon` 服务重试一次，仍失败才显示 `assets/placeholder.svg` 占位图标（换成自己的图标直接替换该文件即可）。
- 设置（点击扩展图标）：启用开关、特殊页面切换方案（弹窗面板 / 借用相邻标签）、面板卡片数量（5–10 张，超过 5 张自动换行居中排布）、缩略图缓存数量（12–36 张）与保留时长（2–12 小时）；偏好存 `chrome.storage.sync`，MRU 与缩略图状态存 `chrome.storage.session`，service worker 休眠后不丢。

## 开发

```bash
node --check background/main.js   # 语法检查（对所有 js 文件）
node --test                       # 单元测试（node:test，无框架）
```

目录结构：`background/`（命令编排、MRU tracker、截图管线）、`content/`（keyup 观察器、面板）、`pages/`（设置页、切换器弹窗宿主、port 桥）、`assets/`（占位图标）、`test/`（单元测试）。
