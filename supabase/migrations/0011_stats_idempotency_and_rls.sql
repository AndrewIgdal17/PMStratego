-- supabase/migrations/0011_stats_idempotency_and_rls.sql

-- Idempotency: track whether compute-stats has already run for a game
alter table games add column stats_computed boolean not null default false;

-- Password hash protection: replace wide-open select with a deny-all policy.
-- All player reads go through SECURITY DEFINER RPCs (get_player_profile,
-- get_leaderboard, get_game_history) which bypass RLS. Direct PostgREST
-- select from anon was never intended and exposes password_hash.
drop policy if exists players_select on players;
create policy players_no_direct_select on players for select using (false);
