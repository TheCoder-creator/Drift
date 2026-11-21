# Drift

Drift creates a remote Chromium session using Cloudflare Browser Run and opens Cloudflare Live View for that session.

- Cloudflare Worker name: `horizon-chromium`
- Browser binding: `BROWSER`
- Static site files: `public/`
- Worker entry point: `src/index.js`

Connect this repository to the existing Worker named `horizon-chromium`.

Workers Builds settings:
- Root directory: `/`
- Build command: leave blank
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

The Worker name in `wrangler.jsonc` must match the Cloudflare Worker name exactly.

Visitors enter a website address, the Worker creates a Browser Run session, opens the address in Chromium, and returns a short-lived Live View link. Live View links act like access credentials; do not share them publicly.
