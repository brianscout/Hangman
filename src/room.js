// The network adapter. It claims a seat in the one well-known room, keeps this
// client's presence flag alive, and forwards room snapshots onward untouched.
//
// It decides nothing. Which seat to take and what the room should contain once
// taken come from the reducer's claimSeat, which is why that behaviour is
// testable without a database and why nothing here needs a test of its own: take
// the decisions out of an adapter and what is left is a pipe.

import { claimSeat } from './reducer.js';
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

function connect() {
  connection ??= (async () => {
    const [{ initializeApp }, db] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-database.js`),
    ]);
    return { db, database: db.getDatabase(initializeApp(firebaseConfig)) };
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
export async function joinRoom(onRoom) {
  const { db, database } = await connect();
  const roomRef = db.ref(database, ROOM_PATH);

  // A transaction rather than a read followed by a write. Two players pressing
  // Connect at the same moment is the ordinary case here, not a rare race, and a
  // read-then-write would hand them both seat one.
  let seat = null;
  const { committed } = await db.runTransaction(roomRef, (current) => {
    const claim = claimSeat(current);
    seat = claim.seat;
    // Returning nothing aborts. The room is full and there is no seat to take.
    return claim.seat === null ? undefined : claim.room;
  });
  if (!committed || seat === null) return { seat: null, leave() {} };

  const presenceRef = db.ref(database, `${ROOM_PATH}/players/${seat}/present`);

  // Registered with the server, so it fires whether this client quits politely,
  // crashes, runs out of battery or drops off the network. That is the whole
  // reason presence is a disconnect hook and not a goodbye message: a goodbye
  // message is exactly what a dying client cannot send.
  await db.onDisconnect(presenceRef).set(false);

  const unsubscribe = db.onValue(roomRef, (snapshot) => onRoom(snapshot.val()));

  return {
    seat,
    leave() {
      unsubscribe();
      // Cancel first, then clear. The other order would let the hook fire on a
      // later disconnect and write false over a seat somebody else has taken.
      db.onDisconnect(presenceRef).cancel()
        .then(() => db.set(presenceRef, false))
        .catch(() => {});
    },
  };
}
