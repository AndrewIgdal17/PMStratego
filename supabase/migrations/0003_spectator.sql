-- supabase/migrations/0003_spectator.sql
create or replace function get_spectator_state(p_room_code text)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean
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
    false as is_mine
  from pieces p
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_spectator_state(text) to anon;
