# Drift

Drift is a browser UI hosted by Cloudflare Workers. Website pages are rendered by a separate central Chromium server and displayed inside Drift as remote screenshots.

- Cloudflare Worker: `horizon-chromium`
- Worker entry point: `src/index.js`
- Static website: `public/`
- Central Chromium service: repository `drift-chromium-server`

## Connect the Chromium server

Deploy the Docker service from the `TheCoder-creator/drift-chromium-server` repository to a container host. Set a private `DRIFT_SERVER_SECRET` on that host.

In the Cloudflare dashboard, open the Worker `horizon-chromium` and add:

- `BROWSER_SERVER_URL`: the HTTPS URL of your deployed Chromium service
- `BROWSER_SERVER_SECRET`: the same private secret used by the server

Add both as secrets/variables in the Worker settings. Never put the secret in this repository or in frontend code.

## Deploy

Keep this repository connected to the existing Worker named `horizon-chromium`. The production branch is `main`. The build command can be left blank; deploy with `npx wrangler deploy` if deploying manually.

The Chromium host must support Docker and a long-running service. Free plans may sleep or have memory and usage limits. Test privately before sharing Drift. The server has temporary sessions and basic per-IP/session limits; this is not a hardened public proxy.
