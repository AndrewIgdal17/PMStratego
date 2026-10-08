import type { CombatOutcome, NumericRank, Rank } from '../types.ts';
import { RANK } from './pieces.ts';

export const COMBAT_OUTCOME = {
  ATTACKER_WINS: 'ATTACKER_WINS',
  DEFENDER_WINS: 'DEFENDER_WINS',
  TIE: 'TIE',
} as const;

export function resolveCombat(attackerRank: Rank, defenderRank: Rank): CombatOutcome {
  if (defenderRank === RANK.FLAG) {
    return COMBAT_OUTCOME.ATTACKER_WINS;
  }
  if (defenderRank === RANK.BOMB) {
    return attackerRank === RANK.MINER ? COMBAT_OUTCOME.ATTACKER_WINS : COMBAT_OUTCOME.DEFENDER_WINS;
  }
  if (attackerRank === RANK.SPY && defenderRank === RANK.MARSHAL) {
    return COMBAT_OUTCOME.ATTACKER_WINS;
  }
  if (attackerRank === defenderRank) {
    return COMBAT_OUTCOME.TIE;
  }
  // Bombs and flags are handled above. The cast is erased; the comparison stays numeric.
  return (attackerRank as NumericRank) < (defenderRank as NumericRank)
    ? COMBAT_OUTCOME.ATTACKER_WINS
    : COMBAT_OUTCOME.DEFENDER_WINS;
}
