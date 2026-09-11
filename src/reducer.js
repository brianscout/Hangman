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

// Headlines for the brief message screen. Every one of them is a dead end that
// drops back to the lobby on its own, because none of them is something the
// player can do anything about from where they are standing.
export const PARTNER_LEFT = 'PARTNER LEFT';
export const ROOM_BUSY = 'GAME IN PROGRESS';
export const NO_CONNECTION = 'NO CONNECTION';

export function initialState() {
  return { screen: 'lobby', lobbyFocus: 0, seat: null, room: null, notice: null };
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

// A placeholder until the next ticket gives it a word. It still watches the room,
// because losing your partner has to end the game from here too.
function reducePlaying(state, action) {
  switch (action.type) {
    case 'hydrate':
      return settle({ ...state, room: normalizeRoom(action.room) });
    default:
      return state;
  }
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
export function claimSeat(room) {
  const current = normalizeRoom(room);
  const present = [current.players[1].present, current.players[2].present];

  // An empty room is reset rather than adopted. Whatever is lying in it belongs
  // to a game that is over, and inheriting its word or its guesses would start
  // this game already half played.
  if (!present[0] && !present[1]) return { seat: 1, room: occupy(normalizeRoom(null), 1) };

  if (!present[0]) return { seat: 1, room: occupy(current, 1) };
  if (!present[1]) return { seat: 2, room: occupy(current, 2) };

  // Both seats taken. One fixed room means one game at a time, globally, which is
  // the accepted cost of pairing without a room code on a device that cannot type.
  return { seat: null, room: null };
}

function occupy(room, seat) {
  return { ...room, players: { ...room.players, [seat]: { present: true } } };
}
