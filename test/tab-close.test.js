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
    attachShadow() {
      const shadowRoot = createMockElement('shadow-root');
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
  const inputEl = createMockElement('input');
  bodyEl.appendChild(inputEl);
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
    activeElement: inputEl,
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
      sendMessage: sendMessageMock
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

  return { sandbox, rootEl, mockChrome };
}

test('background closeTab handler: succeeds and returns ok: true', () => {
  let removedTabId = null;
  const mockChrome = {
    runtime: { lastError: null },
    tabs: {
      remove(tabId, callback) {
        removedTabId = tabId;
        callback();
      }
    }
  };

  // Simulate background message handler for closeTab
  function handleCloseTab(request, sendResponse) {
    if (typeof request.tabId !== 'number') {
      sendResponse({ ok: false, reason: 'invalid-tab' });
      return;
    }
    mockChrome.tabs.remove(request.tabId, () => {
      if (mockChrome.runtime && mockChrome.runtime.lastError) {
        sendResponse({
          ok: false,
          reason: mockChrome.runtime.lastError.message || 'tabs-remove-failed'
        });
        return;
      }
      sendResponse({ ok: true });
    });
  }

  let responseData = null;
  handleCloseTab({ action: 'closeTab', tabId: 101 }, (res) => {
    responseData = res;
  });

  assert.equal(removedTabId, 101);
  assert.deepEqual(responseData, { ok: true });
});

test('background closeTab handler: propagates tabs.remove lastError as ok: false', () => {
  const mockChrome = {
    runtime: { lastError: { message: 'Tabs cannot be edited right now' } },
    tabs: {
      remove(tabId, callback) {
        callback();
      }
    }
  };

  function handleCloseTab(request, sendResponse) {
    if (typeof request.tabId !== 'number') {
      sendResponse({ ok: false, reason: 'invalid-tab' });
      return;
    }
    mockChrome.tabs.remove(request.tabId, () => {
      if (mockChrome.runtime && mockChrome.runtime.lastError) {
        sendResponse({
          ok: false,
          reason: mockChrome.runtime.lastError.message || 'tabs-remove-failed'
        });
        return;
      }
      sendResponse({ ok: true });
    });
  }

  let responseData = null;
  handleCloseTab({ action: 'closeTab', tabId: 101 }, (res) => {
    responseData = res;
  });

  assert.deepEqual(responseData, {
    ok: false,
    reason: 'Tabs cannot be edited right now'
  });
});

test('panel closeTabAtIndex: successful removal removes card and updates selectedIndex', () => {
  let sentMessage = null;
  const env = setupPanelTestEnvironment((msg, cb) => {
    sentMessage = msg;
    if (cb) cb({ ok: true });
  });

  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';
  const tabs = [
    { id: 101, title: 'Tab 101', url: 'https://example.com/1' },
    { id: 102, title: 'Tab 102', url: 'https://example.com/2' },
    { id: 103, title: 'Tab 103', url: 'https://example.com/3' }
  ];

  env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 1, // Tab 102 selected
    showCloseButton: true
  });

  const host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host && host.shadowRoot);

  // Find close buttons
  const cards = host.shadowRoot.querySelectorAll('.x-tab-switcher-card');
  assert.equal(cards.length, 3);

  // Click close on tab 102 (the selected tab at index 1)
  const closeBtn102 = cards[1].querySelector('.x-tab-switcher-close-btn');
  assert.ok(closeBtn102);

  closeBtn102.dispatchEvent({
    type: 'click',
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  assert.equal(sentMessage.action, 'closeTab');
  assert.equal(sentMessage.tabId, 102);

  // After successful close, card 102 should be marked removing
  assert.equal(cards[1].dataset.removing, 'true');
  // Remaining active cards count is now 2
  const remainingCards = host.shadowRoot.querySelectorAll('.x-tab-switcher-card:not([data-removing="true"])');
  assert.equal(remainingCards.length, 2);
});

test('panel closeTabAtIndex: failed removal keeps card in UI and clears closing state', () => {
  let sentMessage = null;
  const env = setupPanelTestEnvironment((msg, cb) => {
    sentMessage = msg;
    // Simulate background failure response
    if (cb) cb({ ok: false, reason: 'Tab cannot be closed' });
  });

  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';
  const tabs = [
    { id: 101, title: 'Tab 101', url: 'https://example.com/1' },
    { id: 102, title: 'Tab 102', url: 'https://example.com/2' }
  ];

  env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs,
    selectedIndex: 0,
    showCloseButton: true
  });

  const host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host && host.shadowRoot);

  const cards = host.shadowRoot.querySelectorAll('.x-tab-switcher-card');
  assert.equal(cards.length, 2);

  // Click close on tab 101
  const closeBtn = cards[0].querySelector('.x-tab-switcher-close-btn');
  closeBtn.dispatchEvent({
    type: 'click',
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  assert.equal(sentMessage.action, 'closeTab');
  assert.equal(sentMessage.tabId, 101);

  // Failure must NOT remove card
  assert.notEqual(cards[0].dataset.removing, 'true');
  assert.equal(cards[0].dataset.closing, undefined, 'Closing state must be cleared on failure');
  const remainingCards = host.shadowRoot.querySelectorAll('.x-tab-switcher-card:not([data-removing="true"])');
  assert.equal(remainingCards.length, 2, 'All cards must remain in UI on failure');
});
