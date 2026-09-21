'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function createObserverManager(mockChrome, options) {
  const opts = options || {};
  const KEY_OBSERVER_FILES = ['content/key-observer.js'];
  const keyObserverInjectedTabIds = new Set();
  const keyObserverInFlightByTabId = new Map();

  function raceWithTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);
      promise.then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      }).catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
  }

  function canHostSwitcherSurface(tab) {
    if (!tab || typeof tab.id !== 'number' || tab.status === 'loading') {
      return false;
    }
    const url = String(tab.url || '');
    return url.startsWith('http://') || url.startsWith('https://');
  }

  function isTabSwitcherExtensionPageMessageTarget(tab) {
    return false;
  }

  function prepareShortcutKeyObserver(tab) {
    if (!tab || typeof tab.id !== 'number') {
      return Promise.resolve(false);
    }
    if (tab.status === 'loading' || !canHostSwitcherSurface(tab)) {
      return Promise.resolve(false);
    }
    if (isTabSwitcherExtensionPageMessageTarget(tab)) {
      return Promise.resolve(true);
    }
    if (keyObserverInjectedTabIds.has(tab.id)) {
      return Promise.resolve(true);
    }
    if (!mockChrome || !mockChrome.scripting || typeof mockChrome.scripting.executeScript !== 'function') {
      return Promise.resolve(false);
    }

    const inFlightPromise = keyObserverInFlightByTabId.get(tab.id);
    if (inFlightPromise) {
      return raceWithTimeout(inFlightPromise, 50);
    }

    const injectionPromise = new Promise((resolveInjection) => {
      try {
        mockChrome.scripting.executeScript({
          target: {
            tabId: tab.id,
            allFrames: true
          },
          files: KEY_OBSERVER_FILES
        }, () => {
          const error = mockChrome.runtime && mockChrome.runtime.lastError
            ? mockChrome.runtime.lastError.message || 'unknown'
            : '';
          if (!error) {
            keyObserverInjectedTabIds.add(tab.id);
            resolveInjection(true);
          } else {
            resolveInjection(false);
          }
        });
      } catch (error) {
        resolveInjection(false);
      }
    }).finally(() => {
      keyObserverInFlightByTabId.delete(tab.id);
    });

    keyObserverInFlightByTabId.set(tab.id, injectionPromise);
    return raceWithTimeout(injectionPromise, 50);
  }

  function onTabRemoved(tabId) {
    keyObserverInjectedTabIds.delete(tabId);
    keyObserverInFlightByTabId.delete(tabId);
  }

  return {
    prepareShortcutKeyObserver,
    keyObserverInjectedTabIds,
    keyObserverInFlightByTabId,
    onTabRemoved
  };
}

test('executeScript taking 70ms times out at 50ms but records success in cache at 70ms', async () => {
  let executeScriptCallCount = 0;
  const mockChrome = {
    runtime: { lastError: null },
    scripting: {
      executeScript(options, callback) {
        executeScriptCallCount += 1;
        setTimeout(() => {
          callback();
        }, 70);
      }
    }
  };

  const manager = createObserverManager(mockChrome);
  const tab = { id: 10, status: 'complete', url: 'https://example.com' };

  // 1. Initial prepare call should time out at 50ms and resolve false
  const start = Date.now();
  const initialResult = await manager.prepareShortcutKeyObserver(tab);
  const elapsed = Date.now() - start;

  assert.equal(initialResult, false, 'First call must resolve false due to 50ms timeout');
  assert.ok(elapsed >= 45 && elapsed < 90, `Elapsed should be around 50ms, got ${elapsed}ms`);
  assert.equal(executeScriptCallCount, 1);

  // At 50ms, injected cache does not have tab 10 yet
  assert.equal(manager.keyObserverInjectedTabIds.has(10), false);
  assert.equal(manager.keyObserverInFlightByTabId.has(10), true, 'Still in flight at 50ms');

  // 2. Wait until after 70ms completes
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Now the 70ms callback should have completed and updated the cache
  assert.equal(manager.keyObserverInjectedTabIds.has(10), true, '70ms late callback must record success in cache');
  assert.equal(manager.keyObserverInFlightByTabId.has(10), false, 'In-flight promise should be cleared');

  // 3. Subsequent prepare call should resolve true immediately without calling executeScript again
  const secondResult = await manager.prepareShortcutKeyObserver(tab);
  assert.equal(secondResult, true, 'Subsequent call must resolve true immediately from cache');
  assert.equal(executeScriptCallCount, 1, 'executeScript must not be called again');
});

test('concurrent prepare calls for the same tab trigger executeScript only once', async () => {
  let executeScriptCallCount = 0;
  const mockChrome = {
    runtime: { lastError: null },
    scripting: {
      executeScript(options, callback) {
        executeScriptCallCount += 1;
        setTimeout(() => {
          callback();
        }, 20);
      }
    }
  };

  const manager = createObserverManager(mockChrome);
  const tab = { id: 20, status: 'complete', url: 'https://example.com' };

  // Two concurrent calls
  const [res1, res2] = await Promise.all([
    manager.prepareShortcutKeyObserver(tab),
    manager.prepareShortcutKeyObserver(tab)
  ]);

  assert.equal(res1, true);
  assert.equal(res2, true);
  assert.equal(executeScriptCallCount, 1, 'Two concurrent calls must only trigger executeScript once');
  assert.equal(manager.keyObserverInjectedTabIds.has(20), true);
  assert.equal(manager.keyObserverInFlightByTabId.has(20), false);
});

test('executeScript failure is not cached in keyObserverInjectedTabIds', async () => {
  let executeScriptCallCount = 0;
  const mockChrome = {
    runtime: { lastError: null },
    scripting: {
      executeScript(options, callback) {
        executeScriptCallCount += 1;
        mockChrome.runtime.lastError = { message: 'Cannot access tab' };
        callback();
        mockChrome.runtime.lastError = null;
      }
    }
  };

  const manager = createObserverManager(mockChrome);
  const tab = { id: 30, status: 'complete', url: 'https://example.com' };

  const result = await manager.prepareShortcutKeyObserver(tab);
  assert.equal(result, false, 'Failed executeScript must resolve false');
  assert.equal(manager.keyObserverInjectedTabIds.has(30), false, 'Failed injection must not be cached');
  assert.equal(manager.keyObserverInFlightByTabId.has(30), false, 'In-flight record must be cleaned up');
});

test('tab removal cleans up injected cache and in-flight map', () => {
  const mockChrome = { runtime: {}, scripting: {} };
  const manager = createObserverManager(mockChrome);

  manager.keyObserverInjectedTabIds.add(40);
  manager.keyObserverInFlightByTabId.set(40, Promise.resolve(true));

  assert.equal(manager.keyObserverInjectedTabIds.has(40), true);
  assert.equal(manager.keyObserverInFlightByTabId.has(40), true);

  manager.onTabRemoved(40);

  assert.equal(manager.keyObserverInjectedTabIds.has(40), false);
  assert.equal(manager.keyObserverInFlightByTabId.has(40), false);
});
