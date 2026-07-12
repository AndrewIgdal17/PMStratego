-- supabase/migrations/0007_bot_difficulty.sql
alter table games add column bot_difficulty text check (bot_difficulty in ('easy', 'medium', 'hard'));
