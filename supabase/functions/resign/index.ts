import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "active") {
    return new Response(JSON.stringify({ error: "GAME_NOT_ACTIVE" }), { status: 409 });
  }

  const winnerSlot = playerRow.player_slot === 1 ? 2 : 1;

  await supabase
    .from("games")
    .update({ status: "finished", winner_slot: winnerSlot, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  return new Response(JSON.stringify({ ok: true, winnerSlot }), { headers: { "Content-Type": "application/json" } });
});
