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

test('calculateNextRowIndex stays put when single row (<= 5 cards)', () => {
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, 1, 5), 0);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, 1, 5), 3);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, -1, 5), 3);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, 1, 3), 1);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, -1, 3), 1);
});

test('calculateNextRowIndex blocks at top and bottom boundaries', () => {
  // At top row, moving up stays on current card
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, -1, 10), 0);
  assert.equal(PANEL_CORE.calculateNextRowIndex(2, -1, 10), 2);
  assert.equal(PANEL_CORE.calculateNextRowIndex(4, -1, 10), 4);
  // At bottom row, moving down stays on current card
  assert.equal(PANEL_CORE.calculateNextRowIndex(5, 1, 10), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(7, 1, 10), 7);
  assert.equal(PANEL_CORE.calculateNextRowIndex(9, 1, 10), 9);
});

test('calculateNextRowIndex matches exact columns in full 2-row layout (10 cards)', () => {
  // Down from row 0 to row 1
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, 1, 10), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, 1, 10), 6);
  assert.equal(PANEL_CORE.calculateNextRowIndex(2, 1, 10), 7);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, 1, 10), 8);
  assert.equal(PANEL_CORE.calculateNextRowIndex(4, 1, 10), 9);

  // Up from row 1 to row 0
  assert.equal(PANEL_CORE.calculateNextRowIndex(5, -1, 10), 0);
  assert.equal(PANEL_CORE.calculateNextRowIndex(6, -1, 10), 1);
  assert.equal(PANEL_CORE.calculateNextRowIndex(7, -1, 10), 2);
  assert.equal(PANEL_CORE.calculateNextRowIndex(8, -1, 10), 3);
  assert.equal(PANEL_CORE.calculateNextRowIndex(9, -1, 10), 4);
});

test('calculateNextRowIndex finds closest columns in centered 7-card layout (5 + 2)', () => {
  // Row 0 has cards [0, 1, 2, 3, 4] with centers [0, 1, 2, 3, 4]
  // Row 1 has cards [5, 6] with centers [1.5, 2.5]
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, 1, 7), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, 1, 7), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(2, 1, 7), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, 1, 7), 6);
  assert.equal(PANEL_CORE.calculateNextRowIndex(4, 1, 7), 6);

  // Reversible mapping from row 1 back to row 0:
  // Card 5 (center 1.5, left side) -> Card 1
  assert.equal(PANEL_CORE.calculateNextRowIndex(5, -1, 7), 1);
  // Card 6 (center 2.5, right side) -> Card 3
  assert.equal(PANEL_CORE.calculateNextRowIndex(6, -1, 7), 3);
});

test('calculateNextRowIndex finds closest columns in centered 8-card layout (5 + 3)', () => {
  // Row 0 has cards [0, 1, 2, 3, 4] with centers [0, 1, 2, 3, 4]
  // Row 1 has cards [5, 6, 7] with centers [1, 2, 3] (exact match to cards 1, 2, 3)
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, 1, 8), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, 1, 8), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(2, 1, 8), 6);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, 1, 8), 7);
  assert.equal(PANEL_CORE.calculateNextRowIndex(4, 1, 8), 7);

  assert.equal(PANEL_CORE.calculateNextRowIndex(5, -1, 8), 1);
  assert.equal(PANEL_CORE.calculateNextRowIndex(6, -1, 8), 2);
  assert.equal(PANEL_CORE.calculateNextRowIndex(7, -1, 8), 3);
});

test('calculateNextRowIndex finds center column in centered 6-card layout (5 + 1)', () => {
  // Row 1 has only card 5 (center 2.0, directly under card 2)
  assert.equal(PANEL_CORE.calculateNextRowIndex(0, 1, 6), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(1, 1, 6), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(2, 1, 6), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(3, 1, 6), 5);
  assert.equal(PANEL_CORE.calculateNextRowIndex(4, 1, 6), 5);

  assert.equal(PANEL_CORE.calculateNextRowIndex(5, -1, 6), 2);
});

