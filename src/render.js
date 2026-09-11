// Projects state onto the card and reads nothing back. It holds no state of its
// own, so what a player is looking at is always a function of whatever the
// reducer last returned — there is no second copy of the truth to drift.
//
// Untested on purpose. It makes no decisions, and a test here would assert
// against a mock of the DOM, which measures the mock.

import { focusedOption, maskedWord } from './reducer.js';

const screens = new Map(
  [...document.querySelectorAll('.screen')].map((node) => [node.id.replace('screen-', ''), node]),
);
const options = new Map(
  [...document.querySelectorAll('.option')].map((node) => [node.dataset.option, node]),
);
const noticeHeadline = document.querySelector('[data-notice-headline]');
const word = document.querySelector('[data-word]');

export function render(state) {
  for (const [name, node] of screens) node.hidden = name !== state.screen;

  const focused = focusedOption(state);
  for (const [name, node] of options) {
    node.classList.toggle('option--focused', name === focused);
  }

  if (state.notice !== null) noticeHeadline.textContent = state.notice;

  word.textContent = maskedWord(state);
}
