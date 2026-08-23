# QuickSwitcher

零依赖的 Chrome MV3 标签切换扩展：按 `Alt+Q` 弹出最近使用标签的卡片面板（带页面实时缩略图），
按住 `Alt` 连按 `Q` 跳选，松开 `Alt` 提交切换。面板内禁用一切鼠标交互，防止切换期间误触；
无构建工具链，加载即用。

本项目受 [Lumno](https://github.com/kubai087/lumno-extension) 启发：其 Alt+Q 标签切换器是本项目的
直接来源——MRU tracker（`background/recent-tab-switcher.js`）为整体复制，keyup 观察器、缩略图
截图管线、面板样式与主题嗅探等实现亦提取或参考自 Lumno 源码，并在其基础上做了纯键盘化改造与
简化。感谢 [kubai087](https://github.com/kubai087) 的开源工作。

## 安装

1. 打开 `chrome://extensions`，开启右上角**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择本目录。
3. 可选：在 `chrome://extensions/shortcuts` 确认 `Alt+Q` 已绑定。

## 键盘操作

| 按键 | 行为 |
|---|---|
| `Alt+Q` | 打开面板，高亮次近使用的标签 |
| 按住 `Alt` 连按 `Q`，或 `→` / `↓` / `Tab` | 选中 +1（循环） |
| `←` / `↑` / `Shift+Tab` | 选中 -1（循环） |
| 松开 `Alt`，或 `Enter` | 切换到选中标签 |
| `Escape` | 关闭面板，不切换 |

普通网页正常显示面板；本扩展自身页面经 port 桥显示面板。`chrome://`、Web Store、浏览器默认
新标签页等无法注入的页面上，面板借用相邻的最近可注入标签显示（焦点先切到该标签，选中项仍
相对原标签计算，Escape 取消后停留在借用标签上）；仅当最近列表里没有任何可宿主标签时，才
退化为盲切一步（直接切到下一个最近标签，无面板）。

## 说明

- 快捷键运行时实读 `chrome.commands.getAll`，在 shortcuts 页改键后自动适应；若与 Lumno 共存，
  两者都注册 `Alt+Q` 会冲突，需改掉其中一个。
- favicon 依次取 `tab.favIconUrl` → 本扩展 `_favicon` 服务 → gstatic，最终失败显示
  `assets/placeholder.svg` 占位图标（换成自己的图标直接替换该文件即可）。
- 设置页（右键图标 → 选项）只有一个启用开关；MRU 与缩略图状态存
  `chrome.storage.session`，service worker 休眠后不丢。

## 开发

```bash
node --check background/main.js   # 语法检查（对所有 js 文件）
node --test                       # 单元测试（node:test，无框架）
```

目录结构：`background/`（命令编排、MRU tracker、截图管线）、`content/`（keyup 观察器、面板）、
`pages/`（设置页、port 桥）、`assets/`（占位图标）、`test/`（单元测试）。
