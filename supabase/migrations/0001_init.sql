-- supabase/migrations/0001_init.sql
create extension if not exists "pgcrypto";

create table games (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  status text not null default 'setup' check (status in ('setup', 'active', 'finished')),
  current_turn_slot smallint check (current_turn_slot in (1, 2)),
  turn_number integer not null default 0,
  winner_slot smallint check (winner_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  secret_token uuid not null default gen_random_uuid(),
  setup_submitted boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (game_id, player_slot)
);

create table pieces (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  rank text not null,
  row_idx smallint not null check (row_idx between 0 and 9),
  col_idx smallint not null check (col_idx between 0 and 9),
  alive boolean not null default true,
  revealed_rank text,
  created_at timestamptz not null default now()
);

create unique index pieces_alive_position_idx on pieces (game_id, row_idx, col_idx) where alive;

create table moves (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  piece_id uuid not null references pieces(id),
  move_number integer not null,
  player_slot smallint not null check (player_slot in (1, 2)),
  from_row smallint not null,
  from_col smallint not null,
  to_row smallint not null,
  to_col smallint not null,
  move_type text not null check (move_type in ('move', 'attack')),
  outcome text check (outcome in ('ATTACKER_WINS', 'DEFENDER_WINS', 'TIE')),
  attacker_rank text,
  defender_rank text,
  created_at timestamptz not null default now(),
  unique (game_id, move_number)
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table games enable row level security;
alter table game_players enable row level security;
alter table pieces enable row level security;
alter table moves enable row level security;
alter table chat_messages enable row level security;

-- games: readable by anyone who knows the room_code (lookup key, not a secret)
create policy games_select on games for select using (true);

-- game_players: no direct client access at all; only server-side (service role) and SECURITY DEFINER functions touch this table
-- (no policy created = no access for anon/authenticated roles)

-- pieces: no direct client access at all; only readable through get_game_state()
-- (no policy created = no access for anon/authenticated roles)

-- moves: readable by anyone who can read the parent game (both players; safe, combat always reveals both ranks)
create policy moves_select on moves for select using (true);

-- chat_messages: reading requires already knowing the unguessable game_id
-- (same trust model as the rest of the app), so open reads are fine. Writes
-- are NOT allowed directly by anon -- they must go through the send-chat
-- Edge Function, which checks the sender's token before inserting with the
-- service role (bypassing RLS). No insert policy is created here.
create policy chat_select on chat_messages for select using (true);

-- Realtime's postgres_changes only fires for tables explicitly added to this
-- publication. `games` drives the "go refetch your view" signal (Task 16);
-- `chat_messages` drives live chat updates (Task 17). `pieces` and
-- `game_players` are deliberately NOT added here -- broadcasting their raw
-- row changes would defeat the fog-of-war enforcement that get_game_state()
-- exists for.
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table chat_messages;

create or replace function get_game_state(p_token uuid)
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
    (p.player_slot = v_player_slot) as is_mine
  from pieces p
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_game_state(uuid) to anon;
