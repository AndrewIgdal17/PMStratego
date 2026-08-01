import { create, verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const JWT_SECRET_RAW = Deno.env.get("JWT_SECRET") || "stratego-dev-secret-change-me";

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(JWT_SECRET_RAW),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createToken(playerId: string, username: string): Promise<string> {
  const key = await getKey();
  return await create({ alg: "HS256", typ: "JWT" }, {
    sub: playerId,
    username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  }, key);
}

export async function verifyToken(token: string): Promise<{ player_id: string; username: string } | null> {
  try {
    const key = await getKey();
    const payload = await verify(token, key);
    return { player_id: payload.sub as string, username: payload.username as string };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}
