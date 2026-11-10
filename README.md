# CodeShare

CodeShare is a MERN code-snippet workspace. React and CodeMirror provide the interface, Express validates and authorizes API requests, and MongoDB stores accounts and snippets. A person must register or sign in before opening the workspace or reading snippets.

## Run locally

Requirements: Node.js 20.13 or newer and a running MongoDB instance or Atlas connection string.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`; set `MONGODB_URI` and a random `JWT_SECRET` with at least 32 characters.
3. Run `npm run dev`.
4. Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Vite forwards `/api` to Express on port 5051.

`npm test` runs API, authentication, ownership, CORS, theme contrast, and responsive stylesheet checks. `npm run build` creates the production client in `dist/`.

## Publish without paid hosting

The client is published with GitHub Pages. Express runs as a free Render web service, and MongoDB Atlas Free stores persistent application data. GitHub Pages cannot execute an Express/MongoDB backend, so the backend is required for registration, sign-in, and data access.

1. Push the `main` branch to the GitHub repository and set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.
2. Create a MongoDB Atlas Free cluster. Create an application database user and copy the connection string. In Atlas Network Access, allow Render's outbound connections; Render Free does not provide a fixed outbound IP. Keep the database user limited to the CodeShare database.
3. In Render, create a Blueprint from this repository and set the prompted `MONGODB_URI`. The included `render.yaml` configures a free Express service, a generated JWT secret, GitHub Pages CORS origin, and the `/api/health` check.
4. Copy the Render service's public origin, such as `https://codeshare-api-harshkoli9.onrender.com`. In GitHub **Settings → Secrets and variables → Actions → Variables**, create `VITE_API_BASE` with that origin (no trailing slash).
5. Re-run the **Build and deploy GitHub Pages** workflow. Its build requires `VITE_API_BASE` so it does not publish a frontend with a missing API.

The Pages address for this repository is `https://harshkoli9.github.io/code-share-app/`. Free Render services sleep after 15 minutes without traffic and may take about a minute to wake. Atlas Free has storage and throughput limits and can pause after extended inactivity. These are free-tier limits; no paid add-on is required for this setup.

## Authentication and data rules

- Registration normalizes email addresses, trims display names, and requires a password of at least 10 characters.
- Passwords are hashed with bcryptjs. Password hashes are excluded from normal user queries and never returned by the API.
- Sign-in returns an eight-hour signed JWT. The browser holds it in `sessionStorage` and sends it as a bearer token, which works across the GitHub Pages and Render origins without third-party cookies.
- CORS accepts only the configured frontend origin in production. Requests use bearer authorization and do not send cookies.
- All snippet endpoints require authentication. The API derives `owner` from the verified token; edit/delete queries also include that owner ID.
- Snippets are visible to all signed-in accounts. Imported Firebase records have no owner because the old app used unverified display names.
- Request rate limits, Zod validation, Helmet headers, bounded JSON bodies, and server-side ownership filters protect API routes.

## API routes

- `GET /api/health` — service readiness.
- `POST /api/auth/register` and `POST /api/auth/login` — create an account or issue a session token.
- `GET /api/auth/me` — return the authenticated account.
- `GET /api/snippets?search=&page=&limit=` — authenticated, paginated snippet search.
- `POST /api/snippets` — create a snippet.
- `PUT /api/snippets/:id` — update an owned snippet.
- `DELETE /api/snippets/:id` and `DELETE /api/snippets/mine/all` — delete one or all owned snippets.

For local same-origin work, leave `VITE_API_BASE` blank and Vite proxies `/api` to the local Express server. The GitHub Pages workflow builds with `https://codeshare-api-harshkoli9.onrender.com` as `VITE_API_BASE`; set the repository Actions variable of the same name only if the Render API hostname changes. The Render service is API-only, so `GET /` is not a frontend route; use `GET /api/health` to check service and database readiness.

## Import existing Firebase snippets

To preserve old data, set `FIREBASE_DATABASE_URL`, `FIREBASE_AUTH_TOKEN` if required, and `MONGODB_URI` in `.env`; then run `npm run migrate:firebase`. The import is repeat-safe and leaves Firebase data unchanged. It skips malformed or oversized records. Old author names are labels only and are not mapped to new account owners.

See [Explanation/Project_Report.txt](Explanation/Project_Report.txt) for the full architecture, data model, setup, test coverage, limitations, and handoff guide.
