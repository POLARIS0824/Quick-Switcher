'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RECENT_TAB_SWITCHER = require('../background/recent-tab-switcher.js');

const {
  getShortcutCommitModifierEventKey,
  getShortcutTriggerEventKey,
  getShortcutReleaseEventKeys
} = RECENT_TAB_SWITCHER;

test('getShortcutCommitModifierEventKey resolves the first non-shift modifier', () => {
  assert.equal(getShortcutCommitModifierEventKey('Alt+Q'), 'Alt');
  assert.equal(getShortcutCommitModifierEventKey('Ctrl+Shift+K'), 'Control');
  assert.equal(getShortcutCommitModifierEventKey('Command+Shift+K'), 'Meta');
  assert.equal(getShortcutCommitModifierEventKey('MacCtrl+K'), 'Control');
  assert.equal(getShortcutCommitModifierEventKey('Shift+Q'), 'Shift');
  assert.equal(getShortcutCommitModifierEventKey('Q'), '');
  assert.equal(getShortcutCommitModifierEventKey(''), '');
  assert.equal(getShortcutCommitModifierEventKey(null), '');
});

test('getShortcutCommitModifierEventKey understands mac symbols', () => {
  assert.equal(getShortcutCommitModifierEventKey('⌥Q'), 'Alt');
  assert.equal(getShortcutCommitModifierEventKey('⌘⇧K'), 'Meta');
  assert.equal(getShortcutCommitModifierEventKey('⌃⌥K'), 'Control');
  assert.equal(getShortcutCommitModifierEventKey('⇧⌥K'), 'Alt');
});

test('getShortcutTriggerEventKey resolves the trigger token with aliases', () => {
  assert.equal(getShortcutTriggerEventKey('Alt+Q'), 'q');
  assert.equal(getShortcutTriggerEventKey('Ctrl+Shift+K'), 'k');
  assert.equal(getShortcutTriggerEventKey('⌘⇧K'), 'k');
  assert.equal(getShortcutTriggerEventKey('⌥Q'), 'q');
  assert.equal(getShortcutTriggerEventKey('Alt+Comma'), ',');
  assert.equal(getShortcutTriggerEventKey('Alt+Period'), '.');
  assert.equal(getShortcutTriggerEventKey('Alt+Slash'), '/');
  assert.equal(getShortcutTriggerEventKey('Alt+Backslash'), '\\');
  assert.equal(getShortcutTriggerEventKey('Ctrl+Return'), 'Enter');
  assert.equal(getShortcutTriggerEventKey('Ctrl+Esc'), 'Escape');
  assert.equal(getShortcutTriggerEventKey('Alt+Space'), ' ');
  assert.equal(getShortcutTriggerEventKey('Alt+Spacebar'), ' ');
  assert.equal(getShortcutTriggerEventKey('Ctrl+F5'), 'F5');
  assert.equal(getShortcutTriggerEventKey('Ctrl+F12'), 'F12');
  assert.equal(getShortcutTriggerEventKey(''), '');
});

test('getShortcutReleaseEventKeys exposes only the commit modifier', () => {
  assert.deepEqual(getShortcutReleaseEventKeys('Alt+Q'), ['Alt']);
  assert.deepEqual(getShortcutReleaseEventKeys('Ctrl+Shift+K'), ['Control']);
  assert.deepEqual(getShortcutReleaseEventKeys('⌥Q'), ['Alt']);
  assert.deepEqual(getShortcutReleaseEventKeys('⌘⇧K'), ['Meta']);
  assert.deepEqual(getShortcutReleaseEventKeys(''), []);
});
