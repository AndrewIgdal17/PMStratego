-- Per-player committed army colors. Validated against the 8-swatch palette
-- in set-color / _shared/colors.ts (same pattern as bot_difficulty living in
-- application code). null means not yet seeded.
alter table games add column player1_color text;
alter table games add column player2_color text;

-- Postgres cannot CREATE OR REPLACE a function with a changed return type.
drop function if exists get_game_state(uuid);

create function get_game_state(p_token uuid)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_color text,
  player2_color text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_player_slot smallint;
begin
  select gp.game_id, gp.player_slot into v_game_id, v_player_slot
  from game_players gp
  where gp.secret_token = p_token;

  if v_game_id is null then
    raise exception 'invalid token';
  end if;

  return query
  select
    p.id,
    p.player_slot,
    case
      when p.player_slot = v_player_slot then p.rank
      when p.revealed_rank is not null then p.revealed_rank
      else null
    end as rank,
    p.row_idx,
    p.col_idx,
    p.alive,
    (p.player_slot = v_player_slot) as is_mine,
    g.player1_color,
    g.player2_color
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_game_state(uuid) to anon;

drop function if exists get_spectator_state(text);

create function get_spectator_state(p_room_code text)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_color text,
  player2_color text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  select g.id into v_game_id
  from games g
  where g.room_code = p_room_code;

  if v_game_id is null then
    raise exception 'game not found';
  end if;

  return query
  select
    p.id,
    p.player_slot,
    p.rank,
    p.row_idx,
    p.col_idx,
    p.alive,
    false as is_mine,
    g.player1_color,
    g.player2_color
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_spectator_state(text) to anon;
