(function() {
  const RUNTIME_KEY = '_quickswitch_shortcut_key_observer_2026_unique_';
  const previousRuntime = window[RUNTIME_KEY];
  if (previousRuntime && typeof previousRuntime.cleanup === 'function') {
    try {
      previousRuntime.cleanup();
    } catch (error) {
      // A listener from the previous extension context may already be invalid.
    }
  }
  const RELEASE_REPLAY_WINDOW_MS = 5000;
  let armedReleaseKeys = [];
  const recentTrustedKeydownAtByKey = new Map();
  const recentTrustedReleaseAtByKey = new Map();

  function normalizeReleaseKey(value) {
    const key = String(value || '');
    return key.length === 1 ? key.toLowerCase() : key;
  }

  function normalizeReleaseCode(value) {
    const code = String(value || '');
    if (/^Key[A-Z]$/.test(code)) {
      return code.slice(3).toLowerCase();
    }
    if (/^Digit\d$/.test(code)) {
      return code.slice(5);
    }
    const aliases = {
      Backquote: '`',
      Backslash: '\\',
      BracketLeft: '[',
      BracketRight: ']',
      Comma: ',',
      Equal: '=',
      Minus: '-',
      Period: '.',
      Quote: "'",
      Semicolon: ';',
      Slash: '/'
    };
    return aliases[code] || '';
  }

  function getShortcutReleaseCandidates(event) {
    return Array.from(new Set([
      normalizeReleaseKey(event && event.key),
      normalizeReleaseCode(event && event.code)
    ].filter(Boolean)));
  }

  function getShortcutKeydownCandidates(event) {
    const candidates = getShortcutReleaseCandidates(event);
    if (event && event.altKey) {
      candidates.push('Alt');
    }
    if (event && event.ctrlKey) {
      candidates.push('Control');
    }
    if (event && event.metaKey) {
      candidates.push('Meta');
    }
    if (event && event.shiftKey) {
      candidates.push('Shift');
    }
    return Array.from(new Set(candidates));
  }

  function pruneTrustedShortcutEvents(now) {
    [recentTrustedKeydownAtByKey, recentTrustedReleaseAtByKey].forEach((eventsByKey) => {
      eventsByKey.forEach((observedAt, key) => {
        if ((now - observedAt) > RELEASE_REPLAY_WINDOW_MS) {
          eventsByKey.delete(key);
        }
      });
    });
  }

  function rememberTrustedShortcutKeydown(event) {
    if (!event || event.isTrusted !== true || event.isComposing || event.repeat) {
      return;
    }
    const pressedAt = Date.now();
    pruneTrustedShortcutEvents(pressedAt);
    getShortcutKeydownCandidates(event).forEach((key) => {
      recentTrustedKeydownAtByKey.set(key, pressedAt);
    });
  }

  function getReleasedShortcutKey(event) {
    return getShortcutReleaseCandidates(event)
      .find((key) => armedReleaseKeys.includes(key)) || '';
  }

  function rememberTrustedShortcutRelease(event) {
    const releasedAt = Date.now();
    pruneTrustedShortcutEvents(releasedAt);
    getShortcutReleaseCandidates(event).forEach((key) => {
      recentTrustedReleaseAtByKey.set(key, releasedAt);
    });
  }

  function getBufferedReleasedShortcutKey(keys, commandStartedAt) {
    const startedAt = Number(commandStartedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return '';
    }
    const now = Date.now();
    return keys.find((key) => {
      const observedAt = recentTrustedReleaseAtByKey.get(key);
      if (!Number.isFinite(observedAt) ||
          (now - observedAt) > RELEASE_REPLAY_WINDOW_MS) {
        return false;
      }
      if (observedAt >= startedAt) {
        return true;
      }
      const keydownAt = recentTrustedKeydownAtByKey.get(key);
      return Number.isFinite(keydownAt) &&
        keydownAt <= observedAt &&
        (observedAt - keydownAt) <= RELEASE_REPLAY_WINDOW_MS &&
        (startedAt - observedAt) <= RELEASE_REPLAY_WINDOW_MS;
    }) || '';
  }

  function relayTabSwitcherShortcutRelease(key) {
    if (!key) {
      return;
    }
    armedReleaseKeys = [];
    recentTrustedKeydownAtByKey.delete(key);
    recentTrustedReleaseAtByKey.delete(key);
    try {
      chrome.runtime.sendMessage({
        action: 'notifyTabSwitcherShortcutModifierReleased',
        key
      }, () => {
        void (chrome.runtime && chrome.runtime.lastError);
      });
    } catch (error) {
      // Ignore stale extension contexts while a tab or the extension reloads.
    }
  }

  const runtimeMessageListener = (request, _sender, sendResponse) => {
    if (!request || request.action !== 'armTabSwitcherShortcutRelease') {
      return;
    }
    armedReleaseKeys = (Array.isArray(request.keys) ? request.keys : [request.key])
      .map(normalizeReleaseKey)
      .filter(Boolean);
    const bufferedKey = getBufferedReleasedShortcutKey(
      armedReleaseKeys,
      request.commandStartedAt
    );
    if (bufferedKey) {
      relayTabSwitcherShortcutRelease(bufferedKey);
    }
    sendResponse({ ok: armedReleaseKeys.length > 0 || Boolean(bufferedKey) });
  };

  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(runtimeMessageListener);
  }

  function notifyTabSwitcherShortcutModifierReleased(event) {
    if (!event || event.isTrusted !== true) {
      return;
    }
    rememberTrustedShortcutRelease(event);
    const key = getReleasedShortcutKey(event);
    if (!key) {
      return;
    }
    relayTabSwitcherShortcutRelease(key);
  }

  window.addEventListener('keydown', rememberTrustedShortcutKeydown, true);
  window.addEventListener('keyup', notifyTabSwitcherShortcutModifierReleased, true);
  window[RUNTIME_KEY] = Object.freeze({
    cleanup() {
      window.removeEventListener('keydown', rememberTrustedShortcutKeydown, true);
      window.removeEventListener('keyup', notifyTabSwitcherShortcutModifierReleased, true);
      if (chrome && chrome.runtime && chrome.runtime.onMessage &&
          typeof chrome.runtime.onMessage.removeListener === 'function') {
        try {
          chrome.runtime.onMessage.removeListener(runtimeMessageListener);
        } catch (error) {
          // Ignore a listener that belongs to an invalidated extension context.
        }
      }
    }
  });
})();
