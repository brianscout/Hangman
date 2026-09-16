# Hangman — Meta Ray-Ban Display Web App

Collaborative Hangman for Meta Ray-Ban Display glasses. Same word, same gallows,
alternating turns, shared outcome — or the same game on your own when there is
nobody to play against.

**The whole loop works: lobby, pair, play, end, repeat.** Connecting drops you
into the single shared room and waits, a second player arriving starts the game
on both cards, and from there the two alternate: the player whose turn it is
guesses a letter with Enter, every occurrence of it appears on both cards at
once, and the turn passes whether the guess was right or wrong. The other card's
keyboard is locked while it waits. Every wrong guess draws one more part of the
gallows on both cards, and the game ends the same way on both — YOU WIN when the
last letter is revealed, YOU LOSE and the word given up when the sixth wrong
guess completes the figure. The end of a game puts two options where the keyboard
was: another round, which begins only once both players have asked for one, or
out to the lobby, which releases your partner rather than leaving them staring at
a dead game. The connectivity probe that proved the design possible has moved to
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
| `database.rules.json` | The database security rules, as deployed. The record of them. |
| `test/` | Node's built-in test runner. No dependencies. |
| `scripts/probe.html` | The connectivity probe, kept as a diagnostic. |
| `scripts/dev-server.js` | The local server. Serves the files and forbids caching them. |

## Playing alone

The lobby opens on **Play solo**, because it is the only option that cannot fail
to start: Connect needs a second player who may not be there.

A solo game is the same game played from seat one against a room nobody else can
see. It is a flag on the state rather than a second set of screens — one word,
one gallows, one keyboard, one pair of endings — which is what lets every derived
value stay exactly as it was instead of growing a second answer for the case
where there is only one player. Four rules read the flag:

- the turn stays put, because handing it to an empty seat two would lock the
  keyboard against the only person holding it
- pairing is skipped entirely, because both presence flags in a solo room are
  false and that is what a vanished partner looks like — without this the game
  would end on its first render
- nothing is published, and no seat is claimed: a solo player must not occupy one
  of the two seats a pair are trying to play each other in
- Play again starts on the press. A rematch is an acceptance only because it
  needs two of them, and a solo player is already both halves of that agreement

The line that names whose turn it is says nothing in a solo game, but keeps its
space, so the card does not shift under the player when the ending lands in it.

Leaving to the lobby clears the flag. Without that, Connect would start another
solo game and the room would never be joined again.

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
other player as the same missing flag.

That flag is claimed again on every reconnect, not once when the seat is taken.
The server cannot tell a dropped socket from a player walking away and fires the
hook for both, and the SDK then reconnects on its own — so without re-claiming,
a client that recovered in a second stayed absent for the rest of the game.

And a missing partner does not end the game for thirty seconds. Ending it on the
first missing flag meant one blip on one headset took **both** players out: the
partner saw the flag go, walked back to the lobby, and dropped their own presence
on the way, so by the time the first client was back there was nobody left to
play. During the wait the card says PARTNER RECONNECTING in place of the turn,
because a pause with nothing said about it is what a player reads as the app
having stopped. A partner whose presence returns first clears the flag and the
game carries on with the round untouched.

The card distinguishes whose connection it is. A socket dropped at this end and a
partner vanished at the other both arrive as a missing presence flag, and they
need entirely different fixes, so this client's own connection is tracked
separately and says RECONNECTING about itself. It outranks the partner's state,
because nothing known about them is current during an outage here — and the grace
clock is paused for the same reason: a partner cannot be seen coming back through
a connection that is down, and ending the game over a silence they had no part in
would be this client's fault.

A tile that is backgrounded can be frozen outright and come back holding a socket
the server abandoned while it was away, which the SDK believes is fine and waits
on forever. Returning to the foreground tears that socket down and dials again,
guarded on the connection actually being down so a glance away does not disturb a
working one.

The clock lives in the entry module and is reconciled against the state, the same
way the seat and the notice timer are, so no path out of a game can leave one
running.

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
invitation to press it. The keyboard goes with the turn: the card hands its
bottom half to the two options below.

## Playing again

The end of a game puts two options where the keyboard was — **Play again** and
**Exit to Lobby** — because there is nothing left to guess and the options want
the room the keys were taking up. The block is exactly the keyboard's height, so
the gallows the players have just filled in does not resize underneath them at
the moment they want to look at it.

A rematch takes both players. Pressing Play again is an acceptance rather than a
start: one player alone must not be able to drag the other into a round they did
not ask for. Each client writes its own flag, at the path `rematch/<seat>` rather
than as a whole `rematch` object, for the same reason a guess never writes the
presence flags — the other seat's acceptance belongs to the other client, and
this client's copy of it is only ever as fresh as the last snapshot it saw. Two
players accepting at the same moment is the ordinary case here, not a rare race.

Whichever of them accepts first is told they are waiting on their partner, so the
pause is explained rather than mysterious. That line keeps its place on the card
whether or not it has anything to say, so agreeing to another round does not
shunt the two options upwards underneath the press that did it.

Once both flags are set the room is reset in one write: a new word, an empty
guess list, the turn back to player one, and both acceptances cleared. Only seat
one writes it. Two clients resetting the same room would each publish a word they
had drawn independently, and the players would watch the word they were about to
guess change under them. Seat two waits for the reset to arrive, which is the
same way it learns about every other change to the room.

The cursor and which of the two options is focused are put back as well. Neither
of them is in the room — they are places on a card rather than facts about the
game — so nothing in a snapshot can restore them. The client that did not write
the reset recognises a new round by the guess list having got shorter, which is
the whole of the test: guesses only ever accumulate within a round, so nothing
else can take any away.

Exit to Lobby drops the seat along with everything else, and needs no special
path out to do it: the entry module reconciles the seat against the state rather
than releasing it at particular transitions, so the presence flag simply goes —
and a presence flag going is exactly what reaches the other card as PARTNER LEFT.
One player is back in the lobby and the other is released.

A player who exits leaves their acceptance behind them, in a room somebody else
may walk into, so taking a seat clears that seat's flag. Whatever the last
occupant left in it belongs to a rematch they are not here for.

The word a rematch is played with reaches the reducer as an argument on the
action, for the same reason the room's first word is an argument to `claimSeat`:
drawing one at random is the single part of starting a game that cannot be pure,
and the reducer decides rather than does. Every action carries a freshly drawn
word and almost every one of them throws it away, which costs an array index.

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
sized to fit the 36px it already had rather than taking more. The two options
that replace the keyboard take its 254px exactly rather than a height of their
own, so the gallows is drawn to the same size whether the game is running or
over.

## Running it

Locally:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> and size the window to 600x600. Arrow keys and
Enter stand in for the Neural Band, the same development loop RecipeGuide uses.
The probe is at <http://localhost:8000/scripts/probe.html>.

On the glasses:

1. Deploy [`database.rules.json`](database.rules.json) to the Firebase project, if
   it is not already live. A Pages URL is a public URL, and the database behind it
   is only as closed as its rules.
2. Push this repo and enable GitHub Pages on it.
3. In the Meta AI app: **App Settings → App Connections → Web Apps → Add a Web
   App**, then give it a name and the HTTPS Pages URL.
4. Launch the tile from the glasses app grid.

The registered URL is permanent, so steps 2 to 4 are a one-time action.

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

The rematch is tested as the handshake it is: that one acceptance starts nothing,
that the player who gave it is told they are waiting, that the round begins only
when the second one arrives, and that it begins the same way whichever player
accepted last. A room reset is tested for what it clears as much as for what it
sets — the guesses, the turn, both flags, the cursor and which option is focused
— and three rounds are played out through one pairing to hold it to that more
than once. The outbox is asserted on directly, because writing a whole `rematch`
object rather than one path is the kind of mistake that only shows up as two
players accepting at the same moment.

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
from a broken network whenever the glasses start behaving oddly. It runs six
checks and renders every result on the 600x600 card, because there is no console
to read on the glasses.

| # | Check | Needs a Firebase project? |
|---|-------|---------------------------|
| 1 | Cross-origin `fetch` to `gstatic.com` | no |
| 2 | Dynamic `import()` of the Firebase SDK from that CDN | no |
| 3 | `WebSocket` open to a third-party host | no |
| 4 | Firebase RTDB connect + read of the room | **yes** |
| 5 | Database rules deployed — two denied writes are refused | **yes** |
| 6 | Input vocabulary — all four arrows and Enter | no |

Checks 1–3 answer most of the question on their own. Check 4 is the
authoritative one: it does exactly what the game does. Check 5 is the only way
from inside the app to tell rules that shipped from rules that did not — see
[Database rules](#database-rules). Check 6 is passive and confirms the documented
input model on real hardware, since the glasses are already on.

Check 4 reads the room rather than writing a scratch value somewhere, because
the rules no longer leave anywhere to scratch and because the room is a live
game: a probe that wrote to it would knock over a game being played in it.

Check 3 tries three echo endpoints in turn and passes if any opens. One public
echo service was already down during development, and a single dead host must
not be reported as "the glasses block WebSockets".

Press **Enter** on the glasses to re-run.

### What the verdict means

- **"Network reaches Firebase and the rules are live."** Every network check
  passed and the database is not world-writable.
- **"Network works. Add a Firebase config to confirm."** Checks 1–3 passed and
  check 4 has no config yet. Encouraging but not conclusive.
- **"No third-party network at all. Redesign required."** The glasses will not
  reach another origin. Multiplayer over Firebase is impossible and the plan
  needs to change.
- **"Database is wide open. Deploy database.rules.json."** The network is fine
  and a write that must be refused was accepted. Fix this before anyone plays.
- **"Partial. Read the failing row above."** Something specific broke; the row's
  detail line carries the error.

### Filling in the Firebase config

Check 4 stays skipped — grey, not red — until `src/firebase-config.js` has a
real config. Create a Firebase project with a Realtime Database, then copy the
web config from **Project settings → Your apps → Web app**.

That config is **not a secret**. Firebase web configs are public by design;
access is controlled by database rules, not by hiding the file. Deploy
`database.rules.json` to the same project before anybody plays — see below.

## Database rules

`database.rules.json` is what stops the database being world-writable, and it is
the record of the rules as well as the source of them: the Firebase console is
where they take effect and nowhere a change can be reviewed, diffed or restored,
so the text lives here and is pasted there. Nothing enforces that the two agree,
which is what check 5 of the probe is for.

Nobody signs in. The platform has no text input, so there is no account to sign
into, which means a rule cannot ask *who* is writing — only *where* and *what
shape*. The rules are built out of exactly that:

- everything is denied at the root, and granted back only on `room`
- inside `room`, only the five keys the game stores are accepted; any other key
  is rejected, along with everything under it
- each of the five is shape-checked — a word is five to eight uppercase letters,
  `guessed` is a list of single letters, `turn` and both seat numbers are 1 or 2,
  and the presence and rematch flags are booleans

Whose turn it is stays the reducer's business. A rule cannot tell the two players
apart, so it cannot enforce a turn, and the room is open to anyone who has the
URL. What the rules buy is that a write to it has to be recognisable as a move in
this game rather than arbitrary data, and that the rest of the database — every
path the game does not use, including the `probe` path the connectivity probe
used to scribble on — is closed.

### Deploying them

Paste the file into **Firebase console → Realtime Database → Rules** and publish.
Comments are allowed there and are part of the file; keep them. There is no
`firebase.json` in this repo and no CLI step: one file, pasted, on the rare
occasions it changes.

They replaced Firebase's test mode, which was world-readable and world-writable
until a fixed expiry date — right for the probe, wrong to ship, and due to expire
into a database that denied everything.

### When they are wrong

A permission error reads almost exactly like a connectivity failure, and that is
a genuinely bad thing to debug while wearing glasses. Both look like Connect
never finishing.

Two ways to tell them apart, in the order worth trying:

1. Run `scripts/probe.html`. Check 4 failing with `PERMISSION_DENIED` is rules
   too tight; check 5 failing is rules too loose or never deployed; check 1
   failing is the network.
2. Open the app in a desktop browser and read the console. The SDK logs a
   permission error in full there, which is the whole reason to reach for a
   browser over the glasses when something is wrong.

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
