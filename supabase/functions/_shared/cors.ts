function resolveAllowedOrigin(req?: Request): string {
  const configured = Deno.env.get('ALLOWED_ORIGIN')?.trim()
  if (!configured || configured === '*') return '*'
  const allowed = configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.length === 0) return '*'
  const reqOrigin = req?.headers.get('origin')?.trim()
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin
  return allowed[0]
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = resolveAllowedOrigin(req)
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin,
    ...(origin === '*' ? {} : { Vary: 'Origin' }),
  }
}

export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  return null
}
