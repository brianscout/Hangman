import test from 'node:test';
import assert from 'node:assert/strict';

import { WORDS, pickWord } from '../src/words.js';

// The list is data, so the tests on it are the invariants the rest of the game
// assumes rather than assertions about particular entries. A word that breaks one
// of these would not fail here and there — it would fail on the one round that
// happened to draw it, on the glasses, in front of a friend.

test('the list is about the size the game was designed around', () => {
  assert.ok(WORDS.length >= 100, `only ${WORDS.length} words`);
  assert.ok(WORDS.length <= 150, `${WORDS.length} words is more than the card needs`);
});

test('every word is uppercase A to Z with nothing else in it', () => {
  // The keyboard the player guesses with has twenty-six keys and no others, so a
  // hyphen, an accent or a space would be a letter that cannot be guessed.
  for (const word of WORDS) assert.match(word, /^[A-Z]+$/, `${word} is not plain uppercase`);
});

test('every word is between five and eight letters', () => {
  // Below five is over before the gallows means anything; above eight does not
  // fit across the card.
  for (const word of WORDS) {
    assert.ok(word.length >= 5 && word.length <= 8, `${word} is ${word.length} letters`);
  }
});

test('no word appears twice', () => {
  assert.equal(new Set(WORDS).size, WORDS.length);
});

test('picking returns a word from the list', () => {
  assert.ok(WORDS.includes(pickWord()));
});

test('picking can reach both ends of the list', () => {
  // The randomness is a parameter so this is a fact about the picker rather than
  // a thing that is usually true. An index that can never be the last one would
  // quietly retire a word.
  assert.equal(pickWord(() => 0), WORDS[0]);
  assert.equal(pickWord(() => 0.999999), WORDS[WORDS.length - 1]);
});
