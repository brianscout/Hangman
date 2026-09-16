// The network adapter. It claims a seat in the one well-known room, keeps this
// client's presence flag alive, and forwards room snapshots onward untouched.
//
// It decides nothing. Which seat to take and what the room should contain once
// taken come from the reducer's claimSeat, which is why that behaviour is
// testable without a database and why nothing here needs a test of its own: take
// the decisions out of an adapter and what is left is a pipe.

import { claimSeat } from './reducer.js';
import { pickWord } from './words.js';
import { firebaseConfig } from './firebase-config.js';

// Pinned to the version the connectivity probe verified on the glasses. Only the
// database entry point is imported, never the full bundle and never analytics:
// the platform has no offline support and refetches the page on every launch, so
// every kilobyte is time your friend spends waiting for you.
const CDN = 'https://www.gstatic.com/firebasejs/10.12.5';

// One fixed room. Nobody can type a room code on a device with no text input, so
// pairing is "we are both in the only room there is".
const ROOM_PATH = 'room';

// The SDK import and the database handle are shared across joins. Leaving and
// connecting again is a thing a player does while their friend is still getting
// their glasses on, and it should not re-download Firebase to do it.
let connection = null;

// How often a seat says it is still there. Several times over inside the window
// the reducer allows, so one missed write never costs a player their seat.
const HEARTBEAT_MS = 10000;

// The gap between this device's clock and the database's, which the server hands
// out and keeps up to date. Heartbeats are compared against a threshold, and two
// headsets whose clocks disagree by a minute would otherwise evict each other on
// sight — glasses are exactly the sort of device whose clock nobody has checked.
let serverOffset = 0;

// The database's idea of now, which is the only clock the seats are read against.
export function serverNow() {
  return Date.now() + serverOffset;
}

function connect() {
  connection ??= (async () => {
    const [{ initializeApp }, db] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-database.js`),
    ]);
    const database = db.getDatabase(initializeApp(firebaseConfig));

    // Watched for the life of the app rather than per join, because the offset is
    // a property of this device and not of any one game.
    db.onValue(db.ref(database, '.info/serverTimeOffset'), (snapshot) => {
      if (typeof snapshot.val() === 'number') serverOffset = snapshot.val();
    });

    return { db, database };
  })().catch((error) => {
    // Forget a failed load. Cached, it would be handed to every later attempt,
    // so one bad moment on the network at launch would leave the app unable to
    // connect for as long as it stayed open — and there is no reload on the
    // glasses short of relaunching the tile.
    connection = null;
    throw error;
  });
  return connection;
}

// Takes a seat and starts forwarding the room. Resolves with the seat number, or
// with a null seat if both seats were already taken. `leave` is always safe to
// call, including on a join that never got a seat.
export async function joinRoom(onRoom, onConnection = () => {}) {
  const { db, database } = await connect();
  const roomRef = db.ref(database, ROOM_PATH);

  // Drawn once, outside the transaction, and only actually published if this
  // client turns out to be the one creating the room. A transaction body runs
  // again whenever it loses a race, and picking inside it would mean the word
  // that reaches the database is decided by how many times that happened.
  const word = pickWord();

  // A transaction rather than a read followed by a write. Two players pressing
  // Connect at the same moment is the ordinary case here, not a rare race, and a
  // read-then-write would hand them both seat one.
  let seat = null;
  const { committed } = await db.runTransaction(roomRef, (current) => {
    const claim = claimSeat(current, word, serverNow());
    seat = claim.seat;
    // Returning nothing aborts. The room is full and there is no seat to take.
    return claim.seat === null ? undefined : claim.room;
  });
  if (!committed || seat === null) return { seat: null, publish() {}, leave() {} };

  const presenceRef = db.ref(database, `${ROOM_PATH}/players/${seat}/present`);

  // Registered with the server, so it fires whether this client quits politely,
  // crashes, runs out of battery or drops off the network. That is the whole
  // reason presence is a disconnect hook and not a goodbye message: a goodbye
  // message is exactly what a dying client cannot send.
  await db.onDisconnect(presenceRef).set(false);

  // Says the seat is still held, on a timer, so that a seat whose client has
  // stopped existing goes quiet and can be taken by somebody else. The disconnect
  // hook alone was not enough: the server only fires it once it notices the
  // socket is gone, and a player killed or frozen mid-game left a seat that read
  // as occupied long enough for them to be told GAME IN PROGRESS by their own
  // abandoned seat.
  //
  // The server's own timestamp, not this device's, because the stamp is read
  // against a threshold by whichever client picks it up next.
  const seenRef = db.ref(database, `${ROOM_PATH}/players/${seat}/seen`);
  const beat = () => db.set(seenRef, db.serverTimestamp()).catch(() => {});
  beat();
  const heartbeat = setInterval(beat, HEARTBEAT_MS);

  // Claimed again on every reconnect, rather than once when the seat was taken.
  //
  // A dropped socket is not the same thing as a player leaving, but the server
  // cannot tell them apart and fires the hook for both. The SDK then reconnects
  // on its own — and without this, nothing would put the flag back, so a client
  // that recovered in a second would stay absent for the rest of the game. One
  // blip on one headset took both players out: the partner saw the flag go,
  // walked back to the lobby, and dropped their own on the way.
  //
  // `.info/connected` is the SDK's own account of whether it is talking to the
  // server, and it goes true again on every reconnect, which is exactly when
  // this has to run.
  const stopPresence = db.onValue(db.ref(database, '.info/connected'), (snapshot) => {
    const connected = snapshot.val() === true;
    // Reported onward so the card can say whose connection is missing. Without
    // this, a socket that dropped at this end and a partner who vanished at the
    // other look identical on the card, and they need completely different
    // fixes.
    onConnection(connected);
    if (!connected) return;

    // The hook is re-armed before the flag goes back up. The other order leaves
    // a window where this client is present with nothing registered to clear it,
    // and a drop inside that window strands the seat as occupied forever.
    db.onDisconnect(presenceRef)
      .set(false)
      .then(() => db.set(presenceRef, true))
      .then(() => db.set(seenRef, db.serverTimestamp()))
      .catch(() => {});
  });

  const unsubscribe = db.onValue(roomRef, (snapshot) => onRoom(snapshot.val()));

  return {
    seat,

    // Forces a fresh socket. The SDK reconnects on its own with a backoff, but a
    // client that was frozen — a sleeping display, a backgrounded tile — can come
    // back to a socket the server gave up on long ago and sit there believing it
    // is still connected. Tearing it down and dialling again is the only thing
    // that reliably shakes that loose.
    //
    // Going offline fires the disconnect hook, so this briefly reads as this
    // player leaving. That is why it is only ever called when the connection is
    // already believed to be down: the flag is going to be cleared anyway, and
    // the watcher above puts it back the moment the new socket lands.
    reconnect() {
      db.goOffline(database);
      db.goOnline(database);
    },

    // Merges the reducer's outbox into the room. A merge rather than a write of
    // the whole document, because the presence flags in it belong to the two
    // clients that maintain them and this one's copy of the other's is only ever
    // as fresh as the last snapshot.
    //
    // Not a transaction either, unlike claiming a seat. Only the player whose
    // turn it is may write, and the other player's turn does not begin until
    // this write has reached them, so there is no second writer to race.
    publish(fields) {
      // The local cache applies this before the server hears about it, so the
      // subscription above reports the guess back immediately and both cards
      // stay a projection of the room rather than of a pending write.
      //
      // Nothing is done with a rejection because there is nothing useful to do
      // with one. A write made while the network is down is queued and sent on
      // reconnect rather than rejected, and a connection that does not come back
      // reaches the other player as the presence flag going out — which is the
      // one thing that would otherwise leave them waiting for a turn that is
      // never coming.
      db.update(roomRef, fields).catch(() => {});
    },

    leave() {
      unsubscribe();
      clearInterval(heartbeat);
      // Before anything else. The reconnect watcher exists to put this client's
      // presence back, and left running it would do exactly that to a seat the
      // player has just given up.
      stopPresence();
      // Cancel first, then clear. The other order would let the hook fire on a
      // later disconnect and write false over a seat somebody else has taken.
      db.onDisconnect(presenceRef).cancel()
        .then(() => db.set(presenceRef, false))
        .catch(() => {});
    },
  };
}
