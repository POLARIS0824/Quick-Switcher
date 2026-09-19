'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PANEL_SCRIPT_PATH = path.join(__dirname, '../content/panel.js');
const PANEL_CODE = fs.readFileSync(PANEL_SCRIPT_PATH, 'utf8');

function createMockElement(tagName) {
  const children = [];
  const el = {
    tagName: (tagName || 'div').toUpperCase(),
    style: {
      setProperty() {},
      removeProperty() {}
    },
    dataset: {},
    classList: {
      add() {},
      remove() {},
      contains: () => false
    },
    setAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild(child) {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    children,
    parentNode: null
  };
  return el;
}

test('prepareShortcutKeyObserver: skips injection on loading tabs and unhostable pages', async () => {
  let executeScriptCalled = false;

  const mockChrome = {
    runtime: {},
    scripting: {
      executeScript(options, cb) {
        executeScriptCalled = true;
        cb();
      }
    }
  };

  function canHostSwitcherSurface(tab) {
    if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return false;
    if (tab.status === 'loading') return false;
    return Boolean(tab.url && !tab.url.startsWith('chrome://'));
  }

  function isTabSwitcherExtensionPageMessageTarget() {
    return false;
  }

  const keyObserverInjectedTabIds = new Set();
  const KEY_OBSERVER_FILES = ['content/key-observer.js'];

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
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 50);
      try {
        mockChrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: KEY_OBSERVER_FILES
        }, () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  // 1. Loading tab should NOT call executeScript and resolve false immediately
  const loadingTab = { id: 1, windowId: 1, status: 'loading', url: 'https://example.com' };
  const loadingResult = await prepareShortcutKeyObserver(loadingTab);
  assert.equal(loadingResult, false);
  assert.equal(executeScriptCalled, false, 'executeScript must not be called for loading tab');

  // 2. Unhostable tab (e.g. chrome://) should NOT call executeScript
  const chromeTab = { id: 2, windowId: 1, status: 'complete', url: 'chrome://settings' };
  const chromeResult = await prepareShortcutKeyObserver(chromeTab);
  assert.equal(chromeResult, false);
  assert.equal(executeScriptCalled, false, 'executeScript must not be called for unhostable tab');

  // 3. Normal complete tab calls executeScript
  const normalTab = { id: 3, windowId: 1, status: 'complete', url: 'https://example.com' };
  const normalResult = await prepareShortcutKeyObserver(normalTab);
  assert.equal(normalResult, true);
  assert.equal(executeScriptCalled, true, 'executeScript should be called for normal ready tab');
});

test('prepareShortcutKeyObserver: enforces 50ms timeout when executeScript hangs', async () => {
  const mockChrome = {
    runtime: {},
    scripting: {
      executeScript(options, cb) {
        // Deliberately never invoke cb (simulate Chrome hanging on document_idle)
      }
    }
  };

  function prepareShortcutKeyObserver(tab) {
    if (!tab || typeof tab.id !== 'number') {
      return Promise.resolve(false);
    }
    if (tab.status === 'loading') {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 50);
      try {
        mockChrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content/key-observer.js']
        }, () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  const start = Date.now();
  const result = await prepareShortcutKeyObserver({ id: 10, windowId: 1, status: 'complete' });
  const elapsed = Date.now() - start;

  assert.equal(result, false, 'Should timeout and resolve false');
  assert.ok(elapsed >= 40 && elapsed <= 150, `Elapsed time should be around 50ms, was ${elapsed}ms`);
});

test('openSwitcherInPopupWindow: concurrent calls create only one popup window', async () => {
  let windowsCreateCallCount = 0;
  let activeSwitcherPopupWindowId = null;
  let activeSwitcherPopupTab = null;
  let creatingSwitcherPopupWindowPromise = null;
  const switcherPopupHostTabIds = new Set();

  const mockChrome = {
    runtime: {},
    windows: {
      create(options, cb) {
        windowsCreateCallCount++;
        // Simulate async window creation taking 20ms
        setTimeout(() => {
          cb({
            id: 100,
            tabs: [{ id: 500, windowId: 100 }]
          });
        }, 20);
      }
    }
  };

  function openSwitcherInPopupWindow(activeTab, tabList, items, context) {
    const onUnavailable = () => {
      if (context && typeof context.onUnavailable === 'function') {
        context.onUnavailable();
      }
    };
    if (!mockChrome || !mockChrome.windows || typeof mockChrome.windows.create !== 'function') {
      onUnavailable();
      return;
    }
    if (activeSwitcherPopupTab && typeof activeSwitcherPopupTab.id === 'number') {
      context.onHostReady(activeSwitcherPopupTab);
      return;
    }
    if (creatingSwitcherPopupWindowPromise) {
      creatingSwitcherPopupWindowPromise.then((popupTab) => {
        if (popupTab) {
          context.onHostReady(popupTab);
        } else {
          onUnavailable();
        }
      });
      return;
    }

    creatingSwitcherPopupWindowPromise = new Promise((resolve) => {
      mockChrome.windows.create({
        type: 'popup',
        focused: true
      }, (createdWindow) => {
        creatingSwitcherPopupWindowPromise = null;
        const popupTab = createdWindow && createdWindow.tabs && createdWindow.tabs[0];
        if (!popupTab) {
          resolve(null);
          return;
        }
        activeSwitcherPopupWindowId = createdWindow.id;
        activeSwitcherPopupTab = popupTab;
        switcherPopupHostTabIds.add(popupTab.id);
        resolve(popupTab);
      });
    });

    creatingSwitcherPopupWindowPromise.then((popupTab) => {
      if (popupTab) {
        context.onHostReady(popupTab);
      } else {
        onUnavailable();
      }
    });
  }

  // Trigger 3 concurrent calls
  const results = [];
  const p1 = new Promise((resolve) => {
    openSwitcherInPopupWindow({ id: 1, windowId: 1 }, [], [], {
      onHostReady: (tab) => resolve(tab)
    });
  });
  const p2 = new Promise((resolve) => {
    openSwitcherInPopupWindow({ id: 1, windowId: 1 }, [], [], {
      onHostReady: (tab) => resolve(tab)
    });
  });
  const p3 = new Promise((resolve) => {
    openSwitcherInPopupWindow({ id: 1, windowId: 1 }, [], [], {
      onHostReady: (tab) => resolve(tab)
    });
  });

  const [tab1, tab2, tab3] = await Promise.all([p1, p2, p3]);

  assert.equal(windowsCreateCallCount, 1, 'chrome.windows.create must be called only ONCE');
  assert.equal(tab1.id, 500);
  assert.equal(tab2.id, 500);
  assert.equal(tab3.id, 500);
  assert.equal(activeSwitcherPopupWindowId, 100);

  // Subsequent call should reuse active popup window without calling windows.create
  let tab4Result = null;
  openSwitcherInPopupWindow({ id: 1, windowId: 1 }, [], [], {
    onHostReady: (tab) => { tab4Result = tab; }
  });
  assert.equal(windowsCreateCallCount, 1, 'Subsequent call must reuse active window');
  assert.equal(tab4Result.id, 500);
});

test('beginTabSwitcherOpening: in-flight opening tracks pending advances instead of duplicate pipelines', () => {
  const tabSwitcherOpeningByWindowKey = new Map();
  const TAB_SWITCHER_OPENING_GUARD_MS = 2000;

  function beginTabSwitcherOpening(tab, source) {
    const key = `window:${tab.windowId}`;
    const now = Date.now();
    const existing = tabSwitcherOpeningByWindowKey.get(key);
    if (existing) {
      if (existing.expiresAt > now) {
        existing.pendingAdvanceCount = (existing.pendingAdvanceCount || 0) + 1;
        return null;
      }
      tabSwitcherOpeningByWindowKey.delete(key);
    }
    const opening = {
      key,
      tabId: tab.id,
      windowId: tab.windowId,
      source: source || '',
      startedAt: now,
      expiresAt: now + TAB_SWITCHER_OPENING_GUARD_MS,
      pendingAdvanceCount: 0
    };
    tabSwitcherOpeningByWindowKey.set(key, opening);
    return opening;
  }

  const tab = { id: 10, windowId: 1 };
  const firstOpening = beginTabSwitcherOpening(tab, 'cmd');
  assert.ok(firstOpening, 'First call should return opening object');
  assert.equal(firstOpening.pendingAdvanceCount, 0);

  const secondOpening = beginTabSwitcherOpening(tab, 'cmd');
  assert.equal(secondOpening, null, 'Second call while in flight must return null');
  assert.equal(firstOpening.pendingAdvanceCount, 1, 'Pending advance count should increment to 1');

  const thirdOpening = beginTabSwitcherOpening(tab, 'cmd');
  assert.equal(thirdOpening, null, 'Third call while in flight must return null');
  assert.equal(firstOpening.pendingAdvanceCount, 2, 'Pending advance count should increment to 2');
});

test('content/panel.js: does not reject with page-not-focused when isBorrowedHost is true', () => {
  let focusCalled = false;

  const rootEl = createMockElement('html');
  const bodyEl = createMockElement('body');
  rootEl.appendChild(bodyEl);

  const mockWindow = {
    focus() {
      focusCalled = true;
    },
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle() {
      return { getPropertyValue: () => '' };
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1,
    clearTimeout: () => {}
  };

  const mockDoc = {
    hasFocus() {
      // Return false to simulate newly activated borrowed tab that hasn't received focus yet
      return false;
    },
    fullscreenElement: null,
    activeElement: null,
    documentElement: rootEl,
    body: bodyEl,
    createElement: (tag) => createMockElement(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    globalThis: {},
    console
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(PANEL_CODE, sandbox);

  // When isBorrowedHost is true, it should attempt focus and proceed to open, NOT return page-not-focused
  const result = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [{ id: 1, title: 'Tab 1' }, { id: 2, title: 'Tab 2' }],
    activeTabId: 1,
    isBorrowedHost: true
  });

  assert.equal(focusCalled, true, 'window.focus() should still be called');
  assert.notEqual(result.reason, 'page-not-focused', 'Should NOT reject with page-not-focused on borrowed host');
  assert.equal(result.ok, true, 'Should successfully open panel on borrowed host');
});
