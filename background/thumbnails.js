(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.QuickSwitchThumbnails = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const CAPTURE_DELAY_MS = 220;
  const PRIORITY_CAPTURE_DELAY_MS = 90;
  const CAPTURE_HIDE_PAINT_WAIT_MS = 48;
  const CAPTURE_MIN_INTERVAL_MS = 650;
  const CAPTURE_JPEG_QUALITY = 42;
  const CAPTURE_REASON_COMMAND_IMMEDIATE = 'command-immediate';
  const THUMBNAIL_TARGET_WIDTH = 320;
  const THUMBNAIL_TARGET_HEIGHT = 200;

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function prepareSwitcherThumbnailDataUrl(dataUrl) {
    const source = typeof dataUrl === 'string' ? dataUrl : '';
    if (!source.startsWith('data:image/')) {
      return '';
    }
    if (typeof OffscreenCanvas !== 'function' ||
        typeof createImageBitmap !== 'function' ||
        typeof fetch !== 'function') {
      return source;
    }
    try {
      const response = await fetch(source);
      const blob = response && typeof response.blob === 'function' ? await response.blob() : null;
      if (!blob) {
        return source;
      }
      const bitmap = await createImageBitmap(blob);
      const sourceWidth = Math.max(1, bitmap.width || 1);
      const sourceHeight = Math.max(1, bitmap.height || 1);
      const targetRatio = THUMBNAIL_TARGET_WIDTH / THUMBNAIL_TARGET_HEIGHT;
      const sourceRatio = sourceWidth / sourceHeight;
      let cropX = 0;
      let cropY = 0;
      let cropWidth = sourceWidth;
      let cropHeight = sourceHeight;
      if (sourceRatio > targetRatio) {
        cropWidth = Math.max(1, Math.round(sourceHeight * targetRatio));
        cropX = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
      } else if (sourceRatio < targetRatio) {
        cropHeight = Math.max(1, Math.round(sourceWidth / targetRatio));
      }
      const canvas = new OffscreenCanvas(THUMBNAIL_TARGET_WIDTH, THUMBNAIL_TARGET_HEIGHT);
      const context = canvas.getContext('2d');
      if (!context) {
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
        return source;
      }
      context.drawImage(
        bitmap,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        THUMBNAIL_TARGET_WIDTH,
        THUMBNAIL_TARGET_HEIGHT
      );
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
      const outputBlob = await canvas.convertToBlob({
        type: 'image/webp',
        quality: 0.68
      });
      const buffer = await outputBlob.arrayBuffer();
      return `data:${outputBlob.type || 'image/webp'};base64,${arrayBufferToBase64(buffer)}`;
    } catch (error) {
      return source;
    }
  }

  function getSwitcherThumbnailStatusForFailureReason(reason) {
    const text = String(reason || '').toLowerCase();
    if (text.includes('restricted') ||
        text.includes('permission') ||
        text.includes('not allowed') ||
        text.includes('not permitted') ||
        text.includes('cannot access') ||
        text.includes('chrome://') ||
        text.includes('web store') ||
        text.includes('unsupported-protocol') ||
        text.includes('untracked-tab')) {
      return 'restricted';
    }
    return 'failed';
  }

  function isSwitcherCommandCaptureReason(reason) {
    const requestReason = String(reason || '');
    return requestReason === CAPTURE_REASON_COMMAND_IMMEDIATE;
  }

  function createThumbnailPipeline(deps) {
    const options = deps && typeof deps === 'object' ? deps : {};
    const chromeApi = options.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    const tracker = options.tracker || null;
    const getResolvedTabUrl = typeof options.getResolvedTabUrl === 'function'
      ? options.getResolvedTabUrl
      : () => '';
    const shouldTrackSwitcherTab = typeof options.shouldTrackSwitcherTab === 'function'
      ? options.shouldTrackSwitcherTab
      : () => false;
    const setTabSwitcherCaptureVisibility = typeof options.setTabSwitcherCaptureVisibility === 'function'
      ? options.setTabSwitcherCaptureVisibility
      : () => Promise.resolve(false);
    const getOpenTabSwitcherState = typeof options.getOpenTabSwitcherState === 'function'
      ? options.getOpenTabSwitcherState
      : () => Promise.resolve({ ok: false, open: false });
    const postTabSwitcherThumbnailUpdate = typeof options.postTabSwitcherThumbnailUpdate === 'function'
      ? options.postTabSwitcherThumbnailUpdate
      : () => Promise.resolve(false);
    const schedulePersistState = typeof options.schedulePersistState === 'function'
      ? options.schedulePersistState
      : () => {};
    const isTabSwitcherOpeningForCapture = typeof options.isTabSwitcherOpeningForCapture === 'function'
      ? options.isTabSwitcherOpeningForCapture
      : () => false;

    const thumbnailTimersByTabId = new Map();
    const thumbnailPriorityByTabId = new Map();
    let thumbnailCaptureChain = Promise.resolve(false);
    let lastCaptureAt = 0;

    function getSwitcherThumbnailForTab(tabId, url) {
      if (!tracker || typeof tracker.getThumbnail !== 'function') {
        return '';
      }
      return tracker.getThumbnail(tabId, url);
    }

    function getSwitcherThumbnailStateForTab(tabId, url) {
      if (tracker && typeof tracker.getThumbnailState === 'function') {
        return tracker.getThumbnailState(tabId, url);
      }
      const dataUrl = getSwitcherThumbnailForTab(tabId, url);
      return {
        status: dataUrl ? 'ok' : 'missing',
        reason: '',
        dataUrl,
        capturedAt: 0,
        updatedAt: 0
      };
    }

    function getSwitcherThumbnailStateForPayload(tab, url) {
      const status = typeof tab._xSwitcherThumbnailStatus === 'string' ? tab._xSwitcherThumbnailStatus : '';
      if (status) {
        return {
          status,
          reason: typeof tab._xSwitcherThumbnailReason === 'string' ? tab._xSwitcherThumbnailReason : '',
          dataUrl: typeof tab._xSwitcherThumbnail === 'string' ? tab._xSwitcherThumbnail : '',
          capturedAt: 0,
          updatedAt: 0
        };
      }
      return getSwitcherThumbnailStateForTab(tab.id, url);
    }

    function isSwitcherThumbnailRefreshNeeded(state) {
      const status = String(state && state.status ? state.status : '').trim().toLowerCase();
      if (status === 'restricted' || status === 'pending') {
        return false;
      }
      if (status === 'missing' || status === 'stale' || status === 'failed') {
        return true;
      }
      if (status === 'ok') {
        return !(state && typeof state.dataUrl === 'string' && state.dataUrl.startsWith('data:image/'));
      }
      return !status;
    }

    function shouldPreCaptureActiveSwitcherThumbnailBeforePayload(tab) {
      const isActive = tab && tab.active === true;
      if (!isActive || tab.status === 'loading' || !canCaptureSwitcherThumbnail(tab)) {
        return false;
      }
      const state = getSwitcherThumbnailStateForPayload(tab, getResolvedTabUrl(tab));
      return isSwitcherThumbnailRefreshNeeded(state);
    }

    function findSwitcherTabById(tabList, tabId) {
      if (typeof tabId !== 'number') {
        return null;
      }
      return (Array.isArray(tabList) ? tabList : []).find((tab) =>
        tab && typeof tab.id === 'number' && tab.id === tabId
      ) || null;
    }

    function markSwitcherThumbnailPriorityForItems(items, tabList, reason) {
      if (!Array.isArray(items) || !items.length) {
        return;
      }
      items.forEach((item) => {
        if (!item || typeof item.id !== 'number') {
          return;
        }
        if (!isSwitcherThumbnailRefreshNeeded({
          status: item.thumbnailStatus,
          dataUrl: item.thumbnail
        })) {
          return;
        }
        const tab = findSwitcherTabById(tabList, item.id) || item;
        if (!canCaptureSwitcherThumbnail(tab)) {
          return;
        }
        thumbnailPriorityByTabId.set(item.id, {
          url: getResolvedTabUrl(tab) || item.url || '',
          status: item.thumbnailStatus || 'missing',
          reason: reason || '',
          markedAt: Date.now()
        });
      });
    }

    function clearSwitcherThumbnailPriority(tabId) {
      if (typeof tabId !== 'number') {
        return;
      }
      thumbnailPriorityByTabId.delete(tabId);
    }

    function consumeSwitcherThumbnailPriority(tab, reason) {
      const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
      if (typeof tabId !== 'number') {
        return false;
      }
      const entry = thumbnailPriorityByTabId.get(tabId);
      if (!entry) {
        return false;
      }
      const url = getResolvedTabUrl(tab);
      if (entry.url && url && entry.url !== url) {
        clearSwitcherThumbnailPriority(tabId);
        return false;
      }
      const state = getSwitcherThumbnailStateForTab(tabId, url);
      if (!isSwitcherThumbnailRefreshNeeded(state)) {
        clearSwitcherThumbnailPriority(tabId);
        return false;
      }
      clearSwitcherThumbnailPriority(tabId);
      return true;
    }

    function markSwitcherThumbnailStatus(tab, status, requestReason, failureReason) {
      if (!tracker || typeof tracker.setThumbnailStatus !== 'function') {
        return false;
      }
      if (!tab || typeof tab.id !== 'number') {
        return false;
      }
      const didSet = tracker.setThumbnailStatus(tab.id, status, Date.now(), {
        url: getResolvedTabUrl(tab),
        reason: failureReason || requestReason || ''
      });
      if (didSet) {
        schedulePersistState();
      }
      return didSet;
    }

    function canCaptureSwitcherThumbnail(tab) {
      return getSwitcherThumbnailCaptureFailureReason(tab) === '';
    }

    function getSwitcherThumbnailCaptureFailureReason(tab) {
      if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') {
        return 'invalid-tab';
      }
      if (!shouldTrackSwitcherTab(tab)) {
        return 'untracked-tab';
      }
      const url = getResolvedTabUrl(tab);
      try {
        const parsed = new URL(url);
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (!protocol || protocol === 'javascript:') {
          return 'unsupported-protocol';
        }
        return '';
      } catch (error) {
        return 'invalid-url';
      }
    }

    function logSwitcherThumbnailCaptureFailure(tab, failureReason, requestReason) {
      markSwitcherThumbnailStatus(
        tab,
        getSwitcherThumbnailStatusForFailureReason(failureReason),
        requestReason,
        failureReason
      );
    }

    function waitForSwitcherThumbnailCaptureSlot() {
      const sinceLast = Date.now() - lastCaptureAt;
      const waitMs = Math.max(0, CAPTURE_MIN_INTERVAL_MS - sinceLast);
      if (waitMs <= 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }

    function waitForTabSwitcherCapturePaint() {
      return new Promise((resolve) => {
        setTimeout(resolve, CAPTURE_HIDE_PAINT_WAIT_MS);
      });
    }

    function withTabSwitcherHiddenForCapture(tab, capture) {
      const runCapture = typeof capture === 'function' ? capture : () => Promise.resolve(false);
      return setTabSwitcherCaptureVisibility(tab, true)
        .catch(() => false)
        .then(() => waitForTabSwitcherCapturePaint())
        .then(() => runCapture())
        .finally(() => setTabSwitcherCaptureVisibility(tab, false));
    }

    function clearScheduledSwitcherThumbnailCapture(tabId) {
      if (typeof tabId !== 'number') {
        return;
      }
      const timer = thumbnailTimersByTabId.get(tabId);
      if (timer !== undefined) {
        clearTimeout(timer);
        thumbnailTimersByTabId.delete(tabId);
      }
    }

    function shouldSkipSwitcherThumbnailCaptureForOpenSwitcher(tab, reason) {
      if (isSwitcherCommandCaptureReason(reason)) {
        return Promise.resolve(false);
      }
      if (isTabSwitcherOpeningForCapture(tab)) {
        return Promise.resolve(true);
      }
      return getOpenTabSwitcherState(tab)
        .then((state) => Boolean(state && state.open === true))
        .catch(() => false);
    }

    function enqueueSwitcherThumbnailCapture(tab, reason) {
      markSwitcherThumbnailStatus(tab, 'pending', reason, '');
      const runCapture = () => waitForSwitcherThumbnailCaptureSlot()
        .then(() => captureSwitcherThumbnailForTab(tab, reason));
      const queued = thumbnailCaptureChain
        .catch(() => false)
        .then(runCapture);
      thumbnailCaptureChain = queued.catch(() => false);
      return queued;
    }

    // Between the initial active-tab check and the actual captureVisibleTab
    // call sit several async hops (state query, panel-hide paint wait); the
    // visible tab can change underneath (e.g. the borrow-host flow switches
    // focus right after starting a pre-capture). Re-read the tab at storage
    // time so pixels are never attributed to a tab that is no longer visible.
    function verifyCapturedTabStillActive(tabId, resolvedTab) {
      return new Promise((resolve) => {
        if (!chromeApi || !chromeApi.tabs || typeof chromeApi.tabs.get !== 'function') {
          resolve(resolvedTab);
          return;
        }
        chromeApi.tabs.get(tabId, (freshTab) => {
          if (chromeApi.runtime && chromeApi.runtime.lastError) {
            resolve(null);
            return;
          }
          if (!freshTab || typeof freshTab.id !== 'number' || freshTab.active !== true) {
            resolve(null);
            return;
          }
          resolve(freshTab);
        });
      });
    }

    function captureSwitcherThumbnailForTab(tab, reason) {
      const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
      const windowId = tab && typeof tab.windowId === 'number' ? tab.windowId : null;
      clearScheduledSwitcherThumbnailCapture(tabId);
      if (typeof tabId !== 'number' || typeof windowId !== 'number') {
        logSwitcherThumbnailCaptureFailure(tab, 'invalid-tab', reason);
        return Promise.resolve(false);
      }
      if (!chromeApi || !chromeApi.tabs || typeof chromeApi.tabs.captureVisibleTab !== 'function') {
        logSwitcherThumbnailCaptureFailure(tab, 'capture-api-unavailable', reason);
        return Promise.resolve(false);
      }
      const captureResolvedTab = (resolvedTab) => new Promise((resolve) => {
        const failureReason = getSwitcherThumbnailCaptureFailureReason(resolvedTab);
        if (failureReason) {
          logSwitcherThumbnailCaptureFailure(resolvedTab || tab, failureReason, reason);
          resolve(false);
          return;
        }
        if (!resolvedTab || resolvedTab.active !== true) {
          logSwitcherThumbnailCaptureFailure(resolvedTab || tab, 'inactive-tab', reason);
          resolve(false);
          return;
        }
        shouldSkipSwitcherThumbnailCaptureForOpenSwitcher(resolvedTab, reason).then((shouldSkip) => {
          if (shouldSkip) {
            logSwitcherThumbnailCaptureFailure(resolvedTab, 'tab-switcher-open', reason);
            resolve(false);
            return;
          }
          lastCaptureAt = Date.now();
          withTabSwitcherHiddenForCapture(resolvedTab, () => new Promise((captureResolve) => {
            try {
              chromeApi.tabs.captureVisibleTab(windowId, {
                format: 'jpeg',
                quality: CAPTURE_JPEG_QUALITY
              }, (dataUrl) => {
                if (chromeApi.runtime && chromeApi.runtime.lastError) {
                  captureResolve({
                    ok: false,
                    reason: chromeApi.runtime.lastError.message || 'capture-visible-tab-failed'
                  });
                  return;
                }
                captureResolve({
                  ok: true,
                  dataUrl
                });
              });
            } catch (error) {
              captureResolve({
                ok: false,
                reason: error && error.message ? error.message : 'capture-visible-tab-threw'
              });
            }
          })).then((captureResult) => {
            if (!captureResult || captureResult.ok !== true) {
              logSwitcherThumbnailCaptureFailure(
                resolvedTab,
                captureResult && captureResult.reason ? captureResult.reason : 'capture-visible-tab-failed',
                reason
              );
              resolve(false);
              return;
            }
            verifyCapturedTabStillActive(tabId, resolvedTab).then((freshTab) => {
              if (!freshTab) {
                logSwitcherThumbnailCaptureFailure(resolvedTab, 'tab-became-inactive', reason);
                resolve(false);
                return;
              }
              prepareSwitcherThumbnailDataUrl(captureResult.dataUrl).then((thumbnailDataUrl) => {
                if (!thumbnailDataUrl || !tracker || typeof tracker.setThumbnail !== 'function') {
                  logSwitcherThumbnailCaptureFailure(resolvedTab, 'empty-thumbnail-data', reason);
                  resolve(false);
                  return;
                }
                const didSet = tracker.setThumbnail(freshTab.id, thumbnailDataUrl, Date.now(), {
                  url: getResolvedTabUrl(freshTab)
                });
                if (didSet) {
                  schedulePersistState();
                  if (isSwitcherCommandCaptureReason(reason)) {
                    postTabSwitcherThumbnailUpdate(freshTab, {
                      tabId: freshTab.id,
                      url: getResolvedTabUrl(freshTab),
                      thumbnail: thumbnailDataUrl,
                      thumbnailStatus: 'ok',
                      thumbnailReason: ''
                    }).catch(() => {});
                  }
                } else {
                  logSwitcherThumbnailCaptureFailure(resolvedTab, 'thumbnail-cache-rejected', reason);
                }
                resolve(Boolean(didSet));
              }).catch(() => {
                logSwitcherThumbnailCaptureFailure(resolvedTab, 'prepare-thumbnail-failed', reason);
                resolve(false);
              });
            });
          }).catch(() => {
            logSwitcherThumbnailCaptureFailure(resolvedTab, 'capture-visible-tab-failed', reason);
            resolve(false);
          });
        }).catch(() => {
          logSwitcherThumbnailCaptureFailure(resolvedTab, 'tab-switcher-open-state-failed', reason);
          resolve(false);
        });
      });
      if (typeof chromeApi.tabs.get !== 'function') {
        return captureResolvedTab(tab);
      }
      return new Promise((resolve) => {
        chromeApi.tabs.get(tabId, (freshTab) => {
          if (chromeApi.runtime && chromeApi.runtime.lastError) {
            logSwitcherThumbnailCaptureFailure(tab, chromeApi.runtime.lastError.message || 'tabs-get-failed', reason);
            resolve(false);
            return;
          }
          captureResolvedTab(freshTab || tab).then(resolve).catch(() => {
            resolve(false);
          });
        });
      });
    }

    function scheduleSwitcherThumbnailCapture(tab, reason) {
      if (!canCaptureSwitcherThumbnail(tab)) {
        logSwitcherThumbnailCaptureFailure(tab, getSwitcherThumbnailCaptureFailureReason(tab), reason);
        return;
      }
      if (!chromeApi || !chromeApi.tabs || typeof chromeApi.tabs.captureVisibleTab !== 'function') {
        logSwitcherThumbnailCaptureFailure(tab, 'capture-api-unavailable', reason);
        return;
      }
      const hasPriority = consumeSwitcherThumbnailPriority(tab, reason);
      const requestReason = hasPriority ? `priority-${reason || 'visible'}` : reason;
      clearScheduledSwitcherThumbnailCapture(tab.id);
      markSwitcherThumbnailStatus(tab, 'pending', requestReason, '');
      const delay = hasPriority ? PRIORITY_CAPTURE_DELAY_MS : CAPTURE_DELAY_MS;
      const request = {
        tabId: tab.id,
        windowId: tab.windowId,
        reason: requestReason || '',
        requestedAt: Date.now()
      };
      const timer = setTimeout(() => {
        thumbnailTimersByTabId.delete(tab.id);
        enqueueSwitcherThumbnailCapture({
          id: request.tabId,
          windowId: request.windowId
        }, request.reason).catch(() => {});
      }, delay);
      thumbnailTimersByTabId.set(tab.id, timer);
    }

    return Object.freeze({
      markSwitcherThumbnailPriorityForItems,
      captureSwitcherThumbnailForTab,
      scheduleSwitcherThumbnailCapture,
      clearScheduledSwitcherThumbnailCapture,
      clearSwitcherThumbnailPriority,
      getSwitcherThumbnailStateForTab,
      getSwitcherThumbnailStateForPayload,
      isSwitcherThumbnailRefreshNeeded,
      shouldPreCaptureActiveSwitcherThumbnailBeforePayload
    });
  }

  return Object.freeze({
    CAPTURE_REASON_COMMAND_IMMEDIATE,
    createThumbnailPipeline,
    prepareSwitcherThumbnailDataUrl
  });
});
