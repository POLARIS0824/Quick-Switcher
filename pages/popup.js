(function() {
  'use strict';

  const ENABLED_STORAGE_KEY = 'enabled';
  const SPECIAL_HOST_MODE_STORAGE_KEY = 'specialHostMode';
  const THUMBNAIL_LIMIT_STORAGE_KEY = 'thumbnailLimit';
  const THUMBNAIL_TTL_HOURS_STORAGE_KEY = 'thumbnailTtlHours';
  const PANEL_TAB_COUNT_STORAGE_KEY = 'panelTabCount';
  const PANEL_THEME_STORAGE_KEY = 'panelTheme';
  const PANEL_ACCENT_STORAGE_KEY = 'panelAccent';
  const PANEL_THEME_VALUES = ['auto', 'light', 'dark'];
  const PANEL_ACCENT_VALUES = ['default', 'violet', 'teal', 'orange', 'pink'];
  const DEFAULT_PANEL_THEME = 'auto';
  const DEFAULT_PANEL_ACCENT = 'default';
  const DEFAULT_SPECIAL_HOST_MODE = 'popup';
  const DEFAULT_THUMBNAIL_LIMIT = '12';
  const DEFAULT_THUMBNAIL_TTL_HOURS = '2';
  const DEFAULT_PANEL_TAB_COUNT = '5';
  const isZh = String(navigator.language || '').toLowerCase().indexOf('zh') === 0;
  const strings = isZh ? {
    subtitle: '按 Alt+Q 弹出最近标签切换器，松开 Alt 提交切换。',
    enabledLabel: '启用 Alt+Q 标签切换器',
    modeLabel: '特殊页面（chrome://、新标签页等）切换方案',
    popupTitle: '弹窗面板',
    popupDesc: '原页面保持不动，面板在迷你弹窗中打开，Esc 取消后回到原页面',
    borrowTitle: '借用相邻标签',
    borrowDesc: '切到相邻的最近标签，面板显示在那里（与 Lumno 行为一致）',
    thumbnailLabel: '缩略图',
    thumbnailLimitLabel: '缓存数量上限',
    thumbnailTtlLabel: '保留时长',
    panelLabel: '面板',
    panelCountLabel: '卡片数量',
    panelThemeLabel: '主题',
    themeAuto: '自动（跟随页面）',
    themeLight: '浅色',
    themeDark: '深色',
    panelAccentLabel: '强调色',
    accentDefault: '默认蓝',
    accentViolet: '紫色',
    accentTeal: '青色',
    accentOrange: '橙色',
    accentPink: '粉色',
    logsLabel: '运行日志',
    copyLogsBtn: '复制日志',
    clearLogsBtn: '清空日志',
    logsCopiedLabel: '已复制日志到剪贴板',
    logsClearedLabel: '已清空运行日志',
    noLogsLabel: '暂无日志记录',
    savedLabel: '已保存',
    saveFailedLabel: '保存失败，请重试'
  } : {
    subtitle: 'Press Alt+Q for the recent tab switcher; release Alt to commit.',
    enabledLabel: 'Enable the Alt+Q tab switcher',
    modeLabel: 'Switcher on special pages (chrome://, new tab, …)',
    popupTitle: 'Popup window',
    popupDesc: 'Original tab stays put; the panel opens in a mini popup, Esc returns to the page',
    borrowTitle: 'Borrow neighbor tab',
    borrowDesc: 'Focus the nearest recent tab and show the panel there (Lumno-style)',
    thumbnailLabel: 'Thumbnails',
    thumbnailLimitLabel: 'Cache limit',
    thumbnailTtlLabel: 'Keep for',
    panelLabel: 'Panel',
    panelCountLabel: 'Cards',
    panelThemeLabel: 'Theme',
    themeAuto: 'Auto (match page)',
    themeLight: 'Light',
    themeDark: 'Dark',
    panelAccentLabel: 'Accent color',
    accentDefault: 'Default blue',
    accentViolet: 'Violet',
    accentTeal: 'Teal',
    accentOrange: 'Orange',
    accentPink: 'Pink',
    logsLabel: 'Runtime Logs',
    copyLogsBtn: 'Copy Logs',
    clearLogsBtn: 'Clear Logs',
    logsCopiedLabel: 'Logs copied to clipboard',
    logsClearedLabel: 'Logs cleared',
    noLogsLabel: 'No logs recorded yet',
    savedLabel: 'Saved',
    saveFailedLabel: 'Save failed, please retry'
  };

  document.getElementById('subtitle').textContent = strings.subtitle;
  document.getElementById('enabled-label').textContent = strings.enabledLabel;
  document.getElementById('mode-label').textContent = strings.modeLabel;
  document.getElementById('popup-title').textContent = strings.popupTitle;
  document.getElementById('popup-desc').textContent = strings.popupDesc;
  document.getElementById('borrow-title').textContent = strings.borrowTitle;
  document.getElementById('borrow-desc').textContent = strings.borrowDesc;
  document.getElementById('thumbnail-label').textContent = strings.thumbnailLabel;
  document.getElementById('thumbnail-limit-label').textContent = strings.thumbnailLimitLabel;
  document.getElementById('thumbnail-ttl-label').textContent = strings.thumbnailTtlLabel;
  document.getElementById('panel-label').textContent = strings.panelLabel;
  document.getElementById('panel-count-label').textContent = strings.panelCountLabel;
  document.getElementById('panel-theme-label').textContent = strings.panelThemeLabel;
  document.getElementById('panel-accent-label').textContent = strings.panelAccentLabel;
  document.getElementById('logs-label').textContent = strings.logsLabel;
  document.getElementById('copy-logs-btn').textContent = strings.copyLogsBtn;
  document.getElementById('clear-logs-btn').textContent = strings.clearLogsBtn;

  const versionEl = document.getElementById('version');
  if (chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    versionEl.textContent = `QuickSwitcher v${chrome.runtime.getManifest().version}`;
  } else {
    versionEl.textContent = 'QuickSwitcher';
  }

  const checkbox = document.getElementById('enabled');
  const status = document.getElementById('status');
  const radios = Array.from(document.querySelectorAll('input[name="specialHostMode"]'));
  const optionCards = {
    popup: document.getElementById('option-popup'),
    borrow: document.getElementById('option-borrow')
  };
  const thumbnailLimitSelect = document.getElementById('thumbnailLimit');
  const thumbnailTtlSelect = document.getElementById('thumbnailTtlHours');
  const panelTabCountSelect = document.getElementById('panelTabCount');
  const panelThemeSelect = document.getElementById('panelTheme');
  const panelAccentSelect = document.getElementById('panelAccent');
  const themeOptionLabels = [strings.themeAuto, strings.themeLight, strings.themeDark];
  const accentOptionLabels = [
    strings.accentDefault,
    strings.accentViolet,
    strings.accentTeal,
    strings.accentOrange,
    strings.accentPink
  ];
  Array.from(panelThemeSelect.options).forEach((option, index) => {
    option.textContent = themeOptionLabels[index] || option.value;
  });
  Array.from(panelAccentSelect.options).forEach((option, index) => {
    option.textContent = accentOptionLabels[index] || option.value;
  });
  let statusTimer = null;

  function showStatus(text) {
    status.textContent = text;
    if (statusTimer) {
      clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
      status.textContent = '';
      statusTimer = null;
    }, 1600);
  }

  function applyMode(mode) {
    radios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    Object.keys(optionCards).forEach((mode2) => {
      optionCards[mode2].dataset.selected = mode2 === mode ? 'true' : 'false';
    });
  }

  const storageArea = chrome && chrome.storage && chrome.storage.sync
    ? chrome.storage.sync
    : null;
  if (!storageArea || typeof storageArea.get !== 'function') {
    checkbox.disabled = true;
    radios.forEach((radio) => {
      radio.disabled = true;
    });
    thumbnailLimitSelect.disabled = true;
    thumbnailTtlSelect.disabled = true;
    panelTabCountSelect.disabled = true;
    panelThemeSelect.disabled = true;
    panelAccentSelect.disabled = true;
    return;
  }

  storageArea.get([
    ENABLED_STORAGE_KEY,
    SPECIAL_HOST_MODE_STORAGE_KEY,
    THUMBNAIL_LIMIT_STORAGE_KEY,
    THUMBNAIL_TTL_HOURS_STORAGE_KEY,
    PANEL_TAB_COUNT_STORAGE_KEY,
    PANEL_THEME_STORAGE_KEY,
    PANEL_ACCENT_STORAGE_KEY
  ], (result) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      checkbox.checked = true;
      applyMode(DEFAULT_SPECIAL_HOST_MODE);
      thumbnailLimitSelect.value = DEFAULT_THUMBNAIL_LIMIT;
      thumbnailTtlSelect.value = DEFAULT_THUMBNAIL_TTL_HOURS;
      panelTabCountSelect.value = DEFAULT_PANEL_TAB_COUNT;
      panelThemeSelect.value = DEFAULT_PANEL_THEME;
      panelAccentSelect.value = DEFAULT_PANEL_ACCENT;
      return;
    }
    checkbox.checked = !result || result[ENABLED_STORAGE_KEY] !== false;
    applyMode(result && result[SPECIAL_HOST_MODE_STORAGE_KEY] === 'borrow'
      ? 'borrow'
      : DEFAULT_SPECIAL_HOST_MODE);
    thumbnailLimitSelect.value = String(Number(result && result[THUMBNAIL_LIMIT_STORAGE_KEY]) || DEFAULT_THUMBNAIL_LIMIT);
    thumbnailTtlSelect.value = String(Number(result && result[THUMBNAIL_TTL_HOURS_STORAGE_KEY]) || DEFAULT_THUMBNAIL_TTL_HOURS);
    panelTabCountSelect.value = String(Number(result && result[PANEL_TAB_COUNT_STORAGE_KEY]) || DEFAULT_PANEL_TAB_COUNT);
    const storedPanelTheme = result && result[PANEL_THEME_STORAGE_KEY];
    panelThemeSelect.value = PANEL_THEME_VALUES.includes(storedPanelTheme)
      ? storedPanelTheme
      : DEFAULT_PANEL_THEME;
    const storedPanelAccent = result && result[PANEL_ACCENT_STORAGE_KEY];
    panelAccentSelect.value = PANEL_ACCENT_VALUES.includes(storedPanelAccent)
      ? storedPanelAccent
      : DEFAULT_PANEL_ACCENT;
  });

  checkbox.addEventListener('change', () => {
    storageArea.set({ [ENABLED_STORAGE_KEY]: checkbox.checked }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        showStatus(strings.saveFailedLabel);
        return;
      }
      showStatus(strings.savedLabel);
    });
  });

  radios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) {
        return;
      }
      storageArea.set({ [SPECIAL_HOST_MODE_STORAGE_KEY]: radio.value }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          showStatus(strings.saveFailedLabel);
          return;
        }
        applyMode(radio.value);
        showStatus(strings.savedLabel);
      });
    });
  });

  [
    [thumbnailLimitSelect, THUMBNAIL_LIMIT_STORAGE_KEY],
    [thumbnailTtlSelect, THUMBNAIL_TTL_HOURS_STORAGE_KEY],
    [panelTabCountSelect, PANEL_TAB_COUNT_STORAGE_KEY]
  ].forEach(([select, storageKey]) => {
    select.addEventListener('change', () => {
      storageArea.set({ [storageKey]: Number(select.value) }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          showStatus(strings.saveFailedLabel);
          return;
        }
        showStatus(strings.savedLabel);
      });
    });
  });

  // Theme and accent are string enums; save them verbatim, no Number cast.
  [
    [panelThemeSelect, PANEL_THEME_STORAGE_KEY],
    [panelAccentSelect, PANEL_ACCENT_STORAGE_KEY]
  ].forEach(([select, storageKey]) => {
    select.addEventListener('change', () => {
      storageArea.set({ [storageKey]: select.value }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          showStatus(strings.saveFailedLabel);
          return;
        }
        showStatus(strings.savedLabel);
      });
    });
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes) {
        return;
      }
      if (changes[ENABLED_STORAGE_KEY]) {
        checkbox.checked = changes[ENABLED_STORAGE_KEY].newValue !== false;
      }
      if (changes[SPECIAL_HOST_MODE_STORAGE_KEY]) {
        applyMode(changes[SPECIAL_HOST_MODE_STORAGE_KEY].newValue === 'borrow'
          ? 'borrow'
          : DEFAULT_SPECIAL_HOST_MODE);
      }
      if (changes[THUMBNAIL_LIMIT_STORAGE_KEY]) {
        thumbnailLimitSelect.value = String(Number(changes[THUMBNAIL_LIMIT_STORAGE_KEY].newValue) || DEFAULT_THUMBNAIL_LIMIT);
      }
      if (changes[THUMBNAIL_TTL_HOURS_STORAGE_KEY]) {
        thumbnailTtlSelect.value = String(Number(changes[THUMBNAIL_TTL_HOURS_STORAGE_KEY].newValue) || DEFAULT_THUMBNAIL_TTL_HOURS);
      }
      if (changes[PANEL_TAB_COUNT_STORAGE_KEY]) {
        panelTabCountSelect.value = String(Number(changes[PANEL_TAB_COUNT_STORAGE_KEY].newValue) || DEFAULT_PANEL_TAB_COUNT);
      }
      if (changes[PANEL_THEME_STORAGE_KEY]) {
        const nextTheme = changes[PANEL_THEME_STORAGE_KEY].newValue;
        panelThemeSelect.value = PANEL_THEME_VALUES.includes(nextTheme) ? nextTheme : DEFAULT_PANEL_THEME;
      }
      if (changes[PANEL_ACCENT_STORAGE_KEY]) {
        const nextAccent = changes[PANEL_ACCENT_STORAGE_KEY].newValue;
        panelAccentSelect.value = PANEL_ACCENT_VALUES.includes(nextAccent) ? nextAccent : DEFAULT_PANEL_ACCENT;
      }
    });
  }

  const copyLogsBtn = document.getElementById('copy-logs-btn');
  const clearLogsBtn = document.getElementById('clear-logs-btn');

  function formatLogsForExport(logs) {
    if (!Array.isArray(logs) || !logs.length) {
      return '';
    }
    return logs.map((entry) => {
      const time = entry && entry.time ? entry.time : '';
      const level = entry && entry.level ? `[${entry.level.toUpperCase()}]` : '';
      const category = entry && entry.category ? `[${entry.category}]` : '';
      const msg = entry && entry.message ? entry.message : '';
      const details = entry && entry.details ? ` ${JSON.stringify(entry.details)}` : '';
      return `${time} ${level} ${category} ${msg}${details}`.trim();
    }).join('\n');
  }

  if (copyLogsBtn) {
    copyLogsBtn.addEventListener('click', () => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        return;
      }
      chrome.runtime.sendMessage({ action: 'getDebugLogs' }, (response) => {
        const logs = response && Array.isArray(response.logs) ? response.logs : [];
        if (!logs.length) {
          showStatus(strings.noLogsLabel);
          return;
        }
        const text = formatLogsForExport(logs);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).then(() => {
            showStatus(`${strings.logsCopiedLabel} (${logs.length})`);
          }).catch(() => {
            showStatus(strings.saveFailedLabel);
          });
        } else {
          showStatus(strings.logsCopiedLabel);
        }
      });
    });
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        return;
      }
      chrome.runtime.sendMessage({ action: 'clearDebugLogs' }, () => {
        showStatus(strings.logsClearedLabel);
      });
    });
  }
})();
