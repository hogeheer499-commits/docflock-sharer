export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "docfamily.hogeheer499.nl") {
      url.hostname = "docremote.hogeheer499.nl";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/auth" && request.method === "POST") {
      return handleAuth(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      const authResponse = await verifyAuth(request, env);
      if (authResponse) return authResponse;
      return proxyApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleAuth(request, env) {
  try {
    const { pin } = await request.json();
    if (!pin) {
      return Response.json({ error: "PIN is required" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (hashHex !== env.PIN_HASH) {
      return Response.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const tokenData = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const payload = `${tokenData}.${expiry}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return Response.json({ token: `${payload}.${sigHex}`, expiry });
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

async function verifyAuth(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }

  const [tokenData, expiryStr, sigHex] = parts;
  const expiry = parseInt(expiryStr, 10);

  if (Date.now() > expiry) {
    return Response.json({ error: "Token expired" }, { status: 401 });
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
      return Response.json({ error: "Invalid token" }, { status: 401 });
    }
  } catch {
    return Response.json(
      { error: "Token verification failed" },
      { status: 401 }
    );
  }

  return null;
}

async function proxyApi(request, env, url) {
  const backendBase = env.TUNNEL_URL;
  if (!backendBase) {
    return Response.json(
      { error: "Backend niet geconfigureerd" },
      { status: 503 }
    );
  }

  const headers = new Headers(request.headers);
  headers.delete("host");

  try {
    const resp = await fetch(`${backendBase}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    });

    const respHeaders = new Headers(resp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders,
    });
  } catch {
    return Response.json(
      { error: "Backend niet bereikbaar" },
      { status: 502 }
    );
  }
}
