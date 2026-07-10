import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public anon key -- safe to ship in frontend JS. It grants no access to
// `pieces` or `game_players` (no RLS policy = no access); every sensitive
// operation goes through an Edge Function or the get_game_state RPC.
const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = data?.error ?? error.message ?? "UNKNOWN_ERROR";
    throw new Error(message);
  }
  return data;
}
