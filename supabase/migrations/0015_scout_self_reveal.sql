-- supabase/migrations/0015_scout_self_reveal.sql
-- Scout Self-Reveal Rate: long-moves that give away your Scouts

alter table player_stats
  add column if not exists scout_self_reveal_events integer not null default 0;
