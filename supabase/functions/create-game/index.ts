import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no O/0, I/1 to avoid misreads
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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let roomCode = generateRoomCode();
  let gameId: string | null = null;

  for (let attempt = 0; attempt < 5 && !gameId; attempt++) {
    const { data, error } = await supabase
      .from("games")
      .insert({ room_code: roomCode })
      .select("id")
      .single();

    if (!error) {
      gameId = data.id;
    } else if (error.code === "23505") {
      // room_code collision (astronomically unlikely at 8 chars) -- retry with a new code
      roomCode = generateRoomCode();
    } else {
      return new Response(JSON.stringify({ error: "CREATE_GAME_FAILED", detail: error.message }), { status: 500 });
    }
  }

  if (!gameId) {
    return new Response(JSON.stringify({ error: "ROOM_CODE_EXHAUSTED" }), { status: 500 });
  }

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .insert({ game_id: gameId, player_slot: 1 })
    .select("secret_token")
    .single();

  if (playerError) {
    return new Response(JSON.stringify({ error: "CREATE_PLAYER_FAILED", detail: playerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      roomCode,
      token: playerRow.secret_token,
      invitePath: `/setup.html?code=${roomCode}&join=1`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
