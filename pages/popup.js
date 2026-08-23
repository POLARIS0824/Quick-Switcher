(function() {
  'use strict';

  const ENABLED_STORAGE_KEY = 'enabled';
  const SPECIAL_HOST_MODE_STORAGE_KEY = 'specialHostMode';
  const THUMBNAIL_LIMIT_STORAGE_KEY = 'thumbnailLimit';
  const THUMBNAIL_TTL_HOURS_STORAGE_KEY = 'thumbnailTtlHours';
  const DEFAULT_SPECIAL_HOST_MODE = 'popup';
  const DEFAULT_THUMBNAIL_LIMIT = '12';
  const DEFAULT_THUMBNAIL_TTL_HOURS = '2';
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
    return;
  }

  storageArea.get([
    ENABLED_STORAGE_KEY,
    SPECIAL_HOST_MODE_STORAGE_KEY,
    THUMBNAIL_LIMIT_STORAGE_KEY,
    THUMBNAIL_TTL_HOURS_STORAGE_KEY
  ], (result) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      checkbox.checked = true;
      applyMode(DEFAULT_SPECIAL_HOST_MODE);
      thumbnailLimitSelect.value = DEFAULT_THUMBNAIL_LIMIT;
      thumbnailTtlSelect.value = DEFAULT_THUMBNAIL_TTL_HOURS;
      return;
    }
    checkbox.checked = !result || result[ENABLED_STORAGE_KEY] !== false;
    applyMode(result && result[SPECIAL_HOST_MODE_STORAGE_KEY] === 'borrow'
      ? 'borrow'
      : DEFAULT_SPECIAL_HOST_MODE);
    thumbnailLimitSelect.value = String(Number(result && result[THUMBNAIL_LIMIT_STORAGE_KEY]) || DEFAULT_THUMBNAIL_LIMIT);
    thumbnailTtlSelect.value = String(Number(result && result[THUMBNAIL_TTL_HOURS_STORAGE_KEY]) || DEFAULT_THUMBNAIL_TTL_HOURS);
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
    [thumbnailTtlSelect, THUMBNAIL_TTL_HOURS_STORAGE_KEY]
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
    });
  }
})();
