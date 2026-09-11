import test from 'node:test';
import assert from 'node:assert/strict';

import { LOBBY_OPTIONS, focusedLobbyOption, initialState, reduce } from '../src/reducer.js';

// Tests are written as the events a player would actually produce — move, move,
// activate — rather than as hand-built state objects. That way they describe
// behaviour and survive the state shape changing underneath them.

const move = (direction) => ({ type: 'move', direction });
const activate = () => ({ type: 'activate' });

// Deep-frozen before every dispatch, so a reducer that mutates its input throws
// instead of quietly passing. ES modules are strict mode, so the throw is real.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

function play(events, state = initialState()) {
  return events.reduce((current, event) => reduce(deepFreeze(current), event), state);
}

test('the lobby opens with Connect focused', () => {
  assert.equal(focusedLobbyOption(play([])), 'connect');
});

test('down moves focus to the next option', () => {
  assert.equal(focusedLobbyOption(play([move('down')])), 'exit');
});

test('up moves focus to the previous option', () => {
  const onExit = play([move('down')]);
  assert.equal(focusedLobbyOption(play([move('up')], onExit)), 'connect');
});

test('focus wraps at both ends of the option list', () => {
  assert.equal(focusedLobbyOption(play([move('up')])), 'exit');
  assert.equal(focusedLobbyOption(play([move('down'), move('down')])), 'connect');
});

test('focus stays in range however many times it moves', () => {
  const wandered = play([move('down'), move('down'), move('down'), move('up'), move('up')]);
  assert.ok(LOBBY_OPTIONS.includes(focusedLobbyOption(wandered)));
});

test('left and right do nothing in the lobby', () => {
  const before = play([move('down')]);
  const after = play([move('left'), move('right')], before);
  assert.equal(after, before);
});

test('activating Exit App leaves the app', () => {
  assert.equal(play([move('down'), activate()]).screen, 'exited');
});

test('activating Connect does nothing yet', () => {
  const before = play([]);
  assert.equal(play([activate()], before), before);
});

test('nothing responds once the app has exited', () => {
  const exited = play([move('down'), activate()]);
  assert.equal(play([move('up'), activate()], exited), exited);
});

test('the reducer does not mutate the state it is given', () => {
  const start = deepFreeze(initialState());
  reduce(start, move('down'));
  assert.equal(focusedLobbyOption(start), 'connect');
});
