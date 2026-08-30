# garden-designer

A React + TypeScript app for laying out garden beds, built with Vite and Tailwind CSS.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and npm

## Getting started

```bash
npm install
npm run dev
```

Then open the URL printed in the terminal (usually [http://localhost:5173/garden-designer/](http://localhost:5173/garden-designer/)). Vite hot-reloads on save, so this is also how you manually test changes in the browser — there is no automated test suite in this repo yet.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local dev server with hot reload |
| `npm run build` | Type-check and build a production bundle into `dist/` |
| `npm run preview` | Serve the production build locally, to sanity-check it before deploying |
| `npm run lint` | Run Oxlint |

## Deploying to GitHub Pages

Pushes to `main` automatically build and deploy via the workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml), publishing to `https://<owner>.github.io/garden-designer/`.

One-time setup (per GitHub repo): in **Settings → Pages**, set **Source** to **GitHub Actions**.

To deploy manually instead:

```bash
npm run build
npm run preview   # optional: check dist/ locally first
```

Then push the contents of `dist/` to GitHub Pages using whatever method you prefer (e.g. the `gh-pages` package).

Note: [vite.config.ts](vite.config.ts) sets `base: '/garden-designer/'` so built asset paths resolve correctly under the project Pages URL. If you rename the repo, update `base` to match.
