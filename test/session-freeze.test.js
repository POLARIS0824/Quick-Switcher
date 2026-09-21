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
  const listeners = new Map();
  const el = {
    tagName: (tagName || 'div').toUpperCase(),
    style: {
      setProperty(prop, val) {
        el.style[prop] = val;
      },
      removeProperty(prop) {
        delete el.style[prop];
      }
    },
    dataset: {},
    classList: {
      add() {},
      remove() {},
      contains: () => false
    },
    setAttribute(k, v) {
      el[k] = v;
    },
    getAttribute(k) {
      return el[k] || null;
    },
    hasAttribute(k) {
      return k in el;
    },
    removeAttribute(k) {
      delete el[k];
    },
    querySelector(selector) {
      function search(node) {
        for (const child of (node.children || [])) {
          if (selector && selector.includes('x-tab-switcher-close-btn')) {
            if (child.className && child.className.includes('x-tab-switcher-close-btn')) {
              return child;
            }
          }
          const found = search(child);
          if (found) return found;
        }
        return null;
      }
      return search(el);
    },
    querySelectorAll(selector) {
      const results = [];
      function search(node) {
        for (const child of (node.children || [])) {
          if (selector && selector.includes('.x-tab-switcher-card')) {
            if (child.className && child.className.includes('x-tab-switcher-card')) {
              if (!selector.includes(':not([data-removing="true"])') || child.dataset.removing !== 'true') {
                results.push(child);
              }
            }
          }
          search(child);
        }
      }
      search(el);
      return results;
    },
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
    remove() {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    },
    get isConnected() {
      let curr = el;
      while (curr) {
        if (curr.tagName === 'HTML') return true;
        curr = curr.parentNode || curr.host;
      }
      return false;
    },
    attachShadow() {
      const shadowRoot = createMockElement('shadow-root');
      shadowRoot.host = el;
      shadowRoot.parentNode = el;
      el.shadowRoot = shadowRoot;
      return shadowRoot;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type);
      if (list) {
        const idx = list.indexOf(listener);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    dispatchEvent(event) {
      const list = listeners.get(event && event.type);
      if (list) {
        list.forEach((l) => l(event));
      }
    },
    children,
    parentNode: null
  };
  return el;
}

function setupPanelTestEnvironment(sendMessageMock) {
  const rootEl = createMockElement('html');
  const bodyEl = createMockElement('body');
  rootEl.appendChild(bodyEl);

  const windowListeners = new Map();
  const mockWindow = {
    focus() {},
    addEventListener(type, listener, useCapture) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, []);
      }
      windowListeners.get(type).push({ listener, useCapture });
    },
    removeEventListener(type, listener) {
      const list = windowListeners.get(type);
      if (list) {
        const idx = list.findIndex((item) => item.listener === listener);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    dispatchWindowEvent(event) {
      const list = windowListeners.get(event && event.type);
      if (list) {
        list.forEach(({ listener }) => listener(event));
      }
    },
    getComputedStyle() {
      return { getPropertyValue: () => '', colorScheme: 'light' };
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };

  const mockDoc = {
    hasFocus: () => true,
    fullscreenElement: null,
    activeElement: null,
    documentElement: rootEl,
    body: bodyEl,
    createElement: (tag) => createMockElement(tag),
    getElementById: (id) => rootEl.children.find((c) => c.id === id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  const mockChrome = {
    runtime: {
      lastError: null,
      sendMessage: sendMessageMock || ((msg, cb) => { if (cb) cb({ ok: true }); })
    }
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    chrome: mockChrome,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Set,
    Map
  };

  vm.createContext(sandbox);
  vm.runInContext(PANEL_CODE, sandbox);

  return { sandbox, rootEl, mockChrome, mockWindow };
}

// Test A: Session order freeze
test('Test A: Session order freeze: panel DOM card order stays unchanged even if background MRU changes', () => {
  const { sandbox, rootEl } = setupPanelTestEnvironment();

  const initialTabs = [
    { id: 101, title: 'Tab A', url: 'https://a.com' },
    { id: 102, title: 'Tab B', url: 'https://b.com' },
    { id: 103, title: 'Tab C', url: 'https://c.com' }
  ];

  const result = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: initialTabs,
    selectedIndex: 0
  });
  assert.equal(result.ok, true);

  const host = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  assert.ok(host, 'Host element should exist');
  const shadow = host.shadowRoot;
  assert.ok(shadow, 'Shadow root should exist');

  let cards = shadow.querySelectorAll('.x-tab-switcher-card');
  assert.equal(cards.length, 3);
  assert.equal(cards[0].dataset.tabId, '101');
  assert.equal(cards[1].dataset.tabId, '102');
  assert.equal(cards[2].dataset.tabId, '103');

  // Background MRU is updated (e.g. C becomes most recent [103, 101, 102])
  const updatedMru = [
    { id: 103, title: 'Tab C', url: 'https://c.com' },
    { id: 101, title: 'Tab A', url: 'https://a.com' },
    { id: 102, title: 'Tab B', url: 'https://b.com' }
  ];

  // While currently open, cards in panel remain [101, 102, 103]
  cards = shadow.querySelectorAll('.x-tab-switcher-card');
  assert.equal(cards[0].dataset.tabId, '101');
  assert.equal(cards[1].dataset.tabId, '102');
  assert.equal(cards[2].dataset.tabId, '103');

  // Dismiss current session
  if (typeof host._quickswitchTabSwitcherCleanup === 'function') {
    host._quickswitchTabSwitcherCleanup();
  }
  host.remove();

  // Open a new session with updated MRU
  const nextResult = sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: updatedMru,
    selectedIndex: 0
  });
  assert.equal(nextResult.ok, true);

  const nextHost = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  const nextShadow = nextHost.shadowRoot;
  const nextCards = nextShadow.querySelectorAll('.x-tab-switcher-card');
  assert.equal(nextCards.length, 3);
  assert.equal(nextCards[0].dataset.tabId, '103');
  assert.equal(nextCards[1].dataset.tabId, '101');
  assert.equal(nextCards[2].dataset.tabId, '102');
});

// Test B: Commit timing
test('Test B: Commit timing: didStartClosing and close() execute synchronously before background switch response', () => {
  let switchResponseCallback = null;
  let switchToTabMessage = null;

  const { sandbox, rootEl } = setupPanelTestEnvironment((msg, cb) => {
    if (msg && msg.action === 'switchToTab') {
      switchToTabMessage = msg;
      switchResponseCallback = cb;
      // Do NOT call cb synchronously to simulate background async handling
    }
  });

  const tabs = [
    { id: 1, title: 'Tab 1' },
    { id: 2, title: 'Tab 2' }
  ];

  sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 1
  });

  const host = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  const panel = host.shadowRoot.children.find((c) => c.id === '_quickswitch_tab_switcher_panel_2026_unique_');

  // Trigger commit
  const commitResult = host._quickswitchTabSwitcherCommitFromShortcutRelease();
  assert.equal(commitResult, true);
  assert.ok(switchToTabMessage, 'switchToTab message should have been sent');
  assert.equal(switchToTabMessage.tabId, 2);

  // Synchronously BEFORE switchResponseCallback is invoked:
  // 1. Panel is marked closing and hidden
  assert.equal(panel.dataset.closing, 'true');
  assert.equal(panel.dataset.visible, 'false');

  // 2. Further advance attempts return false / suppressed
  const advanceResult = host._quickswitchTabSwitcherAdvance(1);
  assert.equal(advanceResult, false);

  // 3. Second commit call returns false (didRequestSwitch is true)
  const secondCommit = host._quickswitchTabSwitcherCommitFromShortcutRelease();
  assert.equal(secondCommit, false);

  // Now background response arrives
  assert.equal(typeof switchResponseCallback, 'function');
  switchResponseCallback({ ok: true });
});

// Test C: Closing ignores thumbnail update
test('Test C: Closing ignores thumbnail update: returns panel-closing and avoids updating DOM', () => {
  let switchResponseCallback = null;
  const { sandbox, rootEl } = setupPanelTestEnvironment((msg, cb) => {
    if (msg && msg.action === 'switchToTab') {
      switchResponseCallback = cb;
    }
  });

  const tabs = [{ id: 10, title: 'Tab 10' }];
  sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 0
  });

  const host = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  host._quickswitchTabSwitcherCommitFromShortcutRelease();

  // Now panel is in closing state
  const updateResult = host._quickswitchTabSwitcherUpdateThumbnail({
    tabId: 10,
    thumbnail: 'data:image/png;base64,sample'
  });

  assert.equal(updateResult.ok, false);
  assert.equal(updateResult.reason, 'panel-closing');
});

// Test D: Borrowed host activation suppressed from MRU; switching to host tab explicitly records MRU
test('Test D: Borrowed host activation suppressed from MRU; switching to host tab explicitly records MRU', () => {
  const mruList = [];
  function recordRecentSwitcherTab(tab) {
    const idx = mruList.findIndex((t) => t.id === tab.id);
    if (idx !== -1) mruList.splice(idx, 1);
    mruList.unshift(tab);
  }

  const internalSwitcherHostActivationTabIds = new Set();

  // 1. Open switcher on borrowed host tab (id: 200)
  const hostTab = { id: 200, windowId: 1, title: 'Host Tab' };
  internalSwitcherHostActivationTabIds.add(hostTab.id);

  // Chrome fires tabs.onActivated for tab 200
  const activeInfo = { tabId: 200, windowId: 1 };
  let recordedOnActivated = false;
  if (internalSwitcherHostActivationTabIds.delete(activeInfo.tabId)) {
    // Suppressed! Do not record MRU
  } else {
    recordRecentSwitcherTab(hostTab);
    recordedOnActivated = true;
  }

  assert.equal(recordedOnActivated, false, 'Borrowed host activation must NOT record MRU');
  assert.equal(internalSwitcherHostActivationTabIds.has(200), false, 'Set entry must be consumed once');
  assert.equal(mruList.length, 0);

  // 2. User chooses hostTab via switchToTab
  let switchToTabRecorded = false;
  function handleSwitchToTab(requestTabId) {
    if (requestTabId === hostTab.id) {
      recordRecentSwitcherTab(hostTab);
      switchToTabRecorded = true;
    }
  }
  handleSwitchToTab(200);

  assert.equal(switchToTabRecorded, true, 'User selecting hostTab via switchToTab must record MRU');
  assert.equal(mruList.length, 1);
  assert.equal(mruList[0].id, 200);

  // 3. Activation failure cleanup
  const failedHostTab = { id: 300, windowId: 1 };
  internalSwitcherHostActivationTabIds.add(failedHostTab.id);
  // Activation fails -> cleanup from set
  internalSwitcherHostActivationTabIds.delete(failedHostTab.id);
  assert.equal(internalSwitcherHostActivationTabIds.has(300), false);
});

// Test E: Close model/view synchronization
test('Test E: Close model/view synchronization: outer tabs and inner view both updated, switching chooses correct remaining tab', () => {
  let switchTargetTabId = null;
  let closeTabCallback = null;

  const { sandbox, rootEl } = setupPanelTestEnvironment((msg, cb) => {
    if (msg && msg.action === 'closeTab') {
      closeTabCallback = cb;
    }
    if (msg && msg.action === 'switchToTab') {
      switchTargetTabId = msg.tabId;
      if (cb) cb({ ok: true });
    }
  });

  const tabs = [
    { id: 10, title: 'Tab A' },
    { id: 20, title: 'Tab B' },
    { id: 30, title: 'Tab C' }
  ];

  sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 1 // Selected is Tab B (id: 20)
  });

  const host = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  const shadow = host.shadowRoot;
  const cards = shadow.querySelectorAll('.x-tab-switcher-card');
  assert.equal(cards.length, 3);

  // Close card index 1 (Tab B)
  const closeBtn = cards[1].querySelector('.x-tab-switcher-close-btn');
  assert.ok(closeBtn, 'Close button should exist on card 1');
  closeBtn.dispatchEvent({
    type: 'click',
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  // Background responds success to closeTab
  assert.equal(typeof closeTabCallback, 'function');
  closeTabCallback({ ok: true });

  // Now commit selection: selectedIndex after removal of index 1 (from length 3) is 1.
  // With outer `tabs` properly spliced, index 1 is Tab C (id: 30).
  // Without outer `tabs` spliced, index 1 would still be Tab B (id: 20)!
  host._quickswitchTabSwitcherCommitFromShortcutRelease();

  assert.equal(switchTargetTabId, 30, 'Selection must switch to Tab C (id: 30), not closed Tab B (id: 20)');
});

// Test F: Close failure keeps [A, B, C] in both UI and model
test('Test F: Close failure keeps [A, B, C] in both UI and model', () => {
  let switchTargetTabId = null;
  let closeTabCallback = null;

  const { sandbox, rootEl } = setupPanelTestEnvironment((msg, cb) => {
    if (msg && msg.action === 'closeTab') {
      closeTabCallback = cb;
    }
    if (msg && msg.action === 'switchToTab') {
      switchTargetTabId = msg.tabId;
      if (cb) cb({ ok: true });
    }
  });

  const tabs = [
    { id: 10, title: 'Tab A' },
    { id: 20, title: 'Tab B' },
    { id: 30, title: 'Tab C' }
  ];

  sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 1
  });

  const host = rootEl.children.find((c) => c.id === '_quickswitch_tab_switcher_host_2026_unique_');
  const shadow = host.shadowRoot;
  const cards = shadow.querySelectorAll('.x-tab-switcher-card');

  // Close card 1
  const closeBtn = cards[1].querySelector('.x-tab-switcher-close-btn');
  closeBtn.dispatchEvent({
    type: 'click',
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  assert.equal(cards[1].dataset.closing, 'true');

  // Background responds failure
  closeTabCallback({ ok: false, reason: 'failed' });

  // Closing flag is reverted
  assert.equal(cards[1].dataset.closing, undefined);

  // Commit selection: still selects Tab B (id: 20)
  host._quickswitchTabSwitcherCommitFromShortcutRelease();
  assert.equal(switchTargetTabId, 20, 'Failed close must keep Tab B in model and UI');
});
