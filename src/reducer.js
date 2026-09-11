// The only module in the app that decides anything. Every state transition and
// every derived value lives here, which is what makes the game testable without
// putting the glasses on: a test drives this with the events a player would
// produce and asserts on the result.
//
// Nothing in here touches the DOM, the network or the clock, and nothing in here
// mutates. A transition that changes nothing returns the state object it was
// given, so callers can skip work with a reference check.

// The lobby's options, in the order they appear on the card. Focus is stored as
// an index into this list rather than as a label, so movement is arithmetic.
export const LOBBY_OPTIONS = ['connect', 'exit'];

export function initialState() {
  return { screen: 'lobby', lobbyFocus: 0 };
}

export function reduce(state, action) {
  switch (state.screen) {
    case 'lobby':
      return reduceLobby(state, action);
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
      // Connect has nowhere to go yet — the shared room arrives with pairing.
      return focusedLobbyOption(state) === 'exit' ? { ...state, screen: 'exited' } : state;
    default:
      return state;
  }
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

export function focusedLobbyOption(state) {
  return LOBBY_OPTIONS[state.lobbyFocus];
}
