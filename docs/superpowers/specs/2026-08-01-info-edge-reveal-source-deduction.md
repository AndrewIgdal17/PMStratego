# Information Edge, Reveal Source Tracking & Elimination Deduction — Design Spec

## Problem Statement

The current Info Edge Curve implementation is **bugged** — it shows asymmetry between players that cannot exist from combat reveals alone (combat is always symmetric: both sides learn one rank). The curve diverges for wrong reasons (likely double-counting in the ledger).

Additionally, the `KnowledgeEntry` doesn't track HOW a piece was revealed, causing incorrect narrative generation ("fought and survived" when the piece was actually identified by moving multi-square).

This spec defines:
1. The correct model for information asymmetry in Stratego
2. The `revealSource` field on KnowledgeEntry
3. Elimination deduction (inferring ranks from army composition + kill counts)
4. A corrected Info Edge Curve that only diverges from legitimate asymmetry sources
5. Memory display language cleanup

---

## The Three Legitimate Sources of Information Asymmetry

In Stratego, explicit common knowledge (what was revealed) is shared between players at the moment of reveal. But players can know DIFFERENT things because of:

### Source 1: Scout Movement Inference (One-Directional)

When a piece moves 2+ squares, the observer learns it's a Scout. The Scout's owner learns NOTHING about the observer. This is purely one-directional.

- **Who gains:** The player WATCHING the multi-square move
- **Who doesn't:** The Scout's owner
- **Frequency:** Every time a Scout long-moves. Players who use Scouts conservatively (1 square at a time) avoid giving this away.

### Source 2: Elimination Deduction (One-Directional, Compositional)

Every player knows the exact starting army composition:
- 1 Marshal, 1 General, 2 Colonels, 3 Majors, 4 Captains, 4 Lieutenants, 4 Sergeants, 5 Miners, 8 Scouts, 1 Spy, 6 Bombs, 1 Flag

As pieces die and appear in the graveyard (visible to both), each player can deduce what remains. This creates asymmetry because each player has killed/revealed DIFFERENT pieces at DIFFERENT rates:

**Examples:**
- "I've killed 7 of their 8 Scouts → the next piece that long-moves is definitely their last Scout"
- "I've identified or killed every rank except Flag → that one remaining unrevealed piece MUST be the Flag"
- "I've killed 4 of 5 Miners → if they defuse a Bomb, I know exactly which piece it is"
- "I've killed both Colonels, all 3 Majors, and the General → any strong piece I haven't identified must be the Marshal"

**Why asymmetric:** Player A might have killed enough of B's army to deduce the Flag, while Player B hasn't killed enough of A's army to deduce anything yet.

### Source 3: Combat Reveals Are SYMMETRIC (Do Not Create Asymmetry)

Every combat reveals one rank to each side:
- Attacker learns defender_rank
- Defender learns attacker_rank

This adds +1 knowledge to BOTH players simultaneously. It should NEVER move the Info Edge. The current bug likely treats combat as +1 for one side only.

---

## Reveal Source Tracking

### Current State (Buggy)

`KnowledgeEntry` has no `revealSource` field. `learnPiece()` is called the same way whether the piece was learned via combat or via movement inference. Narrative generation guesses (incorrectly) that all reveals came from combat.

### Required Fix

```typescript
export type RevealSource = 
  | "combat_as_attacker"    // I attacked them, learned their defender's rank
  | "combat_as_defender"    // They attacked me, I learned their attacker's rank
  | "movement_inference"    // They moved 2+ squares, I know it's a Scout
  | "elimination_deduction"; // I deduced rank from army composition + kill counts

export interface KnowledgeEntry {
  pieceId: string;
  rank: string;
  revealedAt: number;
  revealSource: RevealSource;
  lastKnownRow: number;
  lastKnownCol: number;
  lastUpdateMove: number;
  movedSinceReveal: boolean;
  alive: boolean;
}
```

### Impact

| Consumer | What changes |
|---|---|
| **Info Edge Curve** | Only `movement_inference` and `elimination_deduction` create asymmetry. Combat sources are ignored (symmetric). |
| **Memory narrative** | Uses `revealSource` to generate accurate story text |
| **Scout self-reveal rate** (new metric) | Count `movement_inference` events per Scout / total Scout moves |
| **Reveal Efficiency** | Unchanged — still counts first-contact attack wins on unknown pieces |
| **`learnPiece()` function** | Gains a `source: RevealSource` parameter |

---

## Elimination Deduction Model

### Concept

At any point during a game, a player might be able to DEDUCE an enemy piece's rank without ever fighting it or seeing it long-move. The deduction comes from: "I know what every other piece is (revealed or killed), so this one MUST be X."

### Army Composition Constants

```typescript
const ARMY_COMPOSITION: Record<string, number> = {
  "1": 1, "2": 1, "3": 2, "4": 3, "5": 4, "6": 4, "7": 4, "8": 5, "9": 8, "10": 1, "BOMB": 6, "FLAG": 1
};
```

### Deduction Algorithm

After each combat (where pieces are killed or revealed), check if any remaining unrevealed enemy pieces can be deduced:

```typescript
function checkEliminationDeductions(
  myLedger: KnowledgeLedger,        // pieces I already know
  deadEnemyRanks: Map<string, number>, // enemy ranks killed (rank → count)
  totalEnemyPieces: number,          // 40
): Array<{ pieceId: string; deducedRank: string }> {
  
  // Count how many of each rank are accounted for (known alive + killed)
  const accountedFor: Record<string, number> = {};
  for (const [_, entry] of myLedger) {
    accountedFor[entry.rank] = (accountedFor[entry.rank] ?? 0) + 1;
  }
  for (const [rank, count] of deadEnemyRanks) {
    accountedFor[rank] = (accountedFor[rank] ?? 0) + count;
  }
  
  // Find ranks with exactly (total - 1) accounted for → remaining piece must be that rank
  const deductions: Array<{ pieceId: string; deducedRank: string }> = [];
  
  // For each unrevealed alive enemy piece, check if only one rank is possible
  // (This requires knowing which pieces are alive but unrevealed — from pieces table minus ledger)
  
  return deductions;
}
```

### Simplified V1

Full deduction (checking every unrevealed piece against all remaining possible ranks) is complex. Simplified v1:

**Single-remaining deduction:** If a rank has `ARMY_COMPOSITION[rank] - 1` accounted for (revealed + killed), and exactly 1 unrevealed enemy piece could have that rank, then that piece IS that rank.

**Flag deduction (endgame):** If all mobile ranks are accounted for and only immobile pieces remain unrevealed → they must be Bombs or Flag. If 5 of 6 Bombs are accounted for → the remaining immobile unrevealed piece that isn't in a Bomb position is the Flag.

### When to Run

After each combat (where a piece dies or is newly revealed), re-check deductions. This is O(ranks × unrevealed_pieces) which is fast (at most 12 × 40 = 480 checks).

### Storage

When a deduction fires, add to `myLedger` with `revealSource: "elimination_deduction"`. This counts toward Info Edge (one-directional) because the other player may NOT have enough information to make the same deduction.

---

## Corrected Info Edge Curve

### Formula

```
InfoEdge_P(t) = asymmetric_knowledge_P(t) - asymmetric_knowledge_opponent(t)
```

Where `asymmetric_knowledge` counts ONLY:
- Pieces learned via `movement_inference` 
- Pieces learned via `elimination_deduction`

Combat reveals are symmetric and contribute 0 to the edge.

### Alternative Formula (Total Knowledge Differential)

If you want to show TOTAL knowledge (not just asymmetric):

```
TotalKnowledge_P(t) = |myLedger at time t|
InfoEdge_P(t) = TotalKnowledge_P(t) - TotalKnowledge_opponent(t)
```

This diverges when one player has more Scout inferences + deductions. But it also diverges if one player attacks more (and thus reveals more of their OWN pieces to the opponent). Wait — no. Attacks reveal both sides equally.

The ONLY way total knowledge differs is:
1. Scout inferences (observer gains +1, owner gains +0)
2. Elimination deductions (deducer gains +1, other player gains +0)

So even with total knowledge, the edge should only move from these two sources.

### Per-Game Storage

```json
"info_edge_curve": {
  "slot1": [0, 0, 1, 1, 1, 2, ...],  // slot 1's edge over slot 2 after each combat
  "slot2": [0, 0, -1, -1, -1, -2, ...]  // inverse
}
```

---

## Memory Display Language Cleanup

### Current (Bad)
- "29w, 0 misses" — meaningless to players
- "track_strike MISS, weight 9" — internal jargon

### Fixed
- Show: "100% (0 mistakes)" or "Perfect — no memory errors"
- Show: "4/5 correct" not "weighted sum 37"
- Narrative: "Attacked where a Scout used to be — it had moved 63 turns ago" not "track_strike MISS"
- When explaining HOW something was revealed: "Identified as Scout from multi-square movement" not "fought and survived"

### Weight Still Used for Scoring

Weights (`RANK_VALUE[piece]`) are still used internally to compute the Memory Score (expensive mistakes count more). But the DISPLAY shows:
- The percentage (weighted score)
- The count (unweighted: X/Y correct)
- Never the raw weight numbers

---

## New Metric: Scout Self-Reveal Rate

**What it measures:** How often your Scouts give away their identity by long-moving.

**Computation:** `movement_inference events targeting your Scouts / total moves by your Scouts`

**Why interesting:** Disciplined players move Scouts one square at a time in enemy territory (no reveal) and only long-move in safe positions. Reckless players long-move everywhere, giving free information to the opponent.

**Profile display:** Under Information Warfare section. Tooltip: "How often your Scouts reveal themselves by moving 2+ squares — lower = more disciplined Scout usage"

---

## Implementation Order

1. Add `revealSource` to `KnowledgeEntry` + update `learnPiece()` calls
2. Fix Info Edge Curve to only count asymmetric sources
3. Implement elimination deduction (simplified v1)
4. Fix memory narrative generation to use `revealSource`
5. Clean up memory display language (no raw weights)
6. Add Scout Self-Reveal Rate metric
7. Deploy + recompute

---

## Design Decisions

1. **Combat is symmetric** — never moves the Info Edge
2. **Elimination deduction runs after each combat** — O(ranks × unrevealed) per check
3. **Deduction is one-directional** — only the player with enough kills/reveals to deduce gains the knowledge
4. **V1 simplified deduction** — only single-remaining-of-rank deduction. Full constraint propagation deferred.
5. **Display shows percentages + counts** — never raw weights
6. **Narrative accuracy from revealSource** — how a piece was identified determines the story text
