# Automonie web app

React 19 single-page app built with Vite. It talks to the Automonie API in `../backend`.

## Scripts

- `npm run dev` starts the dev server on http://localhost:3000
- `npm run build` writes the production build to `build/`
- `npm run preview` serves that build locally

## Configuration

Set these at build time (Vercel: Settings, then Environment Variables). They are inlined
into the bundle, so a change needs a redeploy.

- `REACT_APP_API_URL`: API base URL, no trailing slash. Defaults to the Render URL.
- `REACT_APP_GOOGLE_CLIENT_ID`: enables Google sign-in when set.

For local work against a local API, put `REACT_APP_API_URL=http://localhost:5099` in
`.env.local`.

## Deployment

Vercel builds from this folder using `vercel.json` (Vite, output `build/`, SPA rewrites).
