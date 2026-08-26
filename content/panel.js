(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.QuickSwitchPanelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function clampSelectedIndex(index, length) {
    if (length <= 0) {
      return 0;
    }
    const normalized = Number.isFinite(Number(index)) ? Number(index) : 0;
    return ((normalized % length) + length) % length;
  }

  function nextSelectedIndexAfterRemoval(removedIndex, selectedIndex, length) {
    // `length` is the list size after the removal.
    if (length <= 0) {
      return 0;
    }
    const removed = Math.trunc(Number(removedIndex));
    const selected = Math.trunc(Number(selectedIndex));
    if (!Number.isFinite(removed) || !Number.isFinite(selected)) {
      return clampSelectedIndex(selected, length);
    }
    if (removed < selected) {
      return clampSelectedIndex(selected - 1, length);
    }
    if (removed === selected) {
      return Math.max(0, Math.min(selected, length - 1));
    }
    return clampSelectedIndex(selected, length);
  }

  function normalizeAdvanceOffset(value) {
    const offset = Math.trunc(Number(value));
    return Number.isFinite(offset) && offset !== 0 ? offset : 1;
  }

  function normalizeTabSwitcherShortcutKey(value) {
    const key = String(value || '').trim().toLowerCase();
    const aliases = {
      comma: ',',
      period: '.',
      slash: '/',
      backslash: '\\',
      return: 'enter',
      esc: 'escape',
      space: ' ',
      spacebar: ' '
    };
    return aliases[key] || key;
  }

  function normalizeTabSwitcherShortcutCode(value) {
    const code = String(value || '');
    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3).toLowerCase();
    }
    if (/^Digit\d$/.test(code)) {
      return code.slice(5);
    }
    const aliases = {
      Backquote: '`',
      Backslash: '\\',
      BracketLeft: '[',
      BracketRight: ']',
      Comma: ',',
      Equal: '=',
      Minus: '-',
      Period: '.',
      Quote: "'",
      Semicolon: ';',
      Slash: '/'
    };
    return aliases[code] || '';
  }

  function getTabSwitcherShortcutModifier(value) {
    const token = String(value || '').trim().toLowerCase();
    if (token === 'alt' || token === 'option') {
      return { eventKey: 'Alt', flag: 'altKey' };
    }
    if (token === 'ctrl' || token === 'control' || token === 'macctrl') {
      return { eventKey: 'Control', flag: 'ctrlKey' };
    }
    if (token === 'command' || token === 'cmd' || token === 'meta' || token === 'super') {
      return { eventKey: 'Meta', flag: 'metaKey' };
    }
    if (token === 'shift') {
      return { eventKey: 'Shift', flag: 'shiftKey' };
    }
    return null;
  }

  function parseTabSwitcherShortcut(value) {
    const shortcutText = String(value || 'Alt+Q').trim();
    const parts = shortcutText
      .split('+')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    const hasSymbolModifiers = /[⌥⌃⌘⇧]/.test(shortcutText);
    const symbolTrigger = hasSymbolModifiers
      ? shortcutText.replace(/[⌥⌃⌘⇧]/g, '').replace(/^\++/, '').trim()
      : '';
    const triggerKey = normalizeTabSwitcherShortcutKey(symbolTrigger || parts.pop() || 'Q');
    const modifiers = hasSymbolModifiers
      ? Array.from(shortcutText).map((token) => {
        if (token === '⌥') {
          return { eventKey: 'Alt', flag: 'altKey' };
        }
        if (token === '⌃') {
          return { eventKey: 'Control', flag: 'ctrlKey' };
        }
        if (token === '⌘') {
          return { eventKey: 'Meta', flag: 'metaKey' };
        }
        if (token === '⇧') {
          return { eventKey: 'Shift', flag: 'shiftKey' };
        }
        return null;
      }).filter(Boolean)
      : parts.map(getTabSwitcherShortcutModifier).filter(Boolean);
    const commitModifier = modifiers.find((modifier) => modifier.eventKey !== 'Shift') || modifiers[0] || null;
    return {
      triggerKey,
      commitModifierEventKey: commitModifier ? commitModifier.eventKey : '',
      commitModifierFlag: commitModifier ? commitModifier.flag : ''
    };
  }

  function isTabSwitcherShortcutTriggerEvent(shortcut, event) {
    const eventKeys = [
      normalizeTabSwitcherShortcutKey(event && event.key),
      normalizeTabSwitcherShortcutCode(event && event.code)
    ].filter(Boolean);
    return eventKeys.includes(shortcut.triggerKey);
  }

  function isTabSwitcherCommitModifierPressed(shortcut, event) {
    return Boolean(shortcut.commitModifierFlag && event && event[shortcut.commitModifierFlag] === true);
  }

  // The command itself already advanced the selection once when it opened the
  // panel, so the first trigger-key keydown observed in the page must be
  // swallowed while the modifier is still held.
  function createShortcutSuppressor(shortcut, initiallySuppressed) {
    let suppressed = initiallySuppressed === true;
    return Object.freeze({
      get suppressed() {
        return suppressed;
      },
      shouldSwallowTriggerKeydown(event) {
        return suppressed === true && isTabSwitcherCommitModifierPressed(shortcut, event);
      },
      markTriggerKeyup() {
        suppressed = false;
      },
      markTriggerAdvanced() {
        suppressed = false;
      },
      markExternalAdvance() {
        suppressed = false;
      }
    });
  }

  return Object.freeze({
    clampSelectedIndex,
    nextSelectedIndexAfterRemoval,
    normalizeAdvanceOffset,
    normalizeTabSwitcherShortcutKey,
    normalizeTabSwitcherShortcutCode,
    parseTabSwitcherShortcut,
    isTabSwitcherShortcutTriggerEvent,
    isTabSwitcherCommitModifierPressed,
    createShortcutSuppressor
  });
});

(function() {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
    return;
  }

  const HOST_ID = '_quickswitch_tab_switcher_host_2026_unique_';
  const PANEL_ID = '_quickswitch_tab_switcher_panel_2026_unique_';
  const TAB_SWITCHER_ADVANCE_EVENT = '_quickswitch_tab_switcher_advance_command_2026_unique_';
  const PANEL_CORE = globalThis.QuickSwitchPanelCore || {};
  const clampSelectedIndex = PANEL_CORE.clampSelectedIndex || ((index, length) => (length <= 0 ? 0 : Math.max(0, Math.min(length - 1, Number(index) || 0))));
  const nextSelectedIndexAfterRemoval = PANEL_CORE.nextSelectedIndexAfterRemoval ||
    ((removedIndex, selectedIndex, length) => {
      if (length <= 0) {
        return 0;
      }
      if (removedIndex < selectedIndex) {
        return clampSelectedIndex(selectedIndex - 1, length);
      }
      if (removedIndex === selectedIndex) {
        return Math.max(0, Math.min(selectedIndex, length - 1));
      }
      return clampSelectedIndex(selectedIndex, length);
    });
  const normalizeAdvanceOffset = PANEL_CORE.normalizeAdvanceOffset || (() => 1);
  const parseTabSwitcherShortcut = PANEL_CORE.parseTabSwitcherShortcut || (() => ({ triggerKey: 'q', commitModifierEventKey: 'Alt', commitModifierFlag: 'altKey' }));
  const isTabSwitcherShortcutTriggerEvent = PANEL_CORE.isTabSwitcherShortcutTriggerEvent || (() => false);
  const isTabSwitcherCommitModifierPressed = PANEL_CORE.isTabSwitcherCommitModifierPressed || (() => false);
  const createShortcutSuppressor = PANEL_CORE.createShortcutSuppressor || null;
  const chromeApi = typeof chrome !== 'undefined' ? chrome : null;

  const PANEL_MESSAGES = Object.freeze({
    en: Object.freeze({
      tab_switcher_title: 'Recent tabs',
      tab_switcher_untitled: 'Untitled',
      tab_switcher_favicon_alt: 'Site icon'
    }),
    zh: Object.freeze({
      tab_switcher_title: '最近使用的标签页',
      tab_switcher_untitled: '无标题',
      tab_switcher_favicon_alt: '站点图标'
    })
  });
  const INLINE_PLACEHOLDER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
    + '<circle cx="48" cy="48" r="40" fill="#ea4335"/>'
    + '<path d="M48 48 L82.64 28 A40 40 0 0 1 48 88 Z" fill="#fbbc05"/>'
    + '<path d="M48 48 L48 88 A40 40 0 0 1 13.36 28 Z" fill="#34a853"/>'
    + '<path d="M48 48 L82.64 28 M48 48 L48 88 M48 48 L13.36 28" stroke="#ffffff" stroke-width="4.5"/>'
    + '<circle cx="48" cy="48" r="15" fill="#ffffff"/>'
    + '<circle cx="48" cy="48" r="11" fill="#4285f4"/>'
    + '</svg>';

  function getFaviconPlaceholderUrl(stage) {
    if (!stage || stage < 1) {
      if (chromeApi && chromeApi.runtime && typeof chromeApi.runtime.getURL === 'function') {
        try {
          return chromeApi.runtime.getURL('assets/placeholder.svg');
        } catch (error) {
          // Fall through to the inline placeholder below.
        }
      }
    }
    return 'data:image/svg+xml,' + encodeURIComponent(INLINE_PLACEHOLDER_ICON_SVG);
  }

  function applyFaviconImageFallback(img) {
    const stage = Number(img.dataset.faviconFallbackStage || '0');
    if (stage < 1) {
      img.dataset.faviconFallbackStage = '1';
      img.src = getFaviconPlaceholderUrl(1);
      return;
    }
    if (stage < 2) {
      img.dataset.faviconFallbackStage = '2';
      img.src = getFaviconPlaceholderUrl(2);
      return;
    }
    img.dataset.broken = 'true';
    img.removeAttribute('src');
  }
  const PANEL_LOCALE = (function() {
    const language = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
    return language.indexOf('zh') === 0 ? 'zh' : 'en';
  })();

  function getMessage(key, fallback) {
    const bundle = PANEL_MESSAGES[PANEL_LOCALE] || PANEL_MESSAGES.en;
    return bundle[key] || PANEL_MESSAGES.en[key] || fallback;
  }

  const switcherThemeMediaQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function sanitizeText(value, fallback) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || fallback || '';
  }

  function getHostLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch (error) {
      return '';
    }
  }

  function handleExistingSwitcher(context) {
    const existingHost = document.getElementById(HOST_ID);
    if (!existingHost) {
      return false;
    }
    if (context && context.advanceOnExisting === true && typeof existingHost._quickswitchTabSwitcherAdvance === 'function') {
      existingHost._quickswitchTabSwitcherAdvance();
      return true;
    }
    const cleanup = existingHost._quickswitchTabSwitcherCleanup;
    if (typeof cleanup === 'function') {
      cleanup();
    }
    existingHost.remove();
    return true;
  }

  function updateOpenSwitcherThumbnailFromMessage(request) {
    const host = document.getElementById(HOST_ID);
    if (!host || typeof host._quickswitchTabSwitcherUpdateThumbnail !== 'function') {
      return { ok: false, reason: 'tab_switcher_host_missing' };
    }
    return host._quickswitchTabSwitcherUpdateThumbnail(request) || { ok: true };
  }

  function advanceOpenSwitcherFromMessage(request) {
    const host = document.getElementById(HOST_ID);
    if (!host || typeof host._quickswitchTabSwitcherAdvance !== 'function') {
      return {
        ok: true,
        open: false,
        advanced: false,
        suppressed: false
      };
    }
    const didAdvance = host._quickswitchTabSwitcherAdvance(request && request.offset);
    return {
      ok: true,
      open: true,
      advanced: didAdvance === true,
      suppressed: didAdvance === false
    };
  }

  function commitOpenSwitcherFromShortcutReleaseMessage() {
    const host = document.getElementById(HOST_ID);
    if (!host || typeof host._quickswitchTabSwitcherCommitFromShortcutRelease !== 'function') {
      return { ok: false, committed: false };
    }
    return {
      ok: true,
      committed: host._quickswitchTabSwitcherCommitFromShortcutRelease() === true
    };
  }

  function openSwitcherFromMessage(request) {
    const toggle = window._quickswitch_toggleTabSwitcher_2026_unique_;
    if (typeof toggle !== 'function') {
      return { ok: false, reason: 'tab_switcher_missing' };
    }
    const result = toggle(request && request.context);
    return result && typeof result === 'object'
      ? result
      : { ok: true };
  }

  if (chromeApi && chromeApi.runtime && chromeApi.runtime.onMessage) {
    const previousRuntimeMessageListener =
      window._quickswitch_tab_switcher_runtime_message_listener_2026_unique_;
    if (typeof previousRuntimeMessageListener === 'function' &&
        typeof chromeApi.runtime.onMessage.removeListener === 'function') {
      try {
        chromeApi.runtime.onMessage.removeListener(previousRuntimeMessageListener);
      } catch (error) {
        // The previous extension context may have been invalidated after a reload.
      }
    }
    const runtimeMessageListener = (request, _sender, sendResponse) => {
      if (!request) {
        return;
      }
      if (request.action === 'updateTabSwitcherThumbnail') {
        sendResponse(updateOpenSwitcherThumbnailFromMessage(request));
        return true;
      }
      if (request.action === 'advanceOpenTabSwitcherFromCommand') {
        sendResponse(advanceOpenSwitcherFromMessage(request));
        return true;
      }
      if (request.action === 'commitOpenTabSwitcherFromShortcutRelease') {
        sendResponse(commitOpenSwitcherFromShortcutReleaseMessage());
        return true;
      }
      if (request.action !== 'openTabSwitcherFromCommand') {
        return;
      }
      sendResponse(openSwitcherFromMessage(request));
      return true;
    };
    window._quickswitch_tab_switcher_runtime_message_listener_2026_unique_ =
      runtimeMessageListener;
    chromeApi.runtime.onMessage.addListener(runtimeMessageListener);
  }

  function getThumbnailStatus(tab, thumbnail) {
    const status = String(tab && tab.thumbnailStatus ? tab.thumbnailStatus : '').trim().toLowerCase();
    if (status === 'ok' ||
        status === 'pending' ||
        status === 'failed' ||
        status === 'restricted' ||
        status === 'stale') {
      return status;
    }
    return thumbnail && thumbnail.startsWith('data:image/') ? 'ok' : 'missing';
  }

  function normalizeAccentCss(value) {
    if (!Array.isArray(value) || value.length !== 3) {
      return '';
    }
    const rgb = value.map((channel) => Math.round(Number(channel)));
    if (!rgb.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) {
      return '';
    }
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function parseSwitcherCssColor(color) {
    if (!color || typeof color !== 'string') {
      return null;
    }
    const trimmed = color.trim().toLowerCase();
    if (!trimmed || trimmed === 'transparent') {
      return null;
    }
    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1);
      if (hex.length === 3) {
        const channels = hex.split('').map((value) => parseInt(value + value, 16));
        return channels.every((value) => Number.isFinite(value)) ? channels : null;
      }
      if (hex.length === 6) {
        const channels = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
          .map((value) => parseInt(value, 16));
        return channels.every((value) => Number.isFinite(value)) ? channels : null;
      }
      return null;
    }
    const functionMatch = trimmed.match(/^rgba?\(([\s\S]+)\)$/);
    if (!functionMatch) {
      return null;
    }
    const parts = functionMatch[1]
      .replace(/\//g, ' ')
      .replace(/,/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const channels = parts.slice(0, 3).map((part) => {
      if (part.endsWith('%')) {
        return Math.round(Number(part.slice(0, -1)) * 2.55);
      }
      return Math.round(Number(part));
    });
    const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
    if (!channels.every((value) => Number.isFinite(value)) ||
        !Number.isFinite(alpha) ||
        alpha <= 0) {
      return null;
    }
    return channels.map((value) => Math.max(0, Math.min(255, value)));
  }

  function getSwitcherLuminance(rgb) {
    const [red, green, blue] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  function getSystemSwitcherTheme() {
    return switcherThemeMediaQuery && switcherThemeMediaQuery.matches ? 'dark' : 'light';
  }

  function themeFromSwitcherColor(color) {
    const rgb = parseSwitcherCssColor(color);
    if (!rgb || rgb.length !== 3) {
      return null;
    }
    return getSwitcherLuminance(rgb) < 0.42 ? 'dark' : 'light';
  }

  function detectSwitcherPageTheme() {
    const docEl = document.documentElement;
    const body = document.body;
    if (!docEl) {
      return null;
    }
    if (docEl.hasAttribute('dark') || (body && body.hasAttribute('dark'))) {
      return 'dark';
    }
    if (docEl.hasAttribute('light') || (body && body.hasAttribute('light'))) {
      return 'light';
    }
    const attrCandidates = [
      docEl.getAttribute('data-theme'),
      docEl.getAttribute('data-color-scheme'),
      docEl.getAttribute('data-color-mode'),
      docEl.getAttribute('data-mode'),
      docEl.getAttribute('data-appearance'),
      docEl.getAttribute('color-scheme'),
      docEl.getAttribute('theme'),
      docEl.getAttribute('data-bs-theme'),
      body ? body.getAttribute('data-theme') : null,
      body ? body.getAttribute('data-color-scheme') : null,
      body ? body.getAttribute('data-color-mode') : null,
      body ? body.getAttribute('data-mode') : null,
      body ? body.getAttribute('data-appearance') : null,
      body ? body.getAttribute('color-scheme') : null,
      body ? body.getAttribute('theme') : null,
      body ? body.getAttribute('data-bs-theme') : null
    ];
    for (let i = 0; i < attrCandidates.length; i += 1) {
      const value = String(attrCandidates[i] || '').toLowerCase();
      if (!value) {
        continue;
      }
      if (value.includes('dark') ||
          value.includes('night') ||
          value === '1' ||
          value === 'true' ||
          value === 'on') {
        return 'dark';
      }
      if (value.includes('light') ||
          value.includes('day') ||
          value === '0' ||
          value === 'false' ||
          value === 'off') {
        return 'light';
      }
    }
    const youtubeDarkRoot = document.querySelector('ytd-app[dark], ytm-app[dark]');
    if (youtubeDarkRoot) {
      return 'dark';
    }
    const classTokens = [
      docEl.className || '',
      body ? body.className || '' : ''
    ];
    for (let i = 0; i < classTokens.length; i += 1) {
      const classText = String(classTokens[i] || '').toLowerCase();
      const tokenList = classText.split(/\s+/);
      if (tokenList.includes('dark')) {
        return 'dark';
      }
      if (tokenList.includes('light')) {
        return 'light';
      }
      if (/(^|[\s_-])(dark|darkmode|dark-theme|theme-dark|night)([\s_-]|$)/.test(classText)) {
        return 'dark';
      }
      if (/(^|[\s_-])(light|lightmode|light-theme|theme-light|day)([\s_-]|$)/.test(classText)) {
        return 'light';
      }
    }
    const bodyStyle = body ? window.getComputedStyle(body) : null;
    const docStyle = window.getComputedStyle(docEl);
    const bgColor = bodyStyle && themeFromSwitcherColor(bodyStyle.backgroundColor)
      ? bodyStyle.backgroundColor
      : docStyle.backgroundColor;
    const backgroundTheme = themeFromSwitcherColor(bgColor);
    if (backgroundTheme) {
      return backgroundTheme;
    }
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const themeColor = String(themeColorMeta.getAttribute('content') || '').trim();
      const theme = themeFromSwitcherColor(themeColor);
      if (theme) {
        return theme;
      }
    }
    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) {
      const metaContent = String(colorSchemeMeta.getAttribute('content') || '').toLowerCase();
      if (metaContent.includes('dark') && !metaContent.includes('light')) {
        return 'dark';
      }
      if (metaContent.includes('light') && !metaContent.includes('dark')) {
        return 'light';
      }
    }
    const schemeValue = (window.getComputedStyle(docEl).colorScheme || '').toLowerCase();
    if (schemeValue.includes('dark') && !schemeValue.includes('light')) {
      return 'dark';
    }
    if (schemeValue.includes('light') && !schemeValue.includes('dark')) {
      return 'light';
    }
    return null;
  }

  function resolveSwitcherTheme() {
    const pageTheme = detectSwitcherPageTheme();
    if (pageTheme) {
      return pageTheme;
    }
    return getSystemSwitcherTheme();
  }

  function applySwitcherTheme(panel) {
    if (!panel) {
      return;
    }
    const resolved = resolveSwitcherTheme();
    panel.setAttribute('data-theme', resolved);
    panel.style.setProperty('color-scheme', resolved);
  }

  function createSwitcherThemeController(panel) {
    const themeAttrFilter = [
      'class',
      'style',
      'data-theme',
      'data-color-scheme',
      'data-color-mode',
      'data-mode',
      'data-appearance',
      'theme',
      'color-scheme',
      'dark',
      'light',
      'data-bs-theme'
    ];
    let themeMediaListener = null;
    let pageThemeObserver = null;
    let pageThemeSyncRaf = null;
    let destroyed = false;
    let started = false;

    function refreshSwitcherTheme() {
      if (!destroyed) {
        applySwitcherTheme(panel);
      }
    }

    function schedulePageThemeSync() {
      if (pageThemeSyncRaf !== null) {
        return;
      }
      pageThemeSyncRaf = requestAnimationFrame(() => {
        pageThemeSyncRaf = null;
        if (destroyed || !panel || !panel.isConnected) {
          return;
        }
        refreshSwitcherTheme();
      });
    }

    function stopPageThemeObserver() {
      if (pageThemeSyncRaf !== null) {
        cancelAnimationFrame(pageThemeSyncRaf);
        pageThemeSyncRaf = null;
      }
      if (pageThemeObserver) {
        pageThemeObserver.disconnect();
        pageThemeObserver = null;
      }
    }

    function startPageThemeObserver() {
      if (pageThemeObserver || typeof MutationObserver !== 'function') {
        return;
      }
      pageThemeObserver = new MutationObserver(() => {
        schedulePageThemeSync();
      });
      const docEl = document.documentElement;
      if (docEl) {
        pageThemeObserver.observe(docEl, {
          attributes: true,
          attributeFilter: themeAttrFilter
        });
      }
      const body = document.body;
      if (body) {
        pageThemeObserver.observe(body, {
          attributes: true,
          attributeFilter: themeAttrFilter
        });
      }
      const head = document.head;
      if (head) {
        pageThemeObserver.observe(head, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['name', 'content', 'media']
        });
      }
      schedulePageThemeSync();
    }

    function removeThemeMediaListener() {
      if (!themeMediaListener || !switcherThemeMediaQuery) {
        return;
      }
      if (typeof switcherThemeMediaQuery.removeEventListener === 'function') {
        switcherThemeMediaQuery.removeEventListener('change', themeMediaListener);
      } else if (typeof switcherThemeMediaQuery.removeListener === 'function') {
        switcherThemeMediaQuery.removeListener(themeMediaListener);
      }
      themeMediaListener = null;
    }

    function installThemeMediaListener() {
      if (!switcherThemeMediaQuery || themeMediaListener) {
        return;
      }
      themeMediaListener = () => {
        refreshSwitcherTheme();
      };
      if (typeof switcherThemeMediaQuery.addEventListener === 'function') {
        switcherThemeMediaQuery.addEventListener('change', themeMediaListener);
      } else if (typeof switcherThemeMediaQuery.addListener === 'function') {
        switcherThemeMediaQuery.addListener(themeMediaListener);
      }
    }

    function start() {
      if (started) {
        return;
      }
      started = true;
      destroyed = false;
      refreshSwitcherTheme();
      startPageThemeObserver();
      installThemeMediaListener();
    }

    function destroy() {
      destroyed = true;
      started = false;
      removeThemeMediaListener();
      stopPageThemeObserver();
    }

    return {
      start,
      destroy,
      refresh: refreshSwitcherTheme
    };
  }

  function formatSwitcherScale(value) {
    const rounded = Math.round(value * 1000) / 1000;
    return String(rounded);
  }

  function getSwitcherVisualViewportScale(win) {
    const visualViewport = win && win.visualViewport ? win.visualViewport : null;
    const scale = visualViewport && Number.isFinite(Number(visualViewport.scale))
      ? Number(visualViewport.scale)
      : 1;
    return scale > 0 ? scale : 1;
  }

  function getSwitcherViewportComfortScale(win) {
    const visualViewport = win && win.visualViewport ? win.visualViewport : null;
    const width = visualViewport && Number.isFinite(Number(visualViewport.width))
      ? Number(visualViewport.width)
      : (win && Number.isFinite(Number(win.innerWidth)) ? Number(win.innerWidth) : 0);
    const height = visualViewport && Number.isFinite(Number(visualViewport.height))
      ? Number(visualViewport.height)
      : (win && Number.isFinite(Number(win.innerHeight)) ? Number(win.innerHeight) : 0);
    if (width >= 1440 && height >= 820) {
      return 1.08;
    }
    if (width >= 1180 && height >= 700) {
      return 1.045;
    }
    return 1;
  }

  function applySwitcherViewportPlacement(panel, win) {
    if (!panel || !panel.style) {
      return;
    }
    const targetWindow = win || window;
    const visualViewport = targetWindow && targetWindow.visualViewport
      ? targetWindow.visualViewport
      : null;
    const viewportWidth = visualViewport && Number.isFinite(Number(visualViewport.width))
      ? Math.max(0, Number(visualViewport.width))
      : Math.max(0, Number(targetWindow && targetWindow.innerWidth) || 0);
    const viewportHeight = visualViewport && Number.isFinite(Number(visualViewport.height))
      ? Math.max(0, Number(visualViewport.height))
      : Math.max(0, Number(targetWindow && targetWindow.innerHeight) || 0);
    const offsetLeft = visualViewport && Number.isFinite(Number(visualViewport.offsetLeft))
      ? Math.max(0, Number(visualViewport.offsetLeft))
      : 0;
    const offsetTop = visualViewport && Number.isFinite(Number(visualViewport.offsetTop))
      ? Math.max(0, Number(visualViewport.offsetTop))
      : 0;
    panel.style.setProperty(
      '--x-tab-switcher-center-left',
      `${Math.round(offsetLeft + (viewportWidth / 2))}px`
    );
    panel.style.setProperty(
      '--x-tab-switcher-center-top',
      `${Math.round(offsetTop + (viewportHeight / 2))}px`
    );
  }

  function applySwitcherZoomCompensation(panel, tabZoomFactor, visualViewportScale) {
    if (!panel) {
      return;
    }
    const zoomRaw = Number(tabZoomFactor);
    const visualScale = Number.isFinite(Number(visualViewportScale)) && Number(visualViewportScale) > 0
      ? Number(visualViewportScale)
      : 1;
    const combinedScale = zoomRaw * visualScale;
    const baseVisibleScale = Number.isFinite(combinedScale) && combinedScale > 0 && combinedScale !== 1
      ? Math.max(0.35, Math.min(4, 1 / combinedScale))
      : 1;
    const viewportComfortScale = getSwitcherViewportComfortScale(window);
    const visibleScale = Math.max(0.35, Math.min(4, baseVisibleScale * viewportComfortScale));
    panel.style.setProperty('--x-tab-switcher-visible-scale', formatSwitcherScale(visibleScale));
  }

  function buildStyles() {
    return `
      :host {
        all: initial;
      }
      #${PANEL_ID},
      #${PANEL_ID} * {
        box-sizing: border-box;
        font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: none !important;
      }
      /* Cards are the only mouse surface: a trusted click jumps straight to
      that tab. Hovering never touches the keyboard-selected card. */
      #${PANEL_ID} .x-tab-switcher-card {
        pointer-events: auto !important;
        cursor: pointer;
      }
      #${PANEL_ID} .x-tab-switcher-card:not([data-active="true"]):hover {
        border-color: rgba(15, 23, 42, 0.14);
        background: rgba(255, 255, 255, 0.55);
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-card:not([data-active="true"]):hover {
        border-color: rgba(148, 163, 184, 0.32);
        background: rgba(30, 41, 59, 0.4);
      }
      #${PANEL_ID} {
        all: unset;
        --x-tab-switcher-accent: #2563eb;
        --x-tab-switcher-card-width: clamp(136px, calc((100vw - 68px) / var(--x-tab-count, 5)), 204px);
        --x-tab-switcher-gap: 6px;
        --x-tab-switcher-padding-panel: 10px;
        --x-tab-switcher-padding-card: 7px;
        --x-tab-switcher-border-card: 1px;
        --x-tab-switcher-radius-panel: 30px;
        --x-tab-switcher-radius-card: calc(var(--x-tab-switcher-radius-panel) - var(--x-tab-switcher-padding-panel));
        --x-tab-switcher-radius-thumb: calc(var(--x-tab-switcher-radius-card) - var(--x-tab-switcher-padding-card) - var(--x-tab-switcher-border-card));
        --x-tab-switcher-radius-icon: 9px;
        --x-tab-switcher-radius-title-icon: 4px;
        --x-tab-switcher-meta-inline-padding: 3px;
        --x-tab-switcher-visible-scale: 1;
        --x-tab-switcher-motion-card: 180ms cubic-bezier(0.22, 1, 0.36, 1);
        --x-tab-switcher-motion-cover: 220ms cubic-bezier(0.22, 1, 0.36, 1);
        --x-tab-switcher-thumb-stroke-inset: -0.5px;
        --x-tab-switcher-thumb-stroke-radius-offset: 0.5px;
        --x-tab-switcher-thumb-stroke-color: rgba(15, 23, 42, 0.2);
        --x-tab-switcher-title-icon-size: 16px;
        --x-tab-switcher-title-icon-gap: 5px;
        color-scheme: light;
        position: fixed;
        left: var(--x-tab-switcher-center-left, 50%);
        top: var(--x-tab-switcher-center-top, 50%);
        transform: translate3d(-50%, -50%, 0) scale(var(--x-tab-switcher-visible-scale));
        transform-origin: center center;
        z-index: 2147483647;
        width: fit-content;
        max-width: calc(100vw - 24px);
        color: #172033;
        background:
          radial-gradient(120% 160% at 12% -24%, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.44) 38%, rgba(241, 245, 249, 0.26) 100%),
          linear-gradient(135deg, rgba(255, 255, 255, 0.48), rgba(226, 232, 240, 0.28));
        border: 0;
        border-radius: var(--x-tab-switcher-radius-panel);
        box-shadow:
          0 26px 82px rgba(15, 23, 42, 0.22),
          0 5px 18px rgba(15, 23, 42, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.86),
          inset 0 -18px 44px rgba(255, 255, 255, 0.22),
          inset 0 0 0 1px rgba(255, 255, 255, 0.3);
        backdrop-filter: blur(56px) saturate(210%);
        -webkit-backdrop-filter: blur(56px) saturate(210%);
        padding: var(--x-tab-switcher-padding-panel);
        pointer-events: none;
        opacity: 0;
        transition: opacity 90ms ease;
        will-change: opacity;
      }
      #${PANEL_ID}[data-visible="true"] {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scale(var(--x-tab-switcher-visible-scale));
      }
      .x-tab-switcher-list {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--x-tab-switcher-gap);
        width: calc(
          var(--x-tab-count, 5) * var(--x-tab-switcher-card-width) +
          (var(--x-tab-count, 5) - 1) * var(--x-tab-switcher-gap)
        );
        max-width: 100%;
      }
      .x-tab-switcher-card {
        all: unset;
        width: var(--x-tab-switcher-card-width);
        min-width: var(--x-tab-switcher-card-width);
        max-width: var(--x-tab-switcher-card-width);
        display: flex;
        flex-direction: column;
        gap: 7px;
        border-radius: var(--x-tab-switcher-radius-card);
        border: var(--x-tab-switcher-border-card) solid transparent;
        outline: 0;
        background: transparent;
        padding: var(--x-tab-switcher-padding-card);
        color: #172033;
        box-shadow: none;
        transition: border-color 140ms ease, background 140ms ease, box-shadow var(--x-tab-switcher-motion-card);
      }
      .x-tab-switcher-card[data-active="true"] {
        transform: none;
        border-color: color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 32%, rgba(15, 23, 42, 0.08));
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 16%, rgba(255, 255, 255, 0.88)),
            color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 8%, rgba(255, 255, 255, 0.78))
          );
        box-shadow:
          0 0 16px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 7%, transparent),
          0 4px 10px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 3%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.84),
          inset 0 0 0 1px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 12%, rgba(255, 255, 255, 0.72));
      }
      .x-tab-switcher-thumb {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        border-radius: var(--x-tab-switcher-radius-thumb);
        background: color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 14%, rgba(248, 250, 252, 0.94));
      }
      .x-tab-switcher-thumb::after {
        content: "";
        position: absolute;
        inset: var(--x-tab-switcher-thumb-stroke-inset);
        z-index: 2;
        border-radius: calc(var(--x-tab-switcher-radius-thumb) + var(--x-tab-switcher-thumb-stroke-radius-offset));
        box-sizing: border-box;
        border: 1px solid var(--x-tab-switcher-thumb-stroke-color);
        box-shadow: none;
        pointer-events: none;
      }
      .x-tab-switcher-thumb img[data-kind="thumbnail"] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        object-position: top center;
        opacity: 1;
        transition: opacity var(--x-tab-switcher-motion-cover);
        will-change: opacity;
      }
      .x-tab-switcher-thumb img[data-kind="thumbnail"][data-entering="true"] {
        opacity: 0;
      }
      .x-tab-switcher-thumb img[data-kind="thumbnail"][data-exiting="true"] {
        opacity: 0;
      }
      .x-tab-switcher-thumb img[data-broken="true"] {
        display: none;
      }
      .x-tab-switcher-fallback {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .x-tab-switcher-favicon {
        width: 38px;
        height: 38px;
        border-radius: var(--x-tab-switcher-radius-icon);
      }
      .x-tab-switcher-favicon[data-broken="true"],
      .x-tab-switcher-title-favicon[data-broken="true"] {
        visibility: hidden;
      }
      .x-tab-switcher-meta {
        min-width: 0;
        display: grid;
        gap: 3px;
        padding: 0 var(--x-tab-switcher-meta-inline-padding);
      }
      .x-tab-switcher-name-row {
        min-width: 0;
        display: grid;
        grid-template-columns: var(--x-tab-switcher-title-icon-size) minmax(0, 1fr);
        align-items: center;
        gap: var(--x-tab-switcher-title-icon-gap);
      }
      .x-tab-switcher-title-favicon {
        width: var(--x-tab-switcher-title-icon-size);
        height: var(--x-tab-switcher-title-icon-size);
        min-width: 0;
        border-radius: var(--x-tab-switcher-radius-title-icon);
        object-fit: cover;
        opacity: 1;
      }
      .x-tab-switcher-name {
        min-width: 0;
        display: block;
        color: #172033;
        font-size: 11.5px;
        font-weight: 500;
        line-height: 1.16;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .x-tab-switcher-host {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(23, 32, 51, 0.58);
        font-size: 11px;
        font-weight: 560;
        line-height: 1.18;
      }
      @supports (corner-shape: superellipse(1.25)) {
        #${PANEL_ID},
        .x-tab-switcher-card,
        .x-tab-switcher-thumb,
        .x-tab-switcher-thumb::after,
        .x-tab-switcher-favicon,
        .x-tab-switcher-title-favicon {
          corner-shape: superellipse(1.25);
        }
      }
      @media (max-width: 860px) {
        #${PANEL_ID} {
          --x-tab-switcher-card-width: calc((100vw - 32px) / 5);
          --x-tab-switcher-gap: 3px;
          --x-tab-switcher-padding-panel: 5px;
          --x-tab-switcher-padding-card: 5px;
          --x-tab-switcher-radius-panel: 24px;
          --x-tab-switcher-radius-icon: 9px;
          --x-tab-switcher-radius-title-icon: 4px;
          --x-tab-switcher-meta-inline-padding: 2px;
          --x-tab-switcher-title-icon-size: 13px;
          --x-tab-switcher-title-icon-gap: 4px;
          top: 50%;
          max-width: calc(100vw - 10px);
          padding: var(--x-tab-switcher-padding-panel);
        }
        .x-tab-switcher-card {
          gap: 4px;
          padding: var(--x-tab-switcher-padding-card);
        }
        .x-tab-switcher-meta {
          gap: 0;
        }
        .x-tab-switcher-name {
          font-size: 10.5px;
          line-height: 1.14;
        }
        .x-tab-switcher-host {
          display: none;
        }
      }
      #${PANEL_ID}[data-theme="dark"] {
        --x-tab-switcher-thumb-stroke-color: rgba(255, 255, 255, 0.24);
        color-scheme: dark;
        color: #f8fafc;
        background:
          radial-gradient(120% 150% at 12% -22%, rgba(71, 85, 105, 0.4) 0%, rgba(30, 41, 59, 0.5) 40%, rgba(8, 13, 24, 0.44) 100%),
          linear-gradient(135deg, rgba(30, 41, 59, 0.54), rgba(8, 13, 24, 0.46));
        box-shadow:
          0 26px 82px rgba(0, 0, 0, 0.38),
          0 5px 18px rgba(0, 0, 0, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          inset 0 -18px 42px rgba(255, 255, 255, 0.04),
          inset 0 0 0 1px rgba(255, 255, 255, 0.05);
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-card {
        color: #f8fafc;
        background: transparent;
        box-shadow: none;
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-card[data-active="true"] {
        border-color: color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 34%, rgba(255, 255, 255, 0.12));
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 18%, rgba(30, 41, 59, 0.72)),
            color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 10%, rgba(8, 13, 24, 0.72))
          );
        box-shadow:
          0 0 18px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 10%, transparent),
          0 4px 10px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 5%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.13),
          inset 0 0 0 1px color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 12%, rgba(255, 255, 255, 0.08));
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-name {
        color: #f8fafc;
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-host {
        color: rgba(248, 250, 252, 0.58);
      }
      #${PANEL_ID}[data-theme="dark"] .x-tab-switcher-thumb {
        background: color-mix(in srgb, var(--x-tab-switcher-card-accent, var(--x-tab-switcher-accent)) 18%, rgba(15, 23, 42, 0.92));
      }
      @media (prefers-reduced-motion: reduce) {
        .x-tab-switcher-thumb img[data-kind="thumbnail"] {
          transition: none;
        }
      }
    `;
  }

  function isImageDataUrl(value) {
    return String(value || '').startsWith('data:image/');
  }

  function createTabSwitcherView(options) {
    const doc = options.document || document;
    const win = doc.defaultView || window;
    const tabs = (Array.isArray(options.tabs) ? options.tabs : [])
      .filter((tab) => tab && Number.isInteger(tab.id))
      .slice(0, 10)
      .map((tab) => ({ ...tab }));
    let selectedIndex = Number(options.selectedIndex) || 0;
    let panel = null;
    let listEl = null;
    let destroyed = false;
    const timers = new Set();
    const requestFrame = typeof win.requestAnimationFrame === 'function'
      ? (callback) => win.requestAnimationFrame(callback)
      : (callback) => win.setTimeout(() => callback(Date.now()), 0);

    function createImage(className, src, alt, kind, entering, exiting, usePlaceholder) {
      const img = doc.createElement('img');
      if (className) {
        img.className = className;
      }
      img.src = src;
      img.alt = alt || '';
      img.decoding = 'async';
      img.loading = 'eager';
      img.referrerPolicy = 'no-referrer';
      if (kind) {
        img.dataset.kind = kind;
      }
      if (entering) {
        img.dataset.entering = 'true';
      }
      if (exiting) {
        img.dataset.exiting = 'true';
      }
      img.addEventListener('error', () => {
        if (usePlaceholder === true) {
          applyFaviconImageFallback(img);
          return;
        }
        img.dataset.broken = 'true';
        img.removeAttribute('src');
      });
      return img;
    }

    function createPlaceholderImage(className, alt) {
      const img = createImage(className, getFaviconPlaceholderUrl(1), alt, '', false, false, true);
      img.dataset.faviconFallbackStage = '1';
      return img;
    }

    function buildThumbChildren(thumbEl, tab, previousThumbnail, entering) {
      while (thumbEl.firstChild) {
        thumbEl.removeChild(thumbEl.firstChild);
      }
      if (isImageDataUrl(previousThumbnail)) {
        thumbEl.appendChild(createImage('', previousThumbnail, '', 'thumbnail', false, true));
      }
      const thumbnail = String(tab.thumbnail || '');
      if (isImageDataUrl(thumbnail)) {
        thumbEl.appendChild(createImage('', thumbnail, '', 'thumbnail', Boolean(entering), false));
      } else {
        const fallback = doc.createElement('div');
        fallback.className = 'x-tab-switcher-fallback';
        const favicon = String(tab.favIconUrl || '');
        fallback.appendChild(favicon
          ? createImage(
            'x-tab-switcher-favicon',
            favicon,
            options.getMessage('tab_switcher_favicon_alt', 'Site icon'),
            '', false, false, true
          )
          : createPlaceholderImage(
            'x-tab-switcher-favicon',
            options.getMessage('tab_switcher_favicon_alt', 'Site icon')
          ));
        thumbEl.appendChild(fallback);
      }
    }

    function buildCard(tab, index) {
      const title = options.sanitizeText(
        tab.title,
        options.getMessage('tab_switcher_untitled', 'Untitled')
      );
      const url = String(tab.url || '');
      const favicon = String(tab.favIconUrl || '');
      const thumbnailStatus = options.getThumbnailStatus(tab, String(tab.thumbnail || ''));
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'x-tab-switcher-card';
      button.dataset.tabId = String(tab.id);
      button.dataset.thumbnailStatus = thumbnailStatus;
      button.dataset.active = index === selectedIndex ? 'true' : 'false';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === selectedIndex ? 'true' : 'false');
      button.setAttribute('aria-label', title);
      button.tabIndex = index === selectedIndex ? 0 : -1;
      const accent = options.normalizeAccentCss(tab.accentRgb);
      if (accent) {
        button.style.setProperty('--x-tab-switcher-card-accent', accent);
      }
      if (typeof options.onCardSelect === 'function') {
        button.addEventListener('click', (event) => {
          if (!event || event.isTrusted !== true) {
            return;
          }
          options.onCardSelect(index);
        });
      }
      if (typeof options.onCardClose === 'function') {
        button.addEventListener('contextmenu', (event) => {
          if (!event || event.isTrusted !== true) {
            return;
          }
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          event.stopPropagation();
          options.onCardClose(index);
        });
      }

      const thumb = doc.createElement('div');
      thumb.className = 'x-tab-switcher-thumb';
      thumb.dataset.tabId = String(tab.id);
      thumb.dataset.thumbnailStatus = thumbnailStatus;
      const thumbnailReason = options.sanitizeText(tab.thumbnailReason, '');
      if (thumbnailReason) {
        thumb.dataset.thumbnailReason = thumbnailReason;
      }
      buildThumbChildren(thumb, tab, '', false);

      const meta = doc.createElement('div');
      meta.className = 'x-tab-switcher-meta';
      const nameRow = doc.createElement('div');
      nameRow.className = 'x-tab-switcher-name-row';
      if (favicon) {
        nameRow.appendChild(createImage('x-tab-switcher-title-favicon', favicon, '', '', false, false, true));
      } else {
        nameRow.appendChild(createPlaceholderImage('x-tab-switcher-title-favicon', ''));
      }
      const name = doc.createElement('div');
      name.className = 'x-tab-switcher-name';
      name.title = title;
      name.textContent = title;
      nameRow.appendChild(name);
      const hostLabel = doc.createElement('div');
      hostLabel.className = 'x-tab-switcher-host';
      hostLabel.textContent = options.getHostLabel(url) || url;
      meta.appendChild(nameRow);
      meta.appendChild(hostLabel);
      button.appendChild(thumb);
      button.appendChild(meta);
      return button;
    }

    function getButtons() {
      return panel
        ? Array.from(panel.querySelectorAll('.x-tab-switcher-card'))
        : [];
    }

    function renderCards() {
      if (!panel || !listEl || destroyed) {
        return;
      }
      while (listEl.firstChild) {
        listEl.removeChild(listEl.firstChild);
      }
      tabs.forEach((tab, index) => {
        listEl.appendChild(buildCard(tab, index));
      });
    }

    function applySelection() {
      getButtons().forEach((button, index) => {
        const active = index === selectedIndex;
        button.dataset.active = active ? 'true' : 'false';
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      });
    }

    const controller = {
      get panel() {
        return panel;
      },
      get buttons() {
        return getButtons();
      },
      updateSelection(index) {
        selectedIndex = Number(index) || 0;
        applySelection();
      },
      removeTabAt(index) {
        const position = Math.trunc(Number(index));
        if (!Number.isInteger(position) || position < 0 || position >= tabs.length) {
          return false;
        }
        tabs.splice(position, 1);
        renderCards();
        return true;
      },
      updateThumbnail(update) {
        const tabId = Number(update && update.tabId);
        const index = tabs.findIndex((tab) => tab && tab.id === tabId);
        if (!Number.isInteger(tabId) || index < 0) {
          return { ok: false, reason: 'tab-not-visible' };
        }
        const thumbnail = String((update && update.thumbnail) || '');
        if (!isImageDataUrl(thumbnail)) {
          return { ok: false, reason: 'invalid-thumbnail' };
        }
        const tab = tabs[index];
        const updateUrl = String((update && update.url) || '');
        if (updateUrl && tab.url && updateUrl !== tab.url) {
          return { ok: false, reason: 'tab-url-mismatch' };
        }
        if (tab.thumbnail === thumbnail) {
          return { ok: true };
        }
        const previousThumbnail = isImageDataUrl(tab.thumbnail) ? String(tab.thumbnail) : '';
        tabs[index] = {
          ...tab,
          thumbnail,
          thumbnailStatus: (update && update.thumbnailStatus) || 'ok',
          thumbnailReason: (update && update.thumbnailReason) || ''
        };
        const cardEl = getButtons()[index] || null;
        if (cardEl) {
          const thumbEl = cardEl.querySelector('.x-tab-switcher-thumb');
          if (thumbEl) {
            const status = options.getThumbnailStatus(tabs[index], thumbnail);
            cardEl.dataset.thumbnailStatus = status;
            thumbEl.dataset.thumbnailStatus = status;
            const thumbnailReason = options.sanitizeText(tabs[index].thumbnailReason, '');
            if (thumbnailReason) {
              thumbEl.dataset.thumbnailReason = thumbnailReason;
            } else {
              delete thumbEl.dataset.thumbnailReason;
            }
            buildThumbChildren(thumbEl, tabs[index], previousThumbnail, true);
          }
        }
        requestFrame(() => {
          if (destroyed || !tabs[index] || tabs[index].id !== tabId) {
            return;
          }
          const enteringCard = getButtons()[index] || null;
          const enteringImg = enteringCard
            ? enteringCard.querySelector('img[data-kind="thumbnail"][data-entering="true"]')
            : null;
          if (enteringImg) {
            delete enteringImg.dataset.entering;
          }
          const timer = win.setTimeout(() => {
            timers.delete(timer);
            if (destroyed || !tabs[index] || tabs[index].id !== tabId) {
              return;
            }
            const settledCard = getButtons()[index] || null;
            const exitingImg = settledCard
              ? settledCard.querySelector('img[data-kind="thumbnail"][data-exiting="true"]')
              : null;
            if (exitingImg) {
              exitingImg.remove();
            }
          }, 260);
          timers.add(timer);
        });
        return { ok: true };
      },
      destroy() {
        if (destroyed) {
          return;
        }
        destroyed = true;
        timers.forEach((timer) => win.clearTimeout(timer));
        timers.clear();
        if (panel && panel.parentNode) {
          panel.parentNode.removeChild(panel);
        }
        panel = null;
        listEl = null;
      }
    };

    panel = doc.createElement('div');
    panel.id = options.panelId;
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', options.ariaLabel);
    panel.dataset.visible = 'true';
    // Columns per row caps at 5; extra cards flow into additional grid rows
    // (7 cards = 5 + 2, 10 cards = 5 + 5), keeping every card full width.
    panel.style.setProperty('--x-tab-count', String(Math.max(1, Math.min(5, tabs.length))));
    listEl = doc.createElement('div');
    listEl.className = 'x-tab-switcher-list';
    panel.appendChild(listEl);
    (options.root || doc.body).appendChild(panel);
    renderCards();
    return controller;
  }

  window._quickswitch_toggleTabSwitcher_2026_unique_ = function(rawContext) {
    const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
    if (!document.hasFocus()) {
      // A native surface (permission prompt, omnibox, another app) holds the
      // keyboard focus; the page would never see the modifier release, so a
      // keyboard-only panel would be dead on arrival.
      return { ok: false, reason: 'page-not-focused' };
    }
    if (document.fullscreenElement) {
      // The fullscreen element replaces the whole viewport, so an overlay
      // attached to <html> would never be painted. Route to the dedicated
      // popup window instead — the video keeps playing undisturbed.
      return { ok: false, reason: 'page-fullscreen' };
    }
    if (handleExistingSwitcher(context)) {
      return { ok: true, reason: 'already-open' };
    }
    const tabs = Array.isArray(context.tabs)
      ? context.tabs.filter((tab) => tab && typeof tab.id === 'number').slice(0, 10)
      : [];
    if (!tabs.length) {
      return { ok: false, reason: 'empty' };
    }
    const shortcut = parseTabSwitcherShortcut(context.shortcut);
    const shortcutSuppressor = typeof createShortcutSuppressor === 'function'
      ? createShortcutSuppressor(shortcut, context.suppressInitialShortcutAdvance === true)
      : null;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all: initial !important',
      'position: fixed !important',
      'inset: 0 !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important',
      'contain: layout style paint !important'
    ].join(';');
    const shadow = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'closed' }) : host;
    const style = document.createElement('style');
    style.textContent = buildStyles();
    shadow.appendChild(style);

    let selectedIndex = clampSelectedIndex(context.selectedIndex, tabs.length);
    const tabSwitcherView = createTabSwitcherView({
      document,
      root: shadow,
      panelId: PANEL_ID,
      tabs,
      selectedIndex,
      ariaLabel: getMessage('tab_switcher_title', 'Recent tabs'),
      sanitizeText,
      getHostLabel,
      getMessage,
      normalizeAccentCss,
      getThumbnailStatus,
      onCardSelect: (index) => {
        selectedIndex = clampSelectedIndex(index, tabs.length);
        renderSelection();
        switchToSelected();
      },
      onCardClose: (index) => {
        closeTabAtIndex(index);
      }
    });
    const panel = tabSwitcherView.panel;
    if (!panel) {
      host.remove();
      return { ok: false, reason: 'panel-view-unavailable' };
    }
    applySwitcherViewportPlacement(panel, window);
    applySwitcherZoomCompensation(panel, context.tabZoomFactor, getSwitcherVisualViewportScale(window));

    function syncSwitcherZoomCompensation() {
      applySwitcherViewportPlacement(panel, window);
      applySwitcherZoomCompensation(panel, context.tabZoomFactor, getSwitcherVisualViewportScale(window));
    }

    const switcherThemeController = createSwitcherThemeController(panel);
    switcherThemeController.start();

    let didRequestSwitch = false;

    function renderSelection() {
      tabSwitcherView.updateSelection(selectedIndex);
    }

    function reportTabVisibleToBackground() {
      if (!chromeApi || !chromeApi.runtime || typeof chromeApi.runtime.sendMessage !== 'function') {
        return;
      }
      try {
        chromeApi.runtime.sendMessage({
          action: 'reportTabVisible',
          at: Date.now(),
          reason: 'panel'
        }, () => {
          void (chromeApi.runtime && chromeApi.runtime.lastError);
        });
      } catch (error) {
        // Ignore stale extension contexts while a tab or the extension reloads.
      }
    }

    function close() {
      const cleanup = host._quickswitchTabSwitcherCleanup;
      if (typeof cleanup === 'function') {
        cleanup();
      }
      host.remove();
    }

    function switchToSelected() {
      if (didRequestSwitch) {
        return false;
      }
      const selected = tabs[selectedIndex];
      if (!selected || typeof selected.id !== 'number') {
        close();
        return false;
      }
      didRequestSwitch = true;
      if (!chromeApi || !chromeApi.runtime || typeof chromeApi.runtime.sendMessage !== 'function') {
        close();
        return true;
      }
      try {
        chromeApi.runtime.sendMessage({
          action: 'switchToTab',
          tabId: selected.id,
          windowId: typeof selected.windowId === 'number' ? selected.windowId : null
        }, () => {
          void (chromeApi.runtime && chromeApi.runtime.lastError);
          close();
        });
      } catch (error) {
        close();
      }
      return true;
    }

    function selectByOffset(offset) {
      selectedIndex = clampSelectedIndex(selectedIndex + offset, tabs.length);
      renderSelection();
    }

    function closeTabAtIndex(index) {
      if (didRequestSwitch) {
        return false;
      }
      const position = Math.trunc(Number(index));
      if (!Number.isInteger(position) || position < 0 || position >= tabs.length) {
        return false;
      }
      const target = tabs[position];
      if (!target || typeof target.id !== 'number') {
        return false;
      }
      // Send before mutating local state: in the page-overlay mode, closing
      // the host tab tears this script down mid-call.
      if (chromeApi && chromeApi.runtime && typeof chromeApi.runtime.sendMessage === 'function') {
        try {
          chromeApi.runtime.sendMessage({
            action: 'closeTab',
            tabId: target.id
          }, () => {
            void (chromeApi.runtime && chromeApi.runtime.lastError);
          });
        } catch (error) {
          // A stale extension context means the panel is going away anyway.
        }
      }
      tabs.splice(position, 1);
      tabSwitcherView.removeTabAt(position);
      selectedIndex = nextSelectedIndexAfterRemoval(position, selectedIndex, tabs.length);
      if (!tabs.length) {
        close();
        return true;
      }
      renderSelection();
      return true;
    }

    function advanceSelectionFromShortcut(offset) {
      if (shortcutSuppressor) {
        shortcutSuppressor.markExternalAdvance();
      }
      selectByOffset(offset);
      return true;
    }

    host._quickswitchTabSwitcherAdvance = function(offset) {
      return advanceSelectionFromShortcut(normalizeAdvanceOffset(offset));
    };
    host._quickswitchTabSwitcherCommitFromShortcutRelease = function() {
      return switchToSelected();
    };
    host._quickswitchTabSwitcherUpdateThumbnail = function(update) {
      return tabSwitcherView.updateThumbnail(update);
    };

    function handleExternalAdvance(event) {
      if (didRequestSwitch) {
        return;
      }
      const detail = event && event.detail && typeof event.detail === 'object' ? event.detail : {};
      advanceSelectionFromShortcut(normalizeAdvanceOffset(detail.offset));
    }

    function stopHandledKeyEvent(event) {
      if (!event) {
        return;
      }
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      event.stopPropagation();
    }

    function handleKeydown(event) {
      if (!event || event.isTrusted !== true) {
        return;
      }
      if (event.key === 'Tab') {
        stopHandledKeyEvent(event);
        selectByOffset(event.shiftKey ? -1 : 1);
        return;
      }
      if (isTabSwitcherShortcutTriggerEvent(shortcut, event)) {
        stopHandledKeyEvent(event);
        if (shortcutSuppressor && shortcutSuppressor.shouldSwallowTriggerKeydown(event)) {
          return;
        }
        if (shortcutSuppressor) {
          shortcutSuppressor.markTriggerAdvanced();
        }
        selectByOffset(1);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        stopHandledKeyEvent(event);
        selectByOffset(1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        stopHandledKeyEvent(event);
        selectByOffset(-1);
        return;
      }
      if (event.key === 'Enter') {
        stopHandledKeyEvent(event);
        switchToSelected();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        stopHandledKeyEvent(event);
        closeTabAtIndex(selectedIndex);
        return;
      }
      if (event.key === 'Escape') {
        stopHandledKeyEvent(event);
        close();
      }
    }

    function handleKeyup(event) {
      if (!event || event.isTrusted !== true) {
        return;
      }
      if (isTabSwitcherShortcutTriggerEvent(shortcut, event)) {
        if (shortcutSuppressor) {
          shortcutSuppressor.markTriggerKeyup();
        }
        stopHandledKeyEvent(event);
        return;
      }
      if (shortcut.commitModifierEventKey &&
          event.key === shortcut.commitModifierEventKey) {
        if (shortcutSuppressor) {
          shortcutSuppressor.markTriggerKeyup();
        }
        stopHandledKeyEvent(event);
        switchToSelected();
      }
    }

    function handleDocumentVisibilityChange() {
      // The switcher is transient on the focused tab; a keyboard-only panel
      // has no outside-click close, so retire it when its host tab is hidden.
      if (document.visibilityState === 'hidden') {
        close();
      }
    }

    function handleWindowBlur() {
      // Once keyboard focus moves to a native surface (a permission prompt,
      // the omnibox, another app), the page can never see the modifier
      // release; retire instead of hanging.
      if (!didRequestSwitch) {
        close();
      }
    }

    const switcherVisualViewport = window.visualViewport && typeof window.visualViewport.addEventListener === 'function'
      ? window.visualViewport
      : null;
    host._quickswitchTabSwitcherCleanup = function() {
      window.removeEventListener('keydown', handleKeydown, true);
      window.removeEventListener('keyup', handleKeyup, true);
      window.removeEventListener('blur', handleWindowBlur, true);
      if (switcherVisualViewport && typeof switcherVisualViewport.removeEventListener === 'function') {
        switcherVisualViewport.removeEventListener('resize', syncSwitcherZoomCompensation);
        switcherVisualViewport.removeEventListener('scroll', syncSwitcherZoomCompensation);
      }
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange, true);
      document.removeEventListener(TAB_SWITCHER_ADVANCE_EVENT, handleExternalAdvance, true);
      switcherThemeController.destroy();
      tabSwitcherView.destroy();
      delete host._quickswitchTabSwitcherUpdateThumbnail;
      delete host._quickswitchTabSwitcherCommitFromShortcutRelease;
    };
    document.documentElement.appendChild(host);
    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('keyup', handleKeyup, true);
    window.addEventListener('blur', handleWindowBlur, true);
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange, true);
    if (switcherVisualViewport) {
      switcherVisualViewport.addEventListener('resize', syncSwitcherZoomCompensation, { passive: true });
      switcherVisualViewport.addEventListener('scroll', syncSwitcherZoomCompensation, { passive: true });
    }
    document.addEventListener(TAB_SWITCHER_ADVANCE_EVENT, handleExternalAdvance, true);

    renderSelection();
    reportTabVisibleToBackground();
    return { ok: true };
  };
})();
