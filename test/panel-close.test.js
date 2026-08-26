'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PANEL_CORE = require('../content/panel.js');

test('nextSelectedIndexAfterRemoval shifts up when an earlier card is removed', () => {
  // Removing card 0 while card 2 is selected: the selection follows the card.
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(0, 2, 4), 1);
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(1, 3, 3), 2);
});

test('nextSelectedIndexAfterRemoval keeps pointing at the shifted-in card', () => {
  // Removing the selected card keeps the same slot, now held by the next card.
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(2, 2, 4), 2);
});

test('nextSelectedIndexAfterRemoval falls back to the tail when the last card goes', () => {
  // Removing the selected last card lands on the new last card.
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(4, 4, 4), 3);
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(0, 0, 0), 0);
});

test('nextSelectedIndexAfterRemoval leaves later selections untouched', () => {
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(3, 1, 4), 1);
});

test('nextSelectedIndexAfterRemoval tolerates non-finite input', () => {
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(Number.NaN, 1, 4), 1);
  assert.equal(PANEL_CORE.nextSelectedIndexAfterRemoval(0, Number.NaN, 4), 0);
});
