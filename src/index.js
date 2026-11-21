function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function normalizeUrl(value) {
  let input = String(value || "").trim();
  if (!input) throw new Error("Enter a website address.");
  if (!/^https?:\/\//i.test(input)) input = "https://" + input;
  const parsed = new URL(input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }
  return parsed.href;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/open") {
      if (request.method !== "POST") return json({ error: "Use POST for this endpoint." }, 405);
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "Invalid request." }, 400); }

      let destination;
      try { destination = normalizeUrl(body.url); }
      catch (error) { return json({ error: error.message }, 400); }

      let session;
      try {
        session = await env.BROWSER.acquire({
          keepAlive: 600000,
          targets: true,
          liveViewUrlExpiresInMs: 3600000
        });
        const target = await env.BROWSER.devtools.newTarget(session.sessionId, destination);
        const liveView = await env.BROWSER.getLiveView(session.sessionId, {
          targetId: target.id,
          mode: "tab"
        });
        return json({
          sessionId: session.sessionId,
          liveViewUrl: liveView.devtoolsFrontendUrl,
          destination
        });
      } catch {
        if (session?.sessionId) {
          await env.BROWSER.closeSession(session.sessionId).catch(() => {});
        }
        return json({
          error: "Could not start the remote browser. Check that Browser Run is enabled for this Cloudflare account and try again."
        }, 502);
      }
    }

    if (url.pathname === "/api/close") {
      if (request.method !== "POST") return json({ error: "Use POST for this endpoint." }, 405);
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "Invalid request." }, 400); }
      if (!body.sessionId || typeof body.sessionId !== "string") {
        return json({ error: "Missing session ID." }, 400);
      }
      try {
        const result = await env.BROWSER.closeSession(body.sessionId);
        return json({ closed: true, result });
      } catch {
        return json({ error: "Could not close that browser session." }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
