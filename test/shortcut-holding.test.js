'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEY_OBSERVER_CODE = fs.readFileSync(
  path.join(__dirname, '../content/key-observer.js'),
  'utf8'
);
const PAGE_BRIDGE_CODE = fs.readFileSync(
  path.join(__dirname, '../pages/page-bridge.js'),
  'utf8'
);
const SWITCHER_HOST_CODE = fs.readFileSync(
  path.join(__dirname, '../pages/switcher-host.js'),
  'utf8'
);

/**
 * Creates a sandbox environment simulating the Content Script context
 * for content/key-observer.js.
 */
function createKeyObserverSandbox(initialTime = 10000) {
  let currentTime = initialTime;
  const eventListeners = new Map();
  const sentMessages = [];
  let runtimeMessageListener = null;

  const mockWindow = {
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = eventListeners.get(type) || [];
      const idx = list.indexOf(listener);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    }
  };

  const mockChrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        },
        removeListener(listener) {
          if (runtimeMessageListener === listener) {
            runtimeMessageListener = null;
          }
        }
      },
      sendMessage(message, callback) {
        sentMessages.push({ message, at: currentTime });
        if (typeof callback === 'function') {
          callback({ ok: true });
        }
      }
    }
  };

  const context = vm.createContext({
    window: mockWindow,
    chrome: mockChrome,
    Date: {
      now: () => currentTime
    },
    Array,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Object,
    console
  });

  vm.runInContext(KEY_OBSERVER_CODE, context);

  return {
    setTime(t) {
      currentTime = t;
    },
    advanceTime(ms) {
      currentTime += ms;
    },
    dispatchKeydown(event) {
      const list = eventListeners.get('keydown') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true, repeat: false }, event)));
    },
    dispatchKeyup(event) {
      const list = eventListeners.get('keyup') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true }, event)));
    },
    receiveRuntimeMessage(request) {
      let responseResult = null;
      if (runtimeMessageListener) {
        runtimeMessageListener(request, {}, (resp) => {
          responseResult = resp;
        });
      }
      return responseResult;
    },
    getSentMessages() {
      return sentMessages;
    }
  };
}

/**
 * Creates a sandbox environment simulating the popup host context
 * for pages/switcher-host.js.
 */
function createSwitcherHostSandbox(initialTime = 10000) {
  let currentTime = initialTime;
  const eventListeners = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  let intervalSeq = 0;
  let timeoutSeq = 0;
  let commitCallCount = 0;
  const commitReasons = [];
  let panelHostExists = true;
  let windowClosed = false;

  const mockPanelHost = {
    _quickswitchTabSwitcherCommitFromShortcutRelease() {
      commitCallCount += 1;
      return true;
    }
  };

  const mockDocument = {
    getElementById(id) {
      if (id === '_quickswitch_tab_switcher_host_2026_unique_' && panelHostExists) {
        return mockPanelHost;
      }
      return null;
    },
    hasFocus() {
      return true;
    }
  };

  const mockWindow = {
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const list = eventListeners.get(type) || [];
      const idx = list.indexOf(listener);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    },
    setInterval(fn, delay) {
      const id = ++intervalSeq;
      intervals.set(id, { fn, delay, nextRun: currentTime + delay });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(fn, delay) {
      const id = ++timeoutSeq;
      timeouts.set(id, { fn, delay, runAt: currentTime + delay });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    close() {
      windowClosed = true;
    }
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    Date: {
      now: () => currentTime
    },
    console: {
      info(tag, reason, data) {
        if (tag === 'QuickSwitcher host:' && reason) {
          commitReasons.push({ reason, data, at: currentTime });
        }
      },
      warn: () => {},
      error: () => {},
      log: () => {}
    },
    Array,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Object
  });

  vm.runInContext(SWITCHER_HOST_CODE, context);

  return {
    setTime(t) {
      currentTime = t;
    },
    advanceTime(ms) {
      currentTime += ms;
      intervals.forEach((record) => {
        if (currentTime >= record.nextRun) {
          record.nextRun = currentTime + record.delay;
          record.fn();
        }
      });
      timeouts.forEach((record, id) => {
        if (currentTime >= record.runAt) {
          timeouts.delete(id);
          record.fn();
        }
      });
    },
    dispatchKeydown(event) {
      const list = eventListeners.get('keydown') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true }, event)));
    },
    dispatchKeyup(event) {
      const list = eventListeners.get('keyup') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true }, event)));
    },
    getCommitCallCount() {
      return commitCallCount;
    },
    getCommitReasons() {
      return commitReasons;
    },
    isWindowClosed() {
      return windowClosed;
    }
  };
}

/**
 * Creates a sandbox environment simulating pages/page-bridge.js.
 */
function createPageBridgeSandbox(initialTime = 10000) {
  let currentTime = initialTime;
  const eventListeners = new Map();
  const sentMessages = [];
  let runtimeMessageListener = null;

  const mockWindow = {
    location: { href: 'chrome-extension://mock-id/pages/switcher-host.html' },
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push(listener);
    },
    removeEventListener() {},
    setTimeout(fn) { return 1; },
    clearTimeout() {}
  };

  const mockChrome = {
    runtime: {
      id: 'mock-id',
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        }
      },
      connect: () => ({
        postMessage: () => {},
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} }
      }),
      sendMessage(message, callback) {
        sentMessages.push({ message, at: currentTime });
        if (typeof callback === 'function') {
          callback({ ok: true });
        }
      }
    },
    tabs: {
      getCurrent(cb) { cb({ id: 999 }); }
    }
  };

  const context = vm.createContext({
    window: mockWindow,
    chrome: mockChrome,
    document: {
      getElementById: () => null,
      title: 'QuickSwitcher'
    },
    Date: {
      now: () => currentTime
    },
    Array,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Object,
    console
  });

  vm.runInContext(PAGE_BRIDGE_CODE, context);

  return {
    setTime(t) {
      currentTime = t;
    },
    advanceTime(ms) {
      currentTime += ms;
    },
    dispatchKeydown(event) {
      const list = eventListeners.get('keydown') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true, repeat: false }, event)));
    },
    dispatchKeyup(event) {
      const list = eventListeners.get('keyup') || [];
      list.forEach((fn) => fn(Object.assign({ isTrusted: true }, event)));
    },
    receiveRuntimeMessage(request) {
      let responseResult = null;
      if (runtimeMessageListener) {
        responseResult = runtimeMessageListener(request, {}, () => {});
      }
      return responseResult;
    },
    getSentMessages() {
      return sentMessages;
    }
  };
}

// ============================================================================
// TEST SUITE 1: content/key-observer.js - 历史按键释放回放漏洞 (Replay Window Bug)
// ============================================================================

test('[Bug Reproduction 1.1] content/key-observer.js: holding Alt+Q must NOT commit switch using Alt release from 2000ms ago', () => {
  const sandbox = createKeyObserverSandbox(10000);

  // Step 1: User released Alt 2000ms ago (e.g. from previous tab switch or Alt+Tab)
  sandbox.dispatchKeydown({ key: 'Alt', code: 'AltLeft' });
  sandbox.advanceTime(100);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  // Step 2: 2000ms later, user presses Alt+Q and HOLDS IT (key is NOT released!)
  sandbox.advanceTime(2000);
  const commandStartedAt = 12100;
  sandbox.setTime(commandStartedAt);

  // Background receives onCommand and arms the key observer on the tab
  sandbox.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  const releaseMessages = sandbox.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  // ASSERTION: Since user is STILL holding Alt+Q and has NOT released Alt since commandStartedAt,
  // NO release notification should be sent to background!
  assert.equal(
    releaseMessages.length,
    0,
    `\n❌ [BUG REPRODUCED in key-observer.js]` +
    `\n  Reason: An Alt release from 2000ms ago (before commandStartedAt = ${commandStartedAt})` +
    `\n  was erroneously matched because (startedAt - observedAt) <= 5000ms is allowed!` +
    `\n  Result: The tab switcher commits and switches the tab immediately even though Alt is held down!` +
    `\n  Sent message: ${JSON.stringify(releaseMessages[0])}\n`
  );
});

test('[Bug Reproduction 1.2] content/key-observer.js: background broadcast to other open tabs must NOT trigger switch from stale release', () => {
  // Simulates an inactive tab that observed an Alt keyup 3 seconds ago
  const sandboxOtherTab = createKeyObserverSandbox(5000);
  sandboxOtherTab.dispatchKeydown({ key: 'Alt', code: 'AltLeft' });
  sandboxOtherTab.advanceTime(50);
  sandboxOtherTab.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  // 3 seconds later, user presses Alt+Q in the ACTIVE tab at T = 8000
  sandboxOtherTab.advanceTime(3000);
  const commandStartedAt = 8050;
  sandboxOtherTab.setTime(commandStartedAt);

  // Background broadcasts armTabSwitcherShortcutRelease to ALL tabs in window
  sandboxOtherTab.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  const releaseMessages = sandboxOtherTab.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  assert.equal(
    releaseMessages.length,
    0,
    `\n❌ [BUG REPRODUCED in key-observer.js (Multi-Tab Broadcast)]` +
    `\n  Reason: An inactive tab answered the broadcast using its own 3s-old Alt release!` +
    `\n  Result: The background commits the active switcher due to an unrelated tab's stale event.` +
    `\n  Sent message: ${JSON.stringify(releaseMessages[0])}\n`
  );
});

test('[Bug Reproduction 1.3] content/key-observer.js: release occurred 400ms before commandStartedAt must NOT be accepted while holding', () => {
  const sandbox = createKeyObserverSandbox(10000);

  // Alt release happened 400ms before shortcut triggered
  sandbox.dispatchKeydown({ key: 'Alt', code: 'AltLeft' });
  sandbox.advanceTime(100);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  sandbox.advanceTime(400);
  const commandStartedAt = 10500;
  sandbox.setTime(commandStartedAt);

  sandbox.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  const releaseMessages = sandbox.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  assert.equal(
    releaseMessages.length,
    0,
    `\n❌ [BUG REPRODUCED in key-observer.js]` +
    `\n  Reason: Alt release 400ms prior to command was treated as current release.` +
    `\n  Sent message: ${JSON.stringify(releaseMessages[0])}\n`
  );
});

// ============================================================================
// TEST SUITE 2: pages/switcher-host.js - 独立弹窗500ms强制超时提交漏洞 (Popup Host Bug)
// ============================================================================

test('[Bug Reproduction 2.1] pages/switcher-host.js: popup window must NOT force-commit after 500ms when user holds Alt+Q', () => {
  const sandbox = createSwitcherHostSandbox(10000);

  // User opened Alt+Q on a restricted page (e.g. chrome://newtab).
  // The popup window opens and takes focus.
  // In Windows: Alt does not auto-repeat, so NO keydown events arrive in the popup window.
  // The user is STILL holding Alt+Q.
  // Advance time by 600ms (exceeding LOST_RELEASE_COMMIT_MS = 500ms)
  sandbox.advanceTime(600);

  // ASSERTION: Since user has NEVER released the key (no keyup event was dispatched),
  // the popup host must NOT prematurely commit the switch!
  const commitCount = sandbox.getCommitCallCount();
  const commitReasons = sandbox.getCommitReasons();

  assert.equal(
    commitCount,
    0,
    `\n❌ [BUG REPRODUCED in switcher-host.js]` +
    `\n  Reason: After 500ms without receiving keydown (which is normal in Windows because Alt doesn't auto-repeat),` +
    `\n  switcher-host.js assumed a "lost release" and forcefully committed the tab switch!` +
    `\n  Logged reasons: ${JSON.stringify(commitReasons)}` +
    `\n  Result: User holds Alt+Q for >500ms to preview tabs, but the tab switches automatically!\n`
  );
});

test('[Bug Reproduction 2.2] pages/switcher-host.js: popup window must NOT force-commit after 1000ms while holding Alt+Q', () => {
  const sandbox = createSwitcherHostSandbox(10000);

  // Advance time by 1000ms with no key events
  sandbox.advanceTime(1000);

  assert.equal(
    sandbox.getCommitCallCount(),
    0,
    `\n❌ [BUG REPRODUCED in switcher-host.js]` +
    `\n  Reason: Holding Alt+Q for 1 second triggered premature switch commit.` +
    `\n  Logged reasons: ${JSON.stringify(sandbox.getCommitReasons())}\n`
  );
});

// ============================================================================
// TEST SUITE 3: pages/page-bridge.js - 同样的5秒历史按键释放回放漏洞
// ============================================================================

test('[Bug Reproduction 3.1] pages/page-bridge.js: holding Alt+Q must NOT commit using Alt release from 2500ms ago', () => {
  const sandbox = createPageBridgeSandbox(10000);

  // Step 1: Stale keydown and release 2500ms ago
  sandbox.dispatchKeydown({ key: 'Alt', code: 'AltLeft' });
  sandbox.advanceTime(50);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  sandbox.advanceTime(2450);
  const commandStartedAt = 12500;
  sandbox.setTime(commandStartedAt);

  // Step 2: New command started, arm message arrives
  sandbox.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  const releaseMessages = sandbox.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  assert.equal(
    releaseMessages.length,
    0,
    `\n❌ [BUG REPRODUCED in page-bridge.js]` +
    `\n  Reason: page-bridge.js also contains the 5-second replay window bug!` +
    `\n  (startedAt - observedAt) <= 5000ms accepted an Alt release from 2500ms ago.` +
    `\n  Sent message: ${JSON.stringify(releaseMessages[0])}\n`
  );
});

// ============================================================================
// TEST SUITE 4: 触发键与修饰键分离行为测试 (Key Release Separation & Repeat)
// ============================================================================

test('[Bug Reproduction 1.4] content/key-observer.js: releasing trigger key Q while holding Alt must NOT trigger Alt release', () => {
  const sandbox = createKeyObserverSandbox(10000);

  // User previously pressed Alt 1500ms ago
  sandbox.dispatchKeydown({ key: 'Alt', code: 'AltLeft' });
  sandbox.advanceTime(50);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  // 1500ms later: user presses Alt+Q
  sandbox.advanceTime(1500);
  const commandStartedAt = 11550;
  sandbox.setTime(commandStartedAt);

  sandbox.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  // User releases Q, but STILL HOLDS Alt
  sandbox.dispatchKeyup({ key: 'q', code: 'KeyQ' });

  const releaseMessages = sandbox.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  assert.equal(
    releaseMessages.length,
    0,
    `\n❌ [BUG REPRODUCED in key-observer.js]` +
    `\n  Reason: Releasing the trigger key 'Q' while keeping 'Alt' held committed the switch because old Alt was replayed!`
  );
});

test('[Bug Reproduction 2.3] pages/switcher-host.js: user holding Alt and tapping Q multiple times must NOT be interrupted by 500ms timeout', () => {
  const sandbox = createSwitcherHostSandbox(10000);

  // User holds Alt and presses Q every 300ms to cycle through tabs
  // At T = 300ms, user presses Q
  sandbox.advanceTime(300);
  sandbox.dispatchKeydown({ key: 'q', code: 'KeyQ' });

  // At T = 600ms, total elapsed since focus is 600ms (> 500ms)
  // Even though user is actively cycling and holding Alt, current code commits at 500ms
  // unless sawTrustedKeydown was set. But if user pressed Q before 500ms, did sawTrustedKeydown become true?
  // If no keys arrived (e.g. Q was eaten by Chrome commands or focus was delayed), it committed at 500ms!
  sandbox.advanceTime(300);

  // In the scenario where commands are handled globally by Chrome and page sees no keydown:
  assert.equal(
    sandbox.getCommitCallCount(),
    0,
    `\n❌ [BUG REPRODUCED in switcher-host.js]` +
    `\n  Reason: User is holding Alt, but 500ms timeout forced commit prematurely.`
  );
});

// ============================================================================
// TEST SUITE 5: 正向验证用例 (Sanity Checks - 真正的按键释放必须能正常工作)
// ============================================================================

test('[Sanity Check 5.1] content/key-observer.js: a REAL release after commandStartedAt MUST be relayed correctly', () => {
  const sandbox = createKeyObserverSandbox(10000);
  const commandStartedAt = 10000;

  sandbox.receiveRuntimeMessage({
    action: 'armTabSwitcherShortcutRelease',
    keys: ['Alt'],
    commandStartedAt: commandStartedAt
  });

  // User genuinely releases Alt 200ms AFTER commandStartedAt
  sandbox.advanceTime(200);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  const releaseMessages = sandbox.getSentMessages().filter(
    (m) => m.message && m.message.action === 'notifyTabSwitcherShortcutModifierReleased'
  );

  assert.equal(
    releaseMessages.length,
    1,
    'A legitimate Alt release occurring AFTER commandStartedAt must be sent to background'
  );
  assert.equal(releaseMessages[0].message.key, 'Alt');
});

test('[Sanity Check 5.2] pages/switcher-host.js: a REAL keyup event in popup MUST commit immediately', () => {
  const sandbox = createSwitcherHostSandbox(10000);

  // Let panel open
  sandbox.advanceTime(100);

  // User genuinely releases Alt in popup window at 200ms
  sandbox.advanceTime(100);
  sandbox.dispatchKeyup({ key: 'Alt', code: 'AltLeft' });

  // Next tick of poll interval commits
  sandbox.advanceTime(100);

  assert.equal(
    sandbox.getCommitCallCount(),
    1,
    'A legitimate Alt keyup in popup host must trigger commit'
  );
});

