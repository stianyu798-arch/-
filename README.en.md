# Gomoku · Liquid Glass

**[简体中文](README.md)** · Browser **Gomoku** (five-in-a-row) with **React 19**, **TypeScript**, and **Vite** — dark liquid-glass UI, human vs AI, local history & replay, and a pattern encyclopedia with board demos.

---

## Features

| Area | Description |
|------|-------------|
| **Play** | 15×15; you are black, AI is white; **easy / normal / hard** (heuristics + minimax, stronger at higher tiers). |
| **Scoring & names** | In **easy** mode, shapes are scored and named; moves show in the side move list. |
| **Hints (easy)** | Suggested intersection can be highlighted on your turn (other modes: no hint). |
| **Win & line** | Five in a row wins, line highlighted; “New game” can pulse after the game. |
| **History** | Games stored in **`localStorage`**; select, step or auto-replay. |
| **Encyclopedia** | Pattern templates with animated demos and text on the right. |
| **UI** | Board and grid **scale with the layout**; **responsive gap** between board and side panel; **vertical scroll** on the main block or side panel when content does not fit (`overflow-y: auto`). |

---

## Tech stack

- **React 19**, **TypeScript**, **Vite 8** (`@vitejs/plugin-react`)
- **ESLint** (`typescript-eslint`, React Hooks)

All game and AI logic runs **in the browser** (pattern matching, static eval, minimax + alpha-beta). **No backend.**

---

## Requirements

- **Node.js** 20+ recommended (CI uses Node 22)
- Modern browser (`backdrop-filter`, CSS grid/flex, etc.)

---

## Local development

```bash
npm install
npm run dev
```

Open the URL printed in the terminal (often `http://localhost:5173`; port may vary).

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

---

## Build notes

- Output: **`dist/`**
- **`base: './'`** in `vite.config.ts` — relative asset URLs, suitable for **GitHub Pages** under any repo path; you usually **do not** need to change `base` when renaming the repo.

---

## Data & privacy

- History is stored in **`localStorage`** (see `HISTORY_KEY` in source). **Nothing is uploaded** to a server.

---

## Push to a Git repository (first time)

Initialize Git **inside the `gomoku-liquid-glass` folder** (next to `package.json`), not your entire user home directory. If you already ran `git init` in a parent folder by mistake, run in this project folder:

```bash
cd path/to/gomoku-liquid-glass
git init
```

Then (replace the remote URL with yours):

```bash
git add .
git commit -m "chore: initial commit — Gomoku Liquid Glass"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

If `origin` already exists: `git remote set-url origin <url>` then `git push`.

Use the included **`.gitignore`** (`node_modules/`, `dist/`, etc.) — do not commit dependencies or build output.

---

## Deploy to GitHub Pages

A **GitHub Actions** workflow (`.github/workflows/deploy-pages.yml`) runs on push to **`main`** or **`master`**: `npm ci` → `npm run build` → deploy to Pages.

1. Push the repo to GitHub (see above).
2. **Settings → Pages**: set **Source** to **GitHub Actions** (not “Deploy from a branch” unless you change the workflow).
3. Wait for **Deploy to GitHub Pages** in **Actions** (~1–2 minutes).

**Typical project site URL:**

```text
https://<your-user>.github.io/<your-repo>/
```

Update the path if you rename the repository.

---

## Repository layout (short)

```text
gomoku-liquid-glass/
├── public/
├── src/
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   └── index.css
├── index.html
├── vite.config.ts
├── .github/workflows/
├── README.md               # Chinese
├── README.en.md            # This file
└── package.json
```

---

## License

For learning / demo use; add a `LICENSE` file if you want a formal open-source license.
