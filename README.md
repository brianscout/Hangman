# Hangman — Meta Ray-Ban Display Web App

Two-player collaborative Hangman for Meta Ray-Ban Display glasses. Same word,
same gallows, alternating turns, shared outcome.

**Nothing of the game is built yet.** The repo currently holds one thing: a
connectivity probe that decides whether the planned design is possible.

## The probe, and why it exists first

The design depends on both players' glasses holding a live connection to
Firebase. Nobody has confirmed that a Web App running on the glasses is allowed
to talk to a third-party origin at all. If it is not, the multiplayer design is
dead and needs rethinking — which is worth discovering in ten minutes rather
than after the game is written.

`index.html` is that probe. It runs five checks and renders every result on the
600x600 card, because there is no console to read on the glasses.

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

## Running it

Locally:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> and size the window to 600x600. Arrow keys and
Enter stand in for the Neural Band, the same development loop RecipeGuide uses.

On the glasses:

1. Push this repo and enable GitHub Pages on it.
2. In the Meta AI app: **App Settings → App Connections → Web Apps → Add a Web
   App**, then give it a name and the HTTPS Pages URL.
3. Launch the tile from the glasses app grid.

The registered URL is permanent, so this is a one-time action. The game will
later live at this same URL and the probe will move to `scripts/`.

## Filling in the Firebase config

Check 4 stays skipped — grey, not red — until `src/firebase-config.js` has a
real config. Create a Firebase project with a Realtime Database, then copy the
web config from **Project settings → Your apps → Web app**.

That config is **not a secret**. Firebase web configs are public by design;
access is controlled by database rules, not by hiding the file. Before playing
over the open internet, set rules so only the game's room path is writable.

## What the verdict means

- **"Firebase multiplayer is viable. Build the game."** All four network checks
  passed. The design holds.
- **"Network works. Add a Firebase config to confirm."** Checks 1–3 passed and
  check 4 has no config yet. Encouraging but not conclusive.
- **"No third-party network at all. Redesign required."** The glasses will not
  reach another origin. Multiplayer over Firebase is impossible and the plan
  needs to change.
- **"Partial. Read the failing row above."** Something specific broke; the row's
  detail line carries the error.

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
