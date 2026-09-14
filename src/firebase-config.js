// Firebase web config. This is NOT a secret — Firebase web configs are public
// by design. A browser app has to ship its config to the client, so it can never
// be hidden; access is controlled by database rules, not by concealing this file.
//
// Only the four fields below matter for Realtime Database. The console also emits
// storageBucket, messagingSenderId, appId and measurementId; those belong to
// Storage, Cloud Messaging and Analytics, none of which this app uses. Leaving
// them out keeps the payload small, which matters because the platform has no
// offline support and refetches the page on every launch.
export const firebaseConfig = {
  apiKey: 'AIzaSyAcHR6XUUoLrGaIFCZ9tT2tf_0hJoc8aGQ',
  authDomain: 'hangman-2ecd2.firebaseapp.com',
  databaseURL: 'https://hangman-2ecd2-default-rtdb.firebaseio.com',
  projectId: 'hangman-2ecd2',
};

// What keeps this safe to publish is `database.rules.json`, not this file. The
// rules there deny the whole database except the one `room` path, and check the
// shape of every key written to it. Deploy them to whatever project this config
// points at, because the two states a project is in without them are both bad:
// still in Firebase's test mode, which is world-writable, or past the date test
// mode expires, which denies everything and reads exactly like a dead network.
