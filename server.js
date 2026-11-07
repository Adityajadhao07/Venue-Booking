// Venue Booking System: web server + API.
// Run with:  npm start   (then open http://localhost:3000)

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const database = require('./database');
const { run, all, get, pool } = database;
const venuesList = require('./venues.json');
const { readLegacyDatabase, copyLegacyRows } = require('./legacy-database');
const venuesById = new Map(venuesList.map((venue) => [Number(venue.id), venue]));
const venuesByName = new Map(venuesList.map((venue) => [venue.name, venue]));

const PORT = process.env.PORT || 3000;
const OPEN_MIN = 8 * 60;   // bookings allowed from 8 am
const CLOSE_MIN = 20 * 60; // until 8 pm

// Runs one booking check+insert at a time, so two people cannot take the same slot.
let lockChain = Promise.resolve();
const withLock = (fn) => {
  const result = lockChain.then(fn);
  lockChain = result.catch(() => {});
  return result;
};

async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(9214461772001)');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await client.query('SELECT 1');

    // Older versions stored the static catalogue in PostgreSQL. Translate any
    // booking references to bundled IDs before deleting the obsolete table.
    const oldCatalogue = await client.query("SELECT to_regclass('public.classrooms') AS name");
    if (oldCatalogue.rows[0].name) {
      const oldVenues = await client.query('SELECT id, name FROM classrooms ORDER BY id');
      await client.query(`DO $$ DECLARE fk record; BEGIN
        FOR fk IN SELECT conname FROM pg_constraint
          WHERE conrelid = 'bookings'::regclass AND contype = 'f'
            AND confrelid = 'classrooms'::regclass
        LOOP EXECUTE format('ALTER TABLE bookings DROP CONSTRAINT %I', fk.conname); END LOOP;
      END $$`);
      for (const oldVenue of oldVenues.rows) {
        const venue = venuesByName.get(oldVenue.name);
        if (!venue) throw new Error(`The static venue catalogue is missing "${oldVenue.name}" referenced by existing bookings.`);
        await client.query('UPDATE bookings SET "venueId" = $1 WHERE "venueId" = $2', [venue.id, oldVenue.id]);
      }
      await client.query('DROP TABLE classrooms');
    }

    const migration = await client.query('SELECT value FROM app_settings WHERE key = $1', ['legacy_data_migration']);
    if (!migration.rowCount) {
      // On a new hosted database, import the existing repo's SQLite data once.
      // The helper reads venues.db with WASM and never writes to that file.
      const legacy = await readLegacyDatabase(path.join(__dirname, 'venues.db'));
      const result = await copyLegacyRows(client, legacy, venuesList);
      const state = result.copied ? 'completed' : 'skipped-existing-data';
      await client.query('INSERT INTO app_settings (key, value) VALUES ($1, $2)', ['legacy_data_migration', state]);
      if (result.copied) {
        console.log(`Legacy data copied: ${result.users} registered accounts, ${result.bookings} bookings. Venue details remain in the bundled catalogue.`);
      } else {
        console.log('Legacy data import skipped because PostgreSQL already contains accounts or bookings.');
      }
    }

    let sessionSecret = process.env.JWT_SERVER || process.env.JWT_SECRET || process.env.SESSION_SECRET;
    if (!sessionSecret) {
      const generated = crypto.randomBytes(48).toString('base64url');
      await client.query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
        ['session_secret', generated]);
      ({ rows: [{ value: sessionSecret }] } = await client.query('SELECT value FROM app_settings WHERE key = $1', ['session_secret']));
    }
    await client.query('DELETE FROM sessions WHERE expires <= now()');
    const adminUsernames = String(process.env.ADMIN_USERNAMES || process.env.ADMIN_USERNAME || '')
      .split(',').map((username) => username.trim()).filter(Boolean);
    const adminPasswordHash = process.env.ADMIN_PASSWORD ? await bcrypt.hash(process.env.ADMIN_PASSWORD, 10) : null;
    if (!adminUsernames.length || !adminPasswordHash) console.warn('No administrator configured. Set ADMIN_USERNAMES and ADMIN_PASSWORD.');
    appAdminConfig = { usernames: new Set(adminUsernames.map((username) => username.toLowerCase())), passwordHash: adminPasswordHash };
    await client.query('COMMIT');
    return sessionSecret;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let appAdminConfig = { usernames: new Set(), passwordHash: null };

// ---------- email (optional) ----------
// Gmail: set GMAIL_USER and GMAIL_APP_PASSWORD in .env. Without them, emails are skipped.
let mailer = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
    mailer.verify()
    .then(() => console.log('Email is ready to send.'))
    .catch((err) => console.error('Email login failed:', err.message));
}


const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const to12 = (t) => {
  const min = toMin(t); const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h >= 12 ? 'pm' : 'am'}`;
};

async function sendBookingUpdate(b, status, note = '') {
  if (!mailer) return;
  const approved = status === 'approved';
  try {
    await mailer.sendMail({
      from: `"Venue Booking" <${process.env.GMAIL_USER}>`,
      to: b.email,
      subject: approved ? `Booking approved: ${b.venueName} on ${b.date}` : `Booking update: ${b.venueName} on ${b.date}`,
      text:
`Hi ${b.name},

Your booking request has been ${approved ? 'approved' : status === 'rejected' ? 'declined' : 'received and is awaiting administrator approval'}.

Venue: ${b.venueName}
Date: ${b.date}
Time: ${to12(b.startTime)} to ${to12(b.endTime)}
People: ${b.attendees}
Purpose: ${b.purpose}
${note ? `Administrator note: ${note}\n` : ''}
To view the latest status, open "My bookings" on the website.`,
    });
  } catch (err) {
    console.error('Could not send email:', err.message);
  }
}

// ---------- app ----------
const app = express();
app.use(express.json());
const isHttpsDeployment = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
if (isHttpsDeployment) app.set('trust proxy', 1);
const bad = (res, status, error) => res.status(status).json({ error });

class PostgresSessionStore extends session.Store {
  get(sid, callback) {
    get('SELECT data, expires FROM sessions WHERE sid = ? AND expires > now()', [sid])
      .then(async (row) => {
        if (!row) return callback(null, null);
        callback(null, row.data);
      })
      .catch(callback);
  }

  set(sid, sess, callback) {
    const expires = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + Number(sess.cookie && sess.cookie.maxAge || 8 * 60 * 60 * 1000);
    run(`INSERT INTO sessions (sid, data, expires) VALUES (?, ?::jsonb, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`,
      [sid, JSON.stringify(sess), new Date(expires)])
      .then(() => callback && callback(null))
      .catch((err) => callback && callback(err));
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }

  destroy(sid, callback) {
    run('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => callback && callback(null))
      .catch((err) => callback && callback(err));
  }
}

app.use(express.static(path.join(__dirname, 'public')));

// Serve the one canonical catalogue file to the browser without storing it in
// PostgreSQL or maintaining a second copy under public/.
app.get('/data/venues.json', (req, res) => res.json(venuesList));

// The catalogue is bundled with the app; health checks only confirm the
// writable account/booking database is reachable.
app.get('/api/health', async (req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (err) { next(err); }
});

// Vercel reuses warm instances, so share successful initialization. If Neon
// times out during a cold start, clear the failed promise so the next request
// can retry instead of leaving this function instance permanently unavailable.
let sessionMiddleware;
let databaseReady;
function initializeDatabase() {
  if (!databaseReady) {
    databaseReady = setupDatabase().then((sessionSecret) => {
      sessionMiddleware = session({
        secret: sessionSecret,
        store: new PostgresSessionStore(),
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: 'lax', secure: isHttpsDeployment, maxAge: 1000 * 60 * 60 * 8 },
      });
      return null;
    }).catch((err) => {
      console.error('Database initialization failed:', err.message);
      databaseReady = null;
      return err;
    });
  }
  return databaseReady;
}
initializeDatabase();
app.use('/api', (req, res, next) => {
  initializeDatabase().then((err) => err
    ? bad(res, 503, 'The database is not ready. Check the server configuration and try again.')
    : sessionMiddleware(req, res, next)).catch(next);
});
// Guard: blocks anyone who is not logged in
const requireLogin = (req, res, next) => {
  if (!req.session.user) return bad(res, 401, 'Please log in first.');
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return bad(res, 401, 'Please log in first.');
  if (req.session.user.role !== 'admin') return bad(res, 403, 'Administrator access is required.');
  next();
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// ---------- register / login ----------
app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return bad(res, 400, 'Username must be 3-20 letters, numbers or underscores.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 400, 'Enter a valid email address.');
  if (password.length < 8) return bad(res, 400, 'Password must be at least 8 characters.');

  // Only student or faculty can register here. Admin is NOT allowed.
  if (!['student', 'faculty'].includes(role)) return bad(res, 400, 'Choose student or faculty.');

  // Faculty must know one of the configured secret codes, so students cannot just pick "faculty".
  const facultyCodes = String(process.env.FACULTY_CODES || process.env.FACULTY_CODE || '')
    .split(',').map((code) => code.trim()).filter(Boolean);
  if (role === 'faculty' && !facultyCodes.includes(String(req.body.facultyCode || '').trim())) {
    return bad(res, 403, 'Wrong faculty code.');
  }

  const exists = await get('SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', [username, email]);
  if (exists) return bad(res, 409, 'That username or email is already registered.');

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await run('INSERT INTO users (username, email, "passwordHash", role) VALUES (?,?,?,?)',
      [username, email, passwordHash, role]);
  } catch (err) {
    if (err.code === '23505') {
      return bad(res, 409, 'That username or email is already registered.');
    }
    throw err;
  }
  res.status(201).json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (appAdminConfig.usernames.has(username.toLowerCase()) && appAdminConfig.passwordHash
      && await bcrypt.compare(password, appAdminConfig.passwordHash)) {
    req.session.user = {
      id: `admin:${username.toLowerCase()}`, username,
      email: process.env.ADMIN_EMAIL || `${username.toLowerCase()}@venuebook.invalid`, role: 'admin',
    };
    return res.json(req.session.user);
  }
  const user = await get('SELECT * FROM users WHERE lower(username) = lower(?)', [username]);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return bad(res, 401, 'Wrong username or password.');
  }
  req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return bad(res, 401, 'Not logged in.');
  res.json(req.session.user);
});
// All venues
app.get('/api/venues', requireLogin, async (req, res) => {
  res.json(venuesList);
});

// Bookings: ?date=YYYY-MM-DD (occupied slots) or ?email=... (the signed-in user's bookings)
app.get('/api/bookings', requireLogin, async (req, res) => {
  const { date, email } = req.query;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 400, 'Date must look like 2026-10-24.');
    return res.json(await all(
      `SELECT id, "venueId", to_char(date, 'YYYY-MM-DD') AS date,
              to_char("startTime", 'HH24:MI') AS "startTime", to_char("endTime", 'HH24:MI') AS "endTime", status
         FROM bookings WHERE date = ? AND status IN ('pending','approved')`, [date]));
  }
  if (email) {
    const rows = await all(
      `SELECT b.id, b."venueId", to_char(b.date, 'YYYY-MM-DD') AS date,
              to_char(b."startTime", 'HH24:MI') AS "startTime", to_char(b."endTime", 'HH24:MI') AS "endTime",
              b.purpose, b.attendees, b.status, b."reviewedAt", b."reviewedBy"
         FROM bookings b WHERE lower(b.email) = lower(?)
        ORDER BY b.date, b."startTime"`, [req.session.user.email]);
    return res.json(rows.map((row) => ({ ...row, venueName: venuesById.get(Number(row.venueId))?.name || 'Venue' })));
  }
  bad(res, 400, 'Send either ?date=YYYY-MM-DD or ?email=you@example.com.');
});

// New booking
app.post('/api/bookings', requireLogin, async (req, res) => {
  const b = req.body || {};
  const venueId = Number(b.venueId);
  const name = req.session.user.username;
  const email = req.session.user.email;
  const purpose = String(b.purpose || '').trim();
  const attendees = Number(b.attendees);
  const { date, startTime, endTime } = b;

  if (!Number.isInteger(venueId)) return bad(res, 400, 'Choose a venue.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return bad(res, 400, 'Choose a valid date.');
  if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '')) return bad(res, 400, 'Choose a valid start and end time.');
  const s = toMin(startTime), e = toMin(endTime);
  if (e <= s) return bad(res, 400, 'The end time must be after the start time.');
  if (s < OPEN_MIN || e > CLOSE_MIN) return bad(res, 400, 'Bookings are possible between 8 am and 8 pm.');
  if (date < todayStr()) return bad(res, 400, 'That date has already passed.');
  if (date === todayStr()) {
    const now = new Date();
    if (s < now.getHours() * 60 + now.getMinutes()) return bad(res, 400, 'That start time has already passed.');
  }
  if (!name) return bad(res, 400, 'Enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 400, 'Enter a valid email address.');
  if (!purpose) return bad(res, 400, 'Say what the booking is for.');
  if (!Number.isInteger(attendees) || attendees < 1) return bad(res, 400, 'Enter how many people will attend.');

  const venue = venuesById.get(venueId);
  if (!venue) return bad(res, 404, 'That venue does not exist.');
  if (attendees > venue.capacity) return bad(res, 400, `${venue.name} seats ${venue.capacity}. Reduce the number of people or choose a bigger room.`);

  // Check for a clash and insert in one go so two people cannot grab the same slot.
  let outcome;
  try {
    outcome = await withLock(async () => {
      const clash = await get(
        `SELECT to_char("startTime", 'HH24:MI') AS "startTime", to_char("endTime", 'HH24:MI') AS "endTime"
           FROM bookings WHERE "venueId" = ? AND date = ? AND status IN ('pending','approved')
             AND ?::time < "endTime" AND ?::time > "startTime"`,
        [venueId, date, startTime, endTime]);
      if (clash) return { clash };
      const r = await run(
        `INSERT INTO bookings ("venueId", date, "startTime", "endTime", name, email, attendees, purpose, status)
         VALUES (?,?,?,?,?,?,?,?, 'pending') RETURNING id`,
        [venueId, date, startTime, endTime, name, email, attendees, purpose]);
      return { id: r.lastID };
    });
  } catch (err) {
    if (err.code === '23P01') {
      return bad(res, 409, `${venue.name} is already booked for part of that time. Pick another time.`);
    }
    throw err;
  }
  if (outcome.clash) {
    return bad(res, 409, `${venue.name} is already booked from ${to12(outcome.clash.startTime)} to ${to12(outcome.clash.endTime)}. Pick another time.`);
  }
  const id = outcome.id;

  const saved = { id, venueId, venueName: venue.name, date, startTime, endTime, name, email, attendees, purpose, status: 'pending' };
  await sendBookingUpdate(saved, 'pending');
  res.status(201).json(saved);
});

// Administrator review queue and status changes.
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const rows = await all(
    `SELECT b.id, b."venueId", to_char(b.date, 'YYYY-MM-DD') AS date,
            to_char(b."startTime", 'HH24:MI') AS "startTime", to_char(b."endTime", 'HH24:MI') AS "endTime",
            b.name, b.email, b.attendees, b.purpose, b.status,
            to_char(b."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
            b."reviewedAt", b."reviewedBy"
       FROM bookings b ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.date, b."startTime"`);
  res.json(rows.map((row) => ({ ...row, venueName: venuesById.get(Number(row.venueId))?.name || 'Venue' })));
});

app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const status = req.body && req.body.status;
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
  if (!['approved', 'rejected'].includes(status)) return bad(res, 400, 'Choose approve or decline.');
  const row = await get(
    `SELECT b.*, to_char(b.date, 'YYYY-MM-DD') AS date,
            to_char(b."startTime", 'HH24:MI') AS "startTime", to_char(b."endTime", 'HH24:MI') AS "endTime"
       FROM bookings b WHERE b.id = ?`,
    [req.params.id]);
  if (!row) return bad(res, 404, 'Booking request not found.');
  row.venueName = venuesById.get(Number(row.venueId))?.name || 'Venue';
  if (row.status !== 'pending') return bad(res, 409, 'This request has already been reviewed.');
  if (status === 'approved') {
    const clash = await get(
      `SELECT id FROM bookings WHERE "venueId" = ? AND date = ? AND id <> ? AND status = 'approved'
         AND ?::time < "endTime" AND ?::time > "startTime"`,
      [row.venueId, row.date, row.id, row.startTime, row.endTime]);
    if (clash) return bad(res, 409, 'This time now conflicts with another approved booking. Decline this request or contact the student.');
  }
  let update;
  try {
    update = await run('UPDATE bookings SET status = ?, "reviewedAt" = CURRENT_TIMESTAMP, "reviewedBy" = ? WHERE id = ? AND status = ?',
      [status, req.session.user.username, row.id, 'pending']);
  } catch (err) {
    if (err.code === '23P01') {
      return bad(res, 409, 'This time conflicts with another pending or approved booking. Refresh the queue and review again.');
    }
    throw err;
  }
  if (!update.changes) return bad(res, 409, 'This request has already been reviewed. Refresh the page.');
  await sendBookingUpdate(row, status, note);
  res.json({ ok: true, id: row.id, status, reviewedAt: new Date().toISOString(), reviewedBy: req.session.user.username });
});

app.delete('/api/bookings/:id', requireLogin, async (req, res) => {
  const user = req.session.user;
  // Admin can cancel any booking. Others only their own.
  const row = user.role === 'admin'
    ? await get('SELECT id, status FROM bookings WHERE id = ?', [req.params.id])
    : await get('SELECT id, status FROM bookings WHERE id = ? AND lower(email) = lower(?)',
      [req.params.id, user.email]);
  if (!row) return bad(res, 404, 'Booking not found.');
  if (row.status !== 'cancelled') {
    await run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [row.id]);
  }
  res.json({ ok: true });
});

// Anything else under /api
app.use('/api', (req, res) => bad(res, 404, 'Unknown API address.'));

// Errors: show a plain message, log the details
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  bad(res, 500, 'Something went wrong on the server. Try again.');
});

if (require.main === module) {
  initializeDatabase()
    .then((err) => {
      if (err) throw err;
      return app.listen(PORT, () => console.log(`Website is running: http://localhost:${PORT}`));
    })
    .catch((err) => { console.error('Could not start:', err.message); process.exit(1); });
} else {
  module.exports = app;
}
