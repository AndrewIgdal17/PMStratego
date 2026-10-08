import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "MISSING_TOKEN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find the player by their secret token
    const { data: player, error: playerError } = await supabase
      .from("game_players")
      .select("id, game_id, player_slot")
      .eq("secret_token", token)
      .single();

    if (playerError || !player) {
      return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (player.player_slot !== 1) {
      return new Response(JSON.stringify({ error: "NOT_HOST" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the game and verify it's a bot game still in setup
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, is_bot_game, status")
      .eq("id", player.game_id)
      .single();

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!game.is_bot_game) {
      return new Response(JSON.stringify({ error: "NOT_BOT_GAME" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (game.status !== "setup") {
      return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete in FK order: chat_messages, moves, pieces, game_players, games
    const gid = game.id;
    await supabase.from("chat_messages").delete().eq("game_id", gid);
    await supabase.from("moves").delete().eq("game_id", gid);
    await supabase.from("pieces").delete().eq("game_id", gid);
    await supabase.from("game_players").delete().eq("game_id", gid);
    await supabase.from("games").delete().eq("id", gid);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
