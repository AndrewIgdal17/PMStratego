---
tags: [project/stratego]
---

# Info Edge, Reveal Source & Elimination Deduction — Implementation Plan

## Related

- [[Stratego MOC]]
- [[Projects/Stratego/PROJECT_MEMORY]]
- Design spec: `Projects/Stratego/code/docs/superpowers/specs/2026-08-01-info-edge-reveal-source-deduction.md`
- Prior IW plan: `docs/superpowers/plans/2026-08-01-information-warfare-memory.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Info Edge Curve so it only diverges from legitimate asymmetry (Scout movement inference + elimination deduction), track `reveal_source` on every ledger learn, add simplified v1 single-remaining deduction, fix memory narratives/display, and ship Scout Self-Reveal Rate.

**Architecture:** Extend `KnowledgeEntry` with `reveal_source`. Thread the source through every `learnPiece()` call. Fix the missing bidirectional Scout inference (own long-moves must teach `theirLedger`). Compute Info Edge from asymmetric-source counts only. Run v1 elimination deduction after each combat. Wire corrected curves into `story.info_edge_curve` (replace the legacy combat-only `knownBySlot` path). Profile shows unweighted X/Y + weighted %, never raw weights. New career columns for Scout self-reveal. Story-only recompute path avoids Elo double-application.

**Tech Stack:** Supabase (Postgres + Deno Edge Functions), vanilla HTML/CSS/JS ES modules. Tests: `deno test` for `_shared/information-warfare*.ts`.

## Global Constraints

- Supabase project ref: `cafqbrzaxcwewwtyqpnf`
- Deploy: `npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf`; `npx supabase db push --linked`
- Rank: `R.MARSHAL="1"` … `R.SPY="10"`, `R.BOMB="BOMB"`, `R.FLAG="FLAG"`
- Army composition (counts): `{"1":1,"2":1,"3":2,"4":3,"5":4,"6":4,"7":4,"8":5,"9":8,"10":1,"BOMB":6,"FLAG":1}`
- `KnowledgeEntry` fields stay **snake_case** to match existing ledger code (`piece_id`, `revealed_at`, …). Spec’s `revealSource` → code field `reveal_source`
- Reveal sources (exact strings): `"combat_as_attacker" | "combat_as_defender" | "movement_inference" | "elimination_deduction"`
- Combat reveals are **symmetric** — never contribute to Info Edge
- Info Edge only counts `movement_inference` + `elimination_deduction`
- V1 deduction = single-remaining total army slot (exactly 1 unrevealed alive enemy piece AND exactly 1 unaccounted composition slot). Flag/Bomb constraint propagation deferred
- `learnPiece` on update: refresh position/rank/alive; **do not overwrite** `reveal_source`
- Recompute must **not** re-apply Elo. Use `story_only` mode for backfill
- Migration number: **0015**
- Direct commits to main
- Frontend: vanilla ES modules, `data-tooltip` for help text

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/information-warfare.ts` | `RevealSource`, `reveal_source` on entries, `learnPiece` source param, bidirectional Scout inference, asymmetric count, elimination deduction, narrative text, scout self-reveal counters, Info Edge formula |
| `supabase/functions/_shared/information-warfare.test.ts` | Deno tests for source tagging, edge formula, deduction, narratives, scout self-reveal |
| `supabase/functions/compute-stats/index.ts` | Drop legacy `knownBySlot` edge; write IW asymmetric curves to story; `story_only` mode; career scout self-reveal writes |
| `supabase/migrations/0015_scout_self_reveal.sql` | `scout_self_reveal_events` column |
| `web/js/profile.js` | Memory X/Y display; Scout Self-Reveal Rate row |
| `web/js/gameDetail.js` | Info Edge tooltip copy (asymmetric sources) |
| `scripts/backfill-stats.sh` | Story-only recompute loop |

---

### Task 1: `reveal_source` + `learnPiece` + Bidirectional Scout Inference

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Produces:
  - `export type RevealSource = "combat_as_attacker" | "combat_as_defender" | "movement_inference" | "elimination_deduction"`
  - `KnowledgeEntry.reveal_source: RevealSource`
  - `learnPiece(ledger, pieceId, rank, row, col, moveNumber, source): boolean`
  - Bidirectional Scout inference inside `applyLedgerUpdatesFromMove`
- Consumes: existing `inferScoutFromMove`, ledgers

- [ ] **Step 1: Write failing tests for source tagging + bidirectional Scout**

Append to `information-warfare.test.ts`:

```typescript
import {
  // ...existing imports...
  type RevealSource,
  asymmetricKnowledgeCount,
} from "./information-warfare.ts";

Deno.test("learnPiece stores reveal_source and preserves it on update", () => {
  const L = createLedger();
  assertEquals(
    learnPiece(L, "a", "9", 3, 3, 5, "movement_inference"),
    true,
  );
  assertEquals(L.get("a")!.reveal_source, "movement_inference");
  assertEquals(
    learnPiece(L, "a", "9", 4, 4, 8, "combat_as_attacker"),
    false,
  );
  assertEquals(L.get("a")!.reveal_source, "movement_inference");
  assertEquals(L.get("a")!.last_known_row, 4);
  assertEquals(L.get("a")!.last_update_move, 8);
});

Deno.test("bidirectional Scout inference: my long-move teaches theirLedger", () => {
  const my = createLedger();
  const their = createLedger();
  const vacated = new Map();
  const pieces = new Map<string, PieceLike>([
    ["scout", { id: "scout", player_slot: 1, rank: "9", alive: true }],
    ["e1", { id: "e1", player_slot: 2, rank: "5", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "scout",
      player_slot: 1,
      from_row: 7,
      from_col: 0,
      to_row: 4,
      to_col: 0,
      move_type: "move",
      outcome: null,
      attacker_rank: null,
      defender_rank: null,
      defender_piece_id: null,
      move_number: 3,
    },
    1,
    my,
    their,
    vacated,
    pieces,
  );
  assertEquals(their.has("scout"), true);
  assertEquals(their.get("scout")!.rank, "9");
  assertEquals(their.get("scout")!.reveal_source, "movement_inference");
  assertEquals(my.size, 0);
});

Deno.test("enemy Scout long-move teaches myLedger with movement_inference", () => {
  const my = createLedger();
  const their = createLedger();
  const pieces = new Map<string, PieceLike>([
    ["escout", { id: "escout", player_slot: 2, rank: "9", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "escout",
      player_slot: 2,
      from_row: 2,
      from_col: 0,
      to_row: 5,
      to_col: 0,
      move_type: "move",
      outcome: null,
      attacker_rank: null,
      defender_rank: null,
      defender_piece_id: null,
      move_number: 4,
    },
    1,
    my,
    their,
    new Map(),
    pieces,
  );
  assertEquals(my.get("escout")!.reveal_source, "movement_inference");
});

Deno.test("combat learn tags combat_as_attacker / combat_as_defender", () => {
  const my = createLedger();
  const their = createLedger();
  const pieces = new Map<string, PieceLike>([
    ["me", { id: "me", player_slot: 1, rank: "3", alive: true }],
    ["them", { id: "them", player_slot: 2, rank: "5", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "me",
      player_slot: 1,
      from_row: 5,
      from_col: 0,
      to_row: 4,
      to_col: 0,
      move_type: "attack",
      outcome: "ATTACKER_WINS",
      attacker_rank: "3",
      defender_rank: "5",
      defender_piece_id: "them",
      move_number: 10,
    },
    1,
    my,
    their,
    new Map(),
    pieces,
  );
  assertEquals(my.get("them")!.reveal_source, "combat_as_attacker");
  assertEquals(their.get("me")!.reveal_source, "combat_as_defender");
});
```

Update **every existing** `learnPiece(...)` call in the test file to pass a source as the 7th argument (use `"combat_as_attacker"` for identity-test fixtures).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd Projects/Stratego/code
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: FAIL — `reveal_source` / 7th arg / bidirectional Scout not implemented; existing `learnPiece` arity mismatches.

- [ ] **Step 3: Implement types + `learnPiece` + Scout bidirectionality**

In `information-warfare.ts`, replace the `KnowledgeEntry` / `learnPiece` / scout block:

```typescript
export type RevealSource =
  | "combat_as_attacker"
  | "combat_as_defender"
  | "movement_inference"
  | "elimination_deduction";

export interface KnowledgeEntry {
  piece_id: string;
  rank: string;
  revealed_at: number;
  reveal_source: RevealSource;
  last_known_row: number;
  last_known_col: number;
  last_update_move: number;
  moved_since_reveal: boolean;
  alive: boolean;
}

export function learnPiece(
  ledger: KnowledgeLedger,
  pieceId: string,
  rank: string,
  row: number,
  col: number,
  moveNumber: number,
  source: RevealSource,
): boolean {
  const existing = ledger.get(pieceId);
  if (existing) {
    existing.rank = rank;
    existing.last_known_row = row;
    existing.last_known_col = col;
    existing.last_update_move = moveNumber;
    if (!existing.alive) existing.alive = true;
    // Preserve original reveal_source — do not overwrite
    return false;
  }
  ledger.set(pieceId, {
    piece_id: pieceId,
    rank,
    revealed_at: moveNumber,
    reveal_source: source,
    last_known_row: row,
    last_known_col: col,
    last_update_move: moveNumber,
    moved_since_reveal: false,
    alive: true,
  });
  return true;
}
```

In `applyLedgerUpdatesFromMove`, replace the scout + combat learn section with:

```typescript
  // Scout inference — ONE-DIRECTIONAL toward the observer
  if (isEnemyMove && inferScoutFromMove(m)) {
    learnPiece(
      myLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number,
      "movement_inference",
    );
  }
  if (isMyMove && inferScoutFromMove(m)) {
    learnPiece(
      theirLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number,
      "movement_inference",
    );
  }

  // Position updates for pieces already in ledgers
  if (isEnemyMove) {
    updatePiecePosition(
      myLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col,
      m.move_number, myVacated,
    );
  } else {
    updatePiecePosition(
      theirLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col,
      m.move_number, new Map(),
    );
  }

  if (m.move_type !== "attack" || !m.outcome || !m.defender_piece_id) return;

  if (isMyMove) {
    if (m.defender_rank) {
      learnPiece(
        myLedger, m.defender_piece_id, m.defender_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_attacker",
      );
    }
    if (m.attacker_rank) {
      learnPiece(
        theirLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_defender",
      );
    }
  } else {
    if (m.attacker_rank) {
      learnPiece(
        myLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_defender",
      );
    }
    const def = pieceById.get(m.defender_piece_id);
    if (def && def.player_slot === slot) {
      learnPiece(
        theirLedger, m.defender_piece_id, def.rank, m.to_row, m.to_col,
        m.move_number, "combat_as_attacker",
      );
    }
  }

  // Deaths (unchanged)
  if (m.outcome === "ATTACKER_WINS") {
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  } else if (m.outcome === "DEFENDER_WINS") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
  } else if (m.outcome === "TIE") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  }
```

Note on combat source names from each ledger’s POV:
- `myLedger` when I attack → I learned defender as attacker → `"combat_as_attacker"`
- `theirLedger` when I attack → they learned my attacker as defender → `"combat_as_defender"`
- `myLedger` when enemy attacks me → I learned their attacker as defender → `"combat_as_defender"`
- `theirLedger` when enemy attacks me → they learned my defender as attacker → `"combat_as_attacker"`

- [ ] **Step 4: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: PASS (all prior + new source tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts \
        supabase/functions/_shared/information-warfare.test.ts
git commit -m "$(cat <<'EOF'
feat(iw): add reveal_source to ledger learns and fix bidirectional Scout inference

EOF
)"
```

---

### Task 2: Corrected Info Edge Curve (Asymmetric Sources Only)

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/gameDetail.js`

**Interfaces:**
- Consumes: `KnowledgeEntry.reveal_source` from Task 1
- Produces:
  - `asymmetricKnowledgeCount(ledger): number`
  - `IWGameResult.infoEdgeCurve` uses asymmetric formula
  - `story.info_edge_curve` written from IW pass (not legacy `knownBySlot`)

- [ ] **Step 1: Write failing tests for asymmetric edge**

```typescript
Deno.test("asymmetricKnowledgeCount ignores combat sources", () => {
  const L = createLedger();
  learnPiece(L, "a", "5", 1, 1, 1, "combat_as_attacker");
  learnPiece(L, "b", "9", 2, 2, 2, "movement_inference");
  learnPiece(L, "c", "FLAG", 3, 3, 3, "elimination_deduction");
  assertEquals(asymmetricKnowledgeCount(L), 2);
});

Deno.test("info edge stays 0 across pure combat (symmetric)", () => {
  const pieces: PieceLike[] = [
    { id: "a1", player_slot: 1, rank: "3", alive: true, row_idx: 6, col_idx: 0 },
    { id: "a2", player_slot: 1, rank: "4", alive: true, row_idx: 6, col_idx: 1 },
    { id: "b1", player_slot: 2, rank: "5", alive: true, row_idx: 3, col_idx: 0 },
    { id: "b2", player_slot: 2, rank: "6", alive: true, row_idx: 3, col_idx: 1 },
  ];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const moves: MoveLike[] = [
    {
      piece_id: "a1", player_slot: 1, from_row: 6, from_col: 0, to_row: 3, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "3",
      defender_rank: "5", defender_piece_id: "b1", move_number: 1,
    },
    {
      piece_id: "b2", player_slot: 2, from_row: 3, from_col: 1, to_row: 6, to_col: 1,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "6",
      defender_rank: "4", defender_piece_id: "a2", move_number: 2,
    },
  ];
  const iw = runInformationWarfarePass(1, moves, pieces, pieceById, 2);
  assertEquals(iw.infoEdgeCurve.every((v) => v === 0), true);
});

Deno.test("info edge moves +1 when enemy Scout long-moves", () => {
  const pieces: PieceLike[] = [
    { id: "me", player_slot: 1, rank: "5", alive: true, row_idx: 7, col_idx: 0 },
    { id: "escout", player_slot: 2, rank: "9", alive: true, row_idx: 2, col_idx: 0 },
  ];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const moves: MoveLike[] = [
    {
      piece_id: "escout", player_slot: 2, from_row: 2, from_col: 0, to_row: 5, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 1,
    },
    {
      piece_id: "me", player_slot: 1, from_row: 7, from_col: 0, to_row: 6, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 2,
    },
    // Dummy combat so curve samples after asymmetric knowledge exists
    {
      piece_id: "me", player_slot: 1, from_row: 6, from_col: 0, to_row: 5, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "5",
      defender_rank: "9", defender_piece_id: "escout", move_number: 3,
    },
  ];
  const iw = runInformationWarfarePass(1, moves, pieces, pieceById, 3);
  // After combat sample: scout was movement_inference (asymmetric +1);
  // combat adds symmetric knowledge (ignored). Edge should be +1.
  assertEquals(iw.infoEdgeCurve[iw.infoEdgeCurve.length - 1], 1);
});
```

Add `runInformationWarfarePass` and `MoveLike` to the test imports.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: FAIL — `asymmetricKnowledgeCount` missing; curve still uses `ledger.size`.

- [ ] **Step 3: Implement asymmetric count + edge formula**

```typescript
export function asymmetricKnowledgeCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) {
    if (
      e.reveal_source === "movement_inference" ||
      e.reveal_source === "elimination_deduction"
    ) {
      n++;
    }
  }
  return n;
}
```

In `runInformationWarfarePass`, replace:

```typescript
    if (m.move_type === "attack" && m.outcome) {
      infoEdgeCurve.push(myLedger.size - theirLedger.size);
    }
```

with:

```typescript
    if (m.move_type === "attack" && m.outcome) {
      infoEdgeCurve.push(
        asymmetricKnowledgeCount(myLedger) -
          asymmetricKnowledgeCount(theirLedger),
      );
    }
```

- [ ] **Step 4: Wire compute-stats story from IW; delete legacy knownBySlot edge**

In `compute-stats/index.ts`:

1. Remove the legacy block that builds `knownBySlot1` / `knownBySlot2` / pushes `infoEdgeP1`/`infoEdgeP2` during the first moves loop (the combat Set adds around the “Info Edge — attacker learns defender” comment).
2. Initialize empty arrays before the per-slot loop:

```typescript
  const infoEdgeBySlot: { slot1: number[]; slot2: number[] } = {
    slot1: [],
    slot2: [],
  };
```

3. When building initial `story`, set:

```typescript
    info_edge_curve: infoEdgeBySlot,
```

4. Inside the per-slot loop after `runInformationWarfarePass`:

```typescript
    infoEdgeBySlot[slot === 1 ? "slot1" : "slot2"] = iw.infoEdgeCurve;
```

5. Before the final `game_summaries` upsert (story already holds the object by reference), ensure both slots are filled — no extra assignment needed if `info_edge_curve` points at `infoEdgeBySlot`.

Remove unused `infoEdgeP1` / `infoEdgeP2` / `knownBySlot1` / `knownBySlot2` variables entirely.

- [ ] **Step 5: Update game detail tooltip**

In `web/js/gameDetail.js` `renderInfoEdge`:

```javascript
function renderInfoEdge(infoEdge, slot) {
  const series = infoEdge?.[`slot${slot}`] || [];
  renderLineChart(
    "game-info-edge",
    "Information Edge",
    "Asymmetric knowledge advantage after each combat: Scout inferences + elimination deductions you hold minus those the enemy holds. Pure combat reveals are symmetric and do not move this curve.",
    series,
    null,
  );
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts \
        supabase/functions/_shared/information-warfare.test.ts \
        supabase/functions/compute-stats/index.ts \
        web/js/gameDetail.js
git commit -m "$(cat <<'EOF'
fix(iw): Info Edge counts only Scout inference and deduction asymmetry

EOF
)"
```

---

### Task 3: Elimination Deduction (Simplified V1)

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Consumes: `learnPiece(..., "elimination_deduction")`, `ARMY_COMPOSITION_IW`
- Produces:
  - `export const ARMY_COMPOSITION_IW: Record<string, number>`
  - `checkEliminationDeductions(ledger, enemyPieces, boardAlive): Array<{ pieceId: string; deducedRank: string }>`
  - Called from `runInformationWarfarePass` after combat ledger updates (both perspectives)

- [ ] **Step 1: Write failing deduction tests**

```typescript
Deno.test("v1 deduction: last unrevealed piece is unique remaining rank", () => {
  const L = createLedger();
  // Account for everything except FLAG (1 left) — invent 39 accounted entries via composition
  const ranks = ["1", "2", "3", "3", "4", "4", "4", "5", "5", "5", "5",
    "6", "6", "6", "6", "7", "7", "7", "7", "8", "8", "8", "8", "8",
    "9", "9", "9", "9", "9", "9", "9", "9", "10",
    "BOMB", "BOMB", "BOMB", "BOMB", "BOMB", "BOMB"];
  ranks.forEach((r, i) => {
    learnPiece(L, `known${i}`, r, 0, 0, 1, "combat_as_attacker");
    markPieceDead(L, `known${i}`);
  });
  const alive = new Set(["flag"]);
  const enemyPieces: PieceLike[] = [
    { id: "flag", player_slot: 2, rank: "FLAG", alive: true, row_idx: 0, col_idx: 0 },
  ];
  const d = checkEliminationDeductions(L, enemyPieces, alive);
  assertEquals(d, [{ pieceId: "flag", deducedRank: "FLAG" }]);
});

Deno.test("v1 deduction: no fire when multiple unrevealed remain", () => {
  const L = createLedger();
  learnPiece(L, "k1", "1", 0, 0, 1, "combat_as_attacker");
  markPieceDead(L, "k1");
  const alive = new Set(["u1", "u2"]);
  const enemyPieces: PieceLike[] = [
    { id: "u1", player_slot: 2, rank: "FLAG", alive: true },
    { id: "u2", player_slot: 2, rank: "2", alive: true },
  ];
  assertEquals(checkEliminationDeductions(L, enemyPieces, alive).length, 0);
});

Deno.test("deduction learn counts toward asymmetric knowledge", () => {
  const L = createLedger();
  const ranks = ["1", "2", "3", "3", "4", "4", "4", "5", "5", "5", "5",
    "6", "6", "6", "6", "7", "7", "7", "7", "8", "8", "8", "8", "8",
    "9", "9", "9", "9", "9", "9", "9", "9", "10",
    "BOMB", "BOMB", "BOMB", "BOMB", "BOMB", "BOMB"];
  ranks.forEach((r, i) => {
    learnPiece(L, `known${i}`, r, 0, 0, 1, "combat_as_attacker");
    markPieceDead(L, `known${i}`);
  });
  const alive = new Set(["flag"]);
  const enemyPieces: PieceLike[] = [
    { id: "flag", player_slot: 2, rank: "FLAG", alive: true, row_idx: 0, col_idx: 0 },
  ];
  const d = checkEliminationDeductions(L, enemyPieces, alive);
  assertEquals(d.length, 1);
  learnPiece(L, d[0].pieceId, d[0].deducedRank, 0, 0, 40, "elimination_deduction");
  assertEquals(asymmetricKnowledgeCount(L), 1);
  assertEquals(L.get("flag")!.reveal_source, "elimination_deduction");
});
```

Import `checkEliminationDeductions`, `markPieceDead`, `asymmetricKnowledgeCount`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts --filter "deduction"
```

Expected: FAIL — `checkEliminationDeductions` not defined.

- [ ] **Step 3: Implement v1 deduction + wire into IW pass**

```typescript
export const ARMY_COMPOSITION_IW: Record<string, number> = {
  "1": 1, "2": 1, "3": 2, "4": 3, "5": 4, "6": 4, "7": 4,
  "8": 5, "9": 8, "10": 1, BOMB: 6, FLAG: 1,
};

/**
 * V1: if exactly one enemy piece is alive+unrevealed AND exactly one
 * composition slot remains unaccounted across all ranks, deduce that piece.
 */
export function checkEliminationDeductions(
  ledger: KnowledgeLedger,
  enemyPieces: PieceLike[],
  boardAlive: Set<string>,
): Array<{ pieceId: string; deducedRank: string }> {
  const accounted: Record<string, number> = {};
  for (const e of ledger.values()) {
    accounted[e.rank] = (accounted[e.rank] ?? 0) + 1;
  }

  let totalLeft = 0;
  let remainingRank: string | null = null;
  for (const [rank, total] of Object.entries(ARMY_COMPOSITION_IW)) {
    const left = total - (accounted[rank] ?? 0);
    if (left <= 0) continue;
    totalLeft += left;
    if (left === 1) remainingRank = rank;
  }

  if (totalLeft !== 1 || remainingRank === null) return [];

  const unrevealedAlive = enemyPieces.filter(
    (p) => boardAlive.has(p.id) && !ledger.has(p.id),
  );
  if (unrevealedAlive.length !== 1) return [];

  return [{ pieceId: unrevealedAlive[0].id, deducedRank: remainingRank }];
}
```

Wire-up inside `runInformationWarfarePass` — **after** `applyLedgerUpdatesFromMove` and **after** `applyMoveToBoard` (so `board.alive` reflects deaths), when the move was a combat:

```typescript
    applyLedgerUpdatesFromMove(m, slot, myLedger, theirLedger, myVacated, pieceById);

    // ... existing revealHalfLife block ...

    applyMoveToBoard(board, m);

    if (m.move_type === "attack" && m.outcome) {
      const enemySlot = slot === 1 ? 2 : 1;
      // my deductions about enemy
      {
        const enemyPieces = pieces.filter((p) => p.player_slot === enemySlot);
        for (const d of checkEliminationDeductions(myLedger, enemyPieces, board.alive)) {
          const pos = board.pos.get(d.pieceId);
          learnPiece(
            myLedger, d.pieceId, d.deducedRank,
            pos?.row ?? 0, pos?.col ?? 0, m.move_number,
            "elimination_deduction",
          );
        }
      }
      // their deductions about me
      {
        const myPiecesList = pieces.filter((p) => p.player_slot === slot);
        for (const d of checkEliminationDeductions(theirLedger, myPiecesList, board.alive)) {
          const pos = board.pos.get(d.pieceId);
          learnPiece(
            theirLedger, d.pieceId, d.deducedRank,
            pos?.row ?? 0, pos?.col ?? 0, m.move_number,
            "elimination_deduction",
          );
        }
      }

      infoEdgeCurve.push(
        asymmetricKnowledgeCount(myLedger) -
          asymmetricKnowledgeCount(theirLedger),
      );
    }
```

**Important:** Move the `infoEdgeCurve.push(...)` to **after** deductions (remove the earlier push from Task 2 so sampling includes same-move deductions). Keep phase/material blocks as they are; only the edge sample order changes relative to deduction.

Do **not** leave a duplicate `infoEdgeCurve.push` — one push per combat, after deductions.

- [ ] **Step 4: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts \
        supabase/functions/_shared/information-warfare.test.ts
git commit -m "$(cat <<'EOF'
feat(iw): v1 single-remaining elimination deduction into knowledge ledgers

EOF
)"
```

---

### Task 4: Memory Narrative Uses `reveal_source`

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Consumes: `KnowledgeEntry.reveal_source` on the known defender at test time
- Produces: human narratives that state how the piece was identified; track_strike MISS text matches spec tone

- [ ] **Step 1: Write failing narrative tests**

```typescript
Deno.test("narrativeFor track_strike MISS mentions moved piece, not jargon", () => {
  const text = narrativeFor({
    test_id: "track_strike",
    hit: false,
    weight: 2,
    age: 63,
    move_number: 80,
    attacker_rank: "4",
    known_rank: "9",
    defender_piece_id: "x",
    load: 4,
    reveal_source: "movement_inference",
  });
  assertEquals(text.includes("track_strike"), false);
  assertEquals(text.includes("Scout"), true);
  assertEquals(text.includes("63"), true);
});

Deno.test("narrativeFor mentions Scout identified by multi-square movement", () => {
  const text = narrativeFor({
    test_id: "known_win",
    hit: true,
    weight: 3,
    age: 5,
    move_number: 20,
    attacker_rank: "3",
    known_rank: "9",
    defender_piece_id: "x",
    load: 2,
    reveal_source: "movement_inference",
  });
  assertEquals(/multi-square|movement/i.test(text), true);
});
```

Export `narrativeFor` (or test via `accumulateMemoryTests` → `events[].narrative`). Prefer exporting `narrativeFor` for unit clarity:

```typescript
export function narrativeFor(test: MemoryTestResult): string { ... }
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts --filter "narrativeFor"
```

Expected: FAIL — `reveal_source` not on `MemoryTestResult`; text lacks movement phrasing.

- [ ] **Step 3: Extend `MemoryTestResult` / emitter / narrative**

```typescript
export interface MemoryTestResult {
  test_id: MemoryTestId;
  hit: boolean;
  weight: number;
  age: number;
  move_number: number;
  attacker_rank: string;
  known_rank: string;
  defender_piece_id: string;
  load: number;
  reveal_source: RevealSource | null;
}

function revealHow(source: RevealSource | null, rankName: string): string {
  if (source === "movement_inference") {
    return `Identified as ${rankName} from multi-square movement`;
  }
  if (source === "elimination_deduction") {
    return `Deduced as ${rankName} from army composition`;
  }
  if (source === "combat_as_attacker" || source === "combat_as_defender") {
    return `Previously revealed in combat as ${rankName}`;
  }
  return `Known ${rankName}`;
}

export function narrativeFor(test: MemoryTestResult): string {
  const ar = RANK_NAME[test.attacker_rank] ?? test.attacker_rank;
  const kr = RANK_NAME[test.known_rank] ?? test.known_rank;
  const how = revealHow(test.reveal_source, kr);

  if (test.test_id === "bomb_correct") {
    return test.hit
      ? `Move ${test.move_number} — remembered the Bomb ${test.age} moves later; ${ar} cleared it. (${how})`
      : `Move ${test.move_number} — forgot the Bomb (age ${test.age}); sent a ${ar} into it. (${how})`;
  }
  if (test.test_id === "track_strike") {
    return test.hit
      ? `Move ${test.move_number} — tracked ${kr} to its new square. (${how})`
      : `Move ${test.move_number} — attacked where a ${kr} used to be — it had moved ${test.age} turns ago. (${how})`;
  }
  if (test.test_id === "threat_avoidance") {
    return `Move ${test.move_number} — walked ${ar} into a known lethal ${kr}. (${how})`;
  }
  if (test.test_id === "spy_marshal") {
    return test.hit
      ? `Move ${test.move_number} — Spy correctly struck the known Marshal. (${how})`
      : `Move ${test.move_number} — misplayed the known Marshal with ${ar}. (${how})`;
  }
  return test.hit
    ? `Move ${test.move_number} — correctly re-engaged ${kr} with ${ar}. (${how})`
    : `Move ${test.move_number} — misjudged ${kr}; sent ${ar}. (${how})`;
}
```

In `emitMemoryTestsForAttack`, when pushing each result, set:

```typescript
reveal_source: known?.reveal_source ?? null,
```

For track_strike MISS against a vacated square (stale piece), use:

```typescript
reveal_source: staleEntry?.reveal_source ?? null,
```

and set `known_rank` from `stale.rank` (already done). Update every `results.push({...})` in that function to include `reveal_source`.

Update existing tests that construct `MemoryTestResult` literals to include `reveal_source: "combat_as_attacker"` (or `null`).

- [ ] **Step 4: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts \
        supabase/functions/_shared/information-warfare.test.ts
git commit -m "$(cat <<'EOF'
fix(iw): memory narratives use reveal_source for accurate identification text

EOF
)"
```

---

### Task 5: Profile Memory Display — X/Y Correct, No Raw Weights

**Files:**
- Modify: `web/js/profile.js`

**Interfaces:**
- Consumes: `stats.memory_hits`, `stats.memory_misses`, `stats.memory_hits_w`, `stats.memory_misses_w` (and bomb/track unweighted counters)
- Produces: display strings like `87% (4/5 correct)` or `Perfect — no memory errors`

- [ ] **Step 1: Replace `memoryPctDisplay` and Memory Score rows**

```javascript
function memoryScoreDisplay(hitsW, missesW, hits, misses) {
  const hw = Number(hitsW ?? 0);
  const mw = Number(missesW ?? 0);
  const h = Number(hits ?? 0);
  const m = Number(misses ?? 0);
  const n = h + m;
  if (n <= 0) return "—";
  if (m === 0) return `Perfect — no memory errors (${h}/${n} correct)`;
  const pct = hw + mw > 0 ? ((hw / (hw + mw)) * 100).toFixed(0) : ((h / n) * 100).toFixed(0);
  return `${pct}% (${h}/${n} correct)`;
}

function memoryCountDisplay(hits, misses) {
  const h = Number(hits ?? 0);
  const m = Number(misses ?? 0);
  const n = h + m;
  if (n <= 0) return "—";
  if (m === 0) return `100% (${h}/${n} correct)`;
  return `${((h / n) * 100).toFixed(0)}% (${h}/${n} correct)`;
}
```

In the Memory & Deduction section:

```javascript
    { title: "Memory & Deduction", items: [
      ["Memory Score",
        memoryScoreDisplay(
          stats.memory_hits_w, stats.memory_misses_w,
          stats.memory_hits, stats.memory_misses,
        ),
        "Weighted accuracy when re-engaging a piece you previously identified — expensive mistakes count more. Shows percent and unweighted correct count."],
      ["Bomb Retention",
        memoryCountDisplay(stats.memory_bomb_hits, stats.memory_bomb_misses),
        "When attacking a piece you previously learned was a Bomb, how often do you send a Miner?"],
      ["Position Tracking",
        memoryCountDisplay(stats.memory_track_hits, stats.memory_track_misses),
        "When a revealed piece moves to a new position, how often do you still find it?"],
      ["Memory Half-Life",
        stats.memory_scouting?.half_life_moves != null
          ? `~${stats.memory_scouting.half_life_moves} moves`
          : "—",
        "Estimated moves after a reveal before your accuracy drops to 50% — lower = faster forgetting"],
    ], extraAfter: renderScoutingTags(stats.memory_scouting ?? {}) + renderPhaseBreakdown(stats) },
```

Remove the old `memoryPctDisplay` function if unused, or keep it only if phase pills still need a simple percent (phase pills may stay percent-only — that is fine; they never showed raw weights).

Verify no UI string concatenates `w` / `weight` / `hitsW` into visible text.

- [ ] **Step 2: Manual check**

Open `profile.html?user=<you>` locally (or static review). Memory Score must not show values like `29w`.

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js
git commit -m "$(cat <<'EOF'
fix(ui): show memory as percent and X/Y correct, never raw weights

EOF
)"
```

---

### Task 6: Scout Self-Reveal Rate Metric

**Files:**
- Create: `supabase/migrations/0015_scout_self_reveal.sql`
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/profile.js`

**Interfaces:**
- Produces:
  - `player_stats.scout_self_reveal_events` (integer, default 0)
  - `IWGameResult.scoutSelfRevealEvents: number`
  - Profile row under Information Warfare
- Formula: `scout_self_reveal_events / scout_moves` where events = times **your** Scout long-move newly taught the opponent via `movement_inference`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0015_scout_self_reveal.sql
-- Scout Self-Reveal Rate: long-moves that give away your Scouts

alter table player_stats
  add column if not exists scout_self_reveal_events integer not null default 0;
```

- [ ] **Step 2: Failing test**

```typescript
Deno.test("scout self-reveal counts first long-move of my Scout", () => {
  const pieces: PieceLike[] = [
    { id: "scout", player_slot: 1, rank: "9", alive: true, row_idx: 7, col_idx: 0 },
    { id: "e", player_slot: 2, rank: "5", alive: true, row_idx: 2, col_idx: 0 },
  ];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const moves: MoveLike[] = [
    {
      piece_id: "scout", player_slot: 1, from_row: 7, from_col: 0, to_row: 4, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 1,
    },
    {
      piece_id: "scout", player_slot: 1, from_row: 4, from_col: 0, to_row: 2, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 2,
    },
  ];
  const iw = runInformationWarfarePass(1, moves, pieces, pieceById, 2);
  assertEquals(iw.scoutSelfRevealEvents, 1); // second long-move is not a NEW learn
});
```

- [ ] **Step 3: Implement counter in IW pass**

Add to `IWGameResult`:

```typescript
  scoutSelfRevealEvents: number;
```

In `runInformationWarfarePass`:

```typescript
  let scoutSelfRevealEvents = 0;
```

Inside the move loop, **before** `applyLedgerUpdatesFromMove`:

```typescript
    if (isMyMove && inferScoutFromMove(m)) {
      const piece = pieceById.get(m.piece_id);
      if (piece?.rank === "9" && !theirLedger.has(m.piece_id)) {
        scoutSelfRevealEvents++;
      }
    }
```

Return `scoutSelfRevealEvents` from the result object.

- [ ] **Step 4: Wire compute-stats career write**

In both player_stats update objects (human path), add:

```typescript
        scout_self_reveal_events:
          (stats.scout_self_reveal_events ?? 0) + iw.scoutSelfRevealEvents,
```

(`scout_moves` already accumulated.)

- [ ] **Step 5: Profile UI row**

In Information Warfare items (after Scout Tempo or at end of IW section):

```javascript
      ["Scout Self-Reveal Rate",
        stats.scout_moves > 0
          ? `${(((stats.scout_self_reveal_events ?? 0) / stats.scout_moves) * 100).toFixed(0)}%`
          : "—",
        "How often your Scouts reveal themselves by moving 2+ squares — lower = more disciplined Scout usage"],
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0015_scout_self_reveal.sql \
        supabase/functions/_shared/information-warfare.ts \
        supabase/functions/_shared/information-warfare.test.ts \
        supabase/functions/compute-stats/index.ts \
        web/js/profile.js
git commit -m "$(cat <<'EOF'
feat(iw): Scout Self-Reveal Rate career metric and profile display

EOF
)"
```

---

### Task 7: Deploy + Story-Only Recompute

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts` (add `story_only` mode)
- Create: `scripts/backfill-stats.sh`

**Interfaces:**
- Produces: `POST { game_id, story_only?: boolean }`
  - `story_only: true` → rewrite `game_summaries.story` (info_edge_curve, memory_moments, memory_scores) + optionally patch `scout_self_reveal_events` when `patch_scout_self_reveal: true`; **skip Elo and all other career accumulators**
- Consumes: Tasks 1–6 deployed code

- [ ] **Step 1: Add `story_only` mode to compute-stats**

Near the top of the handler, parse:

```typescript
  const storyOnly = body.story_only === true;
  const patchScoutSelfReveal = body.patch_scout_self_reveal === true;
```

Change the early gate:

```typescript
  if (game.stats_computed && !storyOnly) {
    return jsonResponse({ ok: true, skipped: "already_computed" });
  }
```

Allow bot games for `storyOnly` (optional but useful):

```typescript
  if (game.is_bot_game && !storyOnly) {
    return jsonResponse({ ok: true, skipped: "bot_game" });
  }
```

At the end of successful full compute, keep `stats_computed = true`.

For `storyOnly` path: after loading moves/pieces, run IW for slots 1 and 2 only, then:

```typescript
  if (storyOnly) {
    const { data: existingSummary } = await supabase
      .from("game_summaries")
      .select("story, material_curve_p1, material_curve_p2")
      .eq("game_id", game_id)
      .maybeSingle();

    const story = (existingSummary?.story ?? {}) as Record<string, unknown>;
    const iw1 = runInformationWarfarePass(1, moves as MoveLike[], pieces as PieceLike[], pieceByIdIw, totalMoves);
    const iw2 = runInformationWarfarePass(2, moves as MoveLike[], pieces as PieceLike[], pieceByIdIw, totalMoves);

    story.info_edge_curve = { slot1: iw1.infoEdgeCurve, slot2: iw2.infoEdgeCurve };
    story.memory_moments = {
      slot1: topMemoryMoments(iw1.memory.events, 5),
      slot2: topMemoryMoments(iw2.memory.events, 5),
    };
    const w1 = iw1.memory.hitsW + iw1.memory.missesW;
    const w2 = iw2.memory.hitsW + iw2.memory.missesW;
    story.memory_scores = {
      slot1: w1 > 0 ? iw1.memory.hitsW / w1 : null,
      slot2: w2 > 0 ? iw2.memory.hitsW / w2 : null,
    };

    await supabase.from("game_summaries").upsert(
      {
        game_id,
        material_curve_p1: existingSummary?.material_curve_p1 ?? [],
        material_curve_p2: existingSummary?.material_curve_p2 ?? [],
        story,
      },
      { onConflict: "game_id" },
    );

    if (patchScoutSelfReveal && !game.is_bot_game) {
      for (const slot of [1, 2] as const) {
        const playerId = slot === 1 ? game.player1_id : game.player2_id;
        const iw = slot === 1 ? iw1 : iw2;
        if (!playerId) continue;
        const { data: stats } = await supabase
          .from("player_stats")
          .select("scout_self_reveal_events")
          .eq("player_id", playerId)
          .single();
        if (!stats) continue;
        await supabase.from("player_stats").update({
          scout_self_reveal_events:
            Number(stats.scout_self_reveal_events ?? 0) + iw.scoutSelfRevealEvents,
        }).eq("player_id", playerId);
      }
    }

    return jsonResponse({ ok: true, story_only: true });
  }
```

Place this block after pieces/moves are loaded and `pieceByIdIw` exists, **before** Elo/career mutation. Structure the function so the full path remains unchanged when `storyOnly` is false.

- [ ] **Step 2: Backfill script**

```bash
#!/usr/bin/env bash
# scripts/backfill-stats.sh
# Story-only recompute (safe — does not touch Elo / career totals)
set -euo pipefail
URL="${SUPABASE_URL:?}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?}"
STORY_ONLY="${STORY_ONLY:-true}"
PATCH_SCOUT="${PATCH_SCOUT_SELF_REVEAL:-false}"

GAME_IDS=$(curl -s "$URL/rest/v1/games?status=eq.finished&select=id&order=created_at.asc" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | jq -r '.[].id')

for id in $GAME_IDS; do
  echo "compute-stats $id story_only=$STORY_ONLY patch_scout=$PATCH_SCOUT"
  curl -s -X POST "$URL/functions/v1/compute-stats" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"game_id\":\"$id\",\"story_only\":${STORY_ONLY},\"patch_scout_self_reveal\":${PATCH_SCOUT}}"
  echo
  sleep 0.15
done
```

- [ ] **Step 3: Deploy**

```bash
cd Projects/Stratego/code
npx supabase db push --linked
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

Expected: migration 0015 applied; function deploy OK.

- [ ] **Step 4: Zero scout self-reveal career, then backfill**

```sql
-- Run once in SQL editor before PATCH_SCOUT backfill
UPDATE player_stats SET scout_self_reveal_events = 0;
```

```bash
chmod +x scripts/backfill-stats.sh
# Pass 1: rewrite story (info edge + memory moments) for all finished games
STORY_ONLY=true PATCH_SCOUT_SELF_REVEAL=false \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ./scripts/backfill-stats.sh

# Pass 2: accumulate scout_self_reveal_events (only after zeroing column)
STORY_ONLY=true PATCH_SCOUT_SELF_REVEAL=true \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ./scripts/backfill-stats.sh
```

**Never** set `stats_computed=false` and re-run full mode — that double-applies Elo and career counters.

- [ ] **Step 5: Spot-check**

1. Pick a game with Scout long-moves → `story.info_edge_curve.slot1` should be non-flat only around those / deductions; pure-combat games stay ~0.
2. `memory_moments` narratives mention multi-square movement or deduction when applicable; no `track_strike` jargon.
3. Profile Memory Score shows `N% (X/Y correct)`.
4. Profile Scout Self-Reveal Rate populated for players with scout moves.
5. Player ratings unchanged by backfill.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/compute-stats/index.ts scripts/backfill-stats.sh
git commit -m "$(cat <<'EOF'
chore: story-only compute-stats recompute path and backfill script

EOF
)"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| `revealSource` on `KnowledgeEntry` + `learnPiece` source param | Task 1 (`reveal_source` snake_case) |
| All IW `learnPiece` calls pass correct source | Task 1 |
| Bidirectional Scout inference (own long-move → theirLedger) | Task 1 (bugfix required for edge correctness) |
| Info Edge = asymmetric sources only | Task 2 |
| Replace buggy story curve / stop combat-only divergence | Task 2 (drop `knownBySlot`) |
| Elimination deduction simplified v1 | Task 3 |
| Memory narrative uses reveal source | Task 4 |
| Profile display X/Y, no raw weights | Task 5 |
| Scout Self-Reveal Rate | Task 6 |
| Deploy + recompute | Task 7 (`story_only`, no Elo double) |
| Combat never moves Info Edge | Task 2 tests |
| Reveal Efficiency unchanged | No task touches reveal win/attack counters |
| Weights still used for Memory Score internally | Task 5 display-only; scoring untouched |

### 2. Placeholder scan

No TBD / “implement later” / “similar to Task N” left. Complete code for types, deduction, narratives, migration, profile strings, story_only handler, and backfill script.

### 3. Type consistency

- Field name: `reveal_source` everywhere (not mixed camelCase).
- Source union strings identical across learn sites, asymmetric filter, narratives, tests.
- `learnPiece` always 7 args ending in `RevealSource`.
- `IWGameResult.scoutSelfRevealEvents` ↔ DB `scout_self_reveal_events` ↔ profile `stats.scout_self_reveal_events`.
- Info edge sample happens once per combat, after deductions.
- `story.info_edge_curve = { slot1, slot2 }` shape unchanged for `gameDetail.js`.

### 4. Risks / notes

- Full `stats_computed=false` backfill is **unsafe** (Elo). Always use `story_only`.
- `patch_scout_self_reveal` is not idempotent — zero column before the scout pass.
- V1 deduction only fires in deep endgames (one piece / one slot left); that is intentional.
- Flag-specific bomb-position heuristics from the spec are **deferred** (not in v1).
