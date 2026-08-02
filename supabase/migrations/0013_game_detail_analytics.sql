-- supabase/migrations/0013_game_detail_analytics.sql
-- Game detail narrative + board geography / tempo career stats + phase-binned career accumulator

alter table game_summaries add column if not exists story jsonb not null default '{}';

-- Board Geography
alter table player_stats add column if not exists flank_left_moves integer not null default 0;
alter table player_stats add column if not exists flank_right_moves integer not null default 0;
alter table player_stats add column if not exists lake_corridor_moves integer not null default 0;
alter table player_stats add column if not exists defense_depth_sum numeric not null default 0;
alter table player_stats add column if not exists defense_depth_count integer not null default 0;
alter table player_stats add column if not exists invasion_lane_left integer not null default 0;
alter table player_stats add column if not exists invasion_lane_center integer not null default 0;
alter table player_stats add column if not exists invasion_lane_right integer not null default 0;

-- Tempo & Rhythm
alter table player_stats add column if not exists combat_cadence_sum integer not null default 0;
alter table player_stats add column if not exists combat_cadence_count integer not null default 0;
alter table player_stats add column if not exists opening_speed_sum integer not null default 0;
alter table player_stats add column if not exists opening_speed_games integer not null default 0;
alter table player_stats add column if not exists endgame_accel_early integer not null default 0;
alter table player_stats add column if not exists endgame_accel_late integer not null default 0;
alter table player_stats add column if not exists think_time_sum_ms bigint not null default 0;
alter table player_stats add column if not exists think_time_count integer not null default 0;

-- Phase-binned career accumulator
alter table player_stats add column if not exists phase_career jsonb not null default '{}';

create or replace function get_game_detail(p_game_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_summary json;
  v_p1 text;
  v_p2 text;
begin
  select * into v_game from games where id = p_game_id;
  if not found then
    return null;
  end if;

  select username into v_p1 from players where id = v_game.player1_id;
  select username into v_p2 from players where id = v_game.player2_id;

  select row_to_json(gs) into v_summary
  from game_summaries gs where gs.game_id = p_game_id;

  return json_build_object(
    'game_id', v_game.id,
    'status', v_game.status,
    'winner_slot', v_game.winner_slot,
    'turn_number', v_game.turn_number,
    'created_at', v_game.created_at,
    'player1_username', coalesce(v_p1, 'Anonymous'),
    'player2_username', coalesce(v_p2, 'Anonymous'),
    'summary', v_summary
  );
end;
$$;

grant execute on function get_game_detail(uuid) to anon;
