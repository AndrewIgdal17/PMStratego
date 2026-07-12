-- supabase/migrations/0004_unsubmit.sql
alter table games add column both_submitted_at timestamptz;
