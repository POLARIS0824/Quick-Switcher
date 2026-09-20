(function() {
  'use strict';

  const STORAGE_LANG_KEY = 'quickswitcher_onboarding_lang';

  const I18N = {
    zh: {
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
      linkGithub: '⭐ GitHub 仓库',
      linkIssues: '💬 反馈建议 / 提交 Issue',
      footerCopy: 'QuickSwitcher · 为极速与纯粹而生'
    },
    en: {
      pageTitle: 'Welcome to QuickSwitcher - User Guide',
      heroSubtitle: 'Fast, elegant keyboard-first recent tab switcher with live page thumbnails and adaptive frosted glass UI.',
      titleShortcuts: 'Keyboard Shortcuts',
      actionOpen: 'Open Switcher / Step Forward',
      detailOpen: 'Hold Alt to keep panel open, tap Q to step to the next tab',
      actionNav: 'Directional Navigation',
      detailNav: 'Or use Tab / Shift+Tab to move forward and backward',
      actionCommit: 'Commit and Switch Tab',
      detailCommit: 'Release Alt modifier key, or press Enter',
      labelReleaseAlt: 'Release',
      actionClose: 'Close Tab',
      detailClose: 'Hover over card top-right and left-click ❌ to close; or press Delete / Backspace',
      labelCloseKey: 'Left-click ❌',
      actionCancel: 'Cancel and Dismiss',
      detailCancel: 'Discard switch and stay on the current tab',
      actionClick: 'Click to Switch',
      detailClick: 'Click anywhere on the card to jump directly to that tab',
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
      linkGithub: '⭐ GitHub Repository',
      linkIssues: '💬 Feedback & Issues',
      footerCopy: 'QuickSwitcher · Built for speed and focus'
    }
  };

  let currentLang = 'en';

  function getInitialLang() {
    try {
      const saved = localStorage.getItem(STORAGE_LANG_KEY);
      if (saved === 'zh' || saved === 'en') {
        return saved;
      }
    } catch (e) {}

    const browserLang = String(navigator.language || '').toLowerCase();
    return browserLang.startsWith('zh') ? 'zh' : 'en';
  }

  function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el && typeof text === 'string') {
      el.textContent = text;
    }
  }

  function applyLanguage(lang) {
    currentLang = lang === 'zh' ? 'zh' : 'en';
    try {
      localStorage.setItem(STORAGE_LANG_KEY, currentLang);
    } catch (e) {}

    const strings = I18N[currentLang];
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    document.title = strings.pageTitle;

    setElementText('hero-subtitle', strings.heroSubtitle);
    setElementText('title-shortcuts', strings.titleShortcuts);
    setElementText('action-open', strings.actionOpen);
    setElementText('detail-open', strings.detailOpen);
    setElementText('action-nav', strings.actionNav);
    setElementText('detail-nav', strings.detailNav);
    setElementText('action-commit', strings.actionCommit);
    setElementText('detail-commit', strings.detailCommit);
    setElementText('label-release-alt', strings.labelReleaseAlt);
    setElementText('action-close', strings.actionClose);
    setElementText('detail-close', strings.detailClose);
    setElementText('label-close-key', strings.labelCloseKey);
    setElementText('action-cancel', strings.actionCancel);
    setElementText('detail-cancel', strings.detailCancel);
    setElementText('action-click', strings.actionClick);
    setElementText('detail-click', strings.detailClick);
    setElementText('label-click', strings.labelClick);

    setElementText('title-features', strings.titleFeatures);
    setElementText('feat-1-title', strings.feat1Title);
    setElementText('feat-1-desc', strings.feat1Desc);
    setElementText('feat-2-title', strings.feat2Title);
    setElementText('feat-2-desc', strings.feat2Desc);
    setElementText('feat-3-title', strings.feat3Title);
    setElementText('feat-3-desc', strings.feat3Desc);

    setElementText('custom-title', strings.customTitle);
    setElementText('custom-desc', strings.customDesc);
    setElementText('btn-shortcuts-text', strings.btnShortcutsText);
    setElementText('link-github', strings.linkGithub);
    setElementText('link-issues', strings.linkIssues);
    setElementText('footer-copy', strings.footerCopy);

    const btnZh = document.getElementById('lang-btn-zh');
    const btnEn = document.getElementById('lang-btn-en');
    if (btnZh && btnEn) {
      btnZh.classList.toggle('active', currentLang === 'zh');
      btnEn.classList.toggle('active', currentLang === 'en');
    }
  }

  // Version badge from manifest
  const versionBadge = document.getElementById('version-badge');
  if (chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      versionBadge.textContent = `v${manifest.version}`;
    }
  }

  // Language buttons
  const btnZh = document.getElementById('lang-btn-zh');
  const btnEn = document.getElementById('lang-btn-en');
  if (btnZh) {
    btnZh.addEventListener('click', () => applyLanguage('zh'));
  }
  if (btnEn) {
    btnEn.addEventListener('click', () => applyLanguage('en'));
  }

  // Configure shortcuts button
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
          shortcutsBtnText.textContent = I18N[currentLang].btnShortcutsCopied;
          setTimeout(() => {
            shortcutsBtnText.textContent = original;
          }, 2000);
        }
      }).catch(() => {});
    }
  }

  // Initialize language
  applyLanguage(getInitialLang());
})();
