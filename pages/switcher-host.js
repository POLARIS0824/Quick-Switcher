(function() {
  'use strict';

  const TAB_SWITCHER_HOST_ID = '_quickswitch_tab_switcher_host_2026_unique_';
  const PANEL_OPEN_GRACE_MS = 3000;
  // A quick shortcut flick can release the modifier before this popup window
  // exists, and restricted pages cannot host the key observer that would
  // replay that release to us. Any trusted modifier keyup this page observes
  // is buffered and, once the panel is open, committed right away — even if
  // it arrived before the panel's own key handler was attached.
  // We do not force-commit on lack of keydown because modifier keys (like Alt)
  // do not auto-repeat on Windows, and doing so would prematurely commit the
  // switch while the user is still holding the shortcut to preview tabs.
  const BLUR_CLOSE_DELAY_MS = 120;
  const POLL_INTERVAL_MS = 100;
  // Chrome command shortcuts always require Ctrl or Alt (Meta on macOS), so
  // the commit modifier is always one of these.
  const COMMIT_MODIFIER_KEYS = { Alt: true, Control: true, Meta: true };

  const loadedAt = Date.now();
  let focusedAt = Date.now();
  let sawTrustedKeyEvent = false;
  let sawTrustedKeydown = false;
  let sawPanelOpen = false;
  let pendingModifierRelease = false;
  let didCloseWindow = false;
  let didAttemptLostReleaseCommit = false;
  let lostFocusAfterOpen = false;

  // Transition-only lines: the handful a flick produces are enough to audit
  // the commit decision in the popup window's DevTools console.
  function logHostState(reason) {
    try {
      console.info('QuickSwitcher host:', reason, {
        focusedAt,
        sawTrustedKeyEvent,
        sawTrustedKeydown,
        sawPanelOpen,
        pendingModifierRelease,
        hasFocus: document.hasFocus()
      });
    } catch (error) {
      // Diagnostics must never break the commit flow.
    }
  }

  function closePopupWindow() {
    if (didCloseWindow) {
      return;
    }
    didCloseWindow = true;
    logHostState('popup closing');
    try {
      window.close();
    } catch (error) {
      // The background also removes this window after a switchToTab commit.
    }
  }

  function getPanelHost() {
    return document.getElementById(TAB_SWITCHER_HOST_ID);
  }

  // One-shot commit through the panel's own shortcut-release path; the
  // panel's didRequestSwitch guard makes repeated calls harmless when the
  // page-bridge replay or the panel's own keyup handler already committed.
  function commitOpenPanel(reason) {
    if (didAttemptLostReleaseCommit) {
      return;
    }
    const panelHost = getPanelHost();
    if (!panelHost ||
        typeof panelHost._quickswitchTabSwitcherCommitFromShortcutRelease !== 'function') {
      return;
    }
    didAttemptLostReleaseCommit = true;
    logHostState(reason);
    panelHost._quickswitchTabSwitcherCommitFromShortcutRelease();
  }

  window.addEventListener('keydown', (event) => {
    if (event && event.isTrusted === true) {
      if (!sawTrustedKeyEvent) {
        sawTrustedKeyEvent = true;
        logHostState('first trusted key event');
      }
      sawTrustedKeydown = true;
    }
  }, true);
  window.addEventListener('keyup', (event) => {
    if (event && event.isTrusted === true) {
      if (!sawTrustedKeyEvent) {
        sawTrustedKeyEvent = true;
        logHostState('first trusted key event');
      }
      if (COMMIT_MODIFIER_KEYS[event.key] === true) {
        pendingModifierRelease = true;
        logHostState('modifier release observed');
      }
    }
  }, true);
  window.addEventListener('focus', () => {
    focusedAt = Date.now();
    logHostState('focus');
  });
  // Committing moves focus back to the browser window; clicking away or
  // alt-tabbing cancels. Either way the popup window retires itself.
  window.addEventListener('blur', () => {
    lostFocusAfterOpen = true;
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
      if (!sawPanelOpen) {
        sawPanelOpen = true;
        logHostState('panel open');
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
    if (!panelHost || didAttemptLostReleaseCommit) {
      return;
    }
    if (pendingModifierRelease) {
      // The release was observed (possibly before the panel was ready to see
      // it): commit promptly instead of waiting for the grace period.
      commitOpenPanel('buffered-release commit');
      return;
    }
    if (lostFocusAfterOpen && !document.hasFocus()) {
      // The user moved focus elsewhere on purpose; the blur handler above is
      // already retiring this window, so keep the flick commit off.
      return;
    }
  }, POLL_INTERVAL_MS);
})();
