import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOBBY_OPTIONS,
  NO_CONNECTION,
  PARTNER_LEFT,
  ROOM_BUSY,
  claimSeat,
  focusedOption,
  initialState,
  maskedWord,
  normalizeRoom,
  reduce,
  wantsRoom,
} from '../src/reducer.js';

// Tests are written as the events a player would actually produce — move, move,
// activate — rather than as hand-built state objects. That way they describe
// behaviour and survive the state shape changing underneath them.
//
// The second player is expressed the same way: as the room their client would
// have written, dispatched here as a hydrate. There is no database in these
// tests and nothing standing in for one, because the reducer never sees one.

const move = (direction) => ({ type: 'move', direction });
const activate = () => ({ type: 'activate' });
const joined = (seat) => ({ type: 'joined', seat });
const hydrate = (room) => ({ type: 'hydrate', room });
const dismissNotice = () => ({ type: 'dismissNotice' });

// A room as the database would hold it once the named seats are occupied.
const roomWith = (...seats) => ({
  players: { 1: { present: seats.includes(1) }, 2: { present: seats.includes(2) } },
});

// The same, once the room creator has published a word into it.
const gameOf = (word, guessed = []) => ({ word, guessed, ...roomWith(1, 2) });

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
  return events.reduce((current, event) => reduce(deepFreeze(current), deepFreeze(event)), state);
}

// The sequence a player produces to get as far as the waiting screen with a seat
// in hand, which is where every pairing test starts.
const seated = (seat) => play([activate(), joined(seat)]);

// --- the lobby ------------------------------------------------------------

test('the lobby opens with Connect focused', () => {
  assert.equal(focusedOption(play([])), 'connect');
});

test('down moves focus to the next option', () => {
  assert.equal(focusedOption(play([move('down')])), 'exit');
});

test('up moves focus to the previous option', () => {
  const onExit = play([move('down')]);
  assert.equal(focusedOption(play([move('up')], onExit)), 'connect');
});

test('focus wraps at both ends of the option list', () => {
  assert.equal(focusedOption(play([move('up')])), 'exit');
  assert.equal(focusedOption(play([move('down'), move('down')])), 'connect');
});

test('focus stays in range however many times it moves', () => {
  const wandered = play([move('down'), move('down'), move('down'), move('up'), move('up')]);
  assert.ok(LOBBY_OPTIONS.includes(focusedOption(wandered)));
});

test('left and right do nothing in the lobby', () => {
  const before = play([move('down')]);
  const after = play([move('left'), move('right')], before);
  assert.equal(after, before);
});

test('activating Exit App leaves the app', () => {
  assert.equal(play([move('down'), activate()]).screen, 'exited');
});

test('nothing responds once the app has exited', () => {
  const exited = play([move('down'), activate()]);
  assert.equal(play([move('up'), activate()], exited), exited);
});

test('the reducer does not mutate the state it is given', () => {
  const start = deepFreeze(initialState());
  reduce(start, move('down'));
  assert.equal(focusedOption(start), 'connect');
});

// --- getting into the room ------------------------------------------------

test('activating Connect shows the waiting screen', () => {
  assert.equal(play([activate()]).screen, 'waiting');
});

test('the waiting screen is shown before a seat has been claimed', () => {
  // The join takes a round trip. If the card sat on the lobby until it finished,
  // that round trip would look like a missed keypress.
  assert.equal(play([activate()]).seat, null);
});

test('the waiting screen wants a seat in the room and the lobby does not', () => {
  assert.equal(wantsRoom(play([activate()])), true);
  assert.equal(wantsRoom(play([])), false);
});

test('leaving the waiting screen returns to the lobby', () => {
  assert.equal(play([activate(), activate()]).screen, 'lobby');
});

test('leaving the waiting screen gives up the seat', () => {
  // The entry module releases the seat by reconciling against wantsRoom, so
  // dropping it here is what clears this player's presence in the room.
  const backInLobby = play([activate(), joined(1), activate()]);
  assert.equal(wantsRoom(backInLobby), false);
  assert.equal(backInLobby.seat, null);
});

test('leaving and connecting again starts a fresh wait', () => {
  const again = play([activate(), joined(1), activate(), activate()]);
  assert.equal(again.screen, 'waiting');
  assert.equal(again.room, null);
});

test('moving does nothing on the waiting screen', () => {
  const waiting = play([activate()]);
  assert.equal(play([move('up'), move('down'), move('left')], waiting), waiting);
});

// --- pairing --------------------------------------------------------------

test('waiting alone keeps waiting', () => {
  assert.equal(play([hydrate(roomWith(1))], seated(1)).screen, 'waiting');
});

test('the second player arriving starts the game with no further input', () => {
  assert.equal(play([hydrate(roomWith(1, 2))], seated(1)).screen, 'playing');
});

test('the second player starts the game on their own card too', () => {
  assert.equal(play([hydrate(roomWith(1, 2))], seated(2)).screen, 'playing');
});

test('the game starts even if the room arrives before the seat does', () => {
  // The snapshot subscription and the seat claim resolve independently, so
  // either can land first and the pairing must not depend on which.
  const roomFirst = play([activate(), hydrate(roomWith(1, 2)), joined(2)]);
  assert.equal(roomFirst.screen, 'playing');
});

test('a room holding only this player does not start the game', () => {
  // Seeing your own presence flag come back is not a partner arriving.
  assert.equal(play([hydrate(roomWith(2))], seated(2)).screen, 'waiting');
});

// --- claiming a seat ------------------------------------------------------

test('the first occupant of an empty room takes seat one', () => {
  assert.equal(claimSeat(null).seat, 1);
});

test('the first occupant of an empty room marks itself present', () => {
  assert.equal(claimSeat(null).room.players[1].present, true);
  assert.equal(claimSeat(null).room.players[2].present, false);
});

test('the first occupant resets a stale room rather than adopting it', () => {
  const abandoned = {
    word: 'MARBLE',
    guessed: ['M', 'A', 'Q'],
    turn: 2,
    players: { 1: { present: false }, 2: { present: false } },
    rematch: { 1: true, 2: false },
  };

  const { seat, room } = claimSeat(abandoned, 'PLANET');

  assert.equal(seat, 1);
  assert.equal(room.word, 'PLANET');
  assert.deepEqual(room.guessed, []);
  assert.equal(room.turn, 1);
  assert.deepEqual(room.rematch, { 1: false, 2: false });
});

test('the second occupant takes the free seat and adopts the room', () => {
  const started = { word: 'MARBLE', guessed: ['M'], turn: 1, ...roomWith(1) };

  const { seat, room } = claimSeat(started, 'PLANET');

  assert.equal(seat, 2);
  assert.equal(room.word, 'MARBLE');
  assert.deepEqual(room.guessed, ['M']);
  assert.equal(room.players[1].present, true);
  assert.equal(room.players[2].present, true);
});

test('the word a joiner brought with them is not written over the live one', () => {
  // Every client picks a word before it knows which seat it will get. Only the
  // client that creates the room may publish one; a game already holding MARBLE
  // must not change word under the first player because a second walked in.
  const started = { word: 'MARBLE', guessed: ['M'], turn: 1, ...roomWith(1) };
  assert.equal(claimSeat(started, 'PLANET').room.word, 'MARBLE');
});

test('a room left holding only the second player is joined at seat one', () => {
  assert.equal(claimSeat(roomWith(2)).seat, 1);
});

test('a full room offers no seat and is left untouched', () => {
  assert.equal(claimSeat(roomWith(1, 2)).seat, null);
  assert.equal(claimSeat(roomWith(1, 2)).room, null);
});

test('finding the room full reports it rather than waiting forever', () => {
  const rejected = play([{ type: 'joinRejected' }], play([activate()]));
  assert.equal(rejected.screen, 'notice');
  assert.equal(rejected.notice, ROOM_BUSY);
});

test('failing to reach the room reports it rather than waiting forever', () => {
  const failed = play([{ type: 'joinFailed' }], play([activate()]));
  assert.equal(failed.screen, 'notice');
  assert.equal(failed.notice, NO_CONNECTION);
});

// --- losing the other player ----------------------------------------------

test('losing the partner shows PARTNER LEFT', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1))], playing);

  assert.equal(abandoned.screen, 'notice');
  assert.equal(abandoned.notice, PARTNER_LEFT);
});

test('PARTNER LEFT returns to the lobby', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const returned = play([hydrate(roomWith(1)), dismissNotice()], playing);

  assert.equal(returned.screen, 'lobby');
  assert.deepEqual(returned, initialState());
});

test('losing the partner gives up this seat as well', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(wantsRoom(play([hydrate(roomWith(1))], playing)), false);
});

test('a room emptied of both players is still a partner leaving', () => {
  // A snapshot can arrive after this client's own flag has gone too. What
  // matters is the partner, not the count.
  const playing = play([hydrate(roomWith(1, 2))], seated(2));
  assert.equal(play([hydrate(null)], playing).notice, PARTNER_LEFT);
});

test('there is no grace period before the partner counts as gone', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(play([hydrate(roomWith(1))], playing).screen, 'notice');
});

test('a late room snapshot cannot revive a finished game', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1))], playing);

  assert.equal(play([hydrate(roomWith(1, 2))], abandoned), abandoned);
});

test('keypresses do nothing on a notice screen', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1))], playing);

  assert.equal(play([move('down'), activate()], abandoned), abandoned);
});

// --- the mystery word -----------------------------------------------------

test('the word is masked as one dash per letter', () => {
  const playing = play([hydrate(gameOf('PLANET'))], seated(1));
  assert.equal(maskedWord(playing), '------');
});

test('the mask is as long as the word however long the word is', () => {
  for (const word of ['BEACH', 'PLANET', 'JOURNEY', 'MOUNTAIN']) {
    assert.equal(maskedWord(play([hydrate(gameOf(word))], seated(1))).length, word.length);
  }
});

test('a published word reaches the other player', () => {
  // The room the creator wrote, arriving at the joiner's client as a hydrate.
  // This is the whole ticket: two players looking at the same word.
  const joiner = play([hydrate(gameOf('PLANET'))], seated(2));
  assert.equal(maskedWord(joiner), '------');
});

test('both players mask the same word the same way', () => {
  const room = gameOf('MOUNTAIN', ['M', 'N']);
  assert.equal(
    maskedWord(play([hydrate(room)], seated(1))),
    maskedWord(play([hydrate(room)], seated(2))),
  );
});

test('a guessed letter shows in its place', () => {
  const playing = play([hydrate(gameOf('PLANET', ['P']))], seated(1));
  assert.equal(maskedWord(playing), 'P-----');
});

test('every occurrence of a guessed letter shows at once', () => {
  const playing = play([hydrate(gameOf('BANANA', ['A']))], seated(1));
  assert.equal(maskedWord(playing), '-A-A-A');
});

test('a wrong guess reveals nothing', () => {
  const playing = play([hydrate(gameOf('PLANET', ['Z']))], seated(1));
  assert.equal(maskedWord(playing), '------');
});

test('there is nothing to mask before a room has arrived', () => {
  assert.equal(maskedWord(play([])), '');
  assert.equal(maskedWord(play([activate()])), '');
});

// --- reading the room -----------------------------------------------------

test('an absent room reads as an empty one rather than throwing', () => {
  const empty = normalizeRoom(null);
  assert.equal(empty.players[1].present, false);
  assert.deepEqual(empty.guessed, []);
});

test('keys the database dropped read as their defaults', () => {
  // The database stores nothing for a null or empty value, so a room written
  // with an empty guess list comes back without the key at all.
  const sparse = normalizeRoom({ players: { 1: { present: true } } });
  assert.deepEqual(sparse.guessed, []);
  assert.equal(sparse.turn, 1);
  assert.equal(sparse.players[2].present, false);
  assert.deepEqual(sparse.rematch, { 1: false, 2: false });
});
