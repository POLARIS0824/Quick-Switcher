'use strict';

try {
  importScripts(chrome.runtime.getURL('background/recent-tab-switcher.js'));
} catch (error) {
  console.warn('QuickSwitcher: failed to load the recent tab tracker.', error);
}

try {
  importScripts(chrome.runtime.getURL('background/thumbnails.js'));
} catch (error) {
  console.warn('QuickSwitcher: failed to load the thumbnail pipeline.', error);
}

const RECENT_TAB_SWITCHER = globalThis.LumnoRecentTabSwitcher || {};
const QUICK_SWITCH_THUMBNAILS = globalThis.QuickSwitchThumbnails || {};

const SHOW_TAB_SWITCHER_COMMAND_NAME = 'show-tab-switcher';
const FALLBACK_TAB_SWITCHER_SHORTCUT = 'Alt+Q';
const ENABLED_STORAGE_KEY = 'enabled';
const TAB_SWITCHER_STATE_STORAGE_KEY = 'state';
const TAB_SWITCHER_EXTENSION_PAGE_PORT_NAME = 'lumno-tab-switcher-extension-page';
// A freshly created popup window still has to load its page and connect the
// port before the open command can be delivered; wait long enough for that.
const TAB_SWITCHER_EXTENSION_PAGE_PORT_WAIT_MS = 2000;
const TAB_SWITCHER_EXTENSION_PAGE_PORT_RETRY_MS = 50;
const TAB_SWITCHER_HOST_ID = '_quickswitch_tab_switcher_host_2026_unique_';
const SWITCHER_POPUP_HOST_URL = 'pages/switcher-host.html';
const SWITCHER_POPUP_WIDTH = 1120;
const SWITCHER_POPUP_HEIGHT = 240;
const KEY_OBSERVER_FILES = ['content/key-observer.js'];
const PANEL_FILES = ['content/panel.js'];
const TAB_SWITCHER_LIMIT = 5;
const TAB_SWITCHER_OPENING_GUARD_MS = 2000;
const TAB_SWITCHER_HOST_STATE_TIMEOUT_MS = 400;
const TAB_SWITCHER_THUMBNAIL_LIMIT = 12;
const TAB_SWITCHER_THUMBNAIL_TTL_MS = 1000 * 60 * 60 * 2;
const TAB_SWITCHER_THUMBNAIL_PERSIST_DEBOUNCE_MS = 350;

let tabSwitcherEnabledCache = true;
const tabSwitcherExtensionPagePortsByTabId = new Map();
const tabSwitcherOpeningByWindowKey = new Map();
const tabSwitcherHostTabIdByWindowId = new Map();
const switcherPopupHostTabIds = new Set();
let tabSwitcherExtensionPageRequestSeq = 0;
let tabSwitcherStateLoaded = false;
let tabSwitcherStateLoadPromise = null;
let tabSwitcherStatePersistTimer = null;
let tabSwitcherStateDirtyBeforeLoad = false;

function getResolvedTabUrl(tab) {
  if (!tab || typeof tab !== 'object') {
    return '';
  }
  const directUrl = typeof tab.url === 'string' ? String(tab.url).trim() : '';
  if (directUrl) {
    return directUrl;
  }
  const pendingUrl = typeof tab.pendingUrl === 'string' ? String(tab.pendingUrl).trim() : '';
  return pendingUrl;
}

function isBrowserExtensionProtocol(protocol) {
  const normalized = String(protocol || '').toLowerCase();
  return normalized === 'chrome-extension:' ||
    normalized === 'moz-extension:' ||
    normalized === 'ms-browser-extension:';
}

function isBrowserInternalUrl(url) {
  const lower = String(url || '').toLowerCase();
  return lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('vivaldi://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('about:');
}

function canOpenOverlayOnUrl(url) {
  if (!url) {
    return false;
  }
  const lower = String(url).toLowerCase();
  if (lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('vivaldi://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('about:')) {
    return false;
  }
  try {
    const parsed = new URL(url);
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (isBrowserExtensionProtocol(protocol)) {
      return false;
    }
    if (protocol === 'file:') {
      return true;
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if ((host === 'chrome.google.com' && path.startsWith('/webstore')) ||
        host === 'chromewebstore.google.com' ||
        (host === 'microsoftedge.microsoft.com' && path.startsWith('/addons')) ||
        host === 'addons.opera.com') {
      return false;
    }
  } catch (error) {
    return false;
  }
  return true;
}

function isOwnExtensionPageUrl(url) {
  if (!url || !chrome || !chrome.runtime || !chrome.runtime.id) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.hostname === chrome.runtime.id;
  } catch (error) {
    return false;
  }
}

function shouldTrackSwitcherTab(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number' || tab.incognito === true) {
    return false;
  }
  // The switcher popup window is a transient surface, not a real destination.
  if (switcherPopupHostTabIds.has(tab.id)) {
    return false;
  }
  const url = getResolvedTabUrl(tab);
  if (!url) {
    return false;
  }
  if (isBrowserInternalUrl(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const protocol = String(parsed.protocol || '').toLowerCase();
    return Boolean(protocol) && protocol !== 'javascript:';
  } catch (error) {
    return false;
  }
}

function isTabSwitcherExtensionPageMessageTarget(tab) {
  if (!tab || typeof tab.id !== 'number') {
    return false;
  }
  return isOwnExtensionPageUrl(getResolvedTabUrl(tab));
}

function canHostSwitcherSurface(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') {
    return false;
  }
  const url = getResolvedTabUrl(tab);
  return isOwnExtensionPageUrl(url) || canOpenOverlayOnUrl(url);
}

const recentTabTracker = RECENT_TAB_SWITCHER && typeof RECENT_TAB_SWITCHER.createRecentTabTracker === 'function'
  ? RECENT_TAB_SWITCHER.createRecentTabTracker({
    limit: TAB_SWITCHER_LIMIT,
    thumbnailLimit: TAB_SWITCHER_THUMBNAIL_LIMIT,
    thumbnailTtlMs: TAB_SWITCHER_THUMBNAIL_TTL_MS,
    shouldIncludeTab: shouldTrackSwitcherTab
  })
  : null;

function getTabSwitcherStateStorageArea() {
  if (!chrome || !chrome.storage) {
    return null;
  }
  return chrome.storage.session || chrome.storage.local || null;
}

function getTabSwitcherStateFromStorage() {
  const storageArea = getTabSwitcherStateStorageArea();
  if (!storageArea || typeof storageArea.get !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    storageArea.get([TAB_SWITCHER_STATE_STORAGE_KEY], (result) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(result ? result[TAB_SWITCHER_STATE_STORAGE_KEY] : null);
    });
  });
}

function setTabSwitcherStateToStorage(state) {
  const storageArea = getTabSwitcherStateStorageArea();
  if (!storageArea || typeof storageArea.set !== 'function') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    storageArea.set({ [TAB_SWITCHER_STATE_STORAGE_KEY]: state }, () => {
      resolve(!(chrome.runtime && chrome.runtime.lastError));
    });
  });
}

function ensureTabSwitcherStateLoaded() {
  if (!recentTabTracker || typeof recentTabTracker.hydrateState !== 'function') {
    tabSwitcherStateLoaded = true;
    return Promise.resolve(false);
  }
  if (tabSwitcherStateLoaded) {
    return Promise.resolve(true);
  }
  if (tabSwitcherStateLoadPromise) {
    return tabSwitcherStateLoadPromise;
  }
  tabSwitcherStateLoadPromise = getTabSwitcherStateFromStorage()
    .then((state) => {
      if (state) {
        recentTabTracker.hydrateState(state, {
          merge: tabSwitcherStateDirtyBeforeLoad === true
        });
      }
      tabSwitcherStateLoaded = true;
      if (tabSwitcherStateDirtyBeforeLoad) {
        schedulePersistTabSwitcherState();
      }
      return true;
    })
    .catch(() => {
      tabSwitcherStateLoaded = true;
      return false;
    })
    .finally(() => {
      tabSwitcherStateLoadPromise = null;
      tabSwitcherStateDirtyBeforeLoad = false;
    });
  return tabSwitcherStateLoadPromise;
}

function persistTabSwitcherState() {
  tabSwitcherStatePersistTimer = null;
  if (!recentTabTracker || typeof recentTabTracker.exportState !== 'function') {
    return Promise.resolve(false);
  }
  return setTabSwitcherStateToStorage(recentTabTracker.exportState());
}

function schedulePersistTabSwitcherState() {
  if (!recentTabTracker || typeof recentTabTracker.exportState !== 'function') {
    return;
  }
  if (!tabSwitcherStateLoaded) {
    tabSwitcherStateDirtyBeforeLoad = true;
  }
  if (tabSwitcherStatePersistTimer !== null) {
    clearTimeout(tabSwitcherStatePersistTimer);
  }
  tabSwitcherStatePersistTimer = setTimeout(() => {
    persistTabSwitcherState().catch(() => {});
  }, TAB_SWITCHER_THUMBNAIL_PERSIST_DEBOUNCE_MS);
}

function loadTabSwitcherEnabledSetting() {
  const storageArea = chrome && chrome.storage && chrome.storage.sync
    ? chrome.storage.sync
    : null;
  if (!storageArea || typeof storageArea.get !== 'function') {
    return;
  }
  storageArea.get([ENABLED_STORAGE_KEY], (result) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      return;
    }
    tabSwitcherEnabledCache = !result || result[ENABLED_STORAGE_KEY] !== false;
  });
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes || !changes[ENABLED_STORAGE_KEY]) {
      return;
    }
    tabSwitcherEnabledCache = changes[ENABLED_STORAGE_KEY].newValue !== false;
  });
}

loadTabSwitcherEnabledSetting();

function getPortSenderTabId(port) {
  const senderTab = port && port.sender && port.sender.tab ? port.sender.tab : null;
  return senderTab && typeof senderTab.id === 'number' ? senderTab.id : null;
}

function getPortMessageTabId(port, message) {
  if (message && typeof message.tabId === 'number') {
    return message.tabId;
  }
  return getPortSenderTabId(port);
}

function clearTabSwitcherExtensionPagePending(record, ok, reason) {
  if (!record || !record.pending || typeof record.pending.forEach !== 'function') {
    return;
  }
  record.pending.forEach((pending) => {
    if (!pending) {
      return;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (typeof pending.callback === 'function') {
      pending.callback(Boolean(ok), reason || '');
    }
  });
  record.pending.clear();
}

function deleteTabSwitcherExtensionPagePort(tabId, port) {
  if (typeof tabId !== 'number') {
    return;
  }
  const record = tabSwitcherExtensionPagePortsByTabId.get(tabId);
  if (!record || (port && record.port !== port)) {
    return;
  }
  clearTabSwitcherExtensionPagePending(record, false, 'disconnected');
  tabSwitcherExtensionPagePortsByTabId.delete(tabId);
}

function registerTabSwitcherExtensionPagePort(port, message) {
  const tabId = getPortMessageTabId(port, message);
  if (typeof tabId !== 'number') {
    return null;
  }
  const previous = tabSwitcherExtensionPagePortsByTabId.get(tabId);
  if (previous && previous.port !== port) {
    clearTabSwitcherExtensionPagePending(previous, false, 'replaced');
  }
  const record = previous && previous.port === port
    ? previous
    : {
      port,
      tabId,
      pending: new Map()
    };
  record.url = message && typeof message.url === 'string' ? message.url : (record.url || '');
  record.title = message && typeof message.title === 'string' ? message.title : (record.title || '');
  tabSwitcherExtensionPagePortsByTabId.set(tabId, record);
  return record;
}

function handleTabSwitcherExtensionPagePortMessage(port, message) {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.action === 'registerTabSwitcherExtensionPage') {
    registerTabSwitcherExtensionPagePort(port, message);
    return;
  }
  if (message.action !== 'tabSwitcherExtensionPageResponse') {
    return;
  }
  const tabId = getPortMessageTabId(port, message);
  if (typeof tabId !== 'number' || typeof message.requestId !== 'number') {
    return;
  }
  const record = tabSwitcherExtensionPagePortsByTabId.get(tabId);
  if (!record || record.port !== port || !record.pending) {
    return;
  }
  const pending = record.pending.get(message.requestId);
  if (!pending) {
    return;
  }
  record.pending.delete(message.requestId);
  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  if (typeof pending.callback === 'function') {
    pending.callback(Boolean(message.ok), message.reason || '', message);
  }
}

function registerTabSwitcherExtensionPagePortConnection(port) {
  if (!port || port.name !== TAB_SWITCHER_EXTENSION_PAGE_PORT_NAME) {
    return;
  }
  registerTabSwitcherExtensionPagePort(port, {
    action: 'registerTabSwitcherExtensionPage',
    tabId: getPortSenderTabId(port),
    url: port.sender && typeof port.sender.url === 'string' ? port.sender.url : '',
    title: ''
  });
  port.onMessage.addListener((message) => {
    handleTabSwitcherExtensionPagePortMessage(port, message);
  });
  port.onDisconnect.addListener(() => {
    deleteTabSwitcherExtensionPagePort(getPortSenderTabId(port), port);
    Array.from(tabSwitcherExtensionPagePortsByTabId.entries()).forEach(([tabId, record]) => {
      if (record && record.port === port) {
        deleteTabSwitcherExtensionPagePort(tabId, port);
      }
    });
  });
}

function postTabSwitcherMessageToExtensionPage(tab, message, callback) {
  if (!tab || typeof tab.id !== 'number' || !isTabSwitcherExtensionPageMessageTarget(tab)) {
    if (typeof callback === 'function') {
      callback(false, 'not-extension-page');
    }
    return false;
  }
  const startedAt = Date.now();
  const attemptPost = () => {
    const record = tabSwitcherExtensionPagePortsByTabId.get(tab.id);
    if (!record || !record.port || typeof record.port.postMessage !== 'function') {
      if (Date.now() - startedAt < TAB_SWITCHER_EXTENSION_PAGE_PORT_WAIT_MS) {
        setTimeout(attemptPost, TAB_SWITCHER_EXTENSION_PAGE_PORT_RETRY_MS);
        return true;
      }
      if (typeof callback === 'function') {
        callback(false, 'extension-page-port-missing');
      }
      return false;
    }
    const requestId = ++tabSwitcherExtensionPageRequestSeq;
    const payload = {
      ...(message && typeof message === 'object' ? message : {}),
      requestId
    };
    const timer = setTimeout(() => {
      if (!record.pending || !record.pending.has(requestId)) {
        return;
      }
      record.pending.delete(requestId);
      if (typeof callback === 'function') {
        callback(false, 'extension-page-timeout');
      }
    }, 1000);
    record.pending.set(requestId, {
      callback,
      timer
    });
    try {
      record.port.postMessage(payload);
      return true;
    } catch (error) {
      clearTimeout(timer);
      record.pending.delete(requestId);
      if (typeof callback === 'function') {
        callback(false, error && error.message ? error.message : 'extension-page-post-failed');
      }
      return false;
    }
  };
  return attemptPost();
}

function setTabSwitcherCaptureVisibilityInPage(hidden, hostId) {
  const host = document.getElementById(hostId);
  if (!host) {
    return { ok: true, reason: 'tab_switcher_host_missing' };
  }
  const markerKey = 'quickswitchCaptureVisibilityHidden';
  const valueKey = 'quickswitchCapturePreviousVisibility';
  const priorityKey = 'quickswitchCapturePreviousVisibilityPriority';
  const hadValueKey = 'quickswitchCaptureHadVisibility';
  if (hidden) {
    if (host.dataset[markerKey] !== 'true') {
      const previousValue = host.style.getPropertyValue('visibility');
      host.dataset[markerKey] = 'true';
      host.dataset[valueKey] = previousValue || '';
      host.dataset[priorityKey] = host.style.getPropertyPriority('visibility') || '';
      host.dataset[hadValueKey] = previousValue ? 'true' : 'false';
    }
    host.style.setProperty('visibility', 'hidden', 'important');
    return { ok: true };
  }
  if (host.dataset[markerKey] === 'true') {
    if (host.dataset[hadValueKey] === 'true') {
      host.style.setProperty(
        'visibility',
        host.dataset[valueKey] || '',
        host.dataset[priorityKey] || ''
      );
    } else {
      host.style.removeProperty('visibility');
    }
    delete host.dataset[markerKey];
    delete host.dataset[valueKey];
    delete host.dataset[priorityKey];
    delete host.dataset[hadValueKey];
  }
  return { ok: true };
}

function getOpenTabSwitcherStateInPage(hostId) {
  const host = document.getElementById(hostId);
  return {
    ok: true,
    open: Boolean(host)
  };
}

function updateTabSwitcherThumbnailInPage(update, hostId) {
  const host = document.getElementById(hostId);
  if (!host || typeof host._quickswitchTabSwitcherUpdateThumbnail !== 'function') {
    return { ok: false, reason: 'tab_switcher_host_missing' };
  }
  return host._quickswitchTabSwitcherUpdateThumbnail(update) || { ok: true };
}

function commitOpenTabSwitcherFromShortcutReleaseInPage(hostId) {
  const host = document.getElementById(hostId);
  if (!host || typeof host._quickswitchTabSwitcherCommitFromShortcutRelease !== 'function') {
    return { ok: false, committed: false };
  }
  return {
    ok: true,
    committed: host._quickswitchTabSwitcherCommitFromShortcutRelease() === true
  };
}

function getFailedOpenTabSwitcherState() {
  return { ok: false, open: false };
}

function normalizeTabSwitcherHostOkResponse(response) {
  return response && response.ok === true ? true : null;
}

function normalizeTabSwitcherCommitResponse(response) {
  if (!response || response.ok !== true || typeof response.committed !== 'boolean') {
    return null;
  }
  return response.committed === true;
}

function normalizeOpenTabSwitcherStateResponse(response) {
  if (!response || response.ok !== true || typeof response.open !== 'boolean') {
    return null;
  }
  return {
    ok: true,
    open: response.open === true
  };
}

function normalizeTabSwitcherHostOkScriptResults(results) {
  return Array.isArray(results) &&
    results.some((item) => item && item.result && item.result.ok === true)
    ? true
    : null;
}

function normalizeTabSwitcherCommitScriptResults(results) {
  const result = Array.isArray(results)
    ? results.find((item) => (
      item &&
      item.result &&
      item.result.ok === true &&
      typeof item.result.committed === 'boolean'
    ))
    : null;
  return result && result.result ? result.result.committed === true : null;
}

function normalizeOpenTabSwitcherStateScriptResults(results) {
  const result = Array.isArray(results)
    ? results.find((item) => (
      item &&
      item.result &&
      item.result.ok === true &&
      typeof item.result.open === 'boolean'
    ))
    : null;
  return result && result.result
    ? {
      ok: true,
      open: result.result.open === true
    }
    : null;
}

function runTabSwitcherHostScript(tabId, scriptFunc, scriptArgs, normalizeResults, fallbackValue) {
  if (typeof tabId !== 'number' ||
      !chrome ||
      !chrome.scripting ||
      typeof chrome.scripting.executeScript !== 'function' ||
      typeof scriptFunc !== 'function') {
    return Promise.resolve(fallbackValue);
  }
  const normalize = typeof normalizeResults === 'function'
    ? normalizeResults
    : normalizeTabSwitcherHostOkScriptResults;
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript({
        target: { tabId },
        func: scriptFunc,
        args: Array.isArray(scriptArgs) ? scriptArgs : []
      }, (results) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(fallbackValue);
          return;
        }
        const normalized = normalize(results);
        resolve(normalized === null ? fallbackValue : normalized);
      });
    } catch (error) {
      resolve(fallbackValue);
    }
  });
}

function sendTabSwitcherHostMessage(tab, payload, optionsArg) {
  const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
  const options = optionsArg && typeof optionsArg === 'object' ? optionsArg : {};
  const fallbackValue = Object.prototype.hasOwnProperty.call(options, 'fallbackValue')
    ? options.fallbackValue
    : false;
  if (typeof tabId !== 'number' || !payload || typeof payload !== 'object') {
    return Promise.resolve(fallbackValue);
  }
  const normalizeResponse = typeof options.normalizeResponse === 'function'
    ? options.normalizeResponse
    : normalizeTabSwitcherHostOkResponse;
  const runScriptFallback = () => runTabSwitcherHostScript(
    tabId,
    options.scriptFunc,
    options.scriptArgs,
    options.normalizeScriptResults,
    fallbackValue
  );
  if (isTabSwitcherExtensionPageMessageTarget(tab)) {
    return new Promise((resolve) => {
      postTabSwitcherMessageToExtensionPage(tab, payload, (ok, _reason, response) => {
        if (ok) {
          const normalized = normalizeResponse(response || { ok: true });
          if (normalized !== null) {
            resolve(normalized);
            return;
          }
        }
        runScriptFallback().then(resolve).catch(() => resolve(fallbackValue));
      });
    });
  }
  if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
    return runScriptFallback();
  }
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (!(chrome.runtime && chrome.runtime.lastError)) {
          const normalized = normalizeResponse(response);
          if (normalized !== null) {
            resolve(normalized);
            return;
          }
        }
        runScriptFallback().then(resolve).catch(() => resolve(fallbackValue));
      });
    } catch (error) {
      runScriptFallback().then(resolve).catch(() => resolve(fallbackValue));
    }
  });
}

function setTabSwitcherCaptureVisibility(tab, hidden) {
  const payload = {
    action: 'setTabSwitcherCaptureVisibility',
    hidden: Boolean(hidden)
  };
  return sendTabSwitcherHostMessage(tab, payload, {
    scriptFunc: setTabSwitcherCaptureVisibilityInPage,
    scriptArgs: [Boolean(hidden), TAB_SWITCHER_HOST_ID],
    fallbackValue: false
  });
}

function getOpenTabSwitcherState(tab) {
  const payload = {
    action: 'getOpenTabSwitcherState'
  };
  return sendTabSwitcherHostMessage(tab, payload, {
    scriptFunc: getOpenTabSwitcherStateInPage,
    scriptArgs: [TAB_SWITCHER_HOST_ID],
    normalizeResponse: normalizeOpenTabSwitcherStateResponse,
    normalizeScriptResults: normalizeOpenTabSwitcherStateScriptResults,
    fallbackValue: getFailedOpenTabSwitcherState()
  });
}

function postTabSwitcherThumbnailUpdate(tab, update) {
  if (!update || typeof update !== 'object') {
    return Promise.resolve(false);
  }
  const payload = {
    action: 'updateTabSwitcherThumbnail',
    ...update
  };
  return sendTabSwitcherHostMessage(tab, payload, {
    scriptFunc: updateTabSwitcherThumbnailInPage,
    scriptArgs: [payload, TAB_SWITCHER_HOST_ID],
    fallbackValue: false
  });
}

function commitOpenTabSwitcherFromShortcutReleaseOnTab(tab) {
  return sendTabSwitcherHostMessage(tab, {
    action: 'commitOpenTabSwitcherFromShortcutRelease'
  }, {
    scriptFunc: commitOpenTabSwitcherFromShortcutReleaseInPage,
    scriptArgs: [TAB_SWITCHER_HOST_ID],
    normalizeResponse: normalizeTabSwitcherCommitResponse,
    normalizeScriptResults: normalizeTabSwitcherCommitScriptResults,
    fallbackValue: false
  });
}

function getTabSwitcherOpeningWindowKey(tab) {
  if (tab && typeof tab.windowId === 'number') {
    return `window:${tab.windowId}`;
  }
  if (tab && typeof tab.id === 'number') {
    return `tab:${tab.id}`;
  }
  return '';
}

function finishTabSwitcherOpening(opening) {
  if (!opening || !opening.key) {
    return;
  }
  const current = tabSwitcherOpeningByWindowKey.get(opening.key);
  if (current !== opening) {
    return;
  }
  if (opening.timer) {
    clearTimeout(opening.timer);
    opening.timer = null;
  }
  tabSwitcherOpeningByWindowKey.delete(opening.key);
}

function beginTabSwitcherOpening(tab, source) {
  const key = getTabSwitcherOpeningWindowKey(tab);
  if (!key) {
    return null;
  }
  const now = Date.now();
  const existing = tabSwitcherOpeningByWindowKey.get(key);
  if (existing && existing.expiresAt > now) {
    return null;
  }
  if (existing) {
    finishTabSwitcherOpening(existing);
  }
  const opening = {
    key,
    tabId: tab && typeof tab.id === 'number' ? tab.id : null,
    windowId: tab && typeof tab.windowId === 'number' ? tab.windowId : null,
    source: source || '',
    startedAt: now,
    expiresAt: now + TAB_SWITCHER_OPENING_GUARD_MS,
    timer: null
  };
  opening.timer = setTimeout(() => {
    finishTabSwitcherOpening(opening);
  }, TAB_SWITCHER_OPENING_GUARD_MS);
  tabSwitcherOpeningByWindowKey.set(key, opening);
  return opening;
}

function createTabSwitcherOpeningFinisher(opening) {
  let didFinish = false;
  return function finishOpeningOnce() {
    if (didFinish) {
      return;
    }
    didFinish = true;
    finishTabSwitcherOpening(opening);
  };
}

function isTabSwitcherOpeningForCapture(tab) {
  const key = getTabSwitcherOpeningWindowKey(tab);
  if (!key) {
    return false;
  }
  const opening = tabSwitcherOpeningByWindowKey.get(key);
  return Boolean(opening && opening.expiresAt > Date.now());
}

const thumbnailPipeline = QUICK_SWITCH_THUMBNAILS && typeof QUICK_SWITCH_THUMBNAILS.createThumbnailPipeline === 'function'
  ? QUICK_SWITCH_THUMBNAILS.createThumbnailPipeline({
    chromeApi: chrome,
    tracker: recentTabTracker,
    getResolvedTabUrl,
    shouldTrackSwitcherTab,
    setTabSwitcherCaptureVisibility,
    getOpenTabSwitcherState,
    postTabSwitcherThumbnailUpdate,
    schedulePersistState: schedulePersistTabSwitcherState,
    isTabSwitcherOpeningForCapture
  })
  : null;

const markSwitcherThumbnailPriorityForItems = thumbnailPipeline
  ? thumbnailPipeline.markSwitcherThumbnailPriorityForItems
  : () => {};
const captureSwitcherThumbnailForTab = thumbnailPipeline
  ? thumbnailPipeline.captureSwitcherThumbnailForTab
  : () => Promise.resolve(false);
const scheduleSwitcherThumbnailCapture = thumbnailPipeline
  ? thumbnailPipeline.scheduleSwitcherThumbnailCapture
  : () => {};
const clearScheduledSwitcherThumbnailCapture = thumbnailPipeline
  ? thumbnailPipeline.clearScheduledSwitcherThumbnailCapture
  : () => {};
const clearSwitcherThumbnailPriority = thumbnailPipeline
  ? thumbnailPipeline.clearSwitcherThumbnailPriority
  : () => {};
const getSwitcherThumbnailStateForPayload = thumbnailPipeline
  ? thumbnailPipeline.getSwitcherThumbnailStateForPayload
  : () => ({ status: 'missing', reason: '', dataUrl: '', capturedAt: 0, updatedAt: 0 });
const shouldPreCaptureActiveSwitcherThumbnailBeforePayload = thumbnailPipeline
  ? thumbnailPipeline.shouldPreCaptureActiveSwitcherThumbnailBeforePayload
  : () => false;

function recordRecentSwitcherTab(tab, at) {
  if (!recentTabTracker || typeof recentTabTracker.recordTab !== 'function') {
    return null;
  }
  const snapshot = recentTabTracker.recordTab(tab, at);
  if (snapshot) {
    schedulePersistTabSwitcherState();
  }
  return snapshot;
}

function updateRecentSwitcherTab(tab, at) {
  if (!recentTabTracker || typeof recentTabTracker.updateTab !== 'function') {
    return null;
  }
  const snapshot = recentTabTracker.updateTab(tab, at);
  if (snapshot) {
    schedulePersistTabSwitcherState();
  }
  return snapshot;
}

function removeRecentSwitcherTab(tabId) {
  clearSwitcherThumbnailPriority(tabId);
  clearScheduledSwitcherThumbnailCapture(tabId);
  if (!recentTabTracker || typeof recentTabTracker.removeTab !== 'function') {
    return;
  }
  if (recentTabTracker.removeTab(tabId)) {
    schedulePersistTabSwitcherState();
  }
}

function isPageVisibleSafeFaviconUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return false;
  }
  if (raw.startsWith('data:image/')) {
    return true;
  }
  try {
    const parsed = new URL(raw);
    const protocol = String(parsed.protocol || '').toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function getGstaticFaviconUrl(pageUrl) {
  const resolved = String(pageUrl || '').trim();
  if (!resolved) {
    return '';
  }
  return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(resolved)}`;
}

function getOwnFaviconServiceUrl(pageUrl) {
  const resolved = String(pageUrl || '').trim();
  if (!resolved || !chrome || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
    return '';
  }
  return `${chrome.runtime.getURL('_favicon/')}?pageUrl=${encodeURIComponent(resolved)}&size=32`;
}

function buildSwitcherTabFavicon(tab, url) {
  const resolved = String(url || getResolvedTabUrl(tab) || '').trim();
  const direct = tab && typeof tab.favIconUrl === 'string' ? tab.favIconUrl.trim() : '';
  if (isPageVisibleSafeFaviconUrl(direct)) {
    return direct;
  }
  const ownService = getOwnFaviconServiceUrl(resolved);
  if (ownService) {
    return ownService;
  }
  return getGstaticFaviconUrl(resolved);
}

function normalizeSwitcherTabForPayload(tab, currentTabId) {
  if (!tab || typeof tab.id !== 'number') {
    return null;
  }
  const url = getResolvedTabUrl(tab);
  if (!url) {
    return null;
  }
  const thumbnailState = getSwitcherThumbnailStateForPayload(tab, url);
  return {
    id: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : null,
    url,
    title: String(tab.title || '').replace(/\s+/g, ' ').trim() || url,
    favIconUrl: buildSwitcherTabFavicon(tab, url),
    accentRgb: null,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    current: typeof currentTabId === 'number' && tab.id === currentTabId,
    thumbnail: thumbnailState.dataUrl,
    thumbnailStatus: thumbnailState.status,
    thumbnailReason: thumbnailState.reason
  };
}

function getRecentTabsForSwitcher(tabList, currentTabId) {
  const normalizedTabs = (Array.isArray(tabList) ? tabList : [])
    .map((tab) => ({
      ...tab,
      url: getResolvedTabUrl(tab)
    }))
    .filter(shouldTrackSwitcherTab);
  if (recentTabTracker && typeof recentTabTracker.getRecentTabs === 'function') {
    return recentTabTracker
      .getRecentTabs(normalizedTabs, { limit: TAB_SWITCHER_LIMIT })
      .map((tab) => normalizeSwitcherTabForPayload(tab, currentTabId))
      .filter(Boolean);
  }
  return normalizedTabs
    .slice()
    .sort((a, b) => (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0))
    .slice(0, TAB_SWITCHER_LIMIT)
    .map((tab) => normalizeSwitcherTabForPayload(tab, currentTabId))
    .filter(Boolean);
}

function getDefaultSwitcherSelectedIndex(items, currentTabId) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= 0) {
    return 0;
  }
  if (list.length === 1) {
    return 0;
  }
  if (typeof currentTabId !== 'number') {
    return 0;
  }
  const currentIndex = list.findIndex((item) => item && item.id === currentTabId);
  if (currentIndex === 0) {
    return 1;
  }
  if (currentIndex > 0) {
    return currentIndex;
  }
  return 0;
}

function prepareShortcutKeyObserver(tab) {
  if (!tab || typeof tab.id !== 'number') {
    return Promise.resolve(false);
  }
  if (isTabSwitcherExtensionPageMessageTarget(tab)) {
    return Promise.resolve(true);
  }
  if (!chrome || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true
        },
        files: KEY_OBSERVER_FILES
      }, () => {
        const error = chrome.runtime && chrome.runtime.lastError
          ? chrome.runtime.lastError.message || 'unknown'
          : '';
        resolve(!error);
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function prepareShortcutKeyObserversInOpenTabs() {
  if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return;
  }
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      return;
    }
    (Array.isArray(tabs) ? tabs : []).forEach((tab) => {
      prepareShortcutKeyObserver(tab);
    });
  });
}

function advanceExistingTabSwitcherOnTab(tab, source, callback) {
  if (!tab || typeof tab.id !== 'number' || !canHostSwitcherSurface(tab)) {
    if (typeof callback === 'function') {
      callback(false);
    }
    return;
  }

  const finish = (didAdvance) => {
    if (typeof callback === 'function') {
      callback(Boolean(didAdvance));
    }
  };

  if (isTabSwitcherExtensionPageMessageTarget(tab)) {
    postTabSwitcherMessageToExtensionPage(tab, {
      action: 'advanceOpenTabSwitcherFromCommand',
      offset: 1
    }, (ok, _reason, response) => {
      finish(Boolean(ok && response && response.advanced === true));
    });
    return;
  }

  if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
    finish(false);
    return;
  }
  try {
    chrome.tabs.sendMessage(tab.id, {
      action: 'advanceOpenTabSwitcherFromCommand',
      offset: 1
    }, (response) => {
      const didAdvance = !(chrome.runtime && chrome.runtime.lastError) &&
        response &&
        response.ok === true &&
        response.advanced === true;
      finish(didAdvance);
    });
  } catch (error) {
    finish(false);
  }
}

function findOpenTabSwitcherHostInWindow(windowId) {
  if (typeof windowId !== 'number' || !chrome || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return Promise.resolve(null);
  }
  const readStateWithTimeout = (tab) => new Promise((resolve) => {
    let settled = false;
    const finish = (open) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ tab, open: open === true });
    };
    const timer = setTimeout(() => finish(false), TAB_SWITCHER_HOST_STATE_TIMEOUT_MS);
    getOpenTabSwitcherState(tab)
      .then((state) => finish(Boolean(state && state.open === true)))
      .catch(() => finish(false));
  });
  return new Promise((resolve) => {
    chrome.tabs.query({ windowId }, (tabs) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const knownHostTabId = tabSwitcherHostTabIdByWindowId.get(windowId);
      const candidates = (Array.isArray(tabs) ? tabs : [])
        .filter((tab) => tab && typeof tab.id === 'number' && canHostSwitcherSurface(tab))
        .sort((left, right) => {
          const leftPriority = left.id === knownHostTabId ? 2 : Number(left.active === true);
          const rightPriority = right.id === knownHostTabId ? 2 : Number(right.active === true);
          return rightPriority - leftPriority;
        });
      Promise.all(candidates.map(readStateWithTimeout)).then((states) => {
        const openHost = states.find((state) => state.open === true);
        resolve(openHost ? openHost.tab : null);
      }).catch(() => resolve(null));
    });
  });
}

function getTabForTabSwitcherCommit(tabId) {
  if (typeof tabId !== 'number' || !chrome || !chrome.tabs || typeof chrome.tabs.get !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(tab && typeof tab.id === 'number' ? tab : null);
    });
  });
}

function commitOpenTabSwitcherInWindow(windowId, source) {
  const finishCommit = (hostTab) => {
    if (!hostTab) {
      return Promise.resolve(false);
    }
    return commitOpenTabSwitcherFromShortcutReleaseOnTab(hostTab).then((didCommit) => {
      if (didCommit === true && tabSwitcherHostTabIdByWindowId.get(windowId) === hostTab.id) {
        tabSwitcherHostTabIdByWindowId.delete(windowId);
      }
      return didCommit === true;
    });
  };
  const findAndCommit = () => findOpenTabSwitcherHostInWindow(windowId)
    .then((hostTab) => finishCommit(hostTab));
  const knownHostTabId = tabSwitcherHostTabIdByWindowId.get(windowId);
  if (typeof knownHostTabId !== 'number') {
    return findAndCommit().catch(() => false);
  }
  return getTabForTabSwitcherCommit(knownHostTabId)
    .then((hostTab) => finishCommit(hostTab))
    .then((didCommit) => {
      if (didCommit === true) {
        return true;
      }
      if (tabSwitcherHostTabIdByWindowId.get(windowId) === knownHostTabId) {
        tabSwitcherHostTabIdByWindowId.delete(windowId);
      }
      return findAndCommit();
    })
    .catch(() => findAndCommit().catch(() => false));
}

function getConfiguredTabSwitcherShortcut(callback) {
  if (!chrome || !chrome.commands || typeof chrome.commands.getAll !== 'function') {
    callback(FALLBACK_TAB_SWITCHER_SHORTCUT);
    return;
  }
  chrome.commands.getAll((commands) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      callback(FALLBACK_TAB_SWITCHER_SHORTCUT);
      return;
    }
    const items = Array.isArray(commands) ? commands : [];
    const command = items.find((item) => item && item.name === SHOW_TAB_SWITCHER_COMMAND_NAME);
    const shortcut = command && typeof command.shortcut === 'string'
      ? String(command.shortcut).trim()
      : '';
    callback(shortcut || FALLBACK_TAB_SWITCHER_SHORTCUT);
  });
}

function handleTabSwitcherShortcutModifierReleased(senderTab, releasedKey, callback) {
  const finish = typeof callback === 'function' ? callback : () => {};
  if (!senderTab || typeof senderTab.windowId !== 'number') {
    finish(false);
    return;
  }
  const key = String(releasedKey || '');
  getConfiguredTabSwitcherShortcut((shortcut) => {
    const expectedKeys = typeof RECENT_TAB_SWITCHER.getShortcutReleaseEventKeys === 'function'
      ? RECENT_TAB_SWITCHER.getShortcutReleaseEventKeys(shortcut)
      : [];
    if (!expectedKeys.includes(key)) {
      finish(false);
      return;
    }
    commitOpenTabSwitcherInWindow(senderTab.windowId, 'keyup')
      .then((didCommit) => finish(didCommit === true))
      .catch(() => finish(false));
  });
}

function armTabSwitcherShortcutReleaseObservers(tabs, windowId, shortcut, commandStartedAt) {
  if (typeof windowId !== 'number') {
    return;
  }
  const keys = typeof RECENT_TAB_SWITCHER.getShortcutReleaseEventKeys === 'function'
    ? RECENT_TAB_SWITCHER.getShortcutReleaseEventKeys(shortcut)
    : [];
  if (!keys.length) {
    return;
  }
  const message = {
    action: 'armTabSwitcherShortcutRelease',
    keys,
    commandStartedAt: Number(commandStartedAt) || 0
  };
  (Array.isArray(tabs) ? tabs : []).forEach((item) => {
    if (!item || typeof item.id !== 'number' || item.windowId !== windowId) {
      return;
    }
    if (isTabSwitcherExtensionPageMessageTarget(item)) {
      postTabSwitcherMessageToExtensionPage(item, message, () => {});
      return;
    }
    if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
      return;
    }
    try {
      chrome.tabs.sendMessage(item.id, message, () => {
        void (chrome.runtime && chrome.runtime.lastError);
      });
    } catch (error) {
      // Restricted tabs simply cannot participate in the release relay.
    }
  });
}

function focusWindowAndActivateTab(tabId, windowId, callback) {
  const run = (resolvedWindowId) => {
    if (RECENT_TAB_SWITCHER && typeof RECENT_TAB_SWITCHER.focusWindowAndActivateTab === 'function') {
      RECENT_TAB_SWITCHER.focusWindowAndActivateTab(chrome, {
        tabId,
        windowId: typeof resolvedWindowId === 'number' ? resolvedWindowId : null
      })
        .then((result) => {
          if (typeof callback === 'function') {
            callback(result || { ok: false });
          }
        })
        .catch((error) => {
          if (typeof callback === 'function') {
            callback({
              ok: false,
              tabId,
              windowId: typeof resolvedWindowId === 'number' ? resolvedWindowId : null,
              reason: error && error.message ? error.message : 'switch-failed'
            });
          }
        });
      return;
    }
    if (!chrome || !chrome.tabs || typeof chrome.tabs.update !== 'function') {
      if (typeof callback === 'function') {
        callback({ ok: false, tabId, reason: 'tabs-api-unavailable' });
      }
      return;
    }
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      const ok = !(chrome.runtime && chrome.runtime.lastError);
      if (typeof callback === 'function') {
        callback({
          ok,
          tabId,
          windowId: typeof resolvedWindowId === 'number'
            ? resolvedWindowId
            : (tab && typeof tab.windowId === 'number' ? tab.windowId : null),
          reason: ok ? '' : (chrome.runtime.lastError.message || 'tab-update-failed')
        });
      }
    });
  };
  if (typeof windowId === 'number' ||
      !chrome ||
      !chrome.tabs ||
      typeof chrome.tabs.get !== 'function') {
    run(windowId);
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      run(null);
      return;
    }
    run(tab && typeof tab.windowId === 'number' ? tab.windowId : null);
  });
}

function queryAllTabs() {
  return new Promise((resolve) => {
    if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
      resolve({ error: 'tabs-api-unavailable', tabs: [] });
      return;
    }
    chrome.tabs.query({}, (tabs) => {
      const error = chrome.runtime && chrome.runtime.lastError
        ? chrome.runtime.lastError.message || 'unknown'
        : '';
      resolve({
        error,
        tabs: Array.isArray(tabs) ? tabs : []
      });
    });
  });
}

function computeSwitcherPopupBounds(baseWindow) {
  const fallback = { left: 120, top: 160, width: SWITCHER_POPUP_WIDTH, height: SWITCHER_POPUP_HEIGHT };
  const baseLeft = Number(baseWindow && baseWindow.left);
  const baseTop = Number(baseWindow && baseWindow.top);
  const baseWidth = Number(baseWindow && baseWindow.width);
  const baseHeight = Number(baseWindow && baseWindow.height);
  if (!Number.isFinite(baseLeft) || !Number.isFinite(baseTop) ||
      !Number.isFinite(baseWidth) || !Number.isFinite(baseHeight) || baseWidth <= 0) {
    return fallback;
  }
  const left = Math.round(baseLeft + Math.max(0, (baseWidth - SWITCHER_POPUP_WIDTH) / 2));
  const top = Math.round(baseTop + Math.max(96, baseHeight * 0.16));
  return { left, top, width: SWITCHER_POPUP_WIDTH, height: SWITCHER_POPUP_HEIGHT };
}

function closeSwitcherPopupWindow(senderTab) {
  if (!senderTab || typeof senderTab.id !== 'number' || !switcherPopupHostTabIds.has(senderTab.id)) {
    return;
  }
  if (typeof senderTab.windowId !== 'number' ||
      !chrome || !chrome.windows || typeof chrome.windows.remove !== 'function') {
    return;
  }
  chrome.windows.remove(senderTab.windowId, () => {
    void (chrome.runtime && chrome.runtime.lastError);
  });
}

// Opens the switcher in a small popup window above the active tab's window, so
// restricted pages (chrome://, Web Store, the default new tab) get the panel
// without leaving the page. The popup page is an own extension page, so the
// regular extension-page port bridge drives it.
function openSwitcherInPopupWindow(activeTab, tabList, items, context) {
  const onUnavailable = () => {
    if (context && typeof context.onUnavailable === 'function') {
      context.onUnavailable();
    }
  };
  if (!chrome || !chrome.windows || typeof chrome.windows.create !== 'function') {
    onUnavailable();
    return;
  }
  // Reuse a still-open switcher popup instead of stacking a second window.
  const existingPopupTab = (Array.isArray(tabList) ? tabList : []).find((tabItem) =>
    tabItem && typeof tabItem.id === 'number' && switcherPopupHostTabIds.has(tabItem.id)) || null;
  if (existingPopupTab) {
    context.onHostReady(existingPopupTab);
    return;
  }
  const createPopup = (bounds) => {
    chrome.windows.create({
      type: 'popup',
      focused: true,
      url: SWITCHER_POPUP_HOST_URL,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height
    }, (createdWindow) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        onUnavailable();
        return;
      }
      const popupTab = createdWindow && Array.isArray(createdWindow.tabs) &&
        createdWindow.tabs[0] && typeof createdWindow.tabs[0].id === 'number'
        ? createdWindow.tabs[0]
        : null;
      if (!popupTab) {
        if (createdWindow && typeof createdWindow.id === 'number' && chrome.windows.remove) {
          chrome.windows.remove(createdWindow.id, () => {
            void (chrome.runtime && chrome.runtime.lastError);
          });
        }
        onUnavailable();
        return;
      }
      switcherPopupHostTabIds.add(popupTab.id);
      context.onHostReady(popupTab);
    });
  };
  if (typeof activeTab.windowId !== 'number' || typeof chrome.windows.get !== 'function') {
    createPopup(computeSwitcherPopupBounds(null));
    return;
  }
  chrome.windows.get(activeTab.windowId, (baseWindow) => {
    if (chrome.runtime && chrome.runtime.lastError) {
      createPopup(computeSwitcherPopupBounds(null));
      return;
    }
    createPopup(computeSwitcherPopupBounds(baseWindow));
  });
}

function blindSwitchToNextMostRecentTab(tab, source) {
  Promise.all([
    ensureTabSwitcherStateLoaded().catch(() => null),
    queryAllTabs()
  ]).then((results) => {
    const tabQuery = results[1] || { error: 'unknown', tabs: [] };
    if (tabQuery.error) {
      return;
    }
    const tabList = tabQuery.tabs;
    const activeTab = tabList.find((item) => item && item.id === tab.id) || tab;
    if (shouldTrackSwitcherTab(activeTab)) {
      recordRecentSwitcherTab(activeTab);
    }
    const items = getRecentTabsForSwitcher(tabList, activeTab.id);
    if (!items.length) {
      return;
    }
    const target = items[getDefaultSwitcherSelectedIndex(items, activeTab.id)];
    if (!target || typeof target.id !== 'number' || target.id === activeTab.id) {
      return;
    }
    focusWindowAndActivateTab(target.id, target.windowId, () => {});
  }).catch(() => {});
}

function injectTabSwitcherOnTab(hostTab, items, context) {
  const finishOpen = (ok, reason) => {
    if (context && typeof context.onOpenComplete === 'function') {
      context.onOpenComplete(Boolean(ok), reason || '');
    }
  };
  if (!hostTab || typeof hostTab.id !== 'number') {
    finishOpen(false, 'invalid-host-tab');
    return;
  }
  const tabItems = Array.isArray(items) ? items : [];
  if (!tabItems.length) {
    finishOpen(false, 'empty');
    return;
  }
  const buildSwitcherContext = (tabZoomFactor) => ({
    tabs: tabItems,
    currentTabId: context && typeof context.currentTabId === 'number' ? context.currentTabId : hostTab.id,
    selectedIndex: context && typeof context.selectedIndex === 'number' ? context.selectedIndex : 0,
    tabZoomFactor: tabZoomFactor,
    advanceOnExisting: true,
    suppressInitialShortcutAdvance: context && context.source === 'commands-tab-switcher',
    shortcut: context && typeof context.shortcut === 'string' ? context.shortcut : FALLBACK_TAB_SWITCHER_SHORTCUT,
    source: context && context.source ? context.source : ''
  });
  if (isTabSwitcherExtensionPageMessageTarget(hostTab)) {
    postTabSwitcherMessageToExtensionPage(hostTab, {
      action: 'openTabSwitcherFromCommand',
      context: buildSwitcherContext(1)
    }, (ok, reason) => {
      if (!ok) {
        finishOpen(false, reason || 'extension-page-open-failed');
        return;
      }
      finishOpen(true, 'extension-page-port');
    });
    return;
  }
  const runDynamicSwitcherScript = (switcherContext) => {
    if (!chrome || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
      finishOpen(false, 'scripting-unavailable');
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: hostTab.id },
      files: PANEL_FILES
    }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message || 'unknown';
        finishOpen(false, errorMessage);
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: hostTab.id },
        func: (switcherContextArg) => {
          const toggle = window._quickswitch_toggleTabSwitcher_2026_unique_;
          if (typeof toggle !== 'function') {
            return { ok: false, reason: 'tab_switcher_missing' };
          }
          const result = toggle(switcherContextArg);
          return result && typeof result === 'object'
            ? result
            : { ok: true };
        },
        args: [switcherContext]
      }, (results) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || 'unknown';
          finishOpen(false, errorMessage);
          return;
        }
        const result = Array.isArray(results) && results[0] ? results[0].result : null;
        if (result && result.ok === false) {
          finishOpen(false, result.reason || 'run-failed');
          return;
        }
        finishOpen(true, 'executeScript');
      });
    });
  };
  const runSwitcherScript = (tabZoomFactor) => {
    const switcherContext = buildSwitcherContext(tabZoomFactor);
    if (!chrome || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
      runDynamicSwitcherScript(switcherContext);
      return;
    }
    try {
      chrome.tabs.sendMessage(hostTab.id, {
        action: 'openTabSwitcherFromCommand',
        context: switcherContext
      }, (response) => {
        const didOpen = !(chrome.runtime && chrome.runtime.lastError) &&
          response &&
          response.ok === true;
        if (!didOpen) {
          runDynamicSwitcherScript(switcherContext);
          return;
        }
        finishOpen(true, 'runtime-message');
      });
    } catch (error) {
      runDynamicSwitcherScript(switcherContext);
    }
  };
  if (chrome.tabs && typeof chrome.tabs.getZoom === 'function') {
    chrome.tabs.getZoom(hostTab.id, (zoomFactor) => {
      const zoom = Number.isFinite(Number(zoomFactor)) && Number(zoomFactor) > 0
        ? Number(zoomFactor)
        : 1;
      runSwitcherScript(zoom);
    });
    return;
  }
  runSwitcherScript(1);
}

function triggerTabSwitcherForTab(tab, source, commandObservedAt) {
  const observedAt = Number(commandObservedAt);
  const commandStartedAt = Number.isFinite(observedAt) && observedAt > 0
    ? observedAt
    : Date.now();
  if (!tabSwitcherEnabledCache) {
    if (tab && typeof tab.windowId === 'number') {
      tabSwitcherHostTabIdByWindowId.delete(tab.windowId);
    }
    return;
  }
  if (!tab || typeof tab.id !== 'number') {
    return;
  }
  // Inject the trusted keyup observer before any async switcher work so a
  // quick physical modifier release can be buffered and replayed after the
  // panel opens.
  const shortcutObserverReady = prepareShortcutKeyObserver(tab);
  clearScheduledSwitcherThumbnailCapture(tab.id);
  advanceExistingTabSwitcherOnTab(tab, source, (didAdvance) => {
    if (didAdvance) {
      if (typeof tab.windowId === 'number') {
        tabSwitcherHostTabIdByWindowId.set(tab.windowId, tab.id);
      }
      return;
    }
    const opening = beginTabSwitcherOpening(tab, source);
    if (!opening) {
      return;
    }
    let openingHostTabId = tab.id;
    const finishOpeningGuard = createTabSwitcherOpeningFinisher(opening);
    const finishOpening = (ok) => {
      finishOpeningGuard();
      if (ok === true) {
        if (typeof tab.windowId === 'number' && typeof openingHostTabId === 'number') {
          tabSwitcherHostTabIdByWindowId.set(tab.windowId, openingHostTabId);
        }
        return;
      }
      if (tabSwitcherHostTabIdByWindowId.get(tab.windowId) === openingHostTabId) {
        tabSwitcherHostTabIdByWindowId.delete(tab.windowId);
      }
    };
    const startupStateReady = ensureTabSwitcherStateLoaded().catch(() => {});
    const shortcutReady = new Promise((resolve) => {
      getConfiguredTabSwitcherShortcut(resolve);
    });
    const tabQueryReady = queryAllTabs();
    Promise.all([startupStateReady, tabQueryReady, shortcutReady, shortcutObserverReady]).then((results) => {
      const tabQuery = results[1] || { error: 'unknown', tabs: [] };
      const shortcut = typeof results[2] === 'string' && results[2]
        ? results[2]
        : FALLBACK_TAB_SWITCHER_SHORTCUT;
      if (tabQuery.error) {
        finishOpening();
        return;
      }
      const tabList = tabQuery.tabs;
      const activeTab = tabList.find((item) => item && item.id === tab.id) || tab;
      const finishOpeningAndArmShortcutRelease = (ok) => {
        finishOpening(ok);
        if (ok === true) {
          armTabSwitcherShortcutReleaseObservers(
            tabList,
            activeTab.windowId,
            shortcut,
            commandStartedAt
          );
        }
      };
      clearScheduledSwitcherThumbnailCapture(activeTab.id);
      if (shouldTrackSwitcherTab(activeTab)) {
        recordRecentSwitcherTab(activeTab);
        if (shouldPreCaptureActiveSwitcherThumbnailBeforePayload(activeTab)) {
          captureSwitcherThumbnailForTab(
            activeTab,
            QUICK_SWITCH_THUMBNAILS.CAPTURE_REASON_COMMAND_IMMEDIATE
          ).catch(() => false);
        }
      }
      const items = getRecentTabsForSwitcher(tabList, activeTab.id);
      markSwitcherThumbnailPriorityForItems(items, tabList, 'command-payload');
      if (!items.length) {
        finishOpening();
        return;
      }
      // chrome:// pages, Web Store and the browser default new tab cannot host
      // the panel. Open it in a dedicated popup window so the original tab is
      // left untouched; when popup windows are unavailable, borrow the surface
      // of the nearest recent tab that can host it (focus that tab first, with
      // the selection still computed against the original tab); with no host
      // at all, fall back to a blind MRU switch.
      const canHostOnActiveTab = canHostSwitcherSurface(activeTab);
      const selectedIndex = getDefaultSwitcherSelectedIndex(items, activeTab.id);
      const injectOnHost = (hostTab) => {
        injectTabSwitcherOnTab(hostTab, items, {
          currentTabId: activeTab.id,
          selectedIndex,
          shortcut,
          source,
          onOpenComplete: finishOpeningAndArmShortcutRelease
        });
      };
      const openSwitcherOnBorrowedHost = () => {
        const hostItem = items.find((item) => {
          if (!item || item.id === activeTab.id) {
            return false;
          }
          const candidate = tabList.find((tabItem) => tabItem && tabItem.id === item.id) || item;
          return canHostSwitcherSurface(candidate);
        });
        const hostTab = hostItem
          ? (tabList.find((tabItem) => tabItem && tabItem.id === hostItem.id) || null)
          : null;
        if (!hostTab || typeof hostTab.id !== 'number') {
          finishOpening();
          blindSwitchToNextMostRecentTab(tab, source);
          return;
        }
        openingHostTabId = hostTab.id;
        focusWindowAndActivateTab(hostTab.id, hostTab.windowId, (result) => {
          if (!result || result.ok === false) {
            finishOpening();
            return;
          }
          injectOnHost(hostTab);
        });
      };
      if (canHostOnActiveTab) {
        openingHostTabId = activeTab.id;
        injectOnHost(activeTab);
        return;
      }
      openSwitcherInPopupWindow(activeTab, tabList, items, {
        onHostReady: (popupTab) => {
          openingHostTabId = popupTab.id;
          injectOnHost(popupTab);
        },
        onUnavailable: openSwitcherOnBorrowedHost
      });
    }).catch(() => {
      finishOpening();
    });
  });
}

chrome.commands.onCommand.addListener(function(command) {
  if (command !== SHOW_TAB_SWITCHER_COMMAND_NAME) {
    return;
  }
  const commandObservedAt = Date.now();
  const source = 'commands-tab-switcher';
  chrome.tabs.query({ active: true, currentWindow: true }, function(activeTabs) {
    triggerTabSwitcherForTab(activeTabs[0], source, commandObservedAt);
  });
});

if (chrome && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener(registerTabSwitcherExtensionPagePortConnection);
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (!request || typeof request.action !== 'string') {
    return;
  }
  switch (request.action) {
    case 'switchToTab': {
      if (typeof request.tabId !== 'number') {
        sendResponse({ ok: false, reason: 'invalid-tab' });
        return;
      }
      const senderTab = sender && sender.tab ? sender.tab : null;
      focusWindowAndActivateTab(
        request.tabId,
        typeof request.windowId === 'number' ? request.windowId : null,
        (result) => {
          closeSwitcherPopupWindow(senderTab);
          sendResponse(result || { ok: false });
        }
      );
      return true;
    }
    case 'reportTabVisible': {
      const senderTab = sender && sender.tab ? sender.tab : null;
      if (senderTab && typeof senderTab.id === 'number') {
        const at = Number(request && request.at);
        const reportedAt = Number.isFinite(at) ? at : Date.now();
        recordRecentSwitcherTab(senderTab, reportedAt);
        scheduleSwitcherThumbnailCapture(senderTab, 'visible');
      }
      sendResponse({ ok: true });
      return;
    }
    case 'notifyTabSwitcherShortcutModifierReleased': {
      const senderTab = sender && sender.tab ? sender.tab : null;
      handleTabSwitcherShortcutModifierReleased(senderTab, request && request.key, (didCommit) => {
        sendResponse({ ok: true, committed: didCommit === true });
      });
      return true;
    }
    default:
      return;
  }
});

if (chrome && chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!activeInfo || typeof activeInfo.tabId !== 'number') {
      return;
    }
    if (chrome.tabs && typeof chrome.tabs.get === 'function') {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          return;
        }
        ensureTabSwitcherStateLoaded().catch(() => {}).finally(() => {
          recordRecentSwitcherTab(tab);
          scheduleSwitcherThumbnailCapture(tab, 'activated');
        });
      });
    }
  });
}

if (chrome && chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (typeof windowId !== 'number' ||
        windowId === chrome.windows.WINDOW_ID_NONE ||
        !chrome.tabs ||
        typeof chrome.tabs.query !== 'function') {
      return;
    }
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        return;
      }
      const tab = Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
      if (!tab || typeof tab.id !== 'number') {
        return;
      }
      ensureTabSwitcherStateLoaded().catch(() => {}).finally(() => {
        recordRecentSwitcherTab(tab);
        scheduleSwitcherThumbnailCapture(tab, 'window-focus');
      });
    });
  });
}

if (chrome && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    switcherPopupHostTabIds.delete(tabId);
    removeRecentSwitcherTab(tabId);
    Array.from(tabSwitcherHostTabIdByWindowId.entries()).forEach(([windowId, hostTabId]) => {
      if (hostTabId === tabId) {
        tabSwitcherHostTabIdByWindowId.delete(windowId);
      }
    });
  });
}

if (chrome && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo) {
      return;
    }
    if (typeof changeInfo.url === 'string') {
      clearSwitcherThumbnailPriority(tabId);
      updateRecentSwitcherTab(tab);
    }
    if (tab && tab.active === true && (typeof changeInfo.title === 'string' || typeof changeInfo.favIconUrl === 'string')) {
      updateRecentSwitcherTab(tab);
    }
    if (tab && tab.active === true && changeInfo.status === 'complete') {
      ensureTabSwitcherStateLoaded().catch(() => {}).finally(() => {
        recordRecentSwitcherTab(tab);
        scheduleSwitcherThumbnailCapture(tab, 'updated-complete');
      });
    }
  });
}

if (chrome && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    // Static manifest content scripts only apply to future document loads. A
    // development-extension reload keeps existing tabs alive, so install the
    // shortcut observer there now instead of waiting for the next shortcut.
    prepareShortcutKeyObserversInOpenTabs();
  });
}

if (chrome && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    prepareShortcutKeyObserversInOpenTabs();
  });
}

ensureTabSwitcherStateLoaded().catch(() => {});
