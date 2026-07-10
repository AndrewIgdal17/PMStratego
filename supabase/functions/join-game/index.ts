// supabase/functions/join-game/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { roomCode } = await req.json();
  if (!roomCode) {
    return new Response(JSON.stringify({ error: "MISSING_ROOM_CODE" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, status")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "ROOM_NOT_FOUND" }), { status: 404 });
  }
  if (game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_ALREADY_STARTED" }), { status: 409 });
  }

  const { data: existingPlayers, error: countError } = await supabase
    .from("game_players")
    .select("player_slot")
    .eq("game_id", game.id);

  if (countError) {
    return new Response(JSON.stringify({ error: "LOOKUP_FAILED", detail: countError.message }), { status: 500 });
  }
  if (existingPlayers.some((p) => p.player_slot === 2)) {
    return new Response(JSON.stringify({ error: "GAME_FULL" }), { status: 409 });
  }

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .insert({ game_id: game.id, player_slot: 2 })
    .select("secret_token")
    .single();

  if (playerError) {
    return new Response(JSON.stringify({ error: "JOIN_FAILED", detail: playerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ token: playerRow.secret_token, gameId: game.id }),
    { headers: { "Content-Type": "application/json" } },
  );
});
