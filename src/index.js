import puppeteer from "@cloudflare/puppeteer";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function safeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a valid website address.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid website address."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only public HTTP and HTTPS websites are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host === "0.0.0.0" || host === "::1" ||
      host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    throw new Error("That website address is not allowed.");
  }
  const ip = host.split(".").map(Number);
  if (ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (ip[0] === 0 || ip[0] === 10 || ip[0] === 127 ||
        (ip[0] === 169 && ip[1] === 254) ||
        (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
        (ip[0] === 192 && ip[1] === 168) || ip[0] >= 224) {
      throw new Error("That website address is not allowed.");
    }
  }
  return url.href;
}

function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function protectPage(page) {
  await page.setRequestInterception(true);
  page.on("request", request => {
    try {
      const url = new URL(request.url());
      if (["data:", "blob:", "about:"].includes(url.protocol)) return request.continue();
      safeUrl(url.href);
      return request.continue();
    } catch {
      return request.abort();
    }
  });
}

async function cloudflareSession(env, url, actionBody = null) {
  if (!env.BROWSER) throw new Error("Cloudflare Browser Run is not enabled for this Worker.");
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: 600000 });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(25000);
    await protectPage(page);
    await page.goto(safeUrl(url || "https://example.com"), { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    if (actionBody) await runAction(page, actionBody);
    const png = await page.screenshot({ type: "png", animations: "disabled", timeout: 15000 });
    return {
      sessionId: "cf-" + browser.sessionId(),
      provider: "Cloudflare Browser Run",
      image: encodeBase64(png),
      url: page.url(),
      title: await page.title().catch(() => "Drift")
    };
  } finally {
    await browser.disconnect().catch(() => {});
  }
}

async function runAction(page, body = {}) {
  if (body.action === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => {});
  else if (body.action === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => {});
  else if (body.action === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  else if (body.action === "home") await page.goto("https://example.com", { waitUntil: "domcontentloaded" }).catch(() => {});
  else if (body.action === "click") {
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid click position.");
    await page.mouse.click(Math.max(0, Math.min(1280, x)), Math.max(0, Math.min(800, y)));
  } else if (body.action === "type") await page.keyboard.insertText(String(body.text || "").slice(0, 2000));
  else if (body.action === "key") {
    const allowed = ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "];
    if (!allowed.includes(body.key)) throw new Error("That key is not supported.");
    await page.keyboard.press(body.key);
  } else if (body.action === "scroll") {
    await page.mouse.wheel(0, Math.max(-800, Math.min(800, Number(body.deltaY) || 0)));
  } else throw new Error("Unknown browser action.");
}

async function cloudflareApi(path, body, env) {
  const cfMatch = path.match(/^\/api\/cf-([a-f0-9-]{36})\/(navigate|action|close)$/i);
  if (cfMatch) {
    const [, sessionId, operation] = cfMatch;
    const browser = await puppeteer.connect(env.BROWSER, sessionId);
    try {
      if (operation === "close") {
        await browser.close();
        return json({ ok: true });
      }
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      if (operation === "navigate") {
        await page.goto(safeUrl(body.url), { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
      } else {
        await runAction(page, body);
      }
      const png = await page.screenshot({ type: "png", animations: "disabled", timeout: 15000 });
      return json({
        sessionId: "cf-" + sessionId,
        provider: "Cloudflare Browser Run",
        image: encodeBase64(png),
        url: page.url(),
        title: await page.title().catch(() => "Drift")
      });
    } finally {
      await browser.disconnect().catch(() => {});
    }
  }

  let targetUrl = body.url;
  let actionBody = null;
  if (path.endsWith("/navigate")) targetUrl = body.url;
  if (path.endsWith("/action")) {
    targetUrl = body.currentUrl;
    actionBody = body;
  }
  if (!targetUrl && path === "/api/session") targetUrl = "https://example.com";
  if (!targetUrl) throw new Error("Render stopped responding. Reopen the current page to continue on Cloudflare Browser Run.");
  return json(await cloudflareSession(env, targetUrl, actionBody));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ error: "Only GET requests are supported." }, 405);
      if (!env.BROWSER_SERVER_URL || !env.BROWSER_SERVER_SECRET) {
        return json({ ok: false, primary: "not-configured", fallbackAvailable: !!env.BROWSER });
      }
      try {
        const serverUrl = new URL(env.BROWSER_SERVER_URL);
        if (serverUrl.protocol !== "https:" || serverUrl.username || serverUrl.password) throw new Error("Invalid server URL");
        const upstream = await fetch(new URL("/health", serverUrl.origin), {
          method: "GET",
          headers: { authorization: `Bearer ${env.BROWSER_SERVER_SECRET}` },
          signal: AbortSignal.timeout(8000)
        });
        return json({
          ok: upstream.ok || !!env.BROWSER,
          primary: upstream.ok ? "online" : "unavailable",
          fallbackAvailable: !!env.BROWSER
        }, upstream.ok || env.BROWSER ? 200 : upstream.status);
      } catch {
        return json({ ok: !!env.BROWSER, primary: "unavailable", fallbackAvailable: !!env.BROWSER }, env.BROWSER ? 200 : 502);
      }
    }

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);

    let body = {};
    try {
      const raw = await request.text();
      if (raw.length > 32768) return json({ error: "Request is too large." }, 413);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ error: "Invalid request body." }, 400);
    }

    const path = url.pathname.replace(/\/$/, "");
    const valid = /^\/api\/(session|[a-f0-9]{48}\/(navigate|action|close)|cf-[a-f0-9-]{36}\/(navigate|action|close))$/i.test(path);
    if (!valid) return json({ error: "Unknown Drift API endpoint." }, 404);

    if (path.includes("/cf-")) {
      try { return await cloudflareApi(path, body, env); }
      catch (error) { return json({ error: error.message || "Cloudflare Browser Run failed." }, 502); }
    }

    if (!env.BROWSER_SERVER_URL || !env.BROWSER_SERVER_SECRET) {
      try { return await cloudflareApi(path, body, env); }
      catch (error) { return json({ error: error.message || "No browser provider is available." }, 503); }
    }

    let serverUrl;
    try {
      serverUrl = new URL(env.BROWSER_SERVER_URL);
      if (serverUrl.protocol !== "https:" || serverUrl.username || serverUrl.password) throw new Error("Invalid server URL");
    } catch {
      try { return await cloudflareApi(path, body, env); }
      catch (error) { return json({ error: error.message || "The browser providers are unavailable." }, 503); }
    }

    try {
      const upstream = await fetch(new URL(path + url.search, serverUrl.origin), {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.BROWSER_SERVER_SECRET}`,
          "content-type": "application/json",
          "x-client-ip": request.headers.get("CF-Connecting-IP") || "unknown"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      if (upstream.ok || upstream.status < 500 && upstream.status !== 429) {
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") || "application/json",
            "cache-control": "no-store"
          }
        });
      }
      try { return await cloudflareApi(path, body, env); }
      catch (error) {
        return json({ error: "Render and Cloudflare Browser Run are unavailable: " + (error.message || "fallback failed") }, 502);
      }
    } catch {
      try { return await cloudflareApi(path, body, env); }
      catch (error) {
        return json({ error: "Render is unavailable and Cloudflare Browser Run could not start: " + (error.message || "fallback failed") }, 502);
      }
    }
  }
};
