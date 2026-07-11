import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public anon key -- safe to ship in frontend JS. It grants no access to
// `pieces` or `game_players` (no RLS policy = no access); every sensitive
// operation goes through an Edge Function or the get_game_state RPC.
const SUPABASE_URL = "https://cafqbrzaxcwewwtyqpnf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mxrVhbM1gbEixsbuhyn6sw_eL7r6dRX";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message ?? "UNKNOWN_ERROR";
    if (error.context && typeof error.context.json === "function") {
      try {
        const errorBody = await error.context.json();
        message = errorBody?.error ?? message;
      } catch {
        // response body wasn't JSON (or context.json() failed) -- fall back to error.message
      }
    } else if (data?.error) {
      message = data.error;
    }
    throw new Error(message);
  }
  return data;
}
