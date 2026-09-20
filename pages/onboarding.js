(function() {
  'use strict';

  const isZh = String(navigator.language || '').toLowerCase().indexOf('zh') === 0;

  const strings = isZh ? {
    pageTitle: '欢迎使用 QuickSwitcher - 使用指南',
    heroSubtitle: '极速、优雅的键盘优先最近标签切换器，配备实时网页缩略图与自适应毛玻璃面板。',
    titleShortcuts: '操作快捷键',
    actionOpen: '呼出面板 / 步进切换',
    detailOpen: '按住 Alt 保持面板开启，继续点按 Q 切换下一个',
    actionNav: '自由方向导航',
    detailNav: '也可使用 Tab / Shift+Tab 向前向后选择',
    actionCommit: '提交并切换标签',
    detailCommit: '松开 Alt 修饰键，或者直接按下回车',
    labelReleaseAlt: '松开',
    actionClose: '关闭标签页',
    detailClose: '鼠标悬停卡片右上角，左键点击 ❌ 即可直接关闭；或使用键盘 Delete / Backspace',
    labelCloseKey: '左键 ❌',
    actionCancel: '取消并关闭面板',
    detailCancel: '放弃切换，保持停留在当前标签页',
    actionClick: '鼠标直接切换',
    detailClick: '直接点击卡片主体即可跳转至对应标签',
    labelClick: '鼠标左键',
    titleFeatures: '功能特性',
    feat1Title: '实时网页缩略图',
    feat1Desc: '智能捕获最近访问页面的即时快照，即使打开数十个标签也能凭借画面瞬间定位。',
    feat2Title: '自适应毛玻璃设计',
    feat2Desc: '无缝适配系统及所在网页的深浅主题，提供 5 款精心调配的强调色与 3 档卡片密度。',
    feat3Title: '特殊页面无缝支持',
    feat3Desc: '在 Chrome 内部页、新建标签页或全屏视频等受限场景下，通过迷你弹窗保障一致体验。',
    customTitle: '喜欢使用 Ctrl+Q 或其他快捷键？',
    customDesc: 'Chrome 允许您在原生扩展快捷键页面随时调整或重新绑定该快捷键。',
    btnShortcutsText: '配置快捷键',
    btnShortcutsCopied: '已复制网址到剪贴板',
    footerCopy: 'QuickSwitcher · 为极速与纯粹而生'
  } : {
    pageTitle: 'Welcome to QuickSwitcher - User Guide',
    heroSubtitle: 'Keyboard-first recent tab switcher with live page thumbnails and adaptive frosted glass UI.',
    titleShortcuts: 'Keyboard Shortcuts',
    actionOpen: 'Open Switcher / Step Forward',
    detailOpen: 'Hold Alt to keep panel open, tap Q to step to the next tab',
    actionNav: 'Directional Navigation',
    detailNav: 'Or use Tab / Shift+Tab to move forward and backward',
    actionCommit: 'Commit and Switch',
    detailCommit: 'Release Alt modifier key, or press Enter',
    labelReleaseAlt: 'Release',
    actionClose: 'Close Tab',
    detailClose: 'Hover over card top-right and left-click ❌ to close; or press Delete / Backspace',
    labelCloseKey: 'Left-click ❌',
    actionCancel: 'Cancel and Dismiss',
    detailCancel: 'Discard switch and stay on the current tab',
    actionClick: 'Click to Switch',
    detailClick: 'Click anywhere on the card to jump to that tab',
    labelClick: 'Left Click',
    titleFeatures: 'Features',
    feat1Title: 'Live Page Thumbnails',
    feat1Desc: 'Intelligently captures recent page snapshots, allowing instant visual recognition even with dozens of tabs.',
    feat2Title: 'Adaptive Glassmorphism',
    feat2Desc: 'Seamlessly matches system and host page color themes, with 5 accent colors and 3 card density options.',
    feat3Title: 'Special Pages Support',
    feat3Desc: 'Maintains a consistent, uninterrupted experience on chrome:// pages, new tab pages, and full-screen videos.',
    customTitle: 'Prefer Ctrl+Q or another shortcut?',
    customDesc: 'Chrome lets you customize and rebind this shortcut in the native extensions shortcuts page.',
    btnShortcutsText: 'Configure Shortcuts',
    btnShortcutsCopied: 'URL copied to clipboard',
    footerCopy: 'QuickSwitcher · Built for speed and focus'
  };

  document.title = strings.pageTitle;
  document.getElementById('hero-subtitle').textContent = strings.heroSubtitle;
  document.getElementById('title-shortcuts').textContent = strings.titleShortcuts;
  document.getElementById('action-open').textContent = strings.actionOpen;
  document.getElementById('detail-open').textContent = strings.detailOpen;
  document.getElementById('action-nav').textContent = strings.actionNav;
  document.getElementById('detail-nav').textContent = strings.detailNav;
  document.getElementById('action-commit').textContent = strings.actionCommit;
  document.getElementById('detail-commit').textContent = strings.detailCommit;
  document.getElementById('label-release-alt').textContent = strings.labelReleaseAlt;
  document.getElementById('action-close').textContent = strings.actionClose;
  document.getElementById('detail-close').textContent = strings.detailClose;
  const labelCloseKey = document.getElementById('label-close-key');
  if (labelCloseKey) {
    labelCloseKey.textContent = strings.labelCloseKey;
  }
  document.getElementById('action-cancel').textContent = strings.actionCancel;
  document.getElementById('detail-cancel').textContent = strings.detailCancel;
  document.getElementById('action-click').textContent = strings.actionClick;
  document.getElementById('detail-click').textContent = strings.detailClick;
  document.getElementById('label-click').textContent = strings.labelClick;

  document.getElementById('title-features').textContent = strings.titleFeatures;
  document.getElementById('feat-1-title').textContent = strings.feat1Title;
  document.getElementById('feat-1-desc').textContent = strings.feat1Desc;
  document.getElementById('feat-2-title').textContent = strings.feat2Title;
  document.getElementById('feat-2-desc').textContent = strings.feat2Desc;
  document.getElementById('feat-3-title').textContent = strings.feat3Title;
  document.getElementById('feat-3-desc').textContent = strings.feat3Desc;

  document.getElementById('custom-title').textContent = strings.customTitle;
  document.getElementById('custom-desc').textContent = strings.customDesc;
  document.getElementById('btn-shortcuts-text').textContent = strings.btnShortcutsText;
  document.getElementById('footer-copy').textContent = strings.footerCopy;

  const versionBadge = document.getElementById('version-badge');
  if (chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const shortcutsBtn = document.getElementById('open-shortcuts-btn');
  const shortcutsBtnText = document.getElementById('btn-shortcuts-text');
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', () => {
      const targetUrl = 'chrome://extensions/shortcuts';
      if (chrome && chrome.tabs && typeof chrome.tabs.create === 'function') {
        try {
          chrome.tabs.create({ url: targetUrl }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              fallbackCopy(targetUrl);
            }
          });
          return;
        } catch (error) {
          fallbackCopy(targetUrl);
        }
      } else {
        fallbackCopy(targetUrl);
      }
    });
  }

  function fallbackCopy(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => {
        if (shortcutsBtnText) {
          const original = shortcutsBtnText.textContent;
          shortcutsBtnText.textContent = strings.btnShortcutsCopied;
          setTimeout(() => {
            shortcutsBtnText.textContent = original;
          }, 2000);
        }
      }).catch(() => {});
    }
  }
})();
