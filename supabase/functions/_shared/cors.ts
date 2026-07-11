// Shared CORS headers for all Edge Functions. Supabase does not add CORS
// headers automatically in production (only the local dev CLI does, which is
// why this was missed during local-only testing) -- every function must
// handle the OPTIONS preflight and include these headers on every response,
// success or error.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
