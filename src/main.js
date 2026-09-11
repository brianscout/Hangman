// Wires input to the reducer and the reducer's output to the renderer. It owns
// the one mutable reference in the app — the current state — and no logic at all.
//
// Untested on purpose: there is nothing here to get wrong that running the app
// would not show immediately.

import { initialState, reduce } from './reducer.js';
import { render } from './render.js';

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

let state = initialState();

window.addEventListener('keydown', (event) => {
  const action = ACTIONS[event.key];
  if (!action) return;
  event.preventDefault();

  const next = reduce(state, action);
  // The reducer returns the same object when nothing changed, so an inert press
  // costs nothing and cannot repaint the card.
  if (next === state) return;

  state = next;
  render(state);
  if (state.screen === 'exited') exitApp();
});

// There is no platform Back and no documented exit call, so closing the window is
// the app's only way out. A desktop browser refuses this for any page a script
// did not open; the exited screen is what the player is left looking at there.
function exitApp() {
  window.close();
}

render(state);
