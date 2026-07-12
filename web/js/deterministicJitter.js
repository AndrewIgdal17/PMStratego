// web/js/deterministicJitter.js
//
// The bot's difficulty logic needs small, believable randomness (so two
// games at the same difficulty don't behave identically) without becoming
// stateful -- makeBotMove re-derives everything fresh from the database
// every turn (matching this codebase's existing self-healing pattern,
// e.g. move_number is derived from actual table content rather than
// trusted from a separately-tracked counter), and there is no per-game
// object to cache a random roll in across turns.
//
// A deterministic hash of a stable seed (a piece_id, or a
// piece_id+move_number pair) gives the exact same "roll" every time it's
// queried for that seed, with no storage needed -- mathematically
// equivalent to "rolled once and cached," achieved statelessly.

export function defaultJitterSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) / 0xffffffff;
}

// Returns a factor in [0.8, 1.2] (+/- 20%), deterministic for a given seed.
export function jitterFactor(seed, seedFn = defaultJitterSeed) {
  return (8 + seedFn(seed) * 4) / 10;
}
