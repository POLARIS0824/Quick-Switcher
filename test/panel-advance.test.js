'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PANEL_CORE = require('../content/panel.js');

test('module loads in Node without touching window/document', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.QuickSwitchPanelCore, 'object');
});

test('parseTabSwitcherShortcut resolves trigger key and commit modifier', () => {
  assert.deepEqual(PANEL_CORE.parseTabSwitcherShortcut('Alt+Q'), {
    triggerKey: 'q',
    commitModifierEventKey: 'Alt',
    commitModifierFlag: 'altKey'
  });
  assert.deepEqual(PANEL_CORE.parseTabSwitcherShortcut('Ctrl+Shift+K'), {
    triggerKey: 'k',
    commitModifierEventKey: 'Control',
    commitModifierFlag: 'ctrlKey'
  });
  assert.deepEqual(PANEL_CORE.parseTabSwitcherShortcut('⌥Q'), {
    triggerKey: 'q',
    commitModifierEventKey: 'Alt',
    commitModifierFlag: 'altKey'
  });
  assert.deepEqual(PANEL_CORE.parseTabSwitcherShortcut('⌘⇧K'), {
    triggerKey: 'k',
    commitModifierEventKey: 'Meta',
    commitModifierFlag: 'metaKey'
  });
});

test('parseTabSwitcherShortcut falls back to Alt+Q for empty values', () => {
  assert.deepEqual(PANEL_CORE.parseTabSwitcherShortcut(''), {
    triggerKey: 'q',
    commitModifierEventKey: 'Alt',
    commitModifierFlag: 'altKey'
  });
});

test('isTabSwitcherShortcutTriggerEvent matches by key or physical code', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  assert.equal(PANEL_CORE.isTabSwitcherShortcutTriggerEvent(shortcut, { key: 'q', code: 'KeyQ' }), true);
  assert.equal(PANEL_CORE.isTabSwitcherShortcutTriggerEvent(shortcut, { key: 'Q', code: 'KeyQ' }), true);
  assert.equal(PANEL_CORE.isTabSwitcherShortcutTriggerEvent(shortcut, { key: 'Å', code: 'KeyQ' }), true);
  assert.equal(PANEL_CORE.isTabSwitcherShortcutTriggerEvent(shortcut, { key: 'a', code: 'KeyA' }), false);
  assert.equal(PANEL_CORE.isTabSwitcherShortcutTriggerEvent(shortcut, null), false);
});

test('isTabSwitcherCommitModifierPressed reflects the resolved modifier flag', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  assert.equal(PANEL_CORE.isTabSwitcherCommitModifierPressed(shortcut, { altKey: true }), true);
  assert.equal(PANEL_CORE.isTabSwitcherCommitModifierPressed(shortcut, { altKey: false }), false);
  assert.equal(PANEL_CORE.isTabSwitcherCommitModifierPressed(shortcut, null), false);
});

test('clampSelectedIndex wraps in both directions', () => {
  assert.equal(PANEL_CORE.clampSelectedIndex(0, 5), 0);
  assert.equal(PANEL_CORE.clampSelectedIndex(4, 5), 4);
  assert.equal(PANEL_CORE.clampSelectedIndex(5, 5), 0);
  assert.equal(PANEL_CORE.clampSelectedIndex(-1, 5), 4);
  assert.equal(PANEL_CORE.clampSelectedIndex(7, 3), 1);
  assert.equal(PANEL_CORE.clampSelectedIndex(Number.NaN, 5), 0);
  assert.equal(PANEL_CORE.clampSelectedIndex(1, 0), 0);
});

test('normalizeAdvanceOffset keeps sign, truncates, and defaults to 1', () => {
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(1), 1);
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(-3), -3);
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(2.9), 2);
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(0), 1);
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(null), 1);
  assert.equal(PANEL_CORE.normalizeAdvanceOffset(Number.NaN), 1);
});

test('suppressor swallows the first trigger keydown while the modifier is held', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  const suppressor = PANEL_CORE.createShortcutSuppressor(shortcut, true);
  assert.equal(suppressor.suppressed, true);
  assert.equal(suppressor.shouldSwallowTriggerKeydown({ altKey: true }), true);
  assert.equal(suppressor.shouldSwallowTriggerKeydown({ altKey: false }), false);
});

test('trigger keyup clears the suppression', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  const suppressor = PANEL_CORE.createShortcutSuppressor(shortcut, true);
  suppressor.markTriggerKeyup();
  assert.equal(suppressor.suppressed, false);
  assert.equal(suppressor.shouldSwallowTriggerKeydown({ altKey: true }), false);
});

test('an advance from the command path clears the suppression', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  const suppressor = PANEL_CORE.createShortcutSuppressor(shortcut, true);
  suppressor.markExternalAdvance();
  assert.equal(suppressor.suppressed, false);
});

test('a suppressor created without initial suppression never swallows', () => {
  const shortcut = PANEL_CORE.parseTabSwitcherShortcut('Alt+Q');
  const suppressor = PANEL_CORE.createShortcutSuppressor(shortcut, false);
  assert.equal(suppressor.suppressed, false);
  assert.equal(suppressor.shouldSwallowTriggerKeydown({ altKey: true }), false);
});
