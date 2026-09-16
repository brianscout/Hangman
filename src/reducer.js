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
//
// Solo is first because it is the only one that cannot fail to start: Connect
// needs a second player who may not be there, and the lobby opens on the option
// that always works.
export const LOBBY_OPTIONS = ['solo', 'connect', 'exit'];

// The two ways out of a finished game, in the order they appear at the bottom of
// the play card. Focus is an index into this list for the same reason the
// lobby's is: movement is arithmetic.
export const END_OPTIONS = ['rematch', 'exit-to-lobby'];

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

// Shown while the other player is out of contact but not yet given up on. A
// dropped socket and a player walking away look identical from here, so the card
// says what it knows rather than guessing: somebody is missing, and the game is
// still waiting for them.
export const PARTNER_AWAY = 'PARTNER RECONNECTING';

// How long a partner may be missing before the game ends. Presence is a socket,
// and a socket drops for reasons that have nothing to do with the player holding
// it — a sleeping display, a WiFi handover, a NAT timing out an idle connection.
// Ending the game on the first missing flag meant one blip on one headset took
// both players out, because the partner bailed to the lobby and dropped their own
// presence on the way.
//
// Thirty seconds is long enough to walk out of range and back. The card says it
// is waiting, so the pause is explained rather than read as the app having
// stopped.
export const PARTNER_GRACE_MS = 30000;

// The end of the game, in the same place on the card as the turn it replaces.
// Both players are always told the same one of these: there is one word, one
// gallows and one result, and the result is shared whichever of them brought it
// about.
export const YOU_WIN = 'YOU WIN';
export const YOU_LOSE = 'YOU LOSE';

// Head, body, two arms, two legs. Six wrong guesses complete the figure, which
// is what makes the gallows readable as how much danger the players are in
// without anyone counting anything. The six parts are drawn in the markup, so
// this number and the number of parts in `index.html` are the same number in two
// places — the card runs out of figure at exactly the guess this loses on.
export const MAX_WRONG = 6;

// Shown to the player who has asked for another round and whose partner has not
// answered yet. A rematch needs both of them, so one of them is always left
// waiting for a moment — and a pause with nothing said about it is exactly what
// a player reads as the app having stopped.
export const WAITING_FOR_PARTNER = 'Waiting for your partner to accept.';

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
    endFocus: 0,
    seat: null,
    room: null,
    notice: null,
    cursor: 0,
    outbox: null,
    // Whether this game has a second player in it. A solo game is the same game
    // played from seat one against a room nobody else can see, which is why it
    // is a flag on the state rather than a second set of screens: one word, one
    // gallows, one keyboard, one set of endings, and four rules that read it.
    solo: false,
    // Whether the partner's presence has gone and the game is waiting to see
    // whether it comes back. The clock that decides how long belongs to the
    // entry module, for the same reason the notice timer does: this module has
    // no access to one and is tested without it.
    partnerAbsent: false,
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
      switch (focusedOption(state)) {
        case 'exit':
          return { ...state, screen: 'exited' };
        case 'solo':
          return startSolo(state, action.newWord);
        default:
          return { ...state, screen: 'waiting' };
      }
    default:
      return state;
  }
}

// A game with nobody else in it. It starts on the play card rather than passing
// through the waiting screen, because there is nothing to wait for: no seat to
// claim, no partner to arrive, and no round trip between pressing and playing.
//
// The room is built here and never leaves this client. Giving a solo game the
// same shape as a paired one is what lets every derived value — the masked word,
// the wrong count, the ending — stay exactly as it was, rather than growing a
// second answer for the case where there is only one player.
function startSolo(state, newWord) {
  return {
    ...state,
    screen: 'playing',
    solo: true,
    // Seat one, because the turn is stored as a seat and this player holds the
    // only one. `isMyTurn` then answers yes without being told about solo at all.
    seat: 1,
    room: { ...normalizeRoom(null), word: newWord },
    ...freshRound(),
  };
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
      return settle({ ...state, seat: action.seat }, action.newWord);
    case 'hydrate':
      return settle({ ...state, room: normalizeRoom(action.room) }, action.newWord);
    case 'joinRejected':
      return { ...state, screen: 'notice', notice: ROOM_BUSY };
    case 'joinFailed':
      return { ...state, screen: 'notice', notice: NO_CONNECTION };
    default:
      return state;
  }
}

// The game itself, and the end of it. The keyboard belongs to whichever player
// the room says is to move, so both presses it understands are inert on the
// other card — the whole keyboard is locked rather than Enter alone, because a
// cursor moving around a keyboard that cannot be used is an invitation to press
// it.
//
// A finished game hands the card over to the two options at the bottom of it.
// The keyboard has gone by then — there is nothing left to guess — so the same
// two presses mean something else rather than meaning nothing.
function reducePlaying(state, action) {
  const over = gameStatus(state) !== 'playing';

  switch (action.type) {
    case 'move':
      if (over) return moveEndFocus(state, action.direction);
      return isMyTurn(state) ? moveCursor(state, action.direction) : state;
    case 'activate':
      return over ? activateEnd(state, action.newWord) : guess(state);
    case 'hydrate':
      return hydratePlaying(state, action);
    case 'partnerGone':
      // The grace period has run out. Anything that could have brought the
      // partner back would have cleared the flag before this arrived, so a flag
      // still set here means they are not coming.
      return state.partnerAbsent ? { ...state, screen: 'notice', notice: PARTNER_LEFT } : state;
    default:
      return state;
  }
}

// A room snapshot arriving mid-game, or carrying the start of the next round.
//
// A guess list that has got shorter is the whole of how a new round is
// recognised: guesses only ever accumulate within one, so nothing else can take
// any away. The cursor and the option focus are this client's own and appear
// nowhere in the room, so nothing in a snapshot can put them back — they are put
// back here.
function hydratePlaying(state, action) {
  const room = normalizeRoom(action.room);
  const started = room.guessed.length < guessedLetters(state).length;

  return settle({ ...state, room, ...(started ? freshRound() : null) }, action.newWord);
}

// What the next round owes this client, on top of whatever the room says. Both
// of these are places on the card rather than facts about the game, which is why
// neither of them is in the room to begin with.
function freshRound() {
  return { cursor: 0, endFocus: 0 };
}

// The press a finished game understands, which is one of exactly two things.
function activateEnd(state, newWord) {
  // Another round, immediately. A rematch is an acceptance only because it needs
  // two of them; a solo player asking for one is already both halves of that
  // agreement, and making them wait for a partner who does not exist would be a
  // pause with no end.
  if (state.solo && END_OPTIONS[state.endFocus] === 'rematch') {
    return startSolo(state, newWord);
  }

  if (END_OPTIONS[state.endFocus] === 'exit-to-lobby') {
    // Straight back to the lobby, seat and all. The entry module reconciles the
    // seat against the state, so letting go of the room here is what clears this
    // player's presence — and a cleared presence flag is the one thing that
    // reaches the other card as their partner leaving, rather than leaving them
    // staring at a dead game.
    return initialState();
  }

  return acceptRematch(state, newWord);
}

// Asking for another round. It is an acceptance rather than a start: a rematch
// one player began alone would drag the other into a round they had not asked
// for, so this writes a flag and waits.
function acceptRematch(state, newWord) {
  if (state.seat === null || state.room.rematch[state.seat]) return state;

  // The flag is written at its own path rather than as a whole rematch object,
  // for the same reason a guess does not write the presence flags: the other
  // seat's acceptance belongs to the other client, and this client's copy of it
  // is only ever as fresh as the last snapshot it saw. Two players accepting at
  // the same moment is the ordinary case here, not a rare race.
  const rematch = { ...state.room.rematch, [state.seat]: true };

  return settle(
    {
      ...state,
      room: { ...state.room, rematch },
      outbox: { [`rematch/${state.seat}`]: true },
    },
    newWord,
  );
}

// Starts the next round once both players have asked for one. Only seat one
// writes it: two clients resetting the same room would each publish a word they
// drew independently, and the players would watch the word they are about to
// guess change under them. Seat two waits for the reset to arrive, which is the
// same way it learns about every other change to the room.
//
// The word arrives as an argument for the same reason the room's first one does:
// drawing one at random is the single part of starting a game that cannot be
// pure, and the reducer decides rather than does.
function startRematch(state, newWord) {
  if (state.screen !== 'playing' || gameStatus(state) === 'playing') return state;
  if (state.seat !== 1 || !state.room.rematch[1] || !state.room.rematch[2]) return state;

  // Everything a round is made of, cleared or replaced together. The presence
  // flags are the one part of the room left alone — they belong to the two
  // clients that maintain them, and this client's copy of the other's is only
  // ever as fresh as the last snapshot it saw.
  const round = { word: newWord, guessed: [], turn: 1, rematch: { 1: false, 2: false } };

  return { ...state, room: { ...state.room, ...round }, outbox: round, ...freshRound() };
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
  // The turn passes to the other player, or stays where it is when there is no
  // other player. Handing a solo game's turn to an empty seat two would lock the
  // keyboard against the only person holding it.
  const turn = state.solo ? state.seat : partnerSeat(state.seat);

  // Only the two keys that changed are published. Sending the whole room would
  // put this client's copy of the presence flags back over the partner's, and
  // the partner's are the one part of the room this client does not own.
  //
  // A solo game publishes nothing at all. Its room exists only on this client,
  // and there is nobody to tell.
  return placeCursor({
    ...state,
    room: { ...state.room, guessed, turn },
    outbox: state.solo ? state.outbox : { guessed, turn },
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
function settle(state, newWord = null) {
  return placeCursor(startRematch(pair(state), newWord));
}

function pair(state) {
  // A solo game holds a seat and a room but has no second player, so both halves
  // of pairing are meaningless here — and the absent one would otherwise read as
  // a partner who has just left, ending the game on its first render.
  if (state.solo) return state;
  if (state.seat === null || state.room === null) return state;

  const partnerPresent = state.room.players[partnerSeat(state.seat)].present;

  // The second player's arrival starts the game on both cards. Neither player
  // presses start; each simply sees the other appear in the room.
  if (state.screen === 'waiting' && partnerPresent) {
    return { ...state, screen: 'playing', partnerAbsent: false };
  }

  // Quitting, crashing, a flat battery and a dead network all arrive here as the
  // same missing flag, which is the whole point of maintaining presence through
  // the database's own disconnect hook — but so does a socket that dropped and is
  // already coming back, and the two are indistinguishable from here.
  //
  // So the flag is recorded and the game waits. The entry module runs the clock
  // and says when it has waited long enough; a partner whose presence returns
  // first clears the flag and the game carries on as though nothing happened.
  if (state.screen === 'playing') {
    const partnerAbsent = !partnerPresent;
    return partnerAbsent === state.partnerAbsent ? state : { ...state, partnerAbsent };
  }

  return state;
}

function moveLobbyFocus(state, direction) {
  const lobbyFocus = moveFocus(state.lobbyFocus, direction, LOBBY_OPTIONS.length);
  return lobbyFocus === state.lobbyFocus ? state : { ...state, lobbyFocus };
}

function moveEndFocus(state, direction) {
  const endFocus = moveFocus(state.endFocus, direction, END_OPTIONS.length);
  return endFocus === state.endFocus ? state : { ...state, endFocus };
}

// Moving around a column of options, wherever on the card one of them is.
//
// Up and down only. Left and right move focus *within* a row everywhere in this
// app, and a column of options has no row to move within, so they are inert on
// one rather than aliased onto up and down.
//
// Wrapping rather than clamping. On a two-item list, clamping would make one
// press of down do nothing and one press of up do nothing, at opposite ends —
// which reads as the app having missed the input.
function moveFocus(focus, direction, count) {
  const step = { up: -1, down: 1 }[direction] ?? 0;
  return step === 0 ? focus : (focus + step + count) % count;
}

// Which option Enter would activate on whichever screen is up. A screen with a
// single option has nowhere for focus to move, so focus is simply always on it.
export function focusedOption(state) {
  switch (state.screen) {
    case 'lobby':
      return LOBBY_OPTIONS[state.lobbyFocus];
    case 'waiting':
      return 'leave-waiting';
    case 'playing':
      // Nothing is focused while the game is on. The keyboard has the card
      // then, and the options are not on it yet.
      return isGameOver(state) ? END_OPTIONS[state.endFocus] : null;
    default:
      return null;
  }
}

// Whether the card belongs to the two options rather than to the keyboard. The
// renderer asks this rather than comparing statuses itself, so there is one
// answer to whether the keyboard is still on the card.
export function isGameOver(state) {
  return state.screen === 'playing' && gameStatus(state) !== 'playing';
}

// The line above the two options, for the player who is waiting on the other to
// answer. Only the player who has accepted sees it: the wait belongs to them,
// and the other player is being asked for an answer rather than for patience.
export function rematchNotice(state) {
  // Nobody to wait for. A solo rematch starts on the press.
  if (state.solo) return '';

  const mine = state.room?.rematch?.[state.seat] === true;
  const theirs = state.room?.rematch?.[partnerSeat(state.seat)] === true;
  return mine && !theirs ? WAITING_FOR_PARTNER : '';
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

  // A lost game gives the word up. The players have earned finding out what they
  // were missing, and a row of dashes is the one ending nobody learns anything
  // from.
  if (gameStatus(state) === 'lost') return word;

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

// How much danger the players are in, and how many parts of the gallows are
// drawn. Derived from the word and the guesses for the same reason the masked
// word is: a stored count is a second opinion about a game that must look
// identical on both cards.
export function wrongGuesses(state) {
  const word = state.room?.word ?? null;
  if (word === null) return 0;

  return guessedLetters(state).filter((letter) => !word.includes(letter)).length;
}

// How the game finished, or that it has not. Derived from the word and the guess
// list and written nowhere: a stored outcome is exactly how two clients come to
// disagree about what happened, and this is a game whose whole point is that
// both players are looking at the same thing.
//
// A completed word is asked about first. The two endings cannot both be true of
// a game that was played out — a wrong guess is what completes the gallows and
// it cannot be what completes the word — but a room can hold any pair of values,
// and both cards must read the same one out of it whatever is in there.
export function gameStatus(state) {
  const word = state.room?.word ?? null;
  if (word === null) return 'playing';

  const guessed = guessedLetters(state);
  // Every distinct letter, however many places it holds: BANANA is won on three
  // guesses, because what the players are reading is the word, not a tally.
  if ([...word].every((letter) => guessed.includes(letter))) return 'won';

  if (wrongGuesses(state) >= MAX_WRONG) return 'lost';
  return 'playing';
}

// Whether this client may guess. Every press the play card understands asks this
// first, so there is one answer to it rather than one per key.
//
// A finished game belongs to nobody. Both keyboards go dead the moment the word
// is out or the gallows is full, rather than the card offering the last player a
// turn at a game that is over.
export function isMyTurn(state) {
  return (
    state.seat !== null &&
    state.room !== null &&
    state.room.turn === state.seat &&
    gameStatus(state) === 'playing'
  );
}

// The one line under the word: whose turn it is while the game is on, and how it
// finished once it is over. One line and one function, because the two never
// want saying at once — a game that has ended has no next player.
//
// The turn half is the only thing on the play screen that reads differently on
// the two glasses. The ending half is the opposite: it is the same on both, by
// construction, because it is derived from the room they share.
export function statusNotice(state) {
  switch (gameStatus(state)) {
    case 'won':
      return YOU_WIN;
    case 'lost':
      return YOU_LOSE;
    default:
      // A solo game has nothing to say here. The line exists to tell two players
      // apart, and its space is kept rather than collapsed so the card does not
      // shift under the player when the ending lands in it.
      if (state.solo) return '';
      // A missing partner takes the line over. Whose turn it is stops being the
      // useful thing to say the moment the answer might be nobody's, and a card
      // that went on insisting it was the partner's turn while they were gone
      // would be the app looking broken rather than looking busy.
      if (state.partnerAbsent) return PARTNER_AWAY;
      return isMyTurn(state) ? YOUR_TURN : PARTNER_TURN;
  }
}

// Whether this state wants a live seat in the room. The entry module reconciles
// the connection against this rather than reacting to individual transitions, so
// no path out of the room can forget to release the seat.
// Whether the grace period should be running. The entry module reconciles its
// timer against this rather than starting one at a particular transition, for the
// same reason it reconciles the seat: a partner can go and come back more than
// once, and reconciling means no path can leave a stale clock running.
export function awaitingPartner(state) {
  return state.screen === 'playing' && state.partnerAbsent;
}

export function wantsRoom(state) {
  // A solo game is played entirely on this client. It never claims a seat, so it
  // never writes presence, and it cannot take a seat from two people who are
  // trying to play each other.
  if (state.solo) return false;

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
  return {
    ...room,
    players: { ...room.players, [seat]: { present: true } },
    // A seat that has just been taken carries no acceptance. Whatever the last
    // occupant left in it belongs to a rematch they are not here for, and the
    // player sitting down has agreed to nothing.
    rematch: { ...room.rematch, [seat]: false },
  };
}
