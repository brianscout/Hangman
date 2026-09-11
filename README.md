# Hangman — Meta Ray-Ban Display Web App

Two-player collaborative Hangman for Meta Ray-Ban Display glasses. Same word,
same gallows, alternating turns, shared outcome.

**Two players can find each other; there is no word yet.** Connecting drops you
into the single shared room and waits, and a second player arriving starts the
game on both cards — but the game that starts is a placeholder. The connectivity
probe that proved the design possible has moved to `scripts/probe.html` and still
runs.

## Layout

| Path | What it is |
|------|------------|
| `index.html` | The card's markup and styling. One 600x600 screen at a time, no scrolling. |
| `src/reducer.js` | Pure. Owns every state transition and derived value. The only tested module. |
| `src/room.js` | The network adapter. Claims a seat, keeps presence alive, forwards snapshots. Decides nothing. |
| `src/render.js` | Writes the DOM from state and reads nothing back. |
| `src/main.js` | Wires `keydown` to reducer actions, reducer output to the renderer, and reducer state to whether a seat is held. |
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

Remote snapshots reach the reducer as a `hydrate` action rather than being read
where they land. That is what keeps the network out of the test surface: a
two-player game can be played out inside a single test by dispatching one player's
actions and the other player's room as a hydrate.

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
standing in for one, because the reducer never sees one.

The reducer is the only module with unit tests. The network adapter, the renderer
and the entry module make no decisions — the adapter forwards, the renderer
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
