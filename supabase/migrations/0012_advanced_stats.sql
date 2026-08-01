-- supabase/migrations/0012_advanced_stats.sql
-- Advanced fog/trade/tempo stats, achievement progress, game summaries, analytics RPCs

-- =============================================================================
-- player_stats: new metric columns (Tasks 1, 8, 12)
-- =============================================================================

-- Reveal Efficiency (attacks on unrevealed that win / total attacks on unrevealed)
alter table player_stats add column reveal_attacks integer not null default 0;
alter table player_stats add column reveal_wins integer not null default 0;

-- Trade Efficiency (net rank-value per combat, stored as sum + count for averaging)
-- Columns trade_efficiency_sum and trade_efficiency_count already exist from 0009

-- Scout Tempo (total manhattan distance of scout moves / scout_moves already tracked)
alter table player_stats add column scout_distance integer not null default 0;

-- Avenge Rate (kills on pieces that previously killed yours / opportunities)
alter table player_stats add column avenge_kills integer not null default 0;
alter table player_stats add column avenge_opportunities integer not null default 0;

-- Spy Timing (sum of first-spy-combat move numbers / games with spy combat, for averaging)
alter table player_stats add column spy_timing_sum integer not null default 0;
alter table player_stats add column spy_timing_games integer not null default 0;

-- Comeback Delta (max deficit overcome in any win)
alter table player_stats add column max_comeback_deficit numeric not null default 0;

-- First-Reveal Conversion (pieces first revealed by you that you later kill)
alter table player_stats add column reveal_then_kill integer not null default 0;
alter table player_stats add column reveal_total integer not null default 0;

-- Unknown Pressure (attacks on unrevealed / total attacks — reuses reveal_attacks + attacks_total)

-- Achievement progress (JSONB with partial counters for locked badges)
alter table player_stats add column achievement_progress jsonb not null default '{}';

-- Career achievement counters
alter table player_stats add column career_kingmakers integer not null default 0;
alter table player_stats add column career_rival_wins jsonb not null default '{}';

-- Combat heatmap: 10x10 grid of {attacks, wins} stored as JSONB
alter table player_stats add column attack_heatmap jsonb not null default '{}';

-- Piece fate: what ranks kill yours, what ranks you kill with
alter table player_stats add column kills_by_rank jsonb not null default '{}';
alter table player_stats add column deaths_by_rank jsonb not null default '{}';

-- get_player_profile already returns to_jsonb(v_stats), so new columns are included automatically.

-- =============================================================================
-- game_summaries: per-game material curves (Task 9)
-- =============================================================================

create table game_summaries (
  game_id uuid primary key references games(id) on delete cascade,
  material_curve_p1 integer[] not null default '{}',
  material_curve_p2 integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table game_summaries enable row level security;
create policy game_summaries_select on game_summaries for select using (true);

-- =============================================================================
-- RPCs (Tasks 9, 10, 13)
-- =============================================================================

create or replace function get_game_summary(p_game_id uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select row_to_json(gs) from game_summaries gs where gs.game_id = p_game_id;
$$;

grant execute on function get_game_summary(uuid) to anon;

create or replace function get_head_to_head(p_player1_id uuid, p_player2_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p1_wins integer;
  v_p2_wins integer;
  v_draws integer;
  v_total_games integer;
  v_avg_moves numeric;
begin
  select
    count(*) filter (where (player1_id = p_player1_id and winner_slot = 1) or (player2_id = p_player1_id and winner_slot = 2)),
    count(*) filter (where (player1_id = p_player2_id and winner_slot = 1) or (player2_id = p_player2_id and winner_slot = 2)),
    count(*) filter (where winner_slot is null),
    count(*),
    avg(turn_number)
  into v_p1_wins, v_p2_wins, v_draws, v_total_games, v_avg_moves
  from games
  where status = 'finished'
    and is_bot_game = false
    and ((player1_id = p_player1_id and player2_id = p_player2_id)
      or (player1_id = p_player2_id and player2_id = p_player1_id));

  return json_build_object(
    'p1_wins', v_p1_wins,
    'p2_wins', v_p2_wins,
    'draws', v_draws,
    'total_games', v_total_games,
    'avg_moves', round(v_avg_moves)
  );
end;
$$;

grant execute on function get_head_to_head(uuid, uuid) to anon;

create or replace function get_micro_leaderboard(p_category text, p_limit integer default 10)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category = 'spy_rate' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.spy_kills::numeric / nullif(ps.spy_combats, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.spy_combats >= 3 and p.games_played >= 5
      order by ps.spy_kills::numeric / ps.spy_combats desc limit p_limit
    ) t);
  elsif p_category = 'trade_efficiency' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.trade_efficiency_sum / nullif(ps.trade_efficiency_count, 0)::numeric, 2) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.trade_efficiency_count >= 20 and p.games_played >= 5
      order by ps.trade_efficiency_sum::numeric / ps.trade_efficiency_count desc limit p_limit
    ) t);
  elsif p_category = 'reveal_efficiency' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.reveal_wins::numeric / nullif(ps.reveal_attacks, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.reveal_attacks >= 10 and p.games_played >= 5
      order by ps.reveal_wins::numeric / ps.reveal_attacks desc limit p_limit
    ) t);
  elsif p_category = 'bomb_craft' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.bombs_detonated::numeric / nullif(ps.total_bombs, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.total_bombs >= 12 and p.games_played >= 5
      order by ps.bombs_detonated::numeric / ps.total_bombs desc limit p_limit
    ) t);
  else
    return '[]'::json;
  end if;
end;
$$;

grant execute on function get_micro_leaderboard(text, integer) to anon;
