-- supabase/migrations/0014_information_warfare_memory.sql
-- Information Warfare (Wave 1+2) + Memory + IW archetype + phase_career safety

alter table game_summaries add column if not exists story jsonb not null default '{}';
alter table player_stats add column if not exists phase_career jsonb not null default '{}';

-- Big 6
alter table player_stats add column if not exists stillness_never_moved integer not null default 0;
alter table player_stats add column if not exists stillness_movable_total integer not null default 0;
-- Career Info Exchange = MEAN of per-game ratios (not pooled sums)
alter table player_stats add column if not exists info_exchange_ratio_sum numeric not null default 0;
alter table player_stats add column if not exists info_exchange_games integer not null default 0;
alter table player_stats add column if not exists deduction_latency_sum integer not null default 0;
alter table player_stats add column if not exists deduction_latency_count integer not null default 0;
alter table player_stats add column if not exists bluff_bait_events integer not null default 0;
alter table player_stats add column if not exists bluff_bait_bitten integer not null default 0;
alter table player_stats add column if not exists reveal_half_life_sum numeric not null default 0;
alter table player_stats add column if not exists reveal_half_life_games integer not null default 0;
alter table player_stats add column if not exists ambush_defenses integer not null default 0;
alter table player_stats add column if not exists ambush_wins integer not null default 0;

-- Deeper cuts included (correct ledger required)
alter table player_stats add column if not exists controlled_exposure_attacks integer not null default 0;
alter table player_stats add column if not exists controlled_exposure_burned integer not null default 0;
alter table player_stats add column if not exists silent_majority_sum numeric not null default 0;
alter table player_stats add column if not exists silent_majority_games integer not null default 0;
alter table player_stats add column if not exists silent_majority_wins_sum numeric not null default 0;
alter table player_stats add column if not exists silent_majority_losses_sum numeric not null default 0;

-- Memory
alter table player_stats add column if not exists memory_hits_w numeric not null default 0;
alter table player_stats add column if not exists memory_misses_w numeric not null default 0;
alter table player_stats add column if not exists memory_hits integer not null default 0;
alter table player_stats add column if not exists memory_misses integer not null default 0;
alter table player_stats add column if not exists memory_bomb_hits integer not null default 0;
alter table player_stats add column if not exists memory_bomb_misses integer not null default 0;
alter table player_stats add column if not exists memory_track_hits integer not null default 0;
alter table player_stats add column if not exists memory_track_misses integer not null default 0;
alter table player_stats add column if not exists memory_scouting jsonb not null default '{}';

-- IW Archetype (separate from playstyle archetype)
alter table player_stats add column if not exists info_archetype text;
alter table player_stats add column if not exists info_archetype_updated_at timestamptz;
