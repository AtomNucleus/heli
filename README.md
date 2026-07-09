# HELI STRIKE

Cinematic free-flight + ring-course helicopter mini-sim in the browser. Built with Vite, TypeScript, and Three.js.

## Local development

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

```bash
npm run build    # production build → dist/
npm run preview  # preview production build
```

## Netlify deploy

This repo is Netlify-ready via `netlify.toml` (`publish = dist`, `build = npm run build`, SPA redirect).

1. Push the repo to GitHub/GitLab/Bitbucket.
2. In Netlify: **Add new site → Import an existing project**.
3. Build command: `npm run build` · Publish directory: `dist` (already set in `netlify.toml`).
4. Deploy.

Or CLI:

```bash
npm run build
npx netlify deploy --prod --dir=dist
```

## Controls

| Input | Action |
|--------|--------|
| **W / S** | Collective up / down |
| **A / D** | Pedals (yaw) |
| **Mouse** (pointer lock) | Cyclic pitch / roll |
| **Shift** | Boost collective |
| **Space** | Auto-level |
| **C** | Cycle camera (Chase → Cockpit → Orbit) |
| **V** | Arcade / Realistic assist |
| **P** | Pause |
| **R** | Reset mission |
| **H / Esc** | Controls help / unlock pointer |

Gamepad: left stick cyclic, triggers collective, bumpers yaw.

Touch: drag on canvas to look; on-screen collective / yaw buttons.

## Mission

Fly through glowing checkpoint rings **in order**, then land on an **H** pad for a −5s time bonus. Best time is stored in `localStorage`.

## Stack

- Vite 5 + TypeScript
- Three.js r160+ (Sky, postprocessing bloom + vignette)
- Web Audio API procedural rotor / wind
- Netlify static hosting

## Assets

Terrain PBR maps (`public/textures/terrain/`) are CC0 from [Poly Haven](https://polyhaven.com) — see `public/textures/ATTRIBUTION.md`.
