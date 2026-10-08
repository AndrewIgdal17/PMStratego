import { RANK_DISPLAY } from '../types.ts';

/** Em dash used everywhere profile.js printed an unavailable stat. */
export const EMPTY_STAT = '\u2014';

const MIN_MEMORY_TESTS = 5;

export interface Player {
  id: string;
  username: string;
  rating: number;
  rating_provisional: boolean;
  games_played: number;
  created_at: string;
}

export interface Achievement {
  achievement_key: string;
  unlocked_at: string;
  game_id: string | null;
}

export interface HeatCell {
  attacks: number;
  wins: number;
}

export interface MemoryBin {
  memory_hits_w?: number;
  memory_misses_w?: number;
}

export interface PhaseCareer {
  by_material_state?: {
    behind?: MemoryBin;
    even?: MemoryBin;
    ahead?: MemoryBin;
    dominant?: MemoryBin;
  };
  by_capture_quarter?: {
    q1?: MemoryBin;
    q2?: MemoryBin;
    q3?: MemoryBin;
    q4?: MemoryBin;
  };
  by_info_state?: {
    deep_fog?: MemoryBin;
    partial?: MemoryBin;
    known?: MemoryBin;
  };
}

export interface MemoryScouting {
  tags?: string[];
  half_life_moves?: number | null;
}

export interface PlayerStats {
  wins: number;
  losses: number;
  draws: number;
  current_streak: number;
  longest_streak: number;
  fastest_win: number | null;
  longest_game: number | null;
  most_captures: number | null;
  total_moves_all_games: number;
  spy_combats: number;
  spy_kills: number;
  bombs_detonated: number;
  total_bombs: number;
  miners_survived: number;
  miners_started: number;
  first_bloods: number;
  trade_efficiency_sum: number;
  trade_efficiency_count: number;
  combats_initiated: number;
  combats_total: number;
  forward_moves: number;
  total_moves: number;
  moves_in_enemy_half: number;
  scout_moves: number;
  scout_distance: number;
  attacks_total: number;
  wins_by_flag: number;
  marathon_games: number;
  marathon_wins: number;
  marshal_showdowns: number;
  marshal_showdown_wins: number;
  archetype: string | null;
  reveal_attacks: number;
  reveal_wins: number;
  avenge_kills: number;
  avenge_opportunities: number;
  spy_timing_sum: number;
  spy_timing_games: number;
  max_comeback_deficit: number;
  reveal_then_kill: number;
  reveal_total: number;
  career_kingmakers: number;
  career_rival_wins: Record<string, number> | null;
  attack_heatmap: Record<string, HeatCell> | null;
  kills_by_rank: Record<string, number> | null;
  deaths_by_rank: Record<string, number> | null;
  flank_left_moves: number;
  flank_right_moves: number;
  lake_corridor_moves: number;
  defense_depth_sum: number;
  defense_depth_count: number;
  combat_cadence_sum: number;
  combat_cadence_count: number;
  opening_speed_sum: number;
  opening_speed_games: number;
  endgame_accel_early: number;
  endgame_accel_late: number;
  phase_career: PhaseCareer | null;
  stillness_movable_total: number;
  stillness_never_moved: number;
  info_exchange_games: number;
  info_exchange_ratio_sum: number;
  deduction_latency_count: number;
  deduction_latency_sum: number;
  bluff_bait_events: number;
  bluff_bait_bitten: number;
  reveal_half_life_games: number;
  reveal_half_life_sum: number;
  ambush_defenses: number;
  ambush_wins: number;
  memory_hits_w: number;
  memory_misses_w: number;
  memory_hits: number;
  memory_misses: number;
  memory_bomb_hits: number;
  memory_bomb_misses: number;
  memory_track_hits: number;
  memory_track_misses: number;
  memory_scouting: MemoryScouting | null;
  info_archetype: string | null;
  scout_self_reveal_events?: number;
}

export interface StatItem {
  label: string;
  value: string | number;
  tooltip: string;
  insufficientMemory?: boolean;
}

export interface StatSection {
  title: string;
  items: StatItem[];
  extra: 'memory' | null;
}

export interface RadarAxis {
  label: string;
  value: number;
  raw: string;
  desc: string;
}

export interface AchievementDef {
  key: string;
  name: string;
  desc: string;
}

export interface HistoryGame {
  game_id: string;
  opponent_username: string | null;
  player_slot: number;
  winner_slot: number | null;
  turn_number: number | null;
  created_at: string;
}

export interface HeadToHeadRecord {
  p1_wins: number;
  p2_wins: number;
  draws: number;
  total_games: number;
  avg_moves: number;
}

export interface FateBar {
  rank: string;
  label: string;
  count: number;
  widthPct: number;
}

export const SUMMARY_CONCURRENCY = 5;

const INFO_ARCHETYPES: Record<string, string> = {
  bluffer: 'Hyperactive Bluffer',
  trapper: 'Patient Trapper',
  converter: 'Snap Converter',
  denier: 'Fog Denier',
  investor: 'Recon Investor',
};

const SCOUTING_TAGS: Record<string, string> = {
  steel_trap: 'Steel Trap 🧠',
  bomb_amnesia: 'Bomb Amnesia 💣❌',
  loses_track: 'Loses Track 🔀',
  short_fuse: 'Short Fuse ⚡',
};

/** Full map from profile.js. The source object has 21 keys. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'kingmaker', name: 'Kingmaker', desc: 'Your Spy kills the enemy Marshal in combat' },
  { key: 'bomb_squad', name: 'Bomb Squad', desc: 'Defuse 3 or more enemy Bombs with your Miners in one game' },
  { key: 'needle_threader', name: 'Needle Threader', desc: 'Win the game by capturing the enemy Flag with a Miner' },
  { key: 'glass_cannon', name: 'Glass Cannon', desc: 'Win a game with 8 or fewer of your own pieces still alive' },
  { key: 'clean_operation', name: 'Clean Operation', desc: 'Win a game while losing 10 or fewer of your pieces' },
  { key: 'blitz_general', name: 'Blitz General', desc: 'Win a game in under 30 total moves' },
  { key: 'no_fly_zone', name: 'No Fly Zone', desc: 'Eliminate all 8 of the enemy\'s Scouts in one game' },
  { key: 'minefield_architect', name: 'Minefield Architect', desc: 'Your Bombs kill 4 or more enemy pieces in one game' },
  {
    key: 'iron_wall',
    name: 'Iron Wall',
    desc: 'Win without losing any piece ranked Colonel or higher (Marshal, General, Colonel)',
  },
  { key: 'fog_walker', name: 'Fog Walker', desc: 'Make 10+ attacks on enemy pieces and win the game' },
  { key: 'counterpunch', name: 'Counterpunch', desc: 'Win after being behind by 15+ rank-value points during the game' },
  { key: 'rival_hunter', name: 'Rival Hunter', desc: 'Beat the same opponent 5 times across any number of games' },
  { key: 'ghost_protocol', name: 'Ghost Protocol', desc: 'Win without your Marshal or General ever entering combat' },
  { key: 'phoenix', name: 'Phoenix', desc: 'Win after losing your Marshal during the game' },
  { key: 'vendetta', name: 'Vendetta', desc: 'Avenge 3+ of your pieces by killing the exact enemy piece that killed them' },
  { key: 'counterintel', name: 'Counterintel', desc: 'Eliminate the enemy Spy before your Marshal is revealed in combat' },
  { key: 'fortress_breaker', name: 'Fortress Breaker', desc: 'Defuse 3+ enemy Bombs AND capture the Flag in the same game' },
  { key: 'silent_general', name: 'Silent General', desc: 'Win without initiating any attack in the first 15 moves' },
  { key: 'nemesis', name: 'Nemesis', desc: 'Beat an opponent rated 200+ points higher than you' },
  { key: 'serial_killer', name: 'Serial Killer', desc: 'Use your Spy to kill the enemy Marshal in 3+ career games' },
  { key: 'perfect_deminer', name: 'Perfect Deminer', desc: 'Defuse all 6 enemy Bombs without losing a single Miner to a Bomb' },
];

export function formatArchetype(key: string): string {
  return key.replace('_', ' ');
}

export function formatInfoArchetype(key: string): string {
  return INFO_ARCHETYPES[key] ?? key;
}

export function scoutingTagText(tag: string): string {
  return SCOUTING_TAGS[tag] ?? tag;
}

function pct(numerator: number, denominator: number): string {
  if (!(denominator > 0)) return EMPTY_STAT;
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

function item(
  label: string,
  value: string | number,
  tooltip: string,
  insufficientMemory = false,
): StatItem {
  return insufficientMemory ? { label, value, tooltip, insufficientMemory: true } : { label, value, tooltip };
}

interface MemoryReadout {
  text: string;
  insufficient: boolean;
}

export function memoryScoreDisplay(
  hitsW: number | null | undefined,
  missesW: number | null | undefined,
  hits: number | null | undefined,
  misses: number | null | undefined,
): MemoryReadout {
  const hw = Number(hitsW ?? 0);
  const mw = Number(missesW ?? 0);
  const h = Number(hits ?? 0);
  const m = Number(misses ?? 0);
  const n = h + m;
  if (n < MIN_MEMORY_TESTS) return { text: EMPTY_STAT, insufficient: true };
  const score = hw + mw > 0 ? ((hw / (hw + mw)) * 100).toFixed(0) : ((h / n) * 100).toFixed(0);
  return { text: `${score}% (${h}/${n} correct)`, insufficient: false };
}

export function memoryCountDisplay(
  hits: number | null | undefined,
  misses: number | null | undefined,
): MemoryReadout {
  const h = Number(hits ?? 0);
  const m = Number(misses ?? 0);
  const n = h + m;
  if (n < MIN_MEMORY_TESTS) return { text: EMPTY_STAT, insufficient: true };
  return { text: `${((h / n) * 100).toFixed(0)}% (${h}/${n} correct)`, insufficient: false };
}

export function memoryPhasePercent(bin: MemoryBin | undefined): string {
  const h = bin?.memory_hits_w ?? 0;
  const m = bin?.memory_misses_w ?? 0;
  if (h + m === 0) return EMPTY_STAT;
  return `${((h / (h + m)) * 100).toFixed(0)}%`;
}

export function phaseBreakdownVisible(career: PhaseCareer | null | undefined): boolean {
  const mat = career?.by_material_state;
  if (!mat) return false;
  return Object.values(mat).some((bin) => (bin?.memory_hits_w ?? 0) + (bin?.memory_misses_w ?? 0) > 0);
}

export function showRadar(stats: PlayerStats | null): boolean {
  if (!stats) return false;
  return stats.wins + stats.losses + stats.draws >= 1;
}

export function radarAxes(stats: PlayerStats): RadarAxis[] {
  const trade =
    stats.trade_efficiency_count > 0
      ? stats.trade_efficiency_sum / stats.trade_efficiency_count
      : null;
  return [
    {
      label: 'Aggression',
      value: stats.total_moves > 0 ? stats.forward_moves / stats.total_moves : 0,
      desc: '% of moves advancing toward enemy',
      raw: stats.total_moves > 0 ? `${((stats.forward_moves / stats.total_moves) * 100).toFixed(0)}%` : EMPTY_STAT,
    },
    {
      label: 'Initiative',
      value: stats.combats_total > 0 ? stats.combats_initiated / stats.combats_total : 0,
      desc: '% of combats you started',
      raw:
        stats.combats_total > 0
          ? `${((stats.combats_initiated / stats.combats_total) * 100).toFixed(0)}%`
          : EMPTY_STAT,
    },
    {
      label: 'Fog Breaking',
      value: stats.reveal_attacks > 0 ? stats.reveal_wins / stats.reveal_attacks : 0,
      desc: 'Win rate on blind attacks',
      raw:
        stats.reveal_attacks > 0
          ? `${((stats.reveal_wins / stats.reveal_attacks) * 100).toFixed(0)}%`
          : EMPTY_STAT,
    },
    {
      label: 'Bomb Craft',
      value: stats.total_bombs > 0 ? stats.bombs_detonated / stats.total_bombs : 0,
      desc: '% of your Bombs that killed',
      raw:
        stats.total_bombs > 0
          ? `${((stats.bombs_detonated / stats.total_bombs) * 100).toFixed(0)}%`
          : EMPTY_STAT,
    },
    {
      label: 'Endgame',
      value: stats.marathon_games > 0 ? stats.marathon_wins / stats.marathon_games : 0.5,
      desc: 'Win rate in 60+ move games',
      raw:
        stats.marathon_games > 0
          ? `${((stats.marathon_wins / stats.marathon_games) * 100).toFixed(0)}%`
          : EMPTY_STAT,
    },
    {
      label: 'Material',
      value: trade == null ? 0.5 : Math.min(1, Math.max(0, (trade + 5) / 10)),
      desc: 'Net value per combat',
      raw: trade == null ? EMPTY_STAT : trade.toFixed(1),
    },
  ];
}

export function buildStatSections(stats: PlayerStats): StatSection[] {
  const totalGames = stats.wins + stats.losses + stats.draws;
  const memoryScore = memoryScoreDisplay(
    stats.memory_hits_w,
    stats.memory_misses_w,
    stats.memory_hits,
    stats.memory_misses,
  );
  const bombRetention = memoryCountDisplay(stats.memory_bomb_hits, stats.memory_bomb_misses);
  const positionTracking = memoryCountDisplay(stats.memory_track_hits, stats.memory_track_misses);
  const halfLife = stats.memory_scouting?.half_life_moves;
  const flankMoves = stats.flank_left_moves + stats.flank_right_moves;
  const endgameAttacks = stats.endgame_accel_early + stats.endgame_accel_late;

  return [
    {
      title: 'Core',
      extra: null,
      items: [
        item('Wins', stats.wins, 'Total rated games won'),
        item('Losses', stats.losses, 'Total rated games lost'),
        item('Draws', stats.draws, 'Games with no winner (both Marshals eliminated simultaneously)'),
        item('Current Streak', stats.current_streak, 'Consecutive wins right now — resets on any loss or draw'),
        item('Longest Streak', stats.longest_streak, 'Best-ever consecutive win streak across all games'),
        item(
          'Avg Game Length',
          totalGames > 0 ? Math.round(stats.total_moves_all_games / totalGames) : EMPTY_STAT,
          'Average total moves (both players combined) per game',
        ),
      ],
    },
    {
      title: 'Combat Intelligence',
      extra: null,
      items: [
        item(
          'Spy Success Rate',
          pct(stats.spy_kills, stats.spy_combats),
          'When your Spy enters combat (attacking or defending), how often does it kill the Marshal?',
        ),
        item(
          'Bomb Efficiency',
          pct(stats.bombs_detonated, stats.total_bombs),
          'What fraction of your Bombs (6 per game) actually killed an enemy piece?',
        ),
        item(
          'Miner Survival',
          pct(stats.miners_survived, stats.miners_started),
          'What fraction of your Miners (5 per game) survive to the end?',
        ),
        item(
          'First Blood %',
          pct(stats.first_bloods, totalGames),
          'How often you initiate the very first attack of the entire game',
        ),
      ],
    },
    {
      title: 'Strategic Profile',
      extra: null,
      items: [
        item(
          'Initiative Ratio',
          pct(stats.combats_initiated, stats.combats_total),
          "Of all combats you're involved in, what % did you start by attacking?",
        ),
        item(
          'Aggression Index',
          pct(stats.forward_moves, stats.total_moves),
          "What % of your moves advance toward the enemy's side of the board?",
        ),
        item(
          'Deep Strike Rate',
          pct(stats.moves_in_enemy_half, stats.total_moves),
          "What % of your moves end in the enemy's half of the board?",
        ),
      ],
    },
    {
      title: 'Fog & Intelligence',
      extra: null,
      items: [
        item(
          'Reveal Efficiency',
          pct(stats.reveal_wins, stats.reveal_attacks),
          "Win rate when attacking pieces you haven't seen before — measures blind-combat judgment",
        ),
        item(
          'Unknown Pressure',
          pct(stats.reveal_attacks, stats.attacks_total),
          'What fraction of your attacks target unrevealed (unknown) pieces — bold vs cautious',
        ),
        item(
          'First-Reveal Conversion',
          pct(stats.reveal_then_kill, stats.reveal_total),
          'After revealing an enemy piece, how often do you eventually eliminate it?',
        ),
        item(
          'Scout Tempo',
          stats.scout_moves > 0 ? `${(stats.scout_distance / stats.scout_moves).toFixed(1)} sq/move` : EMPTY_STAT,
          'Average squares traveled per Scout move — long-range recon vs cautious one-step probes',
        ),
        item(
          'Spy Timing',
          stats.spy_timing_games > 0 ? `Move ${Math.round(stats.spy_timing_sum / stats.spy_timing_games)}` : EMPTY_STAT,
          'Average move number when your Spy first enters combat — early gamble vs late dagger',
        ),
      ],
    },
    {
      title: 'Combat Economy',
      extra: null,
      items: [
        item(
          'Trade Efficiency',
          stats.trade_efficiency_count > 0
            ? (stats.trade_efficiency_sum / stats.trade_efficiency_count).toFixed(1)
            : EMPTY_STAT,
          'Net rank-value gained per combat (positive = trading up on average)',
        ),
        item(
          'Avenge Rate',
          pct(stats.avenge_kills, stats.avenge_opportunities),
          'How often you track down and kill a piece that previously killed one of yours',
        ),
        item(
          'Comeback Record',
          stats.max_comeback_deficit > 0 ? `${stats.max_comeback_deficit} pts` : EMPTY_STAT,
          'Largest rank-value deficit you overcame in a winning game',
        ),
      ],
    },
    {
      title: 'Information Warfare',
      extra: null,
      items: [
        item(
          'Stillness Ratio',
          pct(stats.stillness_never_moved, stats.stillness_movable_total),
          'What % of your movable pieces never move in a game — high suggests fake-bomb trapping',
        ),
        item(
          'Info Exchange Rate',
          stats.info_exchange_games > 0
            ? `${(stats.info_exchange_ratio_sum / stats.info_exchange_games).toFixed(2)}x`
            : EMPTY_STAT,
          "For every piece of yours revealed, how many enemy pieces did you learn? >1 = you're winning the info war",
        ),
        item(
          'Deduction Latency',
          stats.deduction_latency_count > 0
            ? `${Math.round(stats.deduction_latency_sum / stats.deduction_latency_count)} moves`
            : EMPTY_STAT,
          "How quickly you send the correct counter after learning an enemy piece's rank",
        ),
        item(
          'Bluff Bait Rate',
          pct(stats.bluff_bait_bitten, stats.bluff_bait_events),
          'When you push weak pieces deep as bluffs, how often does the enemy bite and attack them?',
        ),
        item(
          'Reveal Half-Life',
          stats.reveal_half_life_games > 0
            ? `${((stats.reveal_half_life_sum / stats.reveal_half_life_games) * 100).toFixed(0)}% of game`
            : EMPTY_STAT,
          'How far into the game before half your army is identified by the enemy — higher = you stay foggy longer',
        ),
        item(
          'Ambush Yield',
          pct(stats.ambush_wins, stats.ambush_defenses),
          'When enemies attack your still/never-moved pieces, how often does the still piece win?',
        ),
        item(
          'Scout Discipline',
          stats.scout_moves > 0
            ? `${(100 - ((stats.scout_self_reveal_events ?? 0) / stats.scout_moves) * 100).toFixed(0)}%`
            : EMPTY_STAT,
          'How often your Scouts move without revealing themselves — higher = more disciplined (only long-move when safe)',
        ),
      ],
    },
    {
      title: 'Memory & Deduction',
      extra: 'memory',
      items: [
        item(
          'Memory Score',
          memoryScore.text,
          'Weighted accuracy when re-engaging a piece you previously identified — expensive mistakes count more. Shows percent and unweighted correct count.',
          memoryScore.insufficient,
        ),
        item(
          'Bomb Retention',
          bombRetention.text,
          'When attacking a piece you previously learned was a Bomb, how often do you send a Miner?',
          bombRetention.insufficient,
        ),
        item(
          'Position Tracking',
          positionTracking.text,
          'When a revealed piece moves to a new position, how often do you still find it?',
          positionTracking.insufficient,
        ),
        item(
          'Memory Half-Life',
          halfLife != null ? `~${halfLife} moves` : EMPTY_STAT,
          'Estimated moves after a reveal before your accuracy drops to 50% — lower = faster forgetting',
        ),
      ],
    },
    {
      title: 'Endgame & Clutch',
      extra: null,
      items: [
        item(
          'Marathon Win Rate',
          pct(stats.marathon_wins, stats.marathon_games),
          'Win rate in long games (60+ total moves)',
        ),
        item(
          'Win by Flag %',
          pct(stats.wins_by_flag, stats.wins),
          '% of your wins by capturing the enemy Flag (vs. resignation or no-moves-left)',
        ),
      ],
    },
    {
      title: 'Records',
      extra: null,
      items: [
        item('Fastest Win', stats.fastest_win ? `${stats.fastest_win} moves` : EMPTY_STAT, 'Fewest total moves in any game you won'),
        item('Longest Game', stats.longest_game ? `${stats.longest_game} moves` : EMPTY_STAT, 'Most total moves in any single game you played'),
        item('Most Captures (1 game)', stats.most_captures ?? EMPTY_STAT, 'Most enemy pieces you killed in a single game'),
        item(
          'Marshal Showdowns',
          `${stats.marshal_showdown_wins}/${stats.marshal_showdowns}`,
          'Marshal vs Marshal direct combat — your wins out of total showdowns',
        ),
      ],
    },
    {
      title: 'Board Geography',
      extra: null,
      items: [
        item(
          'Flank Preference',
          flankMoves > 0 ? `${((stats.flank_left_moves / flankMoves) * 100).toFixed(0)}% Left` : EMPTY_STAT,
          'Do you favor the left side (cols 0–4) or right side (cols 5–9) of the board?',
        ),
        item(
          'Lake Corridor',
          pct(stats.lake_corridor_moves, stats.total_moves),
          'What % of your moves pass through the center corridor (cols 4–5) between the lakes?',
        ),
        item(
          'Defense Depth',
          stats.defense_depth_count > 0
            ? `${(Number(stats.defense_depth_sum) / stats.defense_depth_count).toFixed(1)} rows`
            : EMPTY_STAT,
          'Average distance from your back row when you initiate combat — low = defensive, high = deep strikes',
        ),
      ],
    },
    {
      title: 'Tempo & Rhythm',
      extra: null,
      items: [
        item(
          'Combat Cadence',
          stats.combat_cadence_count > 0
            ? `${Math.round(stats.combat_cadence_sum / stats.combat_cadence_count)} moves apart`
            : EMPTY_STAT,
          'Average moves between your consecutive attacks — low = rapid pressure, high = patient/positional',
        ),
        item(
          'Opening Speed',
          stats.opening_speed_games > 0
            ? `Move ${Math.round(stats.opening_speed_sum / stats.opening_speed_games)}`
            : EMPTY_STAT,
          'Average move number of your first attack — early = aggressive opener, late = developer',
        ),
        item(
          'Endgame Acceleration',
          endgameAttacks > 0
            ? `${((stats.endgame_accel_late / endgameAttacks) * 100).toFixed(0)}% in final quarter`
            : EMPTY_STAT,
          'What % of your attacks happen in the last 25% of the game? High = you close fast',
        ),
      ],
    },
  ];
}

export function achievementHint(key: string, stats: PlayerStats | null, unlocked: boolean): string | null {
  if (unlocked || !stats) return null;
  if (key === 'rival_hunter') {
    const rivals = stats.career_rival_wins ?? {};
    const best = Object.entries(rivals).sort(([, a], [, b]) => Number(b) - Number(a))[0];
    return best ? `${best[1]}/5 vs top rival` : null;
  }
  if (key === 'serial_killer') {
    return stats.career_kingmakers > 0 ? `${stats.career_kingmakers}/3 spy kills` : null;
  }
  if (key === 'counterpunch') {
    return stats.max_comeback_deficit > 0 ? `Best: ${stats.max_comeback_deficit}/15 pts` : null;
  }
  return null;
}

export function fateBars(data: Record<string, number> | null | undefined): FateBar[] {
  if (!data) return [];
  const entries = Object.entries(data)
    .filter(([rank]) => Boolean(RANK_DISPLAY[rank]))
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 5);
  if (entries.length === 0) return [];
  const max = Math.max(...entries.map(([, count]) => Number(count)));
  if (max <= 0) return [];
  return entries.map(([rank, count]) => ({
    rank,
    label: RANK_DISPLAY[rank] ?? rank,
    count: Number(count),
    widthPct: (Number(count) / max) * 100,
  }));
}

export function historyMark(game: Pick<HistoryGame, 'winner_slot' | 'player_slot'>): 'W' | 'L' | 'D' {
  if (game.winner_slot === game.player_slot) return 'W';
  if (game.winner_slot) return 'L';
  return 'D';
}

export function historyWord(mark: 'W' | 'L' | 'D'): 'Win' | 'Loss' | 'Draw' {
  if (mark === 'W') return 'Win';
  if (mark === 'L') return 'Loss';
  return 'Draw';
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item, index);
    }
  }

  const workers = Math.max(0, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function zeroPlayerStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    current_streak: 0,
    longest_streak: 0,
    fastest_win: null,
    longest_game: null,
    most_captures: null,
    total_moves_all_games: 0,
    spy_combats: 0,
    spy_kills: 0,
    bombs_detonated: 0,
    total_bombs: 0,
    miners_survived: 0,
    miners_started: 0,
    first_bloods: 0,
    trade_efficiency_sum: 0,
    trade_efficiency_count: 0,
    combats_initiated: 0,
    combats_total: 0,
    forward_moves: 0,
    total_moves: 0,
    moves_in_enemy_half: 0,
    scout_moves: 0,
    scout_distance: 0,
    attacks_total: 0,
    wins_by_flag: 0,
    marathon_games: 0,
    marathon_wins: 0,
    marshal_showdowns: 0,
    marshal_showdown_wins: 0,
    archetype: null,
    reveal_attacks: 0,
    reveal_wins: 0,
    avenge_kills: 0,
    avenge_opportunities: 0,
    spy_timing_sum: 0,
    spy_timing_games: 0,
    max_comeback_deficit: 0,
    reveal_then_kill: 0,
    reveal_total: 0,
    career_kingmakers: 0,
    career_rival_wins: null,
    attack_heatmap: null,
    kills_by_rank: null,
    deaths_by_rank: null,
    flank_left_moves: 0,
    flank_right_moves: 0,
    lake_corridor_moves: 0,
    defense_depth_sum: 0,
    defense_depth_count: 0,
    combat_cadence_sum: 0,
    combat_cadence_count: 0,
    opening_speed_sum: 0,
    opening_speed_games: 0,
    endgame_accel_early: 0,
    endgame_accel_late: 0,
    phase_career: null,
    stillness_movable_total: 0,
    stillness_never_moved: 0,
    info_exchange_games: 0,
    info_exchange_ratio_sum: 0,
    deduction_latency_count: 0,
    deduction_latency_sum: 0,
    bluff_bait_events: 0,
    bluff_bait_bitten: 0,
    reveal_half_life_games: 0,
    reveal_half_life_sum: 0,
    ambush_defenses: 0,
    ambush_wins: 0,
    memory_hits_w: 0,
    memory_misses_w: 0,
    memory_hits: 0,
    memory_misses: 0,
    memory_bomb_hits: 0,
    memory_bomb_misses: 0,
    memory_track_hits: 0,
    memory_track_misses: 0,
    memory_scouting: null,
    info_archetype: null,
    scout_self_reveal_events: 0,
    ...overrides,
  };
}
