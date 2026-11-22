function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return json({ error: "Only GET requests are supported." }, 405);
      }

      if (!env.BROWSER_SERVER_URL || !env.BROWSER_SERVER_SECRET) {
        return json({ ok: false, error: "Drift's Chromium server has not been connected yet." }, 503);
      }

      try {
        const serverUrl = new URL(env.BROWSER_SERVER_URL);
        if (serverUrl.protocol !== "https:" || serverUrl.username || serverUrl.password) {
          throw new Error("Invalid server URL");
        }

        const upstream = await fetch(new URL("/health", serverUrl.origin), {
          method: "GET",
          headers: {
            "authorization": `Bearer ${env.BROWSER_SERVER_SECRET}`
          }
        });

        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") || "application/json",
            "cache-control": "no-store"
          }
        });
      } catch {
        return json({
          ok: false,
          error: "Could not reach the Chromium server. It may be starting or temporarily unavailable."
        }, 502);
      }
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ error: "Only POST requests are supported." }, 405);
    }

    if (!env.BROWSER_SERVER_URL || !env.BROWSER_SERVER_SECRET) {
      return json({ error: "Drift's Chromium server has not been connected yet." }, 503);
    }

    let serverUrl;
    try {
      serverUrl = new URL(env.BROWSER_SERVER_URL);
      if (serverUrl.protocol !== "https:" || serverUrl.username || serverUrl.password) {
        throw new Error("Invalid server URL");
      }
    } catch {
      return json({ error: "The Chromium server URL must be a valid HTTPS address." }, 503);
    }

    const path = url.pathname.replace(/\/$/, "");
    if (!/^\/api\/(session|[a-f0-9]{48}\/(navigate|action|close))$/i.test(path)) {
      return json({ error: "Unknown Drift API endpoint." }, 404);
    }

    let body = "";
    try {
      body = await request.text();
      if (body.length > 32768) return json({ error: "Request is too large." }, 413);
    } catch {
      return json({ error: "Could not read request." }, 400);
    }

    try {
      const upstream = await fetch(new URL(path + url.search, serverUrl.origin), {
        method: "POST",
        headers: {
          "authorization": `Bearer ${env.BROWSER_SERVER_SECRET}`,
          "content-type": "application/json",
          "x-client-ip": request.headers.get("CF-Connecting-IP") || "unknown"
        },
        body
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store"
        }
      });
    } catch {
      return json({
        error: "Could not reach the Chromium server. It may be starting or temporarily unavailable."
      }, 502);
    }
  }
};
