// Built-in word categories (Year 3 vocabulary).
// Shared by the server (round building) and the client (host setup screen).
//
// `clash` lists categories whose words must never be used as distractors for
// this one, because a child could reasonably argue they belong (e.g. a shark
// IS an animal).

export const CATEGORIES = [
  {
    id: 'animals', name: 'Animals', emoji: '🐾', clash: ['ocean', 'minibeasts'],
    words: ['dog', 'cat', 'horse', 'rabbit', 'elephant', 'tiger', 'lion', 'monkey', 'kangaroo',
      'zebra', 'giraffe', 'frog', 'sheep', 'bear', 'mouse', 'goat', 'koala', 'pig'],
  },
  {
    id: 'fruit', name: 'Fruit', emoji: '🍎', clash: [],
    words: ['apple', 'banana', 'grape', 'mango', 'pear', 'peach', 'cherry', 'lemon', 'plum',
      'melon', 'strawberry', 'pineapple', 'coconut', 'apricot', 'watermelon', 'blueberry'],
  },
  {
    id: 'vegetables', name: 'Vegetables', emoji: '🥕', clash: [],
    words: ['carrot', 'potato', 'pumpkin', 'onion', 'broccoli', 'cabbage', 'lettuce', 'peas',
      'corn', 'celery', 'cucumber', 'bean', 'spinach', 'garlic', 'beetroot', 'cauliflower'],
  },
  {
    id: 'colours', name: 'Colours', emoji: '🎨', clash: [],
    words: ['red', 'blue', 'green', 'yellow', 'purple', 'pink', 'brown', 'black', 'white',
      'grey', 'orange', 'gold', 'silver', 'violet'],
  },
  {
    id: 'body', name: 'Body Parts', emoji: '🖐️', clash: [],
    words: ['head', 'hand', 'foot', 'knee', 'elbow', 'shoulder', 'nose', 'mouth', 'ear', 'eye',
      'finger', 'toe', 'chin', 'neck', 'tooth', 'tummy'],
  },
  {
    id: 'weather', name: 'Weather', emoji: '🌦️', clash: [],
    words: ['rain', 'snow', 'wind', 'cloud', 'storm', 'sunny', 'fog', 'hail', 'thunder',
      'lightning', 'rainbow', 'frost', 'breeze', 'drizzle'],
  },
  {
    id: 'transport', name: 'Transport', emoji: '🚌', clash: [],
    words: ['car', 'bus', 'train', 'plane', 'bike', 'boat', 'truck', 'ship', 'tram', 'scooter',
      'taxi', 'helicopter', 'rocket', 'ferry', 'van', 'tractor'],
  },
  {
    id: 'clothes', name: 'Clothes', emoji: '👕', clash: [],
    words: ['shirt', 'dress', 'sock', 'shoe', 'hat', 'coat', 'scarf', 'glove', 'skirt', 'jumper',
      'jeans', 'shorts', 'boots', 'jacket', 'pyjamas', 'belt'],
  },
  {
    id: 'sports', name: 'Sports', emoji: '⚽', clash: [],
    words: ['soccer', 'tennis', 'netball', 'swimming', 'running', 'golf', 'hockey', 'rugby',
      'basketball', 'baseball', 'skiing', 'surfing', 'cycling', 'karate', 'diving', 'gymnastics'],
  },
  {
    id: 'shapes', name: 'Shapes', emoji: '🔷', clash: [],
    words: ['circle', 'square', 'triangle', 'rectangle', 'oval', 'star', 'diamond', 'cube',
      'sphere', 'cone', 'pentagon', 'hexagon', 'cylinder', 'pyramid'],
  },
  {
    id: 'instruments', name: 'Instruments', emoji: '🎸', clash: [],
    words: ['drum', 'piano', 'guitar', 'violin', 'flute', 'trumpet', 'harp', 'recorder', 'cello',
      'tuba', 'banjo', 'xylophone', 'ukulele', 'saxophone', 'trombone', 'tambourine'],
  },
  {
    id: 'jobs', name: 'Jobs', emoji: '👩‍🚒', clash: [],
    words: ['teacher', 'doctor', 'nurse', 'farmer', 'chef', 'pilot', 'baker', 'builder', 'dentist',
      'vet', 'artist', 'plumber', 'firefighter', 'painter', 'author', 'police officer'],
  },
  {
    id: 'ocean', name: 'Ocean Creatures', emoji: '🐬', clash: ['animals'],
    words: ['shark', 'whale', 'dolphin', 'octopus', 'crab', 'starfish', 'jellyfish', 'seal',
      'turtle', 'squid', 'eel', 'lobster', 'seahorse', 'stingray', 'prawn', 'clownfish'],
  },
  {
    id: 'minibeasts', name: 'Minibeasts', emoji: '🐞', clash: ['animals'],
    words: ['ant', 'bee', 'beetle', 'butterfly', 'spider', 'worm', 'snail', 'ladybird', 'fly',
      'moth', 'caterpillar', 'grasshopper', 'mosquito', 'wasp', 'dragonfly', 'slug'],
  },
  {
    id: 'kitchen', name: 'Kitchen Things', emoji: '🍳', clash: [],
    words: ['spoon', 'fork', 'knife', 'plate', 'bowl', 'cup', 'pot', 'pan', 'kettle', 'oven',
      'fridge', 'toaster', 'sink', 'jug', 'whisk', 'teapot'],
  },
  {
    id: 'feelings', name: 'Feelings', emoji: '😊', clash: [],
    words: ['happy', 'sad', 'angry', 'scared', 'excited', 'tired', 'proud', 'nervous', 'calm',
      'silly', 'lonely', 'brave', 'grumpy', 'surprised', 'shy', 'worried'],
  },
];

export const MAX_CUSTOM_CATEGORIES = 5;
export const MAX_CUSTOM_WORDS = 10;
export const MIN_CUSTOM_WORDS = 3;

const norm = (w) => String(w).trim().toLowerCase();

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the conductor's palette for one round.
 * @param {object} cat         the chosen category ({id, words, clash?, custom?})
 * @param {number} distractors how many distractor words to offer
 * @param {number} maxCorrect  how many correct words to offer
 * @returns {{word:string, correct:boolean}[]}
 */
export function buildPalette(cat, distractors, maxCorrect = 12) {
  const correctSet = new Set(cat.words.map(norm));
  const correct = shuffle(cat.words).slice(0, maxCorrect);

  // Distractors come from built-in categories that don't clash with this one.
  // For custom categories, skip any built-in category that shares a word with
  // the custom list (e.g. a custom "Pets" list containing "dog" skips Animals).
  const clash = new Set(cat.clash || []);
  const pool = [];
  for (const other of CATEGORIES) {
    if (other.id === cat.id || clash.has(other.id) || (other.clash || []).includes(cat.id)) continue;
    if (cat.custom && other.words.some((w) => correctSet.has(norm(w)))) continue;
    for (const w of other.words) if (!correctSet.has(norm(w))) pool.push(w);
  }
  const wrong = shuffle(pool).slice(0, distractors);

  return shuffle([
    ...correct.map((word) => ({ word, correct: true })),
    ...wrong.map((word) => ({ word, correct: false })),
  ]);
}
