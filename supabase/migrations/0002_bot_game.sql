-- supabase/migrations/0002_bot_game.sql
alter table games add column is_bot_game boolean not null default false;
