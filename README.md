# VenueBook

VenueBook keeps its plain HTML, CSS, and JavaScript interface. The venue catalogue is static project data in `venues.json`; it is served with the site and is never inserted into PostgreSQL. Neon PostgreSQL stores registered accounts, booking requests and decisions, and login sessions.

## Vercel and Neon

1. Keep the Vercel project Root Directory set to the folder containing this `package.json` (`SDS-Project-` in this repository). The Express framework preset and `vercel.json` configure the serverless app; no Vercel CLI install is needed to deploy from GitHub.
2. In Vercel, connect the Neon integration to this project and enable it for Production and Preview. The integration supplies `DATABASE_URL` to deployments.
3. In Vercel Project Settings → Environment Variables, add `JWT_SERVER` for Production and Preview. Use a long random value and keep it private. It signs the Express session cookie; the app does not use JWT login tokens. Redeploy after adding or changing environment variables.
4. Keep `ADMIN_USERNAMES` and `ADMIN_PASSWORD` configured in Vercel. Admin credentials are environment configuration and are not stored as user records. Set `FACULTY_CODES` if faculty registration is enabled. Email remains optional (`GMAIL_USER` and `GMAIL_APP_PASSWORD`).
5. Push the code to GitHub. On startup, the app creates the required PostgreSQL tables automatically. No SQL editor, database CLI, or manual schema setup is needed.

Neon’s Vercel integration injects its connection URL as an environment variable, and Vercel applies environment-variable changes to new deployments. See [Vercel’s Postgres integration overview](https://vercel.com/docs/postgres) and [environment variable documentation](https://vercel.com/docs/environment-variables).

## Where data lives

- `venues.json`: static venue names, capacities, types, equipment, and stable IDs. Edit this file when the catalogue changes; keep existing IDs attached to the same venues so saved bookings continue to point to the right room.
- PostgreSQL `users`: student/faculty registrations and password hashes.
- PostgreSQL `bookings`: requests and their approval status, keyed to the static venue IDs.
- PostgreSQL `sessions`: shared login sessions required because Vercel functions are short lived.
- Environment variables: administrator credentials, faculty codes, session signing secret, and optional email credentials.

The old `venues.db` is only read by a one-time compatibility importer. If the connected PostgreSQL database has no users or bookings, the importer copies registered (non-admin) accounts and bookings, mapping old venue IDs to the names in the static JSON catalogue. It never copies venue rows into Neon. It does not overwrite an already-used cloud database. Once imported, runtime code does not use SQLite. Old administrator logins should be configured with `ADMIN_USERNAMES` and `ADMIN_PASSWORD`.

## Local development

Install the project dependencies and set `DATABASE_URL` plus `JWT_SERVER` in an untracked `.env` file. Then run:

```sh
npm install
npm start
```

The site uses port 3000 by default: <http://localhost:3000>. A Neon URL from the Vercel project can be used for local development if desired. Keep `.env` private and do not commit it.

Registration, login, venue browsing, booking requests, cancellation, administrator approval, and optional email notifications are retained. See [`API.md`](API.md) for the endpoint contract.
