const fs = require('fs');
const initSqlJs = require('sql.js');

function readRows(db, table) {
  const statement = db.prepare(`SELECT * FROM ${table} ORDER BY id`);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

function insertMany(table, columns, rows, conflict = '') {
  const values = [];
  const groups = rows.map((row) => {
    const slots = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${slots.join(', ')})`;
  });
  return { sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${groups.join(', ')} ${conflict}`, values };
}

async function readLegacyDatabase(filePath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(filePath));
  try {
    return Object.fromEntries(['classrooms', 'users', 'bookings']
      .map((table) => [table, readRows(db, table)]));
  } finally {
    db.close();
  }
}

// Caller owns a transaction. Existing accounts/bookings are never overwritten.
async function copyLegacyRows(client, source, venues) {
  if (!source.classrooms.length) throw new Error('The legacy database has no venue references to map.');
  const current = await client.query(`SELECT
    (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM bookings) AS bookings`);
  if (Number(current.rows[0].users) || Number(current.rows[0].bookings)) {
    return { copied: false };
  }

  const venueIds = new Map(source.classrooms.map((oldVenue) => {
    const venue = venues.find((candidate) => candidate.name === oldVenue.name);
    if (!venue) throw new Error(`The static venue catalogue is missing "${oldVenue.name}" from the old database.`);
    return [oldVenue.id, venue.id];
  }));

  const registeredUsers = source.users.filter((user) => user.role !== 'admin');
  if (registeredUsers.length) {
    const userInsert = insertMany('users', ['id', 'username', 'email', '"passwordHash"', 'role', '"createdAt"'],
      registeredUsers.map((user) => [user.id, user.username, user.email, user.passwordHash, user.role, user.createdAt]));
    await client.query(userInsert.sql, userInsert.values);
  }
  if (source.bookings.length) {
    const bookingRows = source.bookings.map((booking) => {
      const venueId = venueIds.get(booking.venueId);
      if (!venueId) throw new Error(`Booking ${booking.id} refers to a missing venue.`);
      return [booking.id, venueId, booking.date, booking.startTime, booking.endTime, booking.name,
        booking.email, booking.attendees, booking.purpose, booking.createdAt, booking.status,
        booking.reviewedAt, booking.reviewedBy];
    });
    const bookingInsert = insertMany('bookings', ['id', '"venueId"', 'date', '"startTime"', '"endTime"',
      'name', 'email', 'attendees', 'purpose', '"createdAt"', 'status', '"reviewedAt"', '"reviewedBy"'], bookingRows);
    await client.query(bookingInsert.sql, bookingInsert.values);
  }

  for (const table of ['users', 'bookings']) {
    const rows = table === 'users' ? registeredUsers : source.bookings;
    if (rows.length) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT max(id) FROM ${table}), 1), true)`);
    }
  }
  return { copied: true, users: registeredUsers.length, bookings: source.bookings.length };
}

module.exports = { readLegacyDatabase, copyLegacyRows };
