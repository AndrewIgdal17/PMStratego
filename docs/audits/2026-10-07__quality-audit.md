---
tags: [project/stratego]
---

# PMStratego Quality & Bug Audit — 2026-10-07

**Scope:** Full codebase audit of `Projects/Stratego/code/` (frontend JS, CSS, HTML, test suite).
**Edge Functions** are out of scope (not checked out locally in the submodule).
**Method:** Each section produced by an independent reviewer examining one subsystem.

## Summary

| Area | Bugs | Quality Issues | Gotchas | Recommendations |
|------|------|----------------|---------|-----------------|
| Rules Engine | 0 | 7 (1 HIGH, 1 MEDIUM, 5 LOW) | 4 | 5 |
| *(filled in by each task)* | | | | |

---

<!-- == SECTION TEMPLATE (do not delete — reviewers copy this) ==

## [Area Name]

**Files reviewed:** `path/to/file.js` (N lines), ...

### Bugs

| # | Severity | Location | Description | Suggested Fix |
|---|----------|----------|-------------|---------------|
| 1 | HIGH | `file.js:42` | What's wrong | How to fix it |

*If none found, write "No bugs found."*

### Quality Issues

| # | Severity | Location | Description | Recommendation |
|---|----------|----------|-------------|----------------|
| 1 | MEDIUM | `file.js:42` | What's suboptimal | What to do instead |

*If none found, write "No quality issues found."*

### Confusing Code & Gotchas

| # | Location | What's Confusing | Why It Matters |
|---|----------|-----------------|----------------|
| 1 | `file.js:42` | Description | How someone could get burned |

*If none found, write "No gotchas found."*

### Positive Observations

- Things done well in this area (at least 1).

### Recommendations

1. Prioritized list of what to fix/improve, with estimated effort (trivial/small/medium/large).

== END TEMPLATE == -->

## Rules Engine

**Files reviewed:** `web/js/rules/board.js` (18 lines), `web/js/rules/pieces.js` (35 lines), `web/js/rules/movement.js` (59 lines), `web/js/rules/combat.js` (23 lines), `web/js/rules/twoSquareRule.js` (15 lines), `web/js/rules/game.js` (110 lines); `test/rules/board.test.js`, `test/rules/pieces.test.js`, `test/rules/movement.test.js`, `test/rules/combat.test.js`, `test/rules/twoSquareRule.test.js`, `test/rules/game.test.js` (38 tests total, all passing under `node --test`).

**Correctness summary:** `resolveCombat`, `isLake`, `validateMove`, `applyMove`'s end-of-game checks, and `violatesTwoSquareRule` were each traced against the official Stratego rules cited in the brief and found correct. No logic bugs were found in this subsystem. The findings below are quality, coverage, and maintainability issues.

### Bugs

No bugs found. (Note: `test/rules/*.test.js` import from `../../src/rules/*.js`, not `web/js/rules/*.js` — see Quality Issue #1. All behavioral checks below were cross-verified against both copies, which are currently byte-identical.)

### Quality Issues

| # | Severity | Location | Description | Recommendation |
|---|----------|----------|-------------|----------------|
| 1 | HIGH | `web/js/rules/*.js` (all 6 files); duplicated at `src/rules/*.js` and `supabase/functions/_shared/rules/*.js` | The rules engine exists as three independently-maintained, byte-for-byte copies (confirmed via `diff`, all three identical as of this audit). Git history shows they were created by manual copy commits (`11e24ce`, `db76835`) with no sync script, build step, or CI check to keep them in sync. The test suite (`test/rules/*.test.js`) imports exclusively from `src/rules/`, so **the browser-served copy (`web/js/rules/`) and the Edge Function copy (`supabase/functions/_shared/rules/`) have zero automated test coverage.** A future edit to one copy (e.g. a bug fix applied only to `src/rules/`) would silently diverge from what players and Edge Functions actually run, and nothing in CI would catch it. | Pick one canonical source directory and either (a) symlink the other two to it, (b) add a build/copy step that runs before tests and deploy, or (c) add a CI check that `diff`s all three directories and fails on drift. Medium effort. |
| 2 | LOW | `web/js/rules/game.js:90` | `getLegalMoves` re-implements the "is this piece movable" check (`p.rank !== RANK.BOMB && p.rank !== RANK.FLAG`) inline instead of importing and reusing `isMovableRank` from `pieces.js:33-35` (already imported transitively via `movement.js`). If a third immovable rank were ever added, this call site would need a separate, easy-to-miss update. | Import `isMovableRank` from `./pieces.js` and use `isMovableRank(p.rank)` in the filter predicate. Trivial effort. |
| 3 | MEDIUM | `web/js/rules/game.js:108-110` | `hasAnyLegalMove` calls `getLegalMoves(...).length > 0`, which fully enumerates every legal move for every movable piece across all 100 squares before checking the length. Since this is called on every single `applyMove` (to detect a stalemate win), it does far more work than necessary — it only needs to find one legal move, not all of them. With up to ~33 movable pieces this is on the order of thousands of `pieceAt` scans per move, repeated every turn. | Give `hasAnyLegalMove` its own short-circuiting loop that returns `true` as soon as one legal destination is found, instead of delegating to `getLegalMoves`. Small effort. |
| 4 | LOW | `web/js/rules/pieces.js:1-14` | The `RANK` enum mixes numeric ranks (`1`–`10`) with string sentinels (`'BOMB'`, `'FLAG'`) in the same object. This works today only because every comparison site checks `=== RANK.BOMB` / `=== RANK.FLAG` before falling through to the numeric `<` comparison in `combat.js:22`. It is a fragile convention — a new call site that forgets the string check and does a bare numeric comparison would get silently wrong results (`'BOMB' < 5` is `false` in JS, not a thrown error), since there's no type system to catch it. | Document the convention inline, or model Bomb/Flag as a separate `SPECIAL` or `isBomb`/`isFlag` check instead of overloading `RANK` with mixed types. Small effort (mostly documentation if not refactoring). |
| 5 | LOW | `test/rules/movement.test.js` | `validateMove`'s `'ILLEGAL_DESTINATION'` reason (`movement.js:57`) is never asserted directly through a `validateMove(...)` call — it's only exercised indirectly via the many direct `isLegalDestination` tests. Every other `validateMove` reason (`NO_PIECE_AT_SOURCE`, `NOT_YOUR_PIECE`, `PIECE_CANNOT_MOVE`) has a dedicated test. | Add one `validateMove` test asserting `reason === 'ILLEGAL_DESTINATION'` for a same-player piece with a valid rank but an out-of-range destination. Trivial effort. |
| 6 | LOW | `test/rules/combat.test.js` | `resolveCombat` has no test where the Spy attacks (or is attacked by) anything other than the Marshal. The Spy's "loses to everything except an attack on the Marshal" behavior is only implicit in the generic numeric-comparison test (`GENERAL` vs `COLONEL`), not verified for the Spy's own rank. | Add a test asserting `resolveCombat(RANK.SPY, RANK.GENERAL)` is `DEFENDER_WINS` (Spy attacking anything but the Marshal loses normally). Trivial effort. |
| 7 | LOW | `test/rules/game.test.js` | `getLegalMoves` is only exercised with a single Sergeant (one-step orthogonal mover). There is no test driving a Scout's multi-square enumeration, lake-blocked paths, or occupied-square blocking through `getLegalMoves` itself — that logic is covered only at the lower `isLegalDestination` layer in `movement.test.js`. A future refactor of the `getLegalMoves` double-loop (e.g. changing how it calls `validateMove`) could break Scout move enumeration specifically without any test in `game.test.js` catching it. | Add one `getLegalMoves` test with a Scout to confirm multi-square destinations, blocked paths, and lake squares are all reflected end-to-end. Small effort. |

### Confusing Code & Gotchas

| # | Location | What's Confusing | Why It Matters |
|---|----------|-----------------|----------------|
| 1 | `web/js/rules/movement.js:34-46` | The task brief's own review notes speculated that a Scout moving exactly one square might double-validate through both `isClearScoutPath` and `isOrthogonalAdjacent`. In the actual code, the two paths are mutually exclusive (`if (mover.rank === RANK.SCOUT) { return isClearScoutPath(...); } return isOrthogonalAdjacent(...);`), so a 1-square Scout move goes through `isClearScoutPath` only, whose `while` loop body never executes for a distance-1 move (it returns `true` immediately). No double-validation exists — but a reader unfamiliar with this control flow could easily make the same wrong assumption the brief did. | Worth a short comment on `isLegalDestination` noting the branch is mutually exclusive by rank, to pre-empt this exact confusion in future reviews. |
| 2 | `web/js/rules/movement.js:18` | `isClearScoutPath`'s `if (sameRow && sameCol) return false;` guard is unreachable dead code at the current call site: `isLegalDestination` already returns `false` for `from === to` before `isClearScoutPath` is ever called (line 37). It's a harmless defensive check, but it implies `isClearScoutPath` might be safe to call directly elsewhere — it currently isn't exported, so it isn't. | A future developer who exports this helper for reuse might assume it's safe standalone, when in practice it depends on its only caller having already filtered the same-square case. |
| 3 | `web/js/rules/twoSquareRule.js:13-14` | The core violation check collapses five squares (`last3[0].from`, `last3[0].to`, `last3[1].to`, `last3[2].to`, `to`) into a `Set` and tests `size === 2`. This is a correct and compact way to detect a strict A↔B↔A↔B↔A alternation, but it is non-obvious on first read — it relies on the earlier chained `.to !== .from` checks (lines 9-11) to guarantee the five squares form a contiguous path, which isn't visible at the `Set` construction line itself. | A maintainer modifying the chain-of-custody checks above without understanding they're a precondition for the `Set` trick could silently break two-square-rule enforcement. |
| 4 | `web/js/rules/game.js:68` | `nextTurnSlot = playerSlot === 1 ? 2 : 1` hardcodes a 2-player, slot-{1,2} assumption with no validation that `playerSlot` is actually `1` or `2`. If `applyMove` were ever called with an invalid `playerSlot` (e.g. `3`, `undefined`, or a string), this silently computes `nextTurnSlot = 1` rather than rejecting the call. | Not exploitable today since callers presumably only pass `1`/`2`, but there's no guard rail if that assumption is ever violated by a caller bug. |

### Positive Observations

- `resolveCombat` (`combat.js:9-23`) is a clean, linear translation of the official combat table — every special case (Flag, Bomb/Miner, Spy/Marshal, ties) is a single early-return guard clause, making it easy to verify against the rulebook line-by-line.
- `twoSquareRule.js:1-4` opens with a comment that states the exact semantic the function implements, including the specific "whose history counts, and what breaks the streak" ambiguity the task brief asked reviewers to check — this is the kind of comment that prevents the exact misreading the brief anticipated.
- `violatesTwoSquareRule` has thorough, well-named edge-case test coverage (empty history, <3 moves, 3rd-square escape, different piece, interleaved opponent move) — this is the best-tested function in the subsystem and a good model for the other rules modules.
- `isLake`'s 8-square lookup table (`board.js:3-6`) matches the official board geometry exactly, and is tested exhaustively for both the 8 lake squares and 4 adjacent non-lake squares (`board.test.js:17-31`), closing off an easy off-by-one class of bug.
- The pure-function design of the whole subsystem (no mutation of input `pieces` arrays; `applyMove` always returns a new `newState` via `state.pieces.map((p) => ({ ...p }))` at `game.js:30`) makes every function here trivially testable in isolation, which is reflected in the test suite's speed and clarity.

### Recommendations

1. **(Medium)** Resolve the triple-copy rules engine (Quality Issue #1) — either symlink/build-step the three directories together or add a CI drift check. This is the single highest-leverage fix in this subsystem: it's the only finding with a plausible path to an undetected game-breaking regression reaching production undetected.
2. **(Small)** Add the three missing test cases (Issues #5, #6, #7: `validateMove` ILLEGAL_DESTINATION, Spy-loses-normally, Scout through `getLegalMoves`) to close the coverage gaps identified above.
3. **(Small)** Short-circuit `hasAnyLegalMove` (Issue #3) instead of delegating to `getLegalMoves().length > 0`, since it runs on every move.
4. **(Trivial)** Replace the duplicated Bomb/Flag filter in `game.js:90` with `isMovableRank` (Issue #2).
5. **(Trivial)** Add a one-line comment at `movement.js:42` clarifying that the Scout/non-Scout branches are mutually exclusive, to prevent the exact confusion the task brief itself raised (Gotcha #1).
