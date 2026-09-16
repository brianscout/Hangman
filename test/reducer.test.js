import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYBOARD_COLUMNS,
  LETTERS,
  LOBBY_OPTIONS,
  MAX_WRONG,
  NO_CONNECTION,
  PARTNER_AWAY,
  PARTNER_LEFT,
  PARTNER_TURN,
  RECONNECTING,
  ROOM_BUSY,
  SEAT_STALE_MS,
  WAITING_FOR_PARTNER,
  YOUR_TURN,
  YOU_LOSE,
  YOU_WIN,
  awaitingPartner,
  claimSeat,
  focusedLetter,
  focusedOption,
  gameStatus,
  guessedLetters,
  initialState,
  isGameOver,
  isMyTurn,
  maskedWord,
  needsReconnect,
  normalizeRoom,
  reduce,
  rematchNotice,
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
const joined = (seat) => ({ type: 'joined', seat });
const dismissNotice = () => ({ type: 'dismissNotice' });
// The grace period running out, which the entry module sends on a timer. The
// reducer has no clock, so a test says when it expired rather than waiting.
const partnerGone = () => ({ type: 'partnerGone' });

// Every action carries a freshly drawn word, exactly as the entry module hands
// one to the reducer, because any transition may turn out to be the one that
// starts another round. Named here rather than random, so a test can say which
// word the next round is played with.
const activate = (newWord = 'MARBLE') => ({ type: 'activate', newWord });
const hydrate = (room, newWord = 'MARBLE') => ({ type: 'hydrate', room, newWord });

// A room as the database would hold it once the named seats are occupied.
const roomWith = (...seats) => ({
  players: { 1: { present: seats.includes(1) }, 2: { present: seats.includes(2) } },
});

// The same, once the room creator has published a word into it.
const gameOf = (word, guessed = [], turn = 1) => ({ word, guessed, turn, ...roomWith(1, 2) });

// The room as the database holds it once a player's client has published: the
// fields in that client's outbox, written over the room both players share.
// Hydrating the other player with this is what the network does.
//
// An outbox key may be a path. `db.update` treats `rematch/1` as a write to that
// one nested key and leaves everything beside it alone, which is how a client
// writes its own flag without carrying a stale copy of its partner's.
const published = (state) => {
  const room = structuredClone(state.room);
  for (const [path, value] of Object.entries(state.outbox ?? {})) {
    const keys = path.split('/');
    const leaf = keys.pop();
    let node = room;
    for (const key of keys) node = node[key] ??= {};
    node[leaf] = value;
  }
  return room;
};

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
// in hand, which is where every pairing test starts. The lobby opens on Play
// solo, so reaching Connect is a press down first.
const seated = (seat) => play([move('down'), activate(), joined(seat)]);

// Reaching Connect and pressing it. Spelled as a sequence rather than folded
// into `play` because several tests press it twice, and the lobby always reopens
// on Play solo.
const connect = () => [move('down'), activate()];

// A solo game, already on the play card with the named word in it. Nothing is
// claimed and nothing is published, so unlike `seated` there is no seat to hand
// in and no room to hydrate.
const alone = (word = 'MARBLE') => play([activate(word)]);

// --- the lobby ------------------------------------------------------------

test('the lobby opens with Play solo focused', () => {
  assert.equal(focusedOption(play([])), 'solo');
});

test('down moves focus to the next option', () => {
  assert.equal(focusedOption(play([move('down')])), 'connect');
});

test('up moves focus to the previous option', () => {
  const onConnect = play([move('down')]);
  assert.equal(focusedOption(play([move('up')], onConnect)), 'solo');
});

test('focus wraps at both ends of the option list', () => {
  assert.equal(focusedOption(play([move('up')])), 'exit');
  assert.equal(focusedOption(play([move('down'), move('down'), move('down')])), 'solo');
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
  assert.equal(play([move('up'), activate()]).screen, 'exited');
});

test('nothing responds once the app has exited', () => {
  const exited = play([move('up'), activate()]);
  assert.equal(play([move('up'), activate()], exited), exited);
});

test('the reducer does not mutate the state it is given', () => {
  const start = deepFreeze(initialState());
  reduce(start, move('down'));
  assert.equal(focusedOption(start), 'solo');
});

// --- getting into the room ------------------------------------------------

test('activating Connect shows the waiting screen', () => {
  assert.equal(play([...connect()]).screen, 'waiting');
});

test('the waiting screen is shown before a seat has been claimed', () => {
  // The join takes a round trip. If the card sat on the lobby until it finished,
  // that round trip would look like a missed keypress.
  assert.equal(play([...connect()]).seat, null);
});

test('the waiting screen wants a seat in the room and the lobby does not', () => {
  assert.equal(wantsRoom(play([...connect()])), true);
  assert.equal(wantsRoom(play([])), false);
});

test('leaving the waiting screen returns to the lobby', () => {
  assert.equal(play([...connect(), activate()]).screen, 'lobby');
});

test('leaving the waiting screen gives up the seat', () => {
  // The entry module releases the seat by reconciling against wantsRoom, so
  // dropping it here is what clears this player's presence in the room.
  const backInLobby = play([...connect(), joined(1), activate()]);
  assert.equal(wantsRoom(backInLobby), false);
  assert.equal(backInLobby.seat, null);
});

test('leaving and connecting again starts a fresh wait', () => {
  const again = play([...connect(), joined(1), activate(), ...connect()]);
  assert.equal(again.screen, 'waiting');
  assert.equal(again.room, null);
});

test('moving does nothing on the waiting screen', () => {
  const waiting = play([...connect()]);
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
  const roomFirst = play([...connect(), hydrate(roomWith(1, 2)), joined(2)]);
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
  const rejected = play([{ type: 'joinRejected' }], play([...connect()]));
  assert.equal(rejected.screen, 'notice');
  assert.equal(rejected.notice, ROOM_BUSY);
});

test('failing to reach the room reports it rather than waiting forever', () => {
  const failed = play([{ type: 'joinFailed' }], play([...connect()]));
  assert.equal(failed.screen, 'notice');
  assert.equal(failed.notice, NO_CONNECTION);
});

// --- losing the other player ----------------------------------------------

test('losing the partner shows PARTNER LEFT once the grace period is up', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1)), partnerGone()], playing);

  assert.equal(abandoned.screen, 'notice');
  assert.equal(abandoned.notice, PARTNER_LEFT);
});

test('PARTNER LEFT returns to the lobby', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const returned = play([hydrate(roomWith(1)), partnerGone(), dismissNotice()], playing);

  assert.equal(returned.screen, 'lobby');
  assert.deepEqual(returned, initialState());
});

test('losing the partner gives up this seat as well', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const waiting = play([hydrate(roomWith(1))], playing);

  // The seat is kept while the game is still hoping the partner comes back.
  // Giving it up then would clear this client's own presence and take the other
  // player out too, which is the cascade the grace period exists to stop.
  assert.equal(wantsRoom(waiting), true);
  assert.equal(wantsRoom(play([partnerGone()], waiting)), false);
});

test('a room emptied of both players is still a partner leaving', () => {
  // A snapshot can arrive after this client's own flag has gone too. What
  // matters is the partner, not the count.
  const playing = play([hydrate(roomWith(1, 2))], seated(2));
  assert.equal(play([hydrate(null), partnerGone()], playing).notice, PARTNER_LEFT);
});

test('a partner going missing does not end the game on its own', () => {
  // A dropped socket and a player walking away look identical from here. Ending
  // the game on the first missing flag meant one blip on one headset took both
  // players out: the partner bailed to the lobby and dropped their own presence
  // on the way, so neither of them had anybody left to play.
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const waiting = play([hydrate(roomWith(1))], playing);

  assert.equal(waiting.screen, 'playing');
  assert.equal(waiting.partnerAbsent, true);
  assert.equal(awaitingPartner(waiting), true);
});

test('the card says it is waiting rather than naming a turn', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(statusNotice(play([hydrate(roomWith(1))], playing)), PARTNER_AWAY);
});

test('a partner who comes back carries on where they were', () => {
  const playing = play([hydrate(gameOf('PLANET', ['P']))], seated(1));
  const waiting = play([hydrate({ ...gameOf('PLANET', ['P']), ...roomWith(1) })], playing);
  const back = play([hydrate(gameOf('PLANET', ['P']))], waiting);

  assert.equal(back.screen, 'playing');
  assert.equal(back.partnerAbsent, false);
  assert.equal(awaitingPartner(back), false);
  // The round is untouched: a blip is not a reason to lose the guesses.
  assert.equal(maskedWord(back), 'P-----');
});

test('the clock is not left running once the partner is back', () => {
  // The entry module reconciles its timer against this, so a stale true would
  // end a game nobody had left.
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(awaitingPartner(play([hydrate(roomWith(1, 2))], playing)), false);
});

test('the grace period expiring is ignored if the partner is already back', () => {
  // The timer and the snapshot race. A partner who returned first has cleared
  // the flag, and a late expiry must not end a game that recovered.
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const recovered = play([hydrate(roomWith(1)), hydrate(roomWith(1, 2))], playing);

  assert.equal(play([partnerGone()], recovered), recovered);
});

test('a solo game is never waiting on a partner', () => {
  assert.equal(awaitingPartner(alone()), false);
  assert.equal(statusNotice(alone()), '');
});

test('a late room snapshot cannot revive a finished game', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1)), partnerGone()], playing);

  assert.equal(play([hydrate(roomWith(1, 2))], abandoned), abandoned);
});

test('keypresses do nothing on a notice screen', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const abandoned = play([hydrate(roomWith(1)), partnerGone()], playing);

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
  assert.equal(maskedWord(play([...connect()])), '');
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
  // Both cards, whoever is nominally to move. There is nothing left to guess, and
  // the presses that moved the cursor around belong to the two options by then.
  for (const guessed of [[...'PLANET'], ['B', 'C', 'D', 'F', 'G', 'H']]) {
    const over = gameFor(1, { guessed, turn: 1 });

    assert.equal(isMyTurn(over), false);
    assert.equal(focusedLetter(play([move('down'), move('right')], over)), focusedLetter(over));
    assert.deepEqual(guessedLetters(play([activate()], over)), guessed);
  }
});

test('a game over on one card is over on the other as well', () => {
  const lost = play([hydrate(gameOf('PLANET', ['B', 'C', 'D', 'F', 'G', 'H'], 2))], seated(2));

  assert.equal(isMyTurn(lost), false);
  assert.equal(gameStatus(play([activate()], lost)), 'lost');
});

test('there is no ending before a room has arrived', () => {
  assert.equal(gameStatus(play([])), 'playing');
  assert.equal(gameStatus(play([...connect()])), 'playing');
});

// --- playing again ---------------------------------------------------------

// A room in which the named seats have asked for another round. The flags live
// beside the word and the guesses because they are a fact about the room both
// players share, not about either client.
const withRematch = (room, ...seats) => ({
  ...room,
  rematch: { 1: seats.includes(1), 2: seats.includes(2) },
});

// A finished game — the word fully revealed — seen from the seat named, with
// whichever players have already accepted marked as having done so. Every test
// below starts here: the two options are only on the card once the game is over.
const ended = (seat, ...accepted) =>
  play([hydrate(withRematch(gameOf('PLANET', [...'PLANET'], 1), ...accepted))], seated(seat));

// The two presses the end of a game understands. Focus opens on Play again, so
// leaving is one press further down.
const acceptRematch = (state, word) => play([activate(word)], state);
const exitToLobby = (state) => play([move('down'), activate()], state);

test('a finished game puts the two options on the card in place of the keyboard', () => {
  const over = ended(1);

  assert.equal(isGameOver(over), true);
  assert.equal(focusedOption(over), 'rematch');
});

test('both players are offered the same two options', () => {
  assert.equal(isGameOver(ended(2)), true);
  assert.equal(focusedOption(ended(2)), focusedOption(ended(1)));
});

test('the keyboard keeps the card for as long as the game is running', () => {
  assert.equal(isGameOver(gameFor(1)), false);
  assert.equal(focusedOption(gameFor(1)), null);
});

test('down and up move between the two options and wrap at both ends', () => {
  assert.equal(focusedOption(play([move('down')], ended(1))), 'exit-to-lobby');
  assert.equal(focusedOption(play([move('down'), move('down')], ended(1))), 'rematch');
  assert.equal(focusedOption(play([move('up')], ended(1))), 'exit-to-lobby');
});

test('left and right do nothing once the game is over', () => {
  const over = ended(1);
  assert.equal(play([move('left'), move('right')], over), over);
});

test('moving between the options publishes nothing', () => {
  assert.equal(play([move('down'), move('up')], ended(1)).outbox, null);
});

test('accepting a rematch publishes only this player’s own flag', () => {
  // The other seat's acceptance belongs to the other client, for the same reason
  // its presence flag does: this client's copy of it is only ever as fresh as the
  // last snapshot it saw.
  assert.deepEqual(acceptRematch(ended(2)).outbox, { 'rematch/2': true });
});

test('accepting a rematch alone does not start one', () => {
  const alone = acceptRematch(ended(1));

  assert.equal(isGameOver(alone), true);
  assert.equal(alone.room.word, 'PLANET');
  assert.deepEqual(guessedLetters(alone), [...'PLANET']);
});

test('a player who has accepted is shown they are waiting on their partner', () => {
  assert.equal(rematchNotice(acceptRematch(ended(1))), WAITING_FOR_PARTNER);
});

test('a player who has not accepted is shown nothing', () => {
  assert.equal(rematchNotice(ended(1)), '');
});

test('a player whose partner has accepted is shown nothing either', () => {
  // The wait belongs to whoever accepted. The other player is being asked for an
  // answer, not for patience.
  assert.equal(rematchNotice(ended(1, 2)), '');
});

test('the waiting line is gone once the round has started', () => {
  assert.equal(rematchNotice(acceptRematch(ended(1, 2))), '');
});

test('a rematch begins only once both players have accepted', () => {
  const both = acceptRematch(ended(1, 2));

  assert.equal(isGameOver(both), false);
  assert.equal(gameStatus(both), 'playing');
  assert.equal(both.room.word, 'MARBLE');
});

test('a rematch is played with a new word', () => {
  assert.equal(acceptRematch(ended(1, 2), 'CASTLE').room.word, 'CASTLE');
});

test('a rematch clears the round that came before it entirely', () => {
  const next = acceptRematch(ended(1, 2));

  assert.deepEqual(guessedLetters(next), []);
  assert.equal(wrongGuesses(next), 0);
  assert.equal(maskedWord(next), '------');
  assert.equal(next.room.turn, 1);
  assert.equal(focusedLetter(next), 'A');
  assert.equal(statusNotice(next), YOUR_TURN);
});

test('the acceptance flags are cleared when the new round starts', () => {
  const next = acceptRematch(ended(1, 2));

  assert.deepEqual(next.room.rematch, { 1: false, 2: false });
  assert.deepEqual(next.outbox.rematch, { 1: false, 2: false });
});

test('the new round is published without touching the presence flags', () => {
  const next = acceptRematch(ended(1, 2));

  assert.deepEqual(next.outbox, {
    word: 'MARBLE',
    guessed: [],
    turn: 1,
    rematch: { 1: false, 2: false },
  });
  assert.equal('players' in next.outbox, false);
});

test('the room is reset by seat one, whichever player accepted last', () => {
  // Two clients resetting the same room would each publish a word they drew
  // independently, and the players would watch the word change under them.
  const second = acceptRematch(ended(2, 1));

  assert.equal(isGameOver(second), true);
  assert.deepEqual(second.outbox, { 'rematch/2': true });
});

test('seat one starts the round when the second acceptance reaches it', () => {
  const waiting = acceptRematch(ended(1));
  const started = play([hydrate(withRematch(published(waiting), 1, 2))], waiting);

  assert.equal(gameStatus(started), 'playing');
  assert.equal(started.room.word, 'MARBLE');
});

test('the new round reaches the other player as an ordinary room change', () => {
  const started = acceptRematch(ended(1, 2));
  const partner = play([hydrate(published(started))], ended(2, 1, 2));

  assert.equal(gameStatus(partner), 'playing');
  assert.equal(maskedWord(partner), '------');
  assert.equal(focusedOption(partner), null);
  assert.equal(isMyTurn(partner), false);
});

test('a rematch cannot start while the game is still running', () => {
  // Nothing in the app puts both flags on a live game, but a room can hold any
  // pair of values, and a reset here would take the word out from under two
  // players in the middle of guessing it.
  const live = play([hydrate(withRematch(gameOf('PLANET', ['P'], 1), 1, 2))], seated(1));

  assert.equal(live.room.word, 'PLANET');
  assert.equal(live.outbox, null);
});

test('pressing Play again twice changes nothing', () => {
  const accepted = acceptRematch(ended(1));
  assert.equal(play([activate()], accepted), accepted);
});

// Plays one letter for whichever of the two clients is to move, and hands the
// guess to the other as the room the network would carry between them.
function guessBetween(pair, letter) {
  const oneMoves = isMyTurn(pair[0]);
  const [mover, other] = oneMoves ? pair : [pair[1], pair[0]];

  const played = guess(mover, letter);
  const caught = play([hydrate(published(played))], other);
  return oneMoves ? [played, caught] : [caught, played];
}

// Six wrong guesses between the two of them, which is the shortest ending that
// does not depend on which word the round was played with. None of these letters
// is in any of the words these tests use.
const loseRound = (pair) => ['Q', 'J', 'X', 'Z', 'V', 'W'].reduce(guessBetween, pair);

test('several rematches in a row leave the room no worse than the first', () => {
  let one = gameFor(1, { word: 'BEACH' });
  let two = play([hydrate(gameOf('BEACH', [], 1))], seated(2));

  for (const word of ['MARBLE', 'CASTLE', 'GUITAR']) {
    [one, two] = loseRound([one, two]);
    assert.equal(gameStatus(one), 'lost');
    assert.equal(gameStatus(two), 'lost');

    // Seat two accepts first, so every round here is started by that acceptance
    // reaching seat one — the longer of the two paths through the handshake. The
    // wander over the options on the way is there to leave focus somewhere the
    // next round has to put back.
    two = play([move('down'), move('up'), activate(word)], two);
    one = play([hydrate(published(two)), activate(word)], one);
    two = play([hydrate(published(one))], two);

    for (const player of [one, two]) {
      assert.equal(gameStatus(player), 'playing');
      assert.equal(player.room.word, word);
      assert.deepEqual(guessedLetters(player), []);
      assert.deepEqual(player.room.rematch, { 1: false, 2: false });
      assert.equal(focusedLetter(player), 'A');
      assert.equal(player.room.players[1].present, true);
      assert.equal(player.room.players[2].present, true);
    }
    assert.equal(isMyTurn(one), true);
    assert.equal(isMyTurn(two), false);
  }
});

test('the options open on Play again again in every later round', () => {
  // Focus is this client's own, so nothing in the room can put it back. A player
  // who left it on Exit last time must not find it there when the next round
  // ends.
  let one = gameFor(1, { word: 'BEACH' });
  let two = play([hydrate(gameOf('BEACH', [], 1))], seated(2));

  [one, two] = loseRound([one, two]);
  // Accept, then wander onto Exit while waiting on the other player. That is the
  // only way focus is anywhere but Play again when the next round arrives —
  // pressing Enter on Exit is what leaving is.
  two = play([activate('CASTLE'), move('down')], two);
  one = play([hydrate(published(two)), activate('CASTLE')], one);
  two = play([hydrate(published(one))], two);

  [one, two] = loseRound([one, two]);
  assert.equal(focusedOption(two), 'rematch');
});

test('Exit to Lobby returns that player to the lobby', () => {
  const left = exitToLobby(ended(1));

  assert.equal(left.screen, 'lobby');
  assert.deepEqual(left, initialState());
});

test('Exit to Lobby gives up the seat, which is what releases the partner', () => {
  // The entry module reconciles the seat against wantsRoom, so dropping it here
  // is what clears this player's presence — and a cleared presence flag is the
  // one thing that reaches the other card as their partner going.
  const left = exitToLobby(ended(1, 1));

  assert.equal(wantsRoom(left), false);
  assert.equal(left.seat, null);

  const partner = play(
    [hydrate({ word: 'PLANET', guessed: [...'PLANET'], turn: 1, ...roomWith(2) }), partnerGone()],
    ended(2, 1),
  );

  assert.equal(partner.screen, 'notice');
  assert.equal(partner.notice, PARTNER_LEFT);
  assert.equal(wantsRoom(partner), false);
});

test('a player who has accepted a rematch can still leave', () => {
  assert.deepEqual(exitToLobby(acceptRematch(ended(2))), initialState());
});

test('a seat carries no acceptance from whoever sat in it last', () => {
  // A player who exits leaves their flag behind them in a room somebody else may
  // walk into. The next occupant of that seat has agreed to nothing.
  const abandoned = {
    word: 'MARBLE',
    guessed: ['M'],
    turn: 1,
    rematch: { 1: true, 2: false },
    ...roomWith(2),
  };

  assert.deepEqual(claimSeat(abandoned, 'PLANET').room.rematch, { 1: false, 2: false });
});

// --- playing alone --------------------------------------------------------

// A solo game is the same game from seat one against a room nobody else can
// see. These assert the four rules that read the flag, and that everything the
// paired game derives is left alone by it.

const guessAll = (state, letters) => [...letters].reduce(guess, state);

// Six letters of MARBLE that are not in it, which is exactly a full gallows.
const SIX_WRONG = 'CDFGHJ';

test('Play solo starts a game without waiting for anybody', () => {
  assert.equal(alone().screen, 'playing');
});

test('a solo game starts with the word it was given', () => {
  assert.equal(maskedWord(alone('PLANET')), '------');
});

test('a solo game never claims a seat in the room', () => {
  // The room is one fixed path shared by everyone. A solo player holding a seat
  // in it would take one of the two that a pair are trying to play each other in.
  assert.equal(wantsRoom(alone()), false);
});

test('a solo game publishes nothing', () => {
  assert.equal(guess(alone(), 'M').outbox, null);
});

test('the keyboard belongs to the solo player', () => {
  assert.equal(isMyTurn(alone()), true);
});

test('the turn never leaves the solo player', () => {
  // The turn is stored as a seat, and handing it to an empty seat two would lock
  // the keyboard against the only person holding it.
  assert.equal(isMyTurn(guess(alone(), 'M')), true);
  assert.equal(isMyTurn(guessAll(alone(), 'MAR')), true);
});

test('a solo player can guess twice in a row', () => {
  assert.equal(maskedWord(guessAll(alone(), 'MA')), 'MA----');
});

test('the line that names the turn says nothing in a solo game', () => {
  assert.equal(statusNotice(alone()), '');
});

test('a solo game is never told its partner left', () => {
  // Both presence flags in a solo room are false, which in a paired game is the
  // partner having vanished. Pairing has to stay out of it entirely.
  assert.equal(guessAll(alone(), 'MAR').screen, 'playing');
});

test('a solo game can be won', () => {
  // The letters of MARBLE in alphabetical order, because `reach` only ever walks
  // the cursor forwards and cannot come back for an earlier one.
  const won = guessAll(alone(), 'ABELMR');
  assert.equal(gameStatus(won), 'won');
  assert.equal(statusNotice(won), YOU_WIN);
});

test('a solo game can be lost, and gives the word up', () => {
  const lost = guessAll(alone(), SIX_WRONG);
  assert.equal(gameStatus(lost), 'lost');
  assert.equal(statusNotice(lost), YOU_LOSE);
  assert.equal(maskedWord(lost), 'MARBLE');
  assert.equal(wrongGuesses(lost), MAX_WRONG);
});

test('a finished solo game hands the card to the two options', () => {
  assert.equal(isGameOver(guessAll(alone(), SIX_WRONG)), true);
  assert.equal(focusedOption(guessAll(alone(), SIX_WRONG)), 'rematch');
});

test('a solo rematch starts on the press, with nobody to wait for', () => {
  const again = play([activate('PLANET')], guessAll(alone(), SIX_WRONG));
  assert.equal(gameStatus(again), 'playing');
  assert.equal(maskedWord(again), '------');
});

test('a solo rematch clears the round before it', () => {
  const again = play([activate('PLANET')], guessAll(alone(), SIX_WRONG));
  assert.deepEqual(guessedLetters(again), []);
  assert.equal(wrongGuesses(again), 0);
});

test('a solo player is never asked to wait for a partner to accept', () => {
  assert.equal(rematchNotice(guessAll(alone(), SIX_WRONG)), '');
});

test('leaving a solo game returns to the lobby', () => {
  const over = guessAll(alone(), SIX_WRONG);
  const left = play([move('down'), activate()], over);
  assert.equal(left.screen, 'lobby');
});

test('leaving a solo game puts the two-player game back within reach', () => {
  // The flag has to come off on the way out, or Connect would start another
  // solo game and the room would never be joined again.
  const over = guessAll(alone(), SIX_WRONG);
  const left = play([move('down'), activate()], over);
  assert.equal(left.solo, false);
  assert.equal(play([...connect()], left).screen, 'waiting');
});

test('a paired game is not a solo one', () => {
  assert.equal(gameFor(1).solo, false);
  assert.equal(statusNotice(gameFor(1)), YOUR_TURN);
});

// --- whose connection is it -----------------------------------------------

// A dropped socket at this end and a partner who vanished at the other both show
// up as a missing presence flag. They need completely different fixes, so the
// card has to say which one it is.

const connection = (connected) => ({ type: 'connection', connected });

test('a game assumes it is connected until told otherwise', () => {
  assert.equal(initialState().connected, true);
});

test('losing this end of the connection says so, rather than blaming the partner', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(statusNotice(play([connection(false)], playing)), RECONNECTING);
});

test('this end being down outranks the partner being missing', () => {
  // Nothing known about the partner is current during an outage at this end, so
  // pointing at them would send the player looking at the wrong headset.
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const dark = play([hydrate(roomWith(1)), connection(false)], playing);

  assert.equal(statusNotice(dark), RECONNECTING);
});

test('the grace clock does not run while this end is offline', () => {
  // The partner cannot be seen coming back during an outage here, and ending the
  // game over a silence they had no part in would be this client's fault.
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const dark = play([hydrate(roomWith(1)), connection(false)], playing);

  assert.equal(awaitingPartner(dark), false);
  assert.equal(awaitingPartner(play([connection(true)], dark)), true);
});

test('the connection is worth kicking only while a game wants the room', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));

  assert.equal(needsReconnect(play([connection(false)], playing)), true);
  assert.equal(needsReconnect(playing), false);
  // Nothing to kick from the lobby, and nothing to kick in a solo game.
  assert.equal(needsReconnect(play([connection(false)])), false);
  assert.equal(needsReconnect(play([connection(false)], alone())), false);
});

test('the connection is tracked without disturbing the screen', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  const dark = play([connection(false)], playing);

  assert.equal(dark.screen, 'playing');
  assert.equal(guessedLetters(dark).length, guessedLetters(playing).length);
});

test('an unchanged connection changes nothing', () => {
  const playing = play([hydrate(roomWith(1, 2))], seated(1));
  assert.equal(play([connection(true)], playing), playing);
});

// --- seats held by clients that no longer exist ---------------------------

// A presence flag is cleared by the database's disconnect hook, which the server
// only fires once it notices the socket is gone. For a client that was killed or
// frozen that can take minutes, and until then the seat reads as occupied — so a
// player who was cut off mid-game was told GAME IN PROGRESS by their own
// abandoned seat. A seat is now held by a client still saying so.

const NOW = 1_700_000_000_000;
const stale = NOW - SEAT_STALE_MS - 1;
const fresh = NOW - 1000;

// A room whose seats carry heartbeats, as the database would hold it.
const roomSeen = (one, two) => ({
  players: {
    1: one === null ? { present: false } : { present: true, seen: one },
    2: two === null ? { present: false } : { present: true, seen: two },
  },
});

test('a seat whose heartbeat has stopped can be taken', () => {
  assert.equal(claimSeat(roomSeen(stale, fresh), 'PLANET', NOW).seat, 1);
});

test('a seat that is still beating cannot be taken', () => {
  // Both held, so there is nowhere to sit and the room reports itself full.
  assert.equal(claimSeat(roomSeen(fresh, fresh), 'PLANET', NOW).seat, null);
});

test('a room of nothing but abandoned seats is reset, not joined', () => {
  const claim = claimSeat(roomSeen(stale, stale), 'PLANET', NOW);

  assert.equal(claim.seat, 1);
  // Reset rather than adopted: the previous game's word and guesses would
  // otherwise start this one already half played.
  assert.equal(claim.room.word, 'PLANET');
  assert.deepEqual(claim.room.guessed, []);
});

test('taking a seat stamps it, so it is never held without a heartbeat', () => {
  assert.equal(claimSeat(roomSeen(null, null), 'PLANET', NOW).room.players[1].seen, NOW);
});

test('a seat with no heartbeat at all counts as held', () => {
  // If the database rules ever reject the heartbeat field, every seat reads as
  // unstamped. Treating that as empty would evict both players from every game,
  // continuously; treating it as held degrades to the behaviour before
  // heartbeats existed. It also leaves rooms written by an older build alone.
  const unstamped = { players: { 1: { present: true }, 2: { present: true } } };
  assert.equal(claimSeat(unstamped, 'PLANET', NOW).seat, null);
});

test('a partner whose heartbeat stops counts as gone, flag or no flag', () => {
  // A frozen client holds its socket open, so the server never fires the hook
  // that would clear the flag. Without reading the heartbeat, the game would
  // wait forever on a turn belonging to somebody who is not coming back.
  const playing = play([hydrate(roomSeen(fresh, fresh), 'MARBLE')], seated(1));
  const silent = play(
    [{ type: 'hydrate', room: roomSeen(fresh, stale), newWord: 'MARBLE', now: NOW }],
    playing,
  );

  assert.equal(silent.partnerAbsent, true);
  assert.equal(statusNotice(silent), PARTNER_AWAY);
});

test('a partner still beating is still there', () => {
  const playing = play(
    [{ type: 'hydrate', room: roomSeen(fresh, fresh), newWord: 'MARBLE', now: NOW }],
    seated(1),
  );

  assert.equal(playing.screen, 'playing');
  assert.equal(playing.partnerAbsent, false);
});

test('a heartbeat is carried through the room untouched', () => {
  assert.equal(normalizeRoom(roomSeen(fresh, null)).players[1].seen, fresh);
  // Absent rather than defaulted to a number: "no heartbeat" and "a heartbeat
  // from long ago" mean different things and only one of them frees the seat.
  assert.equal(normalizeRoom(roomSeen(null, null)).players[1].seen, null);
});
