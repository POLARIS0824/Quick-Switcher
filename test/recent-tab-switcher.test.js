'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RECENT_TAB_SWITCHER = require('../background/recent-tab-switcher.js');

function makeTab(id, url, extra) {
  return Object.assign({
    id,
    windowId: 1,
    url,
    title: `Tab ${id}`,
    favIconUrl: '',
    lastAccessed: 1000 + id,
    incognito: false
  }, extra || {});
}

function permissiveShouldIncludeTab(tab) {
  return tab && typeof tab.id === 'number' && typeof tab.windowId === 'number' && Boolean(tab.url);
}

function createTracker(options) {
  return RECENT_TAB_SWITCHER.createRecentTabTracker(Object.assign({
    shouldIncludeTab: permissiveShouldIncludeTab
  }, options || {}));
}

test('stack keeps most-recent-first order', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.recordTab(makeTab(2, 'https://a.example.com/2'));
  tracker.recordTab(makeTab(3, 'https://a.example.com/3'));
  const recent = tracker.getRecentTabs([
    makeTab(1, 'https://a.example.com/1'),
    makeTab(2, 'https://a.example.com/2'),
    makeTab(3, 'https://a.example.com/3')
  ]);
  assert.deepEqual(recent.map((tab) => tab.id), [3, 2, 1]);
});

test('recording a tab again dedupes and moves it to the front', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.recordTab(makeTab(2, 'https://a.example.com/2'));
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  const recent = tracker.getRecentTabs([
    makeTab(1, 'https://a.example.com/1'),
    makeTab(2, 'https://a.example.com/2')
  ]);
  assert.deepEqual(recent.map((tab) => tab.id), [1, 2]);
});

test('stack is trimmed to limit * 4 entries', () => {
  const tracker = createTracker({ limit: 5 });
  const liveTabs = [];
  for (let id = 1; id <= 30; id += 1) {
    const tab = makeTab(id, `https://a.example.com/${id}`);
    liveTabs.push(tab);
    tracker.recordTab(tab);
  }
  const stack = tracker.getStackSnapshot();
  assert.equal(stack.length, 20);
  assert.equal(stack[0].id, 30);
  const recent = tracker.getRecentTabs(liveTabs, { limit: 5 });
  assert.deepEqual(recent.map((tab) => tab.id), [30, 29, 28, 27, 26]);
});

test('unknown tabs are filled in by lastAccessed order', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1', { lastAccessed: 500 }));
  const recent = tracker.getRecentTabs([
    makeTab(1, 'https://a.example.com/1', { lastAccessed: 500 }),
    makeTab(7, 'https://a.example.com/7', { lastAccessed: 900 }),
    makeTab(4, 'https://a.example.com/4', { lastAccessed: 700 })
  ], { limit: 3 });
  assert.deepEqual(recent.map((tab) => tab.id), [1, 7, 4]);
});

test('tabs excluded by shouldIncludeTab never enter the stack', () => {
  const tracker = RECENT_TAB_SWITCHER.createRecentTabTracker({ limit: 5 });
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.recordTab(makeTab(2, 'javascript:void(0)'));
  tracker.recordTab(makeTab(3, 'https://a.example.com/3', { incognito: true }));
  const recent = tracker.getRecentTabs([
    makeTab(1, 'https://a.example.com/1'),
    makeTab(2, 'javascript:void(0)')
  ]);
  assert.deepEqual(recent.map((tab) => tab.id), [1]);
});

test('removeTab drops both the stack entry and the thumbnail', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.setThumbnail(1, 'data:image/webp;base64,AAAA', Date.now(), { url: 'https://a.example.com/1' });
  assert.equal(tracker.removeTab(1), true);
  assert.equal(tracker.getStackSnapshot().length, 0);
  assert.equal(tracker.getThumbnail(1, 'https://a.example.com/1'), '');
});

test('exportState / hydrateState round-trips the stack and thumbnails', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.recordTab(makeTab(2, 'https://a.example.com/2'));
  tracker.recordTab(makeTab(3, 'https://a.example.com/3'));
  tracker.setThumbnail(2, 'data:image/webp;base64,AAAA', Date.now(), { url: 'https://a.example.com/2' });
  const state = tracker.exportState();

  const restored = createTracker();
  assert.equal(restored.hydrateState(JSON.parse(JSON.stringify(state))), true);
  const recent = restored.getRecentTabs([
    makeTab(1, 'https://a.example.com/1'),
    makeTab(2, 'https://a.example.com/2'),
    makeTab(3, 'https://a.example.com/3')
  ]);
  assert.deepEqual(recent.map((tab) => tab.id), [3, 2, 1]);
  assert.equal(recent[1]._xSwitcherThumbnail, 'data:image/webp;base64,AAAA');
  assert.equal(recent[1]._xSwitcherThumbnailStatus, 'ok');
});

test('hydrateState merge keeps dirty entries ahead of the persisted stack', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  tracker.recordTab(makeTab(2, 'https://a.example.com/2'));
  const state = tracker.exportState();

  const dirty = createTracker();
  dirty.recordTab(makeTab(9, 'https://a.example.com/9'));
  dirty.recordTab(makeTab(2, 'https://a.example.com/2'));
  dirty.hydrateState(state, { merge: true });
  const stack = dirty.getStackSnapshot();
  assert.deepEqual(stack.map((item) => item.id), [2, 9, 1]);
});

test('hydrateState expires thumbnails past the TTL', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  const capturedAt = Date.now() - (3 * 60 * 60 * 1000);
  tracker.setThumbnail(1, 'data:image/webp;base64,AAAA', capturedAt, { url: 'https://a.example.com/1' });
  const state = tracker.exportState();

  const restored = createTracker();
  restored.hydrateState(state, {});
  assert.equal(restored.getThumbnailState(1, 'https://a.example.com/1').status, 'missing');
});

test('url changes invalidate the cached thumbnail', () => {
  const tracker = createTracker();
  tracker.recordTab(makeTab(1, 'https://a.example.com/one'));
  tracker.setThumbnail(1, 'data:image/webp;base64,AAAA', Date.now(), { url: 'https://a.example.com/one' });
  tracker.updateTab(makeTab(1, 'https://a.example.com/two'));
  const state = tracker.getThumbnailState(1, 'https://a.example.com/two');
  assert.equal(state.dataUrl, '');
});

test('reconfigure enforces the new thumbnail limit immediately', () => {
  const tracker = createTracker({ thumbnailLimit: 3, thumbnailTtlMs: 6 * 60 * 60 * 1000 });
  const now = Date.now();
  for (let id = 1; id <= 3; id += 1) {
    tracker.recordTab(makeTab(id, `https://a.example.com/${id}`));
    assert.equal(
      tracker.setThumbnail(id, 'data:image/webp;base64,AAAA', now + id, { url: `https://a.example.com/${id}` }),
      true
    );
  }
  assert.equal(tracker.exportState().thumbnails.length, 3);
  assert.equal(tracker.reconfigure({ thumbnailLimit: 1 }), true);
  const thumbnails = tracker.exportState().thumbnails;
  assert.equal(thumbnails.length, 1);
  assert.equal(thumbnails[0].tabId, 3);
  assert.equal(tracker.reconfigure({ thumbnailLimit: 1 }), false);
});

test('reconfigure applies the new thumbnail ttl on next read', () => {
  const tracker = createTracker({ thumbnailTtlMs: 6 * 60 * 60 * 1000 });
  tracker.recordTab(makeTab(1, 'https://a.example.com/1'));
  const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
  assert.equal(
    tracker.setThumbnail(1, 'data:image/webp;base64,AAAA', threeHoursAgo, { url: 'https://a.example.com/1' }),
    true
  );
  assert.equal(tracker.reconfigure({ thumbnailTtlMs: 30 * 60 * 1000 }), true);
  assert.equal(tracker.getThumbnailState(1, 'https://a.example.com/1').status, 'missing');
});

test('defaultShouldIncludeTab accepts only http/https pages', () => {
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(makeTab(1, 'https://a.example.com/')), true);
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(makeTab(2, 'http://b.example.com/')), true);
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(makeTab(3, 'chrome://settings/')), false);
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(makeTab(4, 'javascript:void(0)')), false);
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(makeTab(5, 'https://a.example.com/', { incognito: true })), false);
  assert.equal(RECENT_TAB_SWITCHER.defaultShouldIncludeTab(null), false);
});

test('focusWindowAndActivateTab validates input and reports tab-update failures', async () => {
  const invalid = await RECENT_TAB_SWITCHER.focusWindowAndActivateTab(
    { runtime: {}, tabs: {} },
    { tabId: 1, windowId: 2 }
  );
  assert.deepEqual(invalid, { ok: false, reason: 'invalid-tab' });

  const missingRequest = await RECENT_TAB_SWITCHER.focusWindowAndActivateTab(
    {
      runtime: {},
      tabs: { update: () => {} },
      windows: { update: (_windowId, _options, done) => done() }
    },
    null
  );
  assert.deepEqual(missingRequest, { ok: false, reason: 'invalid-tab' });

  const okChrome = {
    runtime: {},
    windows: { update: (_windowId, _options, done) => done() },
    tabs: {
      update: (tabId, _options, done) => done({ id: tabId, windowId: 3 })
    }
  };
  const okResult = await RECENT_TAB_SWITCHER.focusWindowAndActivateTab(okChrome, { tabId: 1, windowId: 2 });
  assert.deepEqual(okResult, { ok: true, tabId: 1, windowId: 2 });

  const failedChrome = {
    runtime: {},
    windows: { update: (_windowId, _options, done) => done() },
    tabs: {
      update: (_tabId, _options, done) => {
        failedChrome.runtime.lastError = { message: 'no tab' };
        done(undefined);
      }
    }
  };
  const failed = await RECENT_TAB_SWITCHER.focusWindowAndActivateTab(failedChrome, { tabId: 1, windowId: 2 });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'no tab');
});
