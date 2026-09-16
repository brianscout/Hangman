// Wires input to the reducer, the reducer's output to the renderer, and the
// reducer's state to whether this client holds a seat in the room. It owns the
// one mutable reference in the app — the current state — and no logic at all.
//
// Untested on purpose: there is nothing here to get wrong that running the app
// would not show immediately.

import { PARTNER_GRACE_MS, awaitingPartner, initialState, reduce, wantsRoom } from './reducer.js';
import { render } from './render.js';
import { joinRoom } from './room.js';
import { pickWord } from './words.js';

// The Neural Band and temple strip are translated by the glasses OS into exactly
// these five keyboard events, and nothing else ever arrives. Arrow keys on a
// desktop keyboard stand in for them during development.
const ACTIONS = {
  ArrowUp: { type: 'move', direction: 'up' },
  ArrowDown: { type: 'move', direction: 'down' },
  ArrowLeft: { type: 'move', direction: 'left' },
  ArrowRight: { type: 'move', direction: 'right' },
  Enter: { type: 'activate' },
};

// Long enough to read four words, short enough that nobody wonders whether the
// app has stopped. Nothing on a notice screen is waiting for the player.
const NOTICE_MS = 2200;

let state = initialState();
let seatHeld = null;
let claiming = false;
let noticeTimer = null;
let partnerTimer = null;

function dispatch(action) {
  // Every action carries a freshly drawn word, which the reducer uses only if
  // this transition turns out to be the one that starts another round. Drawn
  // here rather than in the reducer for the same reason the room's first word
  // is drawn in the adapter: picking at random is the one part of starting a
  // game that cannot be pure, and the reducer decides rather than does. Drawing
  // one that is thrown away costs an array index.
  const next = reduce(state, { ...action, newWord: pickWord() });
  // The reducer returns the same object when nothing changed, so an inert press
  // costs nothing and cannot repaint the card.
  if (next === state) return;

  // The reducer hands the room what it owes it as a value. A fresh one means
  // this transition produced something to send; the same one means it did not,
  // which is what keeps a snapshot arriving from being echoed straight back.
  const outbox = next.outbox === state.outbox ? null : next.outbox;

  state = next;
  render(state);
  if (outbox !== null) seatHeld?.publish(outbox);
  syncSeat();
  syncNoticeTimer();
  syncPartnerTimer();
  if (state.screen === 'exited') exitApp();
}

window.addEventListener('keydown', (event) => {
  const action = ACTIONS[event.key];
  if (!action) return;
  event.preventDefault();
  dispatch(action);
});

// The seat is reconciled against what the state wants rather than taken and
// released at particular transitions. There are several ways out of the room —
// backing out of the wait, the partner vanishing, a room that was already full —
// and reconciling means none of them can be the one that forgets to let go.
async function syncSeat() {
  if (!wantsRoom(state)) {
    seatHeld?.leave();
    seatHeld = null;
    return;
  }
  if (seatHeld || claiming) return;

  claiming = true;
  try {
    const joined = await joinRoom((room) => dispatch({ type: 'hydrate', room }));
    claiming = false;

    // The player may have given up and walked back to the lobby while the room
    // was being reached. Their seat is claimed by now, so it has to be released.
    if (!wantsRoom(state)) {
      joined.leave();
      return;
    }

    if (joined.seat === null) {
      dispatch({ type: 'joinRejected' });
      return;
    }

    seatHeld = joined;
    dispatch({ type: 'joined', seat: joined.seat });
  } catch {
    claiming = false;
    // Any failure to reach the room at all. Left unhandled this would be an
    // eternal WAITING screen, which is the one thing that screen exists to
    // avoid — so it is reported and the player is sent back to try again.
    if (wantsRoom(state)) dispatch({ type: 'joinFailed' });
  }
}

function syncNoticeTimer() {
  const wanted = state.screen === 'notice';
  if (wanted === (noticeTimer !== null)) return;

  if (wanted) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      dispatch({ type: 'dismissNotice' });
    }, NOTICE_MS);
  } else {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
}

// How long the game waits for a partner whose presence has gone. Reconciled
// against the state rather than started when they vanish, so a partner who comes
// back and goes again gets a fresh thirty seconds rather than the remains of the
// last one — and so no path out of the game can leave a clock running that would
// later end a game nobody is playing.
function syncPartnerTimer() {
  const wanted = awaitingPartner(state);
  if (wanted === (partnerTimer !== null)) return;

  if (wanted) {
    partnerTimer = setTimeout(() => {
      partnerTimer = null;
      dispatch({ type: 'partnerGone' });
    }, PARTNER_GRACE_MS);
  } else {
    clearTimeout(partnerTimer);
    partnerTimer = null;
  }
}

// There is no platform Back and no documented exit call, so closing the window is
// the app's only way out. A desktop browser refuses this for any page a script
// did not open; the exited screen is what the player is left looking at there.
function exitApp() {
  window.close();
}

render(state);
