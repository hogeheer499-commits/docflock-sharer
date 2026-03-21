// Middleware that validates auth token on all /api/* routes except /api/auth
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Skip auth check for the auth endpoint itself and for static files
  if (url.pathname === "/api/auth" || !url.pathname.startsWith("/api/")) {
    return next();
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) {
    return Response.json({ error: "Ongeldig token" }, { status: 401 });
  }

  const [tokenData, expiryStr, sigHex] = parts;
  const expiry = parseInt(expiryStr, 10);

  if (Date.now() > expiry) {
    return Response.json({ error: "Token verlopen" }, { status: 401 });
  }

  try {
    const encoder = new TextEncoder();
    const payload = `${tokenData}.${expiryStr}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBytes = new Uint8Array(
      sigHex.match(/.{2}/g).map((byte) => parseInt(byte, 16))
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(payload)
    );
    if (!valid) {
      return Response.json({ error: "Ongeldig token" }, { status: 401 });
    }
  } catch {
    return Response.json(
      { error: "Token verificatie mislukt" },
      { status: 401 }
    );
  }

  return next();
}
