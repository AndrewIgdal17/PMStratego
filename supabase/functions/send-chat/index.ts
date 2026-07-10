import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_LENGTH = 500;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token, body } = await req.json();
  if (!token || typeof body !== "string" || body.trim().length === 0) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }
  if (body.length > MAX_LENGTH) {
    return new Response(JSON.stringify({ error: "MESSAGE_TOO_LONG" }), { status: 400 });
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

  const { error: insertError } = await supabase.from("chat_messages").insert({
    game_id: playerRow.game_id,
    player_slot: playerRow.player_slot,
    body: body.trim(),
  });

  if (insertError) {
    return new Response(JSON.stringify({ error: "SEND_FAILED", detail: insertError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
