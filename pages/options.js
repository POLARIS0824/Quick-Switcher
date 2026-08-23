(function() {
  'use strict';

  const ENABLED_STORAGE_KEY = 'enabled';
  const isZh = String(navigator.language || '').toLowerCase().indexOf('zh') === 0;
  const strings = isZh ? {
    subtitle: '按 Alt+Q 弹出最近使用的标签页切换器，纯键盘操作，松开 Alt 提交切换。',
    enabledLabel: '启用 Alt+Q 标签切换器',
    savedLabel: '已保存',
    saveFailedLabel: '保存失败，请重试',
    hint: '提示：若与其他同样占用 Alt+Q 的扩展（如 Lumno）共存，请在 chrome://extensions/shortcuts 中修改其中一个的快捷键。'
  } : {
    subtitle: 'Press Alt+Q to open the recent tab switcher. Keyboard only — release Alt to commit the switch.',
    enabledLabel: 'Enable the Alt+Q tab switcher',
    savedLabel: 'Saved',
    saveFailedLabel: 'Save failed, please retry',
    hint: 'Note: if another extension also claims Alt+Q (e.g. Lumno), reassign one of them at chrome://extensions/shortcuts.'
  };

  document.getElementById('subtitle').textContent = strings.subtitle;
  document.getElementById('enabled-label').textContent = strings.enabledLabel;
  document.getElementById('hint').textContent = strings.hint;

  const checkbox = document.getElementById('enabled');
  const status = document.getElementById('status');
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

  const storageArea = chrome && chrome.storage && chrome.storage.sync
    ? chrome.storage.sync
    : null;
  if (!storageArea || typeof storageArea.get !== 'function') {
    checkbox.disabled = true;
    return;
  }

  storageArea.get([ENABLED_STORAGE_KEY], (result) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      checkbox.checked = true;
      return;
    }
    checkbox.checked = !result || result[ENABLED_STORAGE_KEY] !== false;
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

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes || !changes[ENABLED_STORAGE_KEY]) {
        return;
      }
      checkbox.checked = changes[ENABLED_STORAGE_KEY].newValue !== false;
    });
  }
})();
