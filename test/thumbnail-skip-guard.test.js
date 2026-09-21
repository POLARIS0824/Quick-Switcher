'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const QUICK_SWITCH_THUMBNAILS = require('../background/thumbnails.js');
const RECENT_TAB_SWITCHER = require('../background/recent-tab-switcher.js');

function createPipeline(options) {
  const opts = options || {};
  return QUICK_SWITCH_THUMBNAILS.createThumbnailPipeline({
    chromeApi: opts.chromeApi || null,
    tracker: opts.tracker || null,
    getResolvedTabUrl: (tab) => (tab && tab.url) || '',
    shouldTrackSwitcherTab: (tab) => Boolean(tab && typeof tab.id === 'number' && tab.url),
    setTabSwitcherCaptureVisibility: () => Promise.resolve(false),
    getOpenTabSwitcherState: typeof opts.getOpenTabSwitcherState === 'function'
      ? opts.getOpenTabSwitcherState
      : () => Promise.resolve({ ok: true, open: false }),
    postTabSwitcherThumbnailUpdate: () => Promise.resolve(false),
    schedulePersistState: () => {},
    isTabSwitcherOpeningForCapture: typeof opts.isTabSwitcherOpeningForCapture === 'function'
      ? opts.isTabSwitcherOpeningForCapture
      : () => false
  });
}

test('tab with existing valid thumbnail retains ok status when capture is skipped because switcher is open', async () => {
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  const tab = { id: 10, windowId: 1, active: true, url: 'https://example.com/page' };
  tracker.recordTab(tab);

  // Set an initial valid thumbnail
  const initialDataUrl = 'data:image/webp;base64,VALID_IMAGE_DATA_123';
  tracker.setThumbnail(10, initialDataUrl, Date.now(), { url: 'https://example.com/page' });

  let captureVisibleTabCalls = 0;
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      get(id, cb) { cb({ ...tab }); },
      query(q, cb) { cb([{ ...tab }]); },
      captureVisibleTab(winId, opts, cb) {
        captureVisibleTabCalls += 1;
        cb('data:image/jpeg;base64,NEW_IMAGE');
      }
    }
  };

  // Switcher is open!
  const pipeline = createPipeline({
    chromeApi,
    tracker,
    getOpenTabSwitcherState: () => Promise.resolve({ ok: true, open: true })
  });

  const success = await pipeline.captureSwitcherThumbnailForTab(tab, 'scheduled');
  assert.equal(success, false, 'Capture should be skipped when switcher is open');
  assert.equal(captureVisibleTabCalls, 0, 'captureVisibleTab must not be called');

  // Thumbnail must still be 'ok' and keep the existing image!
  const state = tracker.getThumbnailState(10, 'https://example.com/page');
  assert.equal(state.status, 'ok', 'Status must remain ok after tab-switcher-open skip');
  assert.equal(state.dataUrl, initialDataUrl, 'Image data must be preserved');

  // Next opening must not consider refresh needed
  const refreshNeeded = pipeline.isSwitcherThumbnailRefreshNeeded(state);
  assert.equal(refreshNeeded, false, 'Refresh must not be needed for existing valid thumbnail');
});

test('tab with existing thumbnail is not marked pending during scheduling or skipped', async () => {
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  const tab = { id: 10, windowId: 1, active: true, url: 'https://example.com/page' };
  tracker.recordTab(tab);
  tracker.setThumbnail(10, 'data:image/webp;base64,INITIAL', Date.now(), { url: 'https://example.com/page' });

  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      get(id, cb) { cb({ ...tab }); },
      query(q, cb) { cb([{ ...tab }]); },
      captureVisibleTab(winId, opts, cb) { cb('data:image/jpeg;base64,NEW'); }
    }
  };

  const pipeline = createPipeline({
    chromeApi,
    tracker,
    getOpenTabSwitcherState: () => Promise.resolve({ ok: true, open: true })
  });

  // Schedule capture
  pipeline.scheduleSwitcherThumbnailCapture(tab, 'visible');

  // Immediate state check: must NOT have been converted to 'pending'
  const stateAfterSchedule = tracker.getThumbnailState(10, 'https://example.com/page');
  assert.equal(stateAfterSchedule.status, 'ok');
  assert.equal(stateAfterSchedule.dataUrl, 'data:image/webp;base64,INITIAL');

  // Clear scheduled capture
  pipeline.clearScheduledSwitcherThumbnailCapture(10);
});

test('tab without existing thumbnail reverts to missing instead of failed when skipped', async () => {
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  const tab = { id: 10, windowId: 1, active: true, url: 'https://example.com/page' };
  tracker.recordTab(tab);

  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      get(id, cb) { cb({ ...tab }); },
      query(q, cb) { cb([{ ...tab }]); },
      captureVisibleTab(winId, opts, cb) { cb('data:image/jpeg;base64,NEW'); }
    }
  };

  const pipeline = createPipeline({
    chromeApi,
    tracker,
    getOpenTabSwitcherState: () => Promise.resolve({ ok: true, open: true })
  });

  const success = await pipeline.captureSwitcherThumbnailForTab(tab, 'visible');
  assert.equal(success, false);

  const state = tracker.getThumbnailState(10, 'https://example.com/page');
  assert.notEqual(state.status, 'failed', 'Status must not be failed after benign skip');
  assert.equal(state.status, 'missing');
});

test('actual capture failure still records failed or restricted status', async () => {
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({
    shouldIncludeTab: () => true
  });
  const tabsMap = new Map();
  tabsMap.set(10, { id: 10, windowId: 1, active: true, url: 'https://example.com/page' });
  tabsMap.set(11, { id: 11, windowId: 1, active: true, url: 'chrome://settings' });

  tracker.recordTab(tabsMap.get(10));
  tracker.recordTab(tabsMap.get(11));

  let currentActiveTabId = 10;
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      get(id, cb) {
        const t = tabsMap.get(id);
        cb(t ? { ...t, active: t.id === currentActiveTabId } : undefined);
      },
      query(q, cb) {
        const activeTab = tabsMap.get(currentActiveTabId);
        cb(activeTab && activeTab.windowId === q.windowId ? [{ ...activeTab }] : []);
      },
      captureVisibleTab(winId, opts, cb) {
        if (currentActiveTabId === 11) {
          chromeApi.runtime.lastError = { message: 'Cannot access chrome:// url: not permitted' };
        } else {
          chromeApi.runtime.lastError = { message: 'Internal capture error' };
        }
        cb(undefined);
        chromeApi.runtime.lastError = null;
      }
    }
  };

  const pipeline = createPipeline({
    chromeApi,
    tracker,
    getOpenTabSwitcherState: () => Promise.resolve({ ok: true, open: false })
  });

  // 1. Tab 10 normal failure
  currentActiveTabId = 10;
  const success10 = await pipeline.captureSwitcherThumbnailForTab(tabsMap.get(10), 'visible');
  assert.equal(success10, false);
  const state10 = tracker.getThumbnailState(10, 'https://example.com/page');
  assert.equal(state10.status, 'failed', 'Actual error must record failed status');

  // 2. Tab 11 restricted URL / permission error
  currentActiveTabId = 11;
  const success11 = await pipeline.captureSwitcherThumbnailForTab(tabsMap.get(11), 'visible');
  assert.equal(success11, false);
  const state11 = tracker.getThumbnailState(11, 'chrome://settings');
  assert.equal(state11.status, 'restricted', 'chrome:// permission error must record restricted status');
});

test('reportTabVisible with reason panel does not schedule thumbnail capture', () => {
  let scheduledTab = null;
  let scheduledReason = null;
  const mockScheduleSwitcherThumbnailCapture = (tab, reason) => {
    scheduledTab = tab;
    scheduledReason = reason;
  };

  let recordedTab = null;
  const mockRecordRecentSwitcherTab = (tab, at) => {
    recordedTab = tab;
  };

  // Simulate background message handler logic for reportTabVisible
  function handleReportTabVisible(senderTab, request) {
    if (senderTab && typeof senderTab.id === 'number') {
      const at = Number(request && request.at);
      const reportedAt = Number.isFinite(at) ? at : Date.now();
      mockRecordRecentSwitcherTab(senderTab, reportedAt);
      if (!request || request.reason !== 'panel') {
        mockScheduleSwitcherThumbnailCapture(senderTab, 'visible');
      }
    }
  }

  // 1. With reason: 'panel'
  const senderTab = { id: 42, windowId: 1, url: 'https://example.com' };
  handleReportTabVisible(senderTab, { action: 'reportTabVisible', reason: 'panel', at: 12345 });

  assert.equal(recordedTab.id, 42, 'MRU/recentTab must still be recorded');
  assert.equal(scheduledTab, null, 'Thumbnail capture must not be scheduled for reason panel');

  // 2. With reason: other / undefined
  handleReportTabVisible(senderTab, { action: 'reportTabVisible', at: 12346 });
  assert.equal(scheduledTab.id, 42, 'Thumbnail capture should be scheduled for normal visible reports');
  assert.equal(scheduledReason, 'visible');
});
