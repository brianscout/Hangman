// Projects state onto the card and reads nothing back. It holds no state of its
// own, so what a player is looking at is always a function of whatever the
// reducer last returned — there is no second copy of the truth to drift.
//
// Untested on purpose. It makes no decisions, and a test here would assert
// against a mock of the DOM, which measures the mock.

import {
  LETTERS,
  focusedLetter,
  focusedOption,
  gameStatus,
  guessedLetters,
  isMyTurn,
  maskedWord,
  statusNotice,
  wrongGuesses,
} from './reducer.js';

const screens = new Map(
  [...document.querySelectorAll('.screen')].map((node) => [node.id.replace('screen-', ''), node]),
);
const options = new Map(
  [...document.querySelectorAll('.option')].map((node) => [node.dataset.option, node]),
);
const noticeHeadline = document.querySelector('[data-notice-headline]');
const word = document.querySelector('[data-word]');
const status = document.querySelector('[data-status]');
const keyboard = document.querySelector('[data-keyboard]');

// The six body parts, in the order the markup draws them: head, body, arms,
// legs. Document order is draw order, so how many to show is the whole of what
// this has to know.
const parts = [...document.querySelectorAll('[data-part]')];

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
keyboard.append(...keys);

export function render(state) {
  for (const [name, node] of screens) node.hidden = name !== state.screen;

  const focused = focusedOption(state);
  for (const [name, node] of options) {
    node.classList.toggle('option--focused', name === focused);
  }

  if (state.notice !== null) noticeHeadline.textContent = state.notice;

  word.textContent = maskedWord(state);

  // One more part for every wrong guess, so the danger is read off the figure
  // rather than counted off the keyboard. A count past six leaves the figure
  // complete, which is all there is to draw.
  const wrong = wrongGuesses(state);
  parts.forEach((node, index) => node.classList.toggle('gallows-part--drawn', index < wrong));

  const outcome = gameStatus(state);
  const mine = isMyTurn(state);
  status.textContent = statusNotice(state);
  status.classList.toggle('status--mine', mine);
  status.classList.toggle('status--won', outcome === 'won');
  status.classList.toggle('status--lost', outcome === 'lost');

  // No focused key while this card cannot guess — the other player's turn, or a
  // game that has finished. The keyboard does not answer a press then, and a
  // highlighted key is what invites one.
  keyboard.classList.toggle('keyboard--locked', !mine);

  const guessed = guessedLetters(state);
  const letter = focusedLetter(state);
  keys.forEach((node, index) => {
    node.classList.toggle('key--guessed', guessed.includes(LETTERS[index]));
    node.classList.toggle('key--focused', mine && LETTERS[index] === letter);
  });
}
