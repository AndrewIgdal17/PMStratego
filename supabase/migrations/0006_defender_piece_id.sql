-- supabase/migrations/0006_defender_piece_id.sql
alter table moves add column defender_piece_id uuid references pieces(id);
