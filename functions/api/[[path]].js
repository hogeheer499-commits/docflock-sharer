// Catch-all proxy: forwards all /api/* requests (except /api/auth) to the Beelink backend via Cloudflare Tunnel
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Build the backend URL — TUNNEL_URL should be the Cloudflare Tunnel public hostname
  const backendBase = env.TUNNEL_URL; // e.g. "https://docvlog-backend.yourdomain.com"
  if (!backendBase) {
    return Response.json(
      { error: "Backend niet geconfigureerd" },
      { status: 503 }
    );
  }

  const backendUrl = `${backendBase}${url.pathname}${url.search}`;

  // Forward the request, stripping hop-by-hop headers
  const headers = new Headers(request.headers);
  headers.delete("host");

  try {
    const resp = await fetch(backendUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    });

    // Return the backend response
    const respHeaders = new Headers(resp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    });
  } catch (e) {
    return Response.json(
      { error: "Backend niet bereikbaar" },
      { status: 502 }
    );
  }
}
