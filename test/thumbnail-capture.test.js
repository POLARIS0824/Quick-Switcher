'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const QUICK_SWITCH_THUMBNAILS = require('../background/thumbnails.js');
const RECENT_TAB_SWITCHER = require('../background/recent-tab-switcher.js');

function createMockChromeApi(initialTabs) {
  const tabsMap = new Map();
  (initialTabs || []).forEach((tab) => {
    tabsMap.set(tab.id, { ...tab });
  });

  const capturedWindows = [];

  const api = {
    runtime: {
      lastError: null
    },
    tabs: {
      get(tabId, callback) {
        const tab = tabsMap.get(tabId);
        if (!tab) {
          api.runtime.lastError = { message: `No tab with id ${tabId}` };
          callback(undefined);
          api.runtime.lastError = null;
          return;
        }
        callback({ ...tab });
      },
      query(queryInfo, callback) {
        const results = Array.from(tabsMap.values()).filter((tab) => {
          if (queryInfo.windowId !== undefined && tab.windowId !== queryInfo.windowId) {
            return false;
          }
          if (queryInfo.active !== undefined && tab.active !== queryInfo.active) {
            return false;
          }
          return true;
        }).map((tab) => ({ ...tab }));
        callback(results);
      },
      captureVisibleTab(windowId, options, callback) {
        capturedWindows.push(windowId);
        // Find active tab in windowId to simulate visible pixels
        const activeTab = Array.from(tabsMap.values()).find((tab) =>
          tab.windowId === windowId && tab.active === true
        );
        if (!activeTab) {
          api.runtime.lastError = { message: `No active tab in window ${windowId}` };
          callback(undefined);
          api.runtime.lastError = null;
          return;
        }
        // Return simulated image data tagged with windowId and tabId
        callback(`data:image/jpeg;base64,win_${windowId}_tab_${activeTab.id}`);
      }
    },
    _tabsMap: tabsMap,
    _capturedWindows: capturedWindows
  };

  return api;
}

function createPipeline(chromeApi, tracker) {
  return QUICK_SWITCH_THUMBNAILS.createThumbnailPipeline({
    chromeApi,
    tracker,
    getResolvedTabUrl: (tab) => (tab && tab.url) || '',
    shouldTrackSwitcherTab: (tab) => Boolean(tab && typeof tab.id === 'number' && tab.url),
    setTabSwitcherCaptureVisibility: () => Promise.resolve(false),
    getOpenTabSwitcherState: () => Promise.resolve({ ok: true, open: false }),
    postTabSwitcherThumbnailUpdate: () => Promise.resolve(false),
    schedulePersistState: () => {},
    isTabSwitcherOpeningForCapture: () => false
  });
}

test('normal unmigrated tab captures visible tab in its window successfully', async () => {
  const chromeApi = createMockChromeApi([
    { id: 10, windowId: 1, active: true, url: 'https://example.com/1' }
  ]);
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  tracker.recordTab({ id: 10, windowId: 1, url: 'https://example.com/1', active: true });

  const pipeline = createPipeline(chromeApi, tracker);
  const success = await pipeline.captureSwitcherThumbnailForTab({ id: 10, windowId: 1 });

  assert.equal(success, true);
  assert.deepEqual(chromeApi._capturedWindows, [1]);
  const thumb = tracker.getThumbnail(10, 'https://example.com/1');
  assert.ok(thumb.includes('win_1_tab_10'));
  assert.equal(tracker.getThumbnailState(10, 'https://example.com/1').status, 'ok');
});

test('tab moved from window 1 to window 2 before capture uses fresh windowId', async () => {
  // Tab 10 initially in window 1. Tab 20 in window 1.
  // Tab 10 moves to window 2 and remains active in window 2.
  // Window 1 now has Tab 20 as active.
  const chromeApi = createMockChromeApi([
    { id: 20, windowId: 1, active: true, url: 'https://example.com/old-window-active' },
    { id: 10, windowId: 2, active: true, url: 'https://example.com/moved-tab' }
  ]);
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  tracker.recordTab({ id: 10, windowId: 2, url: 'https://example.com/moved-tab', active: true });
  tracker.recordTab({ id: 20, windowId: 1, url: 'https://example.com/old-window-active', active: true });

  const pipeline = createPipeline(chromeApi, tracker);

  // Stale request passed with windowId: 1
  const success = await pipeline.captureSwitcherThumbnailForTab({ id: 10, windowId: 1 });

  assert.equal(success, true);
  // Must capture window 2 (the fresh tab's window), NOT window 1
  assert.deepEqual(chromeApi._capturedWindows, [2]);
  const thumb10 = tracker.getThumbnail(10, 'https://example.com/moved-tab');
  // Must contain window 2 capture, NOT window 1 (which would be Tab 20)
  assert.ok(thumb10.includes('win_2_tab_10'), 'Tab 10 should receive window 2 pixels');
  assert.ok(!thumb10.includes('tab_20'), 'Tab 10 must never receive Tab 20 pixels');
  // Tab 20 must not have received anything
  assert.equal(tracker.getThumbnail(20, 'https://example.com/old-window-active'), '');
});

test('tab moved from window 1 to window 2 but inactive in window 2 drops capture', async () => {
  // Tab 10 moved to window 2 but is NOT active in window 2 (Tab 30 is active in window 2)
  // Window 1 has Tab 20 active.
  const chromeApi = createMockChromeApi([
    { id: 20, windowId: 1, active: true, url: 'https://example.com/old-window' },
    { id: 10, windowId: 2, active: false, url: 'https://example.com/moved-inactive' },
    { id: 30, windowId: 2, active: true, url: 'https://example.com/window-2-active' }
  ]);
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  tracker.recordTab({ id: 10, windowId: 2, url: 'https://example.com/moved-inactive' });

  const pipeline = createPipeline(chromeApi, tracker);

  const success = await pipeline.captureSwitcherThumbnailForTab({ id: 10, windowId: 1 });

  assert.equal(success, false);
  // captureVisibleTab must NOT be called
  assert.equal(chromeApi._capturedWindows.length, 0);
  assert.equal(tracker.getThumbnail(10, 'https://example.com/moved-inactive'), '');
  assert.equal(tracker.getThumbnail(20, 'https://example.com/old-window'), '');
  assert.equal(tracker.getThumbnail(30, 'https://example.com/window-2-active'), '');
});

test('tab becoming inactive or moving window after captureVisibleTab is discarded', async () => {
  const chromeApi = createMockChromeApi([
    { id: 10, windowId: 1, active: true, url: 'https://example.com/race' }
  ]);
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  tracker.recordTab({ id: 10, windowId: 1, url: 'https://example.com/race', active: true });

  const pipeline = createPipeline(chromeApi, tracker);

  // Hook captureVisibleTab so that right after capture returns, the tab changes window
  const originalCapture = chromeApi.tabs.captureVisibleTab;
  chromeApi.tabs.captureVisibleTab = function(windowId, options, callback) {
    originalCapture.call(this, windowId, options, (dataUrl) => {
      // Tab 10 moves to window 2 during capture!
      chromeApi._tabsMap.set(10, {
        id: 10,
        windowId: 2,
        active: true,
        url: 'https://example.com/race'
      });
      callback(dataUrl);
    });
  };

  const success = await pipeline.captureSwitcherThumbnailForTab({ id: 10, windowId: 1 });

  assert.equal(success, false, 'Capture must fail when tab window changes mid-capture');
  assert.equal(tracker.getThumbnail(10, 'https://example.com/race'), '');
});
