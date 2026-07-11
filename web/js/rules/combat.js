import { RANK } from './pieces.js';

export const COMBAT_OUTCOME = {
  ATTACKER_WINS: 'ATTACKER_WINS',
  DEFENDER_WINS: 'DEFENDER_WINS',
  TIE: 'TIE',
};

export function resolveCombat(attackerRank, defenderRank) {
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
  return attackerRank < defenderRank ? COMBAT_OUTCOME.ATTACKER_WINS : COMBAT_OUTCOME.DEFENDER_WINS;
}
