import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 8;

function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("");
}

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

  const { data: oldGame, error: oldGameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (oldGameError || !oldGame || oldGame.status !== "finished") {
    return new Response(JSON.stringify({ error: "GAME_NOT_FINISHED" }), { status: 409 });
  }

  const roomCode = generateRoomCode();
  const { data: newGame, error: newGameError } = await supabase
    .from("games")
    .insert({ room_code: roomCode })
    .select("id")
    .single();

  if (newGameError) {
    return new Response(JSON.stringify({ error: "CREATE_FAILED", detail: newGameError.message }), { status: 500 });
  }

  const { data: newPlayerRow, error: newPlayerError } = await supabase
    .from("game_players")
    .insert({ game_id: newGame.id, player_slot: 1 })
    .select("secret_token")
    .single();

  if (newPlayerError) {
    return new Response(JSON.stringify({ error: "CREATE_PLAYER_FAILED", detail: newPlayerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ roomCode, token: newPlayerRow.secret_token, yourSlot: 1 }),
    { headers: { "Content-Type": "application/json" } },
  );
});
