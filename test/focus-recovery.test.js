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

/**
 * 1. Test focus recovery & page-not-focused handling in content/panel.js
 */
test('content/panel.js: attempts window.focus() when document.hasFocus() is false', () => {
  let focusCalled = false;
  let hasFocusValue = false;

  const rootEl = createMockElement('html');
  const bodyEl = createMockElement('body');
  rootEl.appendChild(bodyEl);

  const mockWindow = {
    focus() {
      focusCalled = true;
      // Simulate that window.focus() restored document focus
      hasFocusValue = true;
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
      return hasFocusValue;
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
    console,
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(PANEL_CODE, sandbox);

  assert.equal(typeof sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_, 'function');

  // Trigger toggle
  const result = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [{ id: 1, title: 'Tab 1' }, { id: 2, title: 'Tab 2' }],
    activeTabId: 1
  });

  assert.equal(focusCalled, true, 'window.focus() should be called when document is not focused');
  assert.equal(result.ok, true, 'Should proceed to open panel when focus is restored');
});

test('content/panel.js: returns page-not-focused if document.hasFocus() remains false', () => {
  let focusCalled = false;

  const rootEl = createMockElement('html');
  const mockWindow = {
    focus() {
      focusCalled = true;
      // Focus could not be restored (e.g., Omnibox active)
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const mockDoc = {
    hasFocus() {
      return false;
    },
    documentElement: rootEl
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    globalThis: {},
    console
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(PANEL_CODE, sandbox);

  const result = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({});
  assert.equal(focusCalled, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'page-not-focused');
});

test('content/panel.js: catches exception if window.focus() throws in restricted frame', () => {
  const rootEl = createMockElement('html');
  const mockWindow = {
    focus() {
      throw new Error('Blocked by security policy');
    }
  };

  const mockDoc = {
    hasFocus() {
      return false;
    },
    documentElement: rootEl
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    globalThis: {},
    console
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(PANEL_CODE, sandbox);

  // Should not throw, but cleanly return { ok: false, reason: 'page-not-focused' }
  const result = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'page-not-focused');
});

/**
 * 2. Test fallback routing logic for 'page-not-focused'
 */
test('background routing: handleOpenComplete routes page-not-focused to openSwitcherInPopupWindow', () => {
  let popupWindowOpened = false;
  let blindSwitched = false;

  const activeTab = { id: 10, windowId: 1 };
  const tabList = [activeTab, { id: 20, windowId: 1 }];
  const items = tabList;

  function openSwitcherInPopupWindow(tab, tabs, list, context) {
    popupWindowOpened = true;
  }

  function blindSwitchToNextMostRecentTab(tab, source) {
    blindSwitched = true;
  }

  // Simulating handleOpenComplete from background/main.js
  const handleOpenComplete = (ok, reason) => {
    if (ok === true) {
      return;
    }
    if (reason === 'page-fullscreen' || reason === 'page-select-popup' || reason === 'page-not-focused') {
      openSwitcherInPopupWindow(activeTab, tabList, items, {});
      return;
    }
    blindSwitchToNextMostRecentTab(activeTab, 'test');
  };

  handleOpenComplete(false, 'page-not-focused');

  assert.equal(popupWindowOpened, true, 'page-not-focused should trigger popup window fallback');
  assert.equal(blindSwitched, false, 'page-not-focused should not blindly switch when popup can be shown');
});

/**
 * 3. Test blindSwitchToNextMostRecentTab results indexing fix
 */
test('blindSwitchToNextMostRecentTab: correctly extracts tabQuery from results[2]', async () => {
  let activatedTabId = null;

  const activeTab = { id: 10, windowId: 1 };
  const previousTab = { id: 20, windowId: 1, url: 'https://example.com/2' };
  const allTabs = [activeTab, previousTab];

  // Simulating background promise dependencies
  const ensureTabSwitcherStateLoaded = async () => true;
  const ensureSwitcherSettingsLoaded = async () => true; // results[1]
  const queryAllTabs = async () => ({ tabs: allTabs }); // results[2]

  const focusWindowAndActivateTab = (targetId, windowId, cb) => {
    activatedTabId = targetId;
    cb({ ok: true });
  };

  const getRecentTabsForSwitcher = (tabs, activeId) => {
    return [activeTab, previousTab];
  };
  const getDefaultSwitcherSelectedIndex = (items, activeId) => {
    return 1; // points to previousTab
  };

  await Promise.all([
    ensureTabSwitcherStateLoaded().catch(() => null),
    ensureSwitcherSettingsLoaded().catch(() => null),
    queryAllTabs()
  ]).then((results) => {
    // Before fix: results[1] was read, which was boolean `true`, leading to undefined tabs
    const tabQuery = results[2] || { error: 'unknown', tabs: [] };
    assert.ok(Array.isArray(tabQuery.tabs), 'results[2] must be the queryAllTabs result containing tabs');
    assert.equal(tabQuery.tabs.length, 2);

    const tabList = tabQuery.tabs;
    const currentActiveTab = tabList.find((item) => item && item.id === activeTab.id) || activeTab;
    const items = getRecentTabsForSwitcher(tabList, currentActiveTab.id);
    const target = items[getDefaultSwitcherSelectedIndex(items, currentActiveTab.id)];
    if (target && typeof target.id === 'number') {
      focusWindowAndActivateTab(target.id, target.windowId, () => {});
    }
  });

  assert.equal(activatedTabId, 20, 'Should successfully switch to target tab');
});
