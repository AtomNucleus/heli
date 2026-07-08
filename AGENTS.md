# HELI STRIKE

Browser helicopter mini-sim built with Vite 5 + TypeScript + Three.js. Fully static, client-side only — there is no backend, database, or API, and no environment variables/secrets are required.

## Cursor Cloud specific instructions

- Dependencies are installed via the startup update script (`npm install`). Node 22 is available and works with Vite 5.
- Commands are documented in `README.md` and `package.json` scripts:
  - `npm run dev` — Vite dev server on `http://localhost:5173` (bound to all interfaces via `server.host: true`).
  - `npm run build` — runs `tsc` (type-check, `noEmit`) then `vite build` into `dist/`. This is the closest thing to a lint check since there is no dedicated lint script.
  - `npm run preview` — serves the production `dist/` build.
- There is no lint script, no test suite, and no git hooks. "Testing" this app means loading it in a browser and flying: from the title screen click `ENTER FLIGHT`, then hold `W` to spin up the rotor / gain lift (RPM, IAS, VS values should respond). See `README.md` for the full control scheme.
- Best lap time is persisted in `localStorage`; there is no server-side state.
