# VenueBook API

The browser talks to the same-origin Express API under `/api`. Express serves the API; Vercel serves files under `public/` as static assets. The static catalogue is `venues.json`, served at `/data/venues.json`; PostgreSQL contains accounts, bookings, and sessions only.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/register` | Public | Create a student or faculty account. Faculty registration requires a configured faculty code. |
| POST | `/api/login` | Public | Sign in and establish a persistent, HTTP-only session. |
| POST | `/api/logout` | Signed in | End the session. |
| GET | `/api/health` | Public | Check whether PostgreSQL is reachable. |
| GET | `/api/me` | Signed in | Return the current account. |
| GET | `/api/venues` | Signed in | List venues and their capacity/features. |
| GET | `/api/bookings?date=YYYY-MM-DD` | Signed in | List occupied time slots for a date. |
| GET | `/api/bookings?email=...` | Signed in | List the signed-in user's bookings; the session controls whose data is returned. |
| POST | `/api/bookings` | Signed in | Request a booking. Requests start in `pending` status. |
| DELETE | `/api/bookings/:id` | Owner or administrator | Mark a booking `cancelled` while retaining its record. |
| GET | `/api/admin/bookings` | Administrator | List requests and review history. |
| PATCH | `/api/admin/bookings/:id` | Administrator | Approve or decline a pending booking. |

Errors return JSON `{ "error": "message" }`. PostgreSQL enforces that active pending/approved bookings for the same static venue ID and date cannot overlap, even when requests reach separate Vercel instances concurrently.

If the API is unavailable in production, the site shows a service error instead of saving fake bookings in browser storage. The local-only demo fallback is retained for `localhost` development.
