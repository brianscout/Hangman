// The only module in the app that decides anything. Every state transition and
// every derived value lives here, which is what makes the game testable without
// putting the glasses on: a test drives this with the events a player would
// produce and asserts on the result.
//
// Nothing in here touches the DOM, the network or the clock, and nothing in here
// mutates. A transition that changes nothing returns the state object it was
// given, so callers can skip work with a reference check.
//
// Remote room snapshots arrive here as a `hydrate` action rather than being
// consumed where they land. That is what keeps the network out of the test
// surface: a two-player game can be played out inside a single test by
// dispatching one player's actions and the other player's room as a hydrate.

// The lobby's options, in the order they appear on the card. Focus is stored as
// an index into this list rather than as a label, so movement is arithmetic.
export const LOBBY_OPTIONS = ['connect', 'exit'];

// The letter keyboard, as data. Every letter of the alphabet, laid out six to a
// row, which puts the whole thing in five rows and no more than three presses
// from any letter to any other in either axis. Focus is an index into this list
// rather than a letter, so movement is arithmetic.
export const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
export const KEYBOARD_COLUMNS = 6;

// Twenty-six letters do not fill a 6-wide grid, so the last row is short: Y and
// Z and nothing else. That ragged edge is the only awkward part of moving around
// this grid, and every rule below that mentions a row length is there for it.
const KEYBOARD_ROWS = Math.ceil(LETTERS.length / KEYBOARD_COLUMNS);

// Headlines for the brief message screen. Every one of them is a dead end that
// drops back to the lobby on its own, because none of them is something the
// player can do anything about from where they are standing.
export const PARTNER_LEFT = 'PARTNER LEFT';
export const ROOM_BUSY = 'GAME IN PROGRESS';
export const NO_CONNECTION = 'NO CONNECTION';

// The one line on the play card that differs between the two players. Whose turn
// it is decides whether a keypress does anything at all, so the card says it
// rather than leaving a player to discover it by pressing Enter and seeing
// nothing happen.
export const YOUR_TURN = 'YOUR TURN';
export const PARTNER_TURN = "PARTNER'S TURN";

export function initialState() {
  // The keyboard cursor is local to this client and is never published to the
  // room. Publishing it would mean a database write on every cursor move, and
  // neither player needs to see where the other one is hovering.
  //
  // `outbox` is the opposite: the fields this client owes the room after its
  // last action, for the entry module to hand to the network. It is a value in
  // the state rather than a call out of the reducer because the reducer decides
  // and never does, and because a test can then read what would have been sent.
  return {
    screen: 'lobby',
    lobbyFocus: 0,
    seat: null,
    room: null,
    notice: null,
    cursor: 0,
    outbox: null,
  };
}

export function reduce(state, action) {
  switch (state.screen) {
    case 'lobby':
      return reduceLobby(state, action);
    case 'waiting':
      return reduceWaiting(state, action);
    case 'playing':
      return reducePlaying(state, action);
    case 'notice':
      return reduceNotice(state, action);
    default:
      // 'exited' is terminal. The app is on its way out and nothing a late
      // keypress says should bring it back.
      return state;
  }
}

function reduceLobby(state, action) {
  switch (action.type) {
    case 'move':
      return moveLobbyFocus(state, action.direction);
    case 'activate':
      return focusedOption(state) === 'exit'
        ? { ...state, screen: 'exited' }
        : { ...state, screen: 'waiting' };
    default:
      return state;
  }
}

// The waiting screen goes up the instant Connect is pressed, before the room has
// been reached, because reaching it is the part that takes time and an
// unexplained pause is exactly what a player reads as a hang.
function reduceWaiting(state, action) {
  switch (action.type) {
    case 'activate':
      // The one option on this screen is the way out. A player whose friend never
      // shows up must not be stuck here.
      return initialState();
    case 'joined':
      return settle({ ...state, seat: action.seat });
    case 'hydrate':
      return settle({ ...state, room: normalizeRoom(action.room) });
    case 'joinRejected':
      return { ...state, screen: 'notice', notice: ROOM_BUSY };
    case 'joinFailed':
      return { ...state, screen: 'notice', notice: NO_CONNECTION };
    default:
      return state;
  }
}

// The game itself. The keyboard belongs to whichever player the room says is to
// move, so both presses it understands are inert on the other card — the whole
// keyboard is locked rather than Enter alone, because a cursor moving around a
// keyboard that cannot be used is an invitation to press it.
function reducePlaying(state, action) {
  switch (action.type) {
    case 'move':
      return isMyTurn(state) ? moveCursor(state, action.direction) : state;
    case 'activate':
      return guess(state);
    case 'hydrate':
      return settle({ ...state, room: normalizeRoom(action.room) });
    default:
      return state;
  }
}

// A guess, which is the only thing in the game that changes the room. It is
// applied here first and published second: the card must answer the press now,
// and the round trip to the database is not now.
//
// Only one player may guess at a time, so two clients writing the room at once
// is not a race this has to survive — the turn is what serialises them. The
// second player's guess cannot be made until the first player's has arrived,
// because until it does it is not their turn.
function guess(state) {
  if (!isMyTurn(state)) return state;

  const letter = focusedLetter(state);
  // The cursor does not rest on a spent key, so this can only fire once every
  // letter has been guessed. A duplicate in the list would be a lie about how
  // the game went, and both cards derive what they show from that list.
  if (state.room.guessed.includes(letter)) return state;

  const guessed = [...state.room.guessed, letter];
  const turn = partnerSeat(state.seat);

  // Only the two keys that changed are published. Sending the whole room would
  // put this client's copy of the presence flags back over the partner's, and
  // the partner's are the one part of the room this client does not own.
  return placeCursor({
    ...state,
    room: { ...state.room, guessed, turn },
    outbox: { guessed, turn },
  });
}

function reduceNotice(state, action) {
  // Dismissal is on a timer rather than on a keypress. These screens report
  // something that has already happened, and asking for an acknowledgement would
  // make a player press a button to be told they cannot play.
  return action.type === 'dismissNotice' ? initialState() : state;
}

// Everything that depends on both halves of the pairing — which seat this client
// holds and what the room says — decided in one place. A seat claim and a room
// snapshot can land in either order, so neither may own the decision alone.
function settle(state) {
  return placeCursor(pair(state));
}

function pair(state) {
  if (state.seat === null || state.room === null) return state;

  const partnerPresent = state.room.players[partnerSeat(state.seat)].present;

  // The second player's arrival starts the game on both cards. Neither player
  // presses start; each simply sees the other appear in the room.
  if (state.screen === 'waiting' && partnerPresent) return { ...state, screen: 'playing' };

  // No reconnect grace period. Quitting, crashing, a flat battery and a dead
  // network all arrive here as the same missing flag, which is the whole point of
  // maintaining presence through the database's own disconnect hook.
  if (state.screen === 'playing' && !partnerPresent) {
    return { ...state, screen: 'notice', notice: PARTNER_LEFT };
  }

  return state;
}

function moveLobbyFocus(state, direction) {
  // Up and down only. Left and right move focus *within* a row everywhere in
  // this app, and a single column of options has no row to move within, so they
  // are inert here rather than aliased onto up and down.
  const step = { up: -1, down: 1 }[direction] ?? 0;
  if (step === 0) return state;

  // Wrapping. On a two-item list, clamping would make one press of down do
  // nothing and one press of up do nothing, at opposite ends — which reads as
  // the app having missed the input.
  const count = LOBBY_OPTIONS.length;
  return { ...state, lobbyFocus: (state.lobbyFocus + step + count) % count };
}

// Which option Enter would activate on whichever screen is up. A screen with a
// single option has nowhere for focus to move, so focus is simply always on it.
export function focusedOption(state) {
  switch (state.screen) {
    case 'lobby':
      return LOBBY_OPTIONS[state.lobbyFocus];
    case 'waiting':
      return 'leave-waiting';
    default:
      return null;
  }
}

// Movement around the keyboard grid. Every edge wraps in both axes, so no
// direction is ever a dead end and no letter is more than a few presses away
// from any other.
//
// A letter that has already been guessed is out of play, and the cursor does not
// stop on one: a press is repeated in the same direction until it lands
// somewhere that would do something. Skipping is that rule applied to movement,
// and it is why a player cannot land on a key whose press would be ignored.
function moveCursor(state, direction) {
  const guessed = guessedLetters(state);

  let cursor = state.cursor;
  for (let presses = 0; presses < LETTERS.length; presses += 1) {
    const next = step(cursor, direction);
    // An unknown direction, or a sweep that has come all the way back to where
    // it started because everything else it passed is spent.
    if (next === null || next === state.cursor) return state;

    cursor = next;
    if (!guessed.includes(LETTERS[cursor])) return atLetter(state, cursor);
  }
  return state;
}

// One press, before anything is skipped.
function step(cursor, direction) {
  const row = Math.floor(cursor / KEYBOARD_COLUMNS);
  const column = cursor % KEYBOARD_COLUMNS;

  const sideways = { left: -1, right: 1 }[direction];
  if (sideways !== undefined) {
    // Left and right stay in their row rather than running on into the next one.
    // A row is a place on the card, and a cursor that slid between rows on a
    // horizontal press would be somewhere a player was not looking.
    const width = rowWidth(row);
    return row * KEYBOARD_COLUMNS + ((column + sideways + width) % width);
  }

  const vertically = { up: -1, down: 1 }[direction];
  if (vertically === undefined) return null;

  const nextRow = (row + vertically + KEYBOARD_ROWS) % KEYBOARD_ROWS;

  // Landing in the short last row from a column it does not have takes the
  // nearest letter it does. The alternative is a press that appears to do
  // nothing, which reads as the app having missed the input.
  const nextColumn = Math.min(column, rowWidth(nextRow) - 1);
  return nextRow * KEYBOARD_COLUMNS + nextColumn;
}

// Moves the cursor off a letter that has just gone out of play, whichever player
// guessed it. Without this the cursor would sit on a key whose press does
// nothing, which reads as the app having stopped listening.
//
// Forward through the alphabet, because that is the direction the rest of the
// keyboard is read in and the nearest letter still worth pressing is the one the
// eye goes to next.
function placeCursor(state) {
  const guessed = guessedLetters(state);
  if (!guessed.includes(LETTERS[state.cursor])) return state;

  for (let ahead = 1; ahead < LETTERS.length; ahead += 1) {
    const cursor = (state.cursor + ahead) % LETTERS.length;
    if (!guessed.includes(LETTERS[cursor])) return { ...state, cursor };
  }
  // Every letter guessed. There is nowhere left to stand, and nothing left to
  // press either.
  return state;
}

function rowWidth(row) {
  return Math.min(KEYBOARD_COLUMNS, LETTERS.length - row * KEYBOARD_COLUMNS);
}

function atLetter(state, cursor) {
  return cursor === state.cursor ? state : { ...state, cursor };
}

// The letter Enter would guess. Derived rather than stored for the same reason
// the masked word is: one cursor index is the whole truth, and a second copy of
// which letter that is could disagree with it.
export function focusedLetter(state) {
  return LETTERS[state.cursor];
}

// The character standing in for a letter nobody has guessed yet. One per letter,
// so the length of the word is readable at a glance without counting anything.
const DASH = '-';

// The word as the card shows it: guessed letters in their places, a dash
// everywhere else. Derived on every render rather than stored, because the moment
// two clients each keep their own copy of how far along the word is, they can
// disagree about it — and the word is the one thing both players must be certain
// they are looking at together.
export function maskedWord(state) {
  const word = state.room?.word ?? null;
  if (word === null) return '';

  // Every occurrence of a guessed letter is revealed, not just the first. A
  // player who guesses A in BANANA has earned all three of them.
  return [...word].map((letter) => (state.room.guessed.includes(letter) ? letter : DASH)).join('');
}

// Every letter either player has guessed, right or wrong. The card dims these
// and the cursor steps over them; both of them ask this rather than the room, so
// there is one answer to what is still in play.
export function guessedLetters(state) {
  return state.room?.guessed ?? [];
}

// How much danger the players are in. Derived from the word and the guesses for
// the same reason the masked word is: a stored count is a second opinion about a
// game that must look identical on both cards.
//
// Nothing draws this yet. It is counted from here so that the gallows, when it
// arrives, has nothing to work out for itself.
export function wrongGuesses(state) {
  const word = state.room?.word ?? null;
  if (word === null) return 0;

  return guessedLetters(state).filter((letter) => !word.includes(letter)).length;
}

// Whether this client may guess. Every press the play card understands asks this
// first, so there is one answer to it rather than one per key.
export function isMyTurn(state) {
  return state.seat !== null && state.room !== null && state.room.turn === state.seat;
}

// What the card says about whose turn it is, which is the only line on the play
// screen that reads differently on the two glasses.
export function turnNotice(state) {
  return isMyTurn(state) ? YOUR_TURN : PARTNER_TURN;
}

// Whether this state wants a live seat in the room. The entry module reconciles
// the connection against this rather than reacting to individual transitions, so
// no path out of the room can forget to release the seat.
export function wantsRoom(state) {
  return state.screen === 'waiting' || state.screen === 'playing';
}

export function partnerSeat(seat) {
  return seat === 1 ? 2 : 1;
}

// The room document as the rest of the app is allowed to see it. The database
// stores nothing at all for a key whose value is null or an empty list, so a raw
// snapshot is full of holes that mean "default" rather than "missing". Filling
// them in here means no reader anywhere else has to know that.
export function normalizeRoom(room) {
  return {
    word: room?.word ?? null,
    guessed: room?.guessed ?? [],
    turn: room?.turn ?? 1,
    players: {
      1: { present: room?.players?.[1]?.present === true },
      2: { present: room?.players?.[2]?.present === true },
    },
    rematch: { 1: room?.rematch?.[1] === true, 2: room?.rematch?.[2] === true },
  };
}

// Decides, from whatever is currently in the room, which seat to take and what
// the room should contain once taken. The network adapter runs this inside a
// database transaction; the choice itself lives here so it can be tested without
// one.
//
// `newWord` is the word to start a game with if this client turns out to be the
// one creating the room, and is ignored otherwise. It arrives as an argument
// because picking it at random is the one part of this that cannot be pure, and
// because publishing it in the same transaction that creates the room is what
// makes "the player who created the room chose the word" true by construction
// rather than by a second write that could lose a race with the other player
// arriving.
export function claimSeat(room, newWord = null) {
  const current = normalizeRoom(room);
  const present = [current.players[1].present, current.players[2].present];

  // An empty room is reset rather than adopted. Whatever is lying in it belongs
  // to a game that is over, and inheriting its word or its guesses would start
  // this game already half played.
  if (!present[0] && !present[1]) {
    return { seat: 1, room: occupy({ ...normalizeRoom(null), word: newWord }, 1) };
  }

  if (!present[0]) return { seat: 1, room: occupy(current, 1) };
  if (!present[1]) return { seat: 2, room: occupy(current, 2) };

  // Both seats taken. One fixed room means one game at a time, globally, which is
  // the accepted cost of pairing without a room code on a device that cannot type.
  return { seat: null, room: null };
}

function occupy(room, seat) {
  return { ...room, players: { ...room.players, [seat]: { present: true } } };
}
