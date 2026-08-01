-- supabase/migrations/0009_player_accounts.sql
-- Player accounts, aggregated stats, achievements, and profile/leaderboard RPCs.

create table players (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_lower text not null unique,
  password_hash text not null,
  rating integer not null default 1500,
  rating_provisional boolean not null default true,
  games_played integer not null default 0,
  created_at timestamptz not null default now()
);

create table player_stats (
  player_id uuid primary key references players(id) on delete cascade,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  resignations_given integer not null default 0,
  resignations_received integer not null default 0,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  fastest_win integer,
  longest_game integer,
  most_captures integer,
  max_deficit_overcome numeric,
  total_moves_all_games integer not null default 0,
  spy_combats integer not null default 0,
  spy_kills integer not null default 0,
  bombs_detonated integer not null default 0,
  total_bombs integer not null default 0,
  miners_survived integer not null default 0,
  miners_started integer not null default 0,
  first_bloods integer not null default 0,
  trade_efficiency_sum numeric not null default 0,
  trade_efficiency_count integer not null default 0,
  high_value_preservation_sum numeric not null default 0,
  high_value_preservation_count integer not null default 0,
  combats_initiated integer not null default 0,
  combats_total integer not null default 0,
  forward_moves integer not null default 0,
  total_moves integer not null default 0,
  moves_in_enemy_half integer not null default 0,
  territorial_advance_sum numeric not null default 0,
  territorial_advance_count integer not null default 0,
  scout_reveals integer not null default 0,
  scout_moves integer not null default 0,
  attacks_on_unknown integer not null default 0,
  attacks_total integer not null default 0,
  lateral_non_combat_moves integer not null default 0,
  opponent_pieces_captured integer not null default 0,
  idle_oscillations integer not null default 0,
  unique_reveals integer not null default 0,
  own_pieces_lost integer not null default 0,
  active_moves integer not null default 0,
  wins_by_flag integer not null default 0,
  wins_by_resign integer not null default 0,
  wins_by_nomoves integer not null default 0,
  endgame_advantage_games integer not null default 0,
  endgame_advantage_wins integer not null default 0,
  comeback_games integer not null default 0,
  comeback_wins integer not null default 0,
  collapse_games integer not null default 0,
  collapse_losses integer not null default 0,
  marathon_games integer not null default 0,
  marathon_wins integer not null default 0,
  marshal_showdowns integer not null default 0,
  marshal_showdown_wins integer not null default 0,
  archetype text,
  archetype_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table achievements (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  achievement_key text not null,
  unlocked_at timestamptz not null default now(),
  game_id uuid references games(id) on delete set null,
  unique (player_id, achievement_key)
);

create index achievements_player_id_idx on achievements (player_id);

alter table games add column player1_id uuid references players(id);
alter table games add column player2_id uuid references players(id);

create index games_player1_id_idx on games (player1_id);
create index games_player2_id_idx on games (player2_id);

alter table players enable row level security;
alter table player_stats enable row level security;
alter table achievements enable row level security;

create policy players_select on players for select using (true);
create policy player_stats_select on player_stats for select using (true);
create policy achievements_select on achievements for select using (true);

create or replace function get_leaderboard(
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  username text,
  rating integer,
  rating_provisional boolean,
  games_played integer,
  wins integer,
  losses integer,
  win_rate numeric,
  longest_streak integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    p.username,
    p.rating,
    p.rating_provisional,
    p.games_played,
    coalesce(ps.wins, 0) as wins,
    coalesce(ps.losses, 0) as losses,
    case
      when coalesce(ps.wins, 0) + coalesce(ps.losses, 0) + coalesce(ps.draws, 0) > 0
        then round(
          coalesce(ps.wins, 0)::numeric
            / (coalesce(ps.wins, 0) + coalesce(ps.losses, 0) + coalesce(ps.draws, 0)),
          4
        )
      else 0::numeric
    end as win_rate,
    coalesce(ps.longest_streak, 0) as longest_streak
  from players p
  left join player_stats ps on ps.player_id = p.id
  where p.rating_provisional = false
  order by p.rating desc, p.username asc
  limit p_limit
  offset p_offset;
end;
$$;

grant execute on function get_leaderboard(integer, integer) to anon;

create or replace function get_player_profile(p_username text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player players%rowtype;
  v_stats player_stats%rowtype;
  v_achievements json;
begin
  select * into v_player
  from players
  where username_lower = lower(p_username);

  if v_player.id is null then
    return null;
  end if;

  select * into v_stats
  from player_stats
  where player_id = v_player.id;

  select coalesce(
    json_agg(
      json_build_object(
        'achievement_key', a.achievement_key,
        'unlocked_at', a.unlocked_at,
        'game_id', a.game_id
      )
      order by a.unlocked_at desc
    ),
    '[]'::json
  )
  into v_achievements
  from achievements a
  where a.player_id = v_player.id;

  return json_build_object(
    'player', json_build_object(
      'id', v_player.id,
      'username', v_player.username,
      'rating', v_player.rating,
      'rating_provisional', v_player.rating_provisional,
      'games_played', v_player.games_played,
      'created_at', v_player.created_at
    ),
    'stats', case
      when v_stats.player_id is null then null
      else to_jsonb(v_stats) - 'player_id'
    end,
    'achievements', v_achievements
  );
end;
$$;

grant execute on function get_player_profile(text) to anon;

create or replace function get_game_history(
  p_username text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  game_id uuid,
  room_code text,
  opponent_username text,
  player_slot smallint,
  winner_slot smallint,
  status text,
  turn_number integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  select p.id into v_player_id
  from players p
  where p.username_lower = lower(p_username);

  if v_player_id is null then
    return;
  end if;

  return query
  select
    g.id as game_id,
    g.room_code,
    case
      when g.player1_id = v_player_id then p2.username
      else p1.username
    end as opponent_username,
    case
      when g.player1_id = v_player_id then 1::smallint
      else 2::smallint
    end as player_slot,
    g.winner_slot,
    g.status,
    g.turn_number,
    g.created_at
  from games g
  left join players p1 on p1.id = g.player1_id
  left join players p2 on p2.id = g.player2_id
  where g.status = 'finished'
    and (g.player1_id = v_player_id or g.player2_id = v_player_id)
  order by g.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

grant execute on function get_game_history(text, integer, integer) to anon;
