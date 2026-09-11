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

// Database rules are currently Firebase's test mode: world-readable and
// world-writable until 2026-10-11 07:00 UTC, after which every read and write is
// denied. The failure mode is a permission error that reads like a connectivity
// break, so replace these rules with scoped ones before that date.
