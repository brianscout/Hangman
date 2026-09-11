// The mystery words. Data, not logic: the list is bundled with the game rather
// than fetched, because the platform refetches the page on every launch and has
// no offline support, so a word list behind a network call would be one more
// round trip between a player pressing Connect and a game starting. At this size
// it costs less than a single icon.
//
// Every entry is uppercase A to Z and five to eight letters. Five is the shortest
// word a six-part gallows makes a game of; eight is the longest that fits across
// a 600x600 card at a size readable on a waveguide. The keyboard has twenty-six
// keys and no others, so a hyphen or an accent would be a letter nobody could
// guess. `test/words.test.js` holds all of that to account.
//
// Common words only. Two people are playing this across a table in a couple of
// minutes, and a word one of them has to be told the meaning of is not a game.

export const WORDS = [
  // five
  'BEACH', 'BREAD', 'BRUSH', 'CANDY', 'CHAIR', 'CLOUD', 'DANCE', 'DREAM',
  'EAGLE', 'EARTH', 'FLAME', 'FRUIT', 'GHOST', 'GRAPE', 'HEART', 'HONEY',
  'HORSE', 'KNIFE', 'LEMON', 'LIGHT', 'MOUSE', 'MUSIC', 'OCEAN', 'PAPER',
  'PIANO', 'PLANT', 'RADIO', 'RIVER', 'ROBOT', 'SMILE', 'SNAKE', 'STONE',
  'STORM', 'TABLE', 'TIGER', 'TRAIN',

  // six
  'ANCHOR', 'BANANA', 'BASKET', 'BRANCH', 'BRIDGE', 'BUTTON', 'CAMERA',
  'CANDLE', 'CASTLE', 'CHEESE', 'CIRCLE', 'COFFEE', 'DESERT', 'DRAGON',
  'ENGINE', 'FALCON', 'FLOWER', 'FOREST', 'GARDEN', 'GUITAR', 'HAMMER',
  'ISLAND', 'JACKET', 'JUNGLE', 'KITTEN', 'LADDER', 'MARKET', 'MIRROR',
  'MONKEY', 'ORANGE', 'PENCIL', 'PLANET', 'POCKET', 'PUZZLE',

  // seven
  'BALLOON', 'BICYCLE', 'BLANKET', 'CABBAGE', 'CAPTAIN', 'COMPASS', 'CRYSTAL',
  'DIAMOND', 'DOLPHIN', 'FACTORY', 'FEATHER', 'GIRAFFE', 'HARVEST', 'JOURNEY',
  'KITCHEN', 'LANTERN', 'LIBRARY', 'MONSTER', 'MORNING', 'MUSTARD', 'OCTOPUS',
  'PENGUIN', 'PICTURE', 'PUMPKIN', 'RAINBOW', 'THUNDER', 'VILLAGE', 'WHISPER',

  // eight
  'AIRPLANE', 'ALPHABET', 'BAREFOOT', 'BASEBALL', 'BIRTHDAY', 'CAMPFIRE',
  'CHAMPION', 'DINOSAUR', 'DOORBELL', 'ELEPHANT', 'FIREWORK', 'HOSPITAL',
  'LAVENDER', 'MOUNTAIN', 'NOTEBOOK', 'PANCAKES', 'PASSPORT', 'SANDWICH',
  'SNOWFALL', 'SUNSHINE', 'TRIANGLE', 'UMBRELLA', 'VACATION',
];

// The one impure thing the word list needs, kept beside the data it draws from
// and out of the reducer, which stays pure. The source of randomness is a
// parameter so a test can say which word comes out without owning a seed.
export function pickWord(random = Math.random) {
  return WORDS[Math.floor(random() * WORDS.length)];
}
