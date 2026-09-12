// Projects state onto the card and reads nothing back. It holds no state of its
// own, so what a player is looking at is always a function of whatever the
// reducer last returned — there is no second copy of the truth to drift.
//
// Untested on purpose. It makes no decisions, and a test here would assert
// against a mock of the DOM, which measures the mock.

import { LETTERS, focusedLetter, focusedOption, maskedWord } from './reducer.js';

const screens = new Map(
  [...document.querySelectorAll('.screen')].map((node) => [node.id.replace('screen-', ''), node]),
);
const options = new Map(
  [...document.querySelectorAll('.option')].map((node) => [node.dataset.option, node]),
);
const noticeHeadline = document.querySelector('[data-notice-headline]');
const word = document.querySelector('[data-word]');

// The keys are written in from the alphabet the reducer owns rather than spelled
// out in the markup, so the grid cannot come to hold a different set of letters
// than the cursor moves around. They are built once: the alphabet never changes,
// and only which of them is focused does.
const keys = LETTERS.map((letter) => {
  const node = document.createElement('div');
  node.className = 'key';
  node.textContent = letter;
  return node;
});
document.querySelector('[data-keyboard]').append(...keys);

export function render(state) {
  for (const [name, node] of screens) node.hidden = name !== state.screen;

  const focused = focusedOption(state);
  for (const [name, node] of options) {
    node.classList.toggle('option--focused', name === focused);
  }

  if (state.notice !== null) noticeHeadline.textContent = state.notice;

  word.textContent = maskedWord(state);

  const letter = focusedLetter(state);
  for (const node of keys) node.classList.toggle('key--focused', node.textContent === letter);
}
