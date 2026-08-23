(function() {
  'use strict';

  const TAB_SWITCHER_HOST_ID = '_quickswitch_tab_switcher_host_2026_unique_';
  const PANEL_OPEN_GRACE_MS = 3000;
  const LOST_RELEASE_COMMIT_MS = 1600;
  const BLUR_CLOSE_DELAY_MS = 120;
  const POLL_INTERVAL_MS = 200;
  const PANEL_FIT_MARGIN_PX = 12;
  const PANEL_FIT_RESIZE_DELTA_PX = 2;
  const POPUP_SIZE_CACHE_KEY = 'switcherPopupSizeCache';

  const loadedAt = Date.now();
  let focusedAt = Date.now();
  let sawTrustedKeyEvent = false;
  let sawPanelOpen = false;
  let didCloseWindow = false;
  let didAttemptLostReleaseCommit = false;
  let didFitWindowToPanel = false;

  function closePopupWindow() {
    if (didCloseWindow) {
      return;
    }
    didCloseWindow = true;
    try {
      window.close();
    } catch (error) {
      // The background also removes this window after a switchToTab commit.
    }
  }

  function getPanelHost() {
    return document.getElementById(TAB_SWITCHER_HOST_ID);
  }

  // The window is created with a cached-or-preset size; once the panel is
  // live, verify against its real bounds (transform included). Only resize
  // when the mismatch exceeds a small threshold (first run or changed CSS),
  // then remember the fitted size per card count so future windows are born
  // at the right size with no visible resize hop.
  function rememberFittedPopupSize(count, width, height) {
    if (!chrome || !chrome.storage || !chrome.storage.local ||
        typeof chrome.storage.local.get !== 'function' ||
        typeof chrome.storage.local.set !== 'function' ||
        !Number.isFinite(count) || count <= 0) {
      return;
    }
    try {
      chrome.storage.local.get([POPUP_SIZE_CACHE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          return;
        }
        const cache = result && result[POPUP_SIZE_CACHE_KEY] &&
          typeof result[POPUP_SIZE_CACHE_KEY] === 'object'
          ? result[POPUP_SIZE_CACHE_KEY]
          : {};
        cache[String(count)] = { width, height };
        chrome.storage.local.set({ [POPUP_SIZE_CACHE_KEY]: cache }, () => {
          void (chrome.runtime && chrome.runtime.lastError);
        });
      });
    } catch (error) {
      // Cache writes are best-effort.
    }
  }

  function fitPopupWindowToPanel(panelHost) {
    const getMetrics = panelHost._quickswitchTabSwitcherGetPanelMetrics;
    if (typeof getMetrics !== 'function') {
      return;
    }
    requestAnimationFrame(() => {
      if (didCloseWindow) {
        return;
      }
      const metrics = getMetrics();
      if (!metrics || !(metrics.width > 0) || !(metrics.height > 0)) {
        didFitWindowToPanel = false;
        return;
      }
      const width = Math.ceil(metrics.width + PANEL_FIT_MARGIN_PX * 2);
      const height = Math.ceil(metrics.height + PANEL_FIT_MARGIN_PX * 2);
      rememberFittedPopupSize(metrics.count, width, height);
      const widthDelta = Math.abs(window.innerWidth - width);
      const heightDelta = Math.abs(window.innerHeight - height);
      if (widthDelta <= PANEL_FIT_RESIZE_DELTA_PX && heightDelta <= PANEL_FIT_RESIZE_DELTA_PX) {
        return;
      }
      const relayout = () => {
        if (!didCloseWindow && typeof panelHost._quickswitchTabSwitcherRelayout === 'function') {
          panelHost._quickswitchTabSwitcherRelayout();
        }
      };
      if (chrome && chrome.windows && typeof chrome.windows.update === 'function') {
        chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { width, height }, () => {
          void (chrome.runtime && chrome.runtime.lastError);
          window.setTimeout(relayout, 50);
        });
        return;
      }
      try {
        window.resizeTo(width, height);
      } catch (error) {
        // Keep the preset size if the window cannot be resized.
      }
      window.setTimeout(relayout, 50);
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event && event.isTrusted === true) {
      sawTrustedKeyEvent = true;
    }
  }, true);
  window.addEventListener('keyup', (event) => {
    if (event && event.isTrusted === true) {
      sawTrustedKeyEvent = true;
    }
  }, true);
  window.addEventListener('focus', () => {
    focusedAt = Date.now();
  });
  // Committing moves focus back to the browser window; clicking away or
  // alt-tabbing cancels. Either way the popup window retires itself.
  window.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!document.hasFocus()) {
        closePopupWindow();
      }
    }, BLUR_CLOSE_DELAY_MS);
  });

  window.setInterval(() => {
    if (didCloseWindow) {
      return;
    }
    const panelHost = getPanelHost();
    if (panelHost) {
      sawPanelOpen = true;
      if (!didFitWindowToPanel) {
        didFitWindowToPanel = true;
        fitPopupWindowToPanel(panelHost);
      }
    } else if (sawPanelOpen) {
      // The in-page panel closed itself (Escape, commit, or visibility
      // retirement); the popup window must not outlive it.
      closePopupWindow();
      return;
    } else if (Date.now() - loadedAt > PANEL_OPEN_GRACE_MS) {
      // The open command never arrived (port failure or a lost race); do not
      // keep an empty popup on screen.
      closePopupWindow();
      return;
    }
    if (!panelHost || sawTrustedKeyEvent || didAttemptLostReleaseCommit) {
      return;
    }
    if (!document.hasFocus()) {
      // The panel can never receive keys without focus; treat as cancel.
      if (Date.now() - focusedAt > LOST_RELEASE_COMMIT_MS) {
        closePopupWindow();
      }
      return;
    }
    // While the OS transferred focus to this popup, the modifier keyup could
    // be delivered to neither window. If the panel has focus, never saw a
    // single trusted key event, and none arrives in time, commit the default
    // selection exactly like a quick modifier flick would have.
    if (Date.now() - focusedAt > LOST_RELEASE_COMMIT_MS) {
      didAttemptLostReleaseCommit = true;
      if (typeof panelHost._quickswitchTabSwitcherCommitFromShortcutRelease === 'function') {
        panelHost._quickswitchTabSwitcherCommitFromShortcutRelease();
      }
    }
  }, POLL_INTERVAL_MS);
})();
