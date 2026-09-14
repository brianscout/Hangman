import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYBOARD_COLUMNS,
  LETTERS,
  LOBBY_OPTIONS,
  MAX_WRONG,
  NO_CONNECTION,
  PARTNER_LEFT,
  PARTNER_TURN,
  ROOM_BUSY,
  YOUR_TURN,
  YOU_LOSE,
  YOU_WIN,
  claimSeat,
  focusedLetter,
  focusedOption,
  gameStatus,
  guessedLetters,
  initialState,
  isMyTurn,
  maskedWord,
  normalizeRoom,
  reduce,
  statusNotice,
  wantsRoom,
  wrongGuesses,
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
const gameOf = (word, guessed = [], turn = 1) => ({ word, guessed, turn, ...roomWith(1, 2) });

// The room as the database holds it once a player's client has published their
// guess: the fields in that client's outbox, written over the room both players
// share. Hydrating the other player with this is what the network does.
const published = (state) => ({ ...state.room, ...state.outbox });

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

// --- the letter keyboard ---------------------------------------------------

// Where every keyboard test starts: a game underway, with the cursor wherever
// the card put it. Reaching a letter is expressed as the presses a player would
// make, not as a cursor index, so these describe movement rather than storage.
const atGame = () => play([hydrate(gameOf('PLANET'))], seated(1));
const from = (...directions) => focusedLetter(play(directions.map(move), atGame()));

test('the keyboard is all 26 letters, six to a row', () => {
  assert.equal(LETTERS.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.equal(KEYBOARD_COLUMNS, 6);
  assert.equal(Math.ceil(LETTERS.length / KEYBOARD_COLUMNS), 5);
});

test('the keyboard opens on the first letter', () => {
  assert.equal(focusedLetter(atGame()), 'A');
});

test('right moves to the next letter in the row', () => {
  assert.equal(from('right'), 'B');
  assert.equal(from('right', 'right'), 'C');
});

test('left moves to the previous letter in the row', () => {
  assert.equal(from('right', 'right', 'left'), 'B');
});

test('down moves a whole row on', () => {
  assert.equal(from('down'), 'G');
  assert.equal(from('down', 'down'), 'M');
});

test('up moves a whole row back', () => {
  assert.equal(from('down', 'down', 'up'), 'G');
});

test('right wraps around the end of a row', () => {
  assert.equal(from('left'), 'F');
  assert.equal(from('right', 'right', 'right', 'right', 'right', 'right'), 'A');
});

test('left wraps around the start of a row', () => {
  assert.equal(from('down', 'left'), 'L');
});

test('down wraps around the bottom of the grid', () => {
  assert.equal(from('down', 'down', 'down', 'down', 'down'), 'A');
});

test('up wraps around the top of the grid', () => {
  assert.equal(from('up'), 'Y');
});

test('a column the short last row does not have lands on its last letter', () => {
  // Twenty-six letters do not fill a 6-wide grid, so the last row holds only Y
  // and Z. Arriving there from further right must land somewhere rather than
  // nowhere — no direction is ever a dead end.
  assert.equal(from('right', 'right', 'right', 'right', 'up'), 'Z');
  assert.equal(from('right', 'right', 'right', 'down', 'down', 'down', 'down'), 'Z');
});

test('left and right wrap inside the short last row too', () => {
  assert.equal(from('up', 'right'), 'Z');
  assert.equal(from('up', 'right', 'right'), 'Y');
  assert.equal(from('up', 'left'), 'Z');
});

test('the cursor is still on a letter however far it wanders', () => {
  const directions = ['up', 'left', 'left', 'down', 'down', 'right', 'up', 'right', 'down'];
  assert.ok(LETTERS.includes(from(...directions)));
});

test('moving the cursor changes nothing in the room', () => {
  // Cursor position is local to each player. Publishing it would mean a database
  // write on every cursor move, and neither player needs to see the other's.
  const before = atGame();
  const after = play([move('down'), move('right'), move('up')], before);

  assert.deepEqual(after.room, before.room);
  assert.equal(JSON.stringify(after.room).includes('cursor'), false);
});

test('both players move their own cursors independently', () => {
  const one = play([move('right')], play([hydrate(gameOf('PLANET'))], seated(1)));
  const two = play([hydrate(gameOf('PLANET'))], seated(2));

  assert.equal(focusedLetter(one), 'B');
  assert.equal(focusedLetter(two), 'A');
});

// --- guessing and turns ----------------------------------------------------

// A game underway, with this client in the named seat and the room in whatever
// state the test is about. Both players are present, because a game only starts
// once they are.
const gameFor = (seat, { word = 'PLANET', guessed = [], turn = 1 } = {}) =>
  play([hydrate(gameOf(word, guessed, turn))], seated(seat));

// Walking the cursor onto a letter with the presses a player would make: down
// into its row, then right along it. Written as presses rather than as a cursor
// index because the cursor skips guessed letters, so which letter a given number
// of presses lands on is exactly the thing under test elsewhere.
function reach(state, letter) {
  const rowOf = (key) => Math.floor(LETTERS.indexOf(key) / KEYBOARD_COLUMNS);

  let current = state;
  for (let press = 0; press < LETTERS.length; press += 1) {
    if (focusedLetter(current) === letter) return current;
    const towards = rowOf(focusedLetter(current)) === rowOf(letter) ? 'right' : 'down';
    current = play([move(towards)], current);
  }
  throw new Error(`the cursor never reached ${letter}`);
}

const guess = (state, letter) => play([activate()], reach(state, letter));

test('Enter guesses the letter under the cursor', () => {
  assert.equal(maskedWord(guess(gameFor(1), 'P')), 'P-----');
});

test('a correct guess reveals every occurrence of that letter at once', () => {
  // A player who guesses A in BANANA has earned all three of them, and a guess
  // that had to be repeated would burn a turn saying something already said.
  assert.equal(maskedWord(guess(gameFor(1, { word: 'BANANA' }), 'A')), '-A-A-A');
});

test('the turn passes after a correct guess', () => {
  assert.equal(isMyTurn(guess(gameFor(1), 'P')), false);
});

test('the turn passes after a wrong guess too', () => {
  // Both outcomes pass the turn. This is a collaborative game and a player who
  // kept guessing while they were right would leave the other one watching.
  const missed = guess(gameFor(1), 'Z');
  assert.equal(isMyTurn(missed), false);
  assert.equal(maskedWord(missed), '------');
});

test('the turn comes back once the partner has guessed', () => {
  const mine = guess(gameFor(1), 'P');
  const theirs = play([hydrate(published(mine))], seated(2));
  const back = play([hydrate(published(guess(theirs, 'L')))], mine);

  assert.equal(isMyTurn(theirs), true);
  assert.equal(isMyTurn(back), true);
});

test('a guess made by one player appears on the other player’s card', () => {
  const mine = guess(gameFor(1), 'A');
  const theirs = play([hydrate(published(mine))], seated(2));

  assert.equal(maskedWord(theirs), '--A---');
  assert.deepEqual(guessedLetters(theirs), ['A']);
});

test('two players fill in a word between them', () => {
  let one = gameFor(1, { word: 'BANANA' });
  let two = play([hydrate(gameOf('BANANA', [], 1))], seated(2));

  one = guess(one, 'A');
  two = play([hydrate(published(one))], two);
  two = guess(two, 'N');
  one = play([hydrate(published(two))], one);
  one = guess(one, 'B');

  assert.equal(maskedWord(one), 'BANANA');
  assert.equal(isMyTurn(one), false);
});

test('a guess made out of turn is rejected', () => {
  // The cursor opens on A, which is in PLANET. Nothing about the press is wrong
  // except whose turn it is.
  const waiting = gameFor(2, { turn: 1 });
  assert.equal(play([activate()], waiting), waiting);
});

test('the keyboard is inert when it is not this player’s turn', () => {
  const waiting = gameFor(2, { turn: 1 });

  assert.equal(isMyTurn(waiting), false);
  assert.equal(play([move('down'), move('right'), move('up')], waiting), waiting);
});

test('the card says whose turn it is', () => {
  assert.equal(statusNotice(gameFor(1, { turn: 1 })), YOUR_TURN);
  assert.equal(statusNotice(gameFor(1, { turn: 2 })), PARTNER_TURN);
  assert.equal(statusNotice(gameFor(2, { turn: 2 })), YOUR_TURN);
  assert.equal(statusNotice(gameFor(2, { turn: 1 })), PARTNER_TURN);
});

test('the wrong-guess count advances only on wrong guesses', () => {
  assert.equal(wrongGuesses(gameFor(1)), 0);
  assert.equal(wrongGuesses(guess(gameFor(1), 'P')), 0);
  assert.equal(wrongGuesses(guess(gameFor(1), 'Z')), 1);
  assert.equal(wrongGuesses(gameFor(1, { guessed: ['Z', 'Q', 'P'] })), 2);
});

test('there is nothing wrong yet before a room has arrived', () => {
  assert.equal(wrongGuesses(play([])), 0);
  assert.deepEqual(guessedLetters(play([])), []);
});

test('a guess publishes the guess list and the turn and nothing else', () => {
  // Only what changed. Writing the whole room would send this client's copy of
  // the presence flags back over the partner's, which may have moved since.
  const after = guess(gameFor(1), 'P');

  assert.deepEqual(after.outbox, { guessed: ['P'], turn: 2 });
  assert.equal('players' in after.outbox, false);
  assert.equal('word' in after.outbox, false);
});

test('moving the cursor publishes nothing', () => {
  assert.equal(play([move('down'), move('right')], gameFor(1)).outbox, null);
});

// --- letters that are out of play ------------------------------------------

test('the cursor skips a letter that has already been guessed', () => {
  assert.equal(focusedLetter(play([move('right')], gameFor(1, { guessed: ['B'] }))), 'C');
});

test('the cursor skips guessed letters in every direction', () => {
  // A guessed key would do nothing if it were pressed, so the cursor never
  // stops on one — in either axis, including over the wrap.
  const state = gameFor(1, { guessed: ['B', 'F', 'G', 'M', 'Y'] });

  assert.equal(focusedLetter(play([move('right')], state)), 'C');
  assert.equal(focusedLetter(play([move('left')], state)), 'E');
  assert.equal(focusedLetter(play([move('down')], state)), 'S');
  assert.equal(focusedLetter(play([move('up')], state)), 'S');
});

test('the cursor steps off the letter this player has just guessed', () => {
  assert.equal(focusedLetter(guess(gameFor(1), 'A')), 'B');
});

test('the cursor steps off a letter the other player has just guessed', () => {
  const waiting = gameFor(1, { turn: 2 });
  const guessed = play([hydrate(gameOf('PLANET', ['A'], 1))], waiting);

  assert.equal(focusedLetter(waiting), 'A');
  assert.equal(focusedLetter(guessed), 'B');
});

// --- winning and losing ----------------------------------------------------

test('a word with every letter guessed is won', () => {
  assert.equal(gameStatus(gameFor(1, { guessed: [...'PLANET'] })), 'won');
});

test('one letter short of the word is still a game', () => {
  assert.equal(gameStatus(gameFor(1, { guessed: [...'PLANE'] })), 'playing');
});

test('revealing the final letter wins the game', () => {
  assert.equal(gameStatus(guess(gameFor(1, { guessed: [...'PLANE'] }), 'T')), 'won');
});

test('a repeated letter is guessed once and counts for all of its places', () => {
  // BANANA is won on three letters, not six. A win asks whether the word is
  // fully revealed, which is what the players are looking at, rather than
  // counting how many letters have been guessed.
  const won = guess(gameFor(1, { word: 'BANANA', guessed: ['B', 'A'] }), 'N');
  assert.equal(gameStatus(won), 'won');
  assert.equal(maskedWord(won), 'BANANA');
});

test('five wrong guesses is not yet a loss', () => {
  const nearly = gameFor(1, { guessed: ['B', 'C', 'D', 'F', 'G'] });
  assert.equal(wrongGuesses(nearly), 5);
  assert.equal(gameStatus(nearly), 'playing');
});

test('the sixth wrong guess loses the game', () => {
  const lost = guess(gameFor(1, { guessed: ['B', 'C', 'F', 'G', 'H'] }), 'D');
  assert.equal(wrongGuesses(lost), MAX_WRONG);
  assert.equal(gameStatus(lost), 'lost');
});

test('the gallows has one part for every wrong guess and no more than six', () => {
  assert.equal(MAX_WRONG, 6);
  assert.equal(wrongGuesses(gameFor(1, { guessed: ['B', 'P', 'C'] })), 2);
});

test('right guesses never lose the game however many there are', () => {
  const long = gameFor(1, { word: 'MOUNTAIN', guessed: [...'MOUNTA'] });
  assert.equal(gameStatus(long), 'playing');
  assert.equal(wrongGuesses(long), 0);
});

test('a loss reveals the whole word', () => {
  // The players have earned finding out what they were missing.
  const lost = gameFor(1, { guessed: ['B', 'C', 'D', 'F', 'G', 'H'] });
  assert.equal(maskedWord(lost), 'PLANET');
});

test('a game still running reveals only what has been guessed', () => {
  assert.equal(maskedWord(gameFor(1, { guessed: ['B', 'C', 'D', 'F', 'G', 'P'] })), 'P-----');
});

test('the card says YOU WIN and YOU LOSE', () => {
  assert.equal(statusNotice(gameFor(1, { guessed: [...'PLANET'] })), YOU_WIN);
  assert.equal(statusNotice(gameFor(1, { guessed: ['B', 'C', 'D', 'F', 'G', 'H'] })), YOU_LOSE);
});

test('both players are given the same ending', () => {
  // The whole reason the outcome is derived rather than stored. Every ending is
  // shared: there is one word, one gallows and one result.
  for (const guessed of [[...'PLANET'], ['B', 'C', 'D', 'F', 'G', 'H']]) {
    const one = play([hydrate(gameOf('PLANET', guessed, 1))], seated(1));
    const two = play([hydrate(gameOf('PLANET', guessed, 1))], seated(2));

    assert.equal(gameStatus(one), gameStatus(two));
    assert.equal(maskedWord(one), maskedWord(two));
    assert.equal(statusNotice(one), statusNotice(two));
    assert.equal(wrongGuesses(one), wrongGuesses(two));
  }
});

test('the player whose guess ended the game sees the same thing as the other', () => {
  // The ending must not read differently to whoever brought it about, on either
  // side of the round trip that carries their guess to the other card.
  const winner = guess(gameFor(1, { guessed: [...'PLANE'] }), 'T');
  const partner = play([hydrate(published(winner))], seated(2));

  assert.equal(statusNotice(winner), YOU_WIN);
  assert.equal(statusNotice(partner), YOU_WIN);
  assert.equal(maskedWord(winner), maskedWord(partner));
});

test('the ending is not written to the room', () => {
  // A stored outcome is a second opinion about a game that must look identical
  // on both cards, and the only way two clients come to disagree about how it
  // finished.
  const lost = guess(gameFor(1, { guessed: ['B', 'C', 'F', 'G', 'H'] }), 'D');

  assert.deepEqual(lost.outbox, { guessed: ['B', 'C', 'F', 'G', 'H', 'D'], turn: 2 });
  assert.equal(JSON.stringify(lost.room).includes('status'), false);
  assert.equal(JSON.stringify(lost.room).includes('won'), false);
});

test('the keyboard is dead once the game is over', () => {
  // Both cards, whoever is nominally to move. There is nothing left to guess and
  // a cursor moving around a keyboard that will not answer invites a press.
  for (const guessed of [[...'PLANET'], ['B', 'C', 'D', 'F', 'G', 'H']]) {
    const over = gameFor(1, { guessed, turn: 1 });

    assert.equal(isMyTurn(over), false);
    assert.equal(play([move('down'), move('right')], over), over);
    assert.equal(play([activate()], over), over);
  }
});

test('a game over on one card is over on the other as well', () => {
  const lost = play([hydrate(gameOf('PLANET', ['B', 'C', 'D', 'F', 'G', 'H'], 2))], seated(2));
  assert.equal(isMyTurn(lost), false);
  assert.equal(play([activate()], lost), lost);
});

test('there is no ending before a room has arrived', () => {
  assert.equal(gameStatus(play([])), 'playing');
  assert.equal(gameStatus(play([activate()])), 'playing');
});
