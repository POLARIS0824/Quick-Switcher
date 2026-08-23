(function() {
  'use strict';

  const TAB_SWITCHER_HOST_ID = '_quickswitch_tab_switcher_host_2026_unique_';
  const PANEL_OPEN_GRACE_MS = 3000;
  const LOST_RELEASE_COMMIT_MS = 1600;
  const BLUR_CLOSE_DELAY_MS = 120;
  const POLL_INTERVAL_MS = 200;

  const loadedAt = Date.now();
  let focusedAt = Date.now();
  let sawTrustedKeyEvent = false;
  let sawPanelOpen = false;
  let didCloseWindow = false;
  let didAttemptLostReleaseCommit = false;

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
