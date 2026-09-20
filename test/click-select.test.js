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
    querySelector: () => null,
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

function setupTestEnvironment() {
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
    setTimeout: () => 1,
    clearTimeout: () => {}
  };

  let documentHasFocus = true;
  let sentMessages = [];

  const mockDoc = {
    hasFocus() {
      return documentHasFocus;
    },
    setHasFocus(val) {
      documentHasFocus = val;
    },
    fullscreenElement: null,
    activeElement: inputEl,
    documentElement: rootEl,
    body: bodyEl,
    createElement: (tag) => createMockElement(tag),
    getElementById: (id) => {
      return rootEl.children.find((c) => c.id === id) || null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  const mockChrome = {
    runtime: {
      sendMessage(msg, cb) {
        sentMessages.push(msg);
        if (cb) cb({ ok: true });
      }
    }
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    chrome: mockChrome,
    globalThis: {},
    console,
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(PANEL_CODE, sandbox);

  return { rootEl, bodyEl, inputEl, mockWindow, mockDoc, mockChrome, sentMessages, sandbox };
}

test('BUG REPRODUCTION: element blur inside page must NOT close tab switcher panel', () => {
  const env = setupTestEnvironment();
  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';

  const result = env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [
      { id: 101, title: 'Tab 101', url: 'https://example.com/1' },
      { id: 102, title: 'Tab 102', url: 'https://example.com/2' }
    ],
    selectedIndex: 0
  });
  assert.equal(result.ok, true, 'Panel should open successfully');

  let host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host, 'Host element should be attached to documentElement');

  // Simulate element blur inside page (mousedown on card causes activeElement to blur)
  env.mockWindow.dispatchWindowEvent({
    type: 'blur',
    target: env.inputEl
  });

  host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host, 'Host element must NOT be removed when an input element inside the page blurs');
});

test('window blur: panel closes when the browser window genuinely loses focus', () => {
  const env = setupTestEnvironment();
  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';

  const result = env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [
      { id: 101, title: 'Tab 101', url: 'https://example.com/1' },
      { id: 102, title: 'Tab 102', url: 'https://example.com/2' }
    ],
    selectedIndex: 0
  });
  assert.equal(result.ok, true);

  let host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host);

  // Genuinely blur the window (e.g. Alt-Tab or clicking omnibox)
  env.mockDoc.setHasFocus(false);
  env.mockWindow.dispatchWindowEvent({
    type: 'blur',
    target: env.mockWindow
  });

  host = env.rootEl.children.find((c) => c.id === hostId);
  assert.equal(host, undefined, 'Host element SHOULD be removed when the window genuinely blurs');
});

test('showCloseButton: renders close button when true and triggers closeTab on click', () => {
  const env = setupTestEnvironment();
  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';

  const result = env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [
      { id: 101, title: 'Tab 101', url: 'https://example.com/1' },
      { id: 102, title: 'Tab 102', url: 'https://example.com/2' }
    ],
    selectedIndex: 0,
    showCloseButton: true
  });
  assert.equal(result.ok, true);

  const host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host);
  assert.ok(host.shadowRoot);

  // Find close button inside shadowRoot
  function findElementByClass(root, className) {
    if (root.className && String(root.className).includes(className)) {
      return root;
    }
    for (const child of (root.children || [])) {
      const found = findElementByClass(child, className);
      if (found) return found;
    }
    return null;
  }

  const closeBtn = findElementByClass(host.shadowRoot, 'x-tab-switcher-close-btn');
  assert.ok(closeBtn, 'Close button should be rendered on card');

  // Trigger trusted click on close button
  closeBtn.dispatchEvent({
    type: 'click',
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  const closeMsg = env.sentMessages.find((m) => m && m.action === 'closeTab');
  assert.ok(closeMsg, 'closeTab action should be sent to chrome.runtime');
  assert.equal(closeMsg.tabId, 101);
});

test('showCloseButton: does not render close button when showCloseButton is false', () => {
  const env = setupTestEnvironment();
  const hostId = '_quickswitch_tab_switcher_host_2026_unique_';

  const result = env.sandbox.window._quickswitch_toggleTabSwitcher_2026_unique_({
    tabs: [
      { id: 101, title: 'Tab 101', url: 'https://example.com/1' }
    ],
    selectedIndex: 0,
    showCloseButton: false
  });
  assert.equal(result.ok, true);

  const host = env.rootEl.children.find((c) => c.id === hostId);
  assert.ok(host && host.shadowRoot);

  function findElementByClass(root, className) {
    if (root.className && String(root.className).includes(className)) {
      return root;
    }
    for (const child of (root.children || [])) {
      const found = findElementByClass(child, className);
      if (found) return found;
    }
    return null;
  }

  const closeBtn = findElementByClass(host.shadowRoot, 'x-tab-switcher-close-btn');
  assert.equal(closeBtn, null, 'Close button should NOT be rendered when showCloseButton is false');
});

