# Hangman — Meta Ray-Ban Display Web App

Two-player collaborative Hangman for Meta Ray-Ban Display glasses. Same word,
same gallows, alternating turns, shared outcome.

**A whole game can be played out, won and lost; there is no way to start a second
one yet.** Connecting drops you into the single shared room and waits, a second
player arriving starts the game on both cards, and from there the two alternate:
the player whose turn it is guesses a letter with Enter, every occurrence of it
appears on both cards at once, and the turn passes whether the guess was right or
wrong. The other card's keyboard is locked while it waits. Every wrong guess
draws one more part of the gallows on both cards, and the game ends the same way
on both — YOU WIN when the last letter is revealed, YOU LOSE and the word given
up when the sixth wrong guess completes the figure. What there is no way to do
yet is play again: a finished card holds its ending, and the rematch comes next.
The connectivity probe that proved the design possible has moved to
`scripts/probe.html` and still runs.

## Layout

| Path | What it is |
|------|------------|
| `index.html` | The card's markup and styling. One 600x600 screen at a time, no scrolling. |
| `src/reducer.js` | Pure. Owns every state transition and derived value. The only tested module. |
| `src/words.js` | The mystery words, as data, plus the one line that draws one. |
| `src/room.js` | The network adapter. Claims a seat, keeps presence alive, forwards snapshots, publishes guesses. Decides nothing. |
| `src/render.js` | Writes the DOM from state and reads nothing back, including the 26 keys. |
| `src/main.js` | Wires `keydown` to reducer actions, reducer output to the renderer and to the room, and reducer state to whether a seat is held. |
| `src/firebase-config.js` | The Firebase web config. Public by design — see below. |
| `test/` | Node's built-in test runner. No dependencies. |
| `scripts/probe.html` | The connectivity probe, kept as a diagnostic. |

## Pairing

There is one room, at the fixed path `room`, because nobody can type a room code
on a device with no text input. Choosing "Connect to local game" claims a seat in
it inside a database transaction — two players pressing Connect at the same
moment is the ordinary case here, not a rare race — and the second player's
arrival starts the game on both cards with no further input.

The first occupant of an empty room resets it rather than adopting what is in it.
Whatever is lying there belongs to a game that is over, and inheriting its word or
its guesses would start this one already half played.

Each client maintains a presence flag through the database's own `onDisconnect`
hook, so quitting, crashing, a flat battery and a lost network all arrive at the
other player as the same missing flag. Losing your partner shows PARTNER LEFT and
returns you to the lobby. There is no reconnect grace period.

## The word

Nobody types a word, because the platform has no text input. The client that
creates the room draws one at random from the bundled list in `src/words.js` —
about 120 common words, five to eight letters, uppercase A to Z — and publishes
it in the same transaction that creates the room. That is what makes "the player
who created the room chose the word" true by construction: there is no second
write to lose a race with the other player arriving.

Every client draws a word before it knows which seat it will get. A client that
ends up joining an existing room discards its own and adopts the one already
there, so the word can only ever be set once per game.

What the card shows is derived from the word and the guesses on every render,
never stored. The moment each client keeps its own copy of how far along the
word is, the two of them can disagree about it.

Remote snapshots reach the reducer as a `hydrate` action rather than being read
where they land. That is what keeps the network out of the test surface: a
two-player game can be played out inside a single test by dispatching one player's
actions and the other player's room as a hydrate.

## Guessing and turns

Every guess passes the turn, right or wrong. This is a collaborative game — one
word, one gallows, one outcome — and a player who kept the keyboard for as long
as they kept guessing correctly would leave the other one watching.

The card says whose turn it is, and the whole keyboard is locked on the other
one: no cursor movement, no focused key, the grid dimmed as a block. Locking
Enter alone would leave a cursor moving around a keyboard that will not answer,
which is an invitation to press it. Saying whose turn it is rather than only
disabling the keys is what makes the locked card read as waiting rather than as
broken.

A guess is applied locally first and published second, because the card has to
answer the press now and the round trip to the database is not now. Only the
two keys that changed are written — the guess list and the turn — never the
whole room: the presence flags in it belong to the two clients that maintain
them, and this client's copy of the other's is only ever as fresh as the last
snapshot it saw.

That write is not a transaction, unlike claiming a seat. Only the player whose
turn it is may write, and the other player's turn does not begin until this
write has reached them, so the turn itself is what serialises the two clients and
there is no second writer to race.

The reducer hands that write out as a value — an `outbox` on the state — rather
than calling the network, which keeps it pure and lets a test read what would
have been sent. The entry module publishes an outbox only when it is a new one,
so a snapshot arriving from the room is never echoed straight back into it.

The count of wrong guesses is derived from the word and the guess list rather
than stored, for the same reason the masked word is. It is what the gallows is
drawn from.

## The gallows, winning and losing

The gallows is inline SVG in seven states, from the empty frame through six body
parts: head, body, two arms, two legs. Inline rather than an image because it
stays sharp at whatever height the layout gives it, needs no hosting on a
platform that refetches the page on every launch, and costs almost nothing in
page weight. The frame is drawn one step back from the figure — the frame is
context and the parts are the signal — but what a player reads off it is how many
parts are there, which is a count of shapes and survives a waveguide washing every
mid-tone out.

One part per wrong guess, on both cards, so the danger is read off the figure
rather than counted off the keyboard.

The game ends when the last letter is revealed, which is YOU WIN, or when the
sixth wrong guess completes the figure, which is YOU LOSE and gives the word up —
the players have earned finding out what they were missing. Both players are
always given the same ending, including the one whose guess brought it about.
This is a collaborative game: one word, one gallows, one result.

Neither outcome is written to the room. Both are derived from the word and the
guess list, on each card, on every render — a stored outcome is a second opinion
about a game that must look identical on both cards, and it is exactly how two
clients come to disagree about how a game finished.

The ending appears in the line the turn was in, because a game that has ended has
no next player, and both keyboards go dead the moment it does. There is nothing
left to guess, and a cursor moving around a keyboard that will not answer is an
invitation to press it. A finished card stays where it is; playing again is the
next ticket.

## The keyboard

All 26 letters, six to a row, which puts the whole alphabet in five rows and no
letter more than three presses from any other in either axis. Twenty-six letters
do not fill a 6-wide grid, so the last row is short: Y and Z and nothing else.

Every edge wraps, in both axes, so no direction is ever a dead end. Left and
right stay inside their row rather than running on into the next one — a row is
a place on the card, and a cursor that slid between rows on a horizontal press
would end up somewhere the player was not looking. Coming down or up into the
short last row from a column it does not have lands on its last letter, because
a press that appears to do nothing reads as the app having missed the input.

A letter that has been guessed is out of play, so the cursor does not stop on
one: a press is repeated in the same direction until it lands on a key that
would do something. It is impossible to focus a spent letter, and so impossible
to press one and see nothing happen. Guessed keys stay on the card, dimmed and
without their border — which letters have been spent is part of reading the
board — but they are no longer places the cursor can be. A letter that goes out
of play underneath the cursor, guessed by either player, moves it forward to the
next letter still worth pressing.

The cursor is local state and is never published to the room. Publishing it
would mean a database write on every cursor move, and neither player needs to
see where the other one is hovering. It is also why two players can be on
different letters at the same time without the two cards disagreeing about
anything that matters.

The play card is the one screen with several things stacked on it, so its height
is budgeted rather than centred: 552px of usable height holding a 67px word line,
a 36px status line and a 254px keyboard, which leaves 195px for the gallows. The
gallows is the only part of the card that can be drawn to whatever it is given,
which is why the status line came out of its share and not out of the word or the
keys — and why the ending, which lands in that same line at a larger size, is
sized to fit the 36px it already had rather than taking more.

## Running it

Locally:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> and size the window to 600x600. Arrow keys and
Enter stand in for the Neural Band, the same development loop RecipeGuide uses.
The probe is at <http://localhost:8000/scripts/probe.html>.

On the glasses:

1. Push this repo and enable GitHub Pages on it.
2. In the Meta AI app: **App Settings → App Connections → Web Apps → Add a Web
   App**, then give it a name and the HTTPS Pages URL.
3. Launch the tile from the glasses app grid.

The registered URL is permanent, so this is a one-time action.

## Tests

```bash
node --test
```

No install step and no dependencies, ever. Tests drive the reducer with the
events a player would produce — move, move, activate — and assert on the
resulting state. They never reach into how state is shaped, never assert on DOM
structure and never mock Firebase.

The second player is expressed the same way: as the room their client would have
written, dispatched as a hydrate. There is no database in the tests and nothing
standing in for one, because the reducer never sees one. A whole word is played
out that way in a single test — one player guesses, their outbox is written over
the shared room, the other player is hydrated with it, and the turn comes back.

The endings are tested at their boundaries — one letter short of the word and
the letter that finishes it, five wrong guesses and the sixth — and on the
property the whole design rests on: that two clients holding the same room derive
the same status, the same word and the same line under it.

The word list is tested too, but on its invariants rather than its contents:
uppercase A to Z, five to eight letters, no duplicates. A word that broke one of
those would not fail here and there — it would fail on the one round that drew
it, on the glasses, in front of a friend.

The reducer is otherwise the only module with unit tests. The network adapter,
the renderer and the entry module make no decisions — the adapter forwards, the renderer
projects, the entry module wires — so testing them would mean asserting against
mocks of the Firebase SDK and the DOM, which measures the mocks. Those are
verified by running the app.

## Input

The Neural Band and temple strip are translated by the glasses OS into exactly
five keyboard events, and the app listens for nothing else:

- **Up** and **down** move focus between elements.
- **Left** and **right** move focus within a row. On a single column of options
  they do nothing.
- **Enter** activates the focused element.

The grammar is the same on every screen, so a player never has to work out which
screen they are on before acting. The middle-finger pinch is reserved by the
system. There is no platform Back — the app owns all reverse navigation, which
is why the lobby carries its own **Exit App**.

## The probe

The design depends on both players' glasses holding a live connection to
Firebase, and nothing confirmed that a Web App on the glasses may talk to a
third-party origin at all. `scripts/probe.html` answered that on real hardware
before any game code was written. All four network checks pass.

It stays in the repo because it remains the fastest way to tell a broken game
from a broken network whenever the glasses start behaving oddly. It runs five
checks and renders every result on the 600x600 card, because there is no console
to read on the glasses.

| # | Check | Needs a Firebase project? |
|---|-------|---------------------------|
| 1 | Cross-origin `fetch` to `gstatic.com` | no |
| 2 | Dynamic `import()` of the Firebase SDK from that CDN | no |
| 3 | `WebSocket` open to a third-party host | no |
| 4 | Firebase RTDB connect + write/read round trip | **yes** |
| 5 | Input vocabulary — all four arrows and Enter | no |

Checks 1–3 answer most of the question on their own. Check 4 is the
authoritative one: it does exactly what the game will do. Check 5 is passive and
confirms the documented input model on real hardware, since the glasses are
already on.

Check 3 tries three echo endpoints in turn and passes if any opens. One public
echo service was already down during development, and a single dead host must
not be reported as "the glasses block WebSockets".

Press **Enter** on the glasses to re-run.

### What the verdict means

- **"Firebase multiplayer is viable. Build the game."** All four network checks
  passed. The design holds.
- **"Network works. Add a Firebase config to confirm."** Checks 1–3 passed and
  check 4 has no config yet. Encouraging but not conclusive.
- **"No third-party network at all. Redesign required."** The glasses will not
  reach another origin. Multiplayer over Firebase is impossible and the plan
  needs to change.
- **"Partial. Read the failing row above."** Something specific broke; the row's
  detail line carries the error.

### Filling in the Firebase config

Check 4 stays skipped — grey, not red — until `src/firebase-config.js` has a
real config. Create a Firebase project with a Realtime Database, then copy the
web config from **Project settings → Your apps → Web app**.

That config is **not a secret**. Firebase web configs are public by design;
access is controlled by database rules, not by hiding the file. Before playing
over the open internet, set rules so only the game's room path is writable.

## Platform constraints this is built around

Established by reading Meta's Web App documentation and the RecipeGuide project:

- Input is **only** `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`.
- The middle-finger pinch is reserved by the system. Do not rely on it.
- There is **no platform Back**. The app owns its own reverse navigation.
- **No text input.** Nobody can type a room code, which is why pairing uses a
  single fixed room instead.
- **No offline support.** The page is refetched on every launch, so page weight
  is start-up latency.
- Supported: display, input, IMU, location, local storage, app icons.
  Unsupported: camera, microphone, text input, offline, notifications, back.

This is a Web App, not a Wearables Device Access Toolkit integration. The `mwdat`
Android SDK is a different platform and is not used here.
