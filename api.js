// API layer. Talks to your Express backend under /api (see API.md).
// Venue details are bundled as a static JSON file. Account and booking APIs
// require the PostgreSQL service; localhost alone retains the existing demo.
(() => {
  const { toMin, toTime, fmtRange, store } = window.VBS;
  const BASE = window.VBS_API_BASE || '/api';
  const LS_KEY = 'vbs.demoBookings';

  const api = (window.VBS.api = { demo: false });

  const fail = (msg, status) => Object.assign(new Error(msg), { status });

  async function http(path, opts = {}) {
    const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw fail(body?.error || body?.message || `Request failed (${res.status})`, res.status);
    return body;
  }

  const norm = (v, i) => ({
    id: v.id ?? i + 1,
    name: v.name,
    capacity: Number(v.capacity),
    type: v.type,
    soundSystem: !!Number(v.soundSystem),
    projector: !!Number(v.projector),
  });

  // ---------- demo storage ----------
  const readDemo = () => { try { return JSON.parse(store.get(LS_KEY, '[]')); } catch { return []; } };
  const writeDemo = (list) => store.set(LS_KEY, JSON.stringify(list));
  let demoVenues = null;

  // Deterministic "already booked" slots so the demo does not look empty.
  function seeded(date, venues) {
    const out = [];
    venues.forEach((v) => {
      let h = 2166136261;
      for (const c of `${date}|${v.id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
      const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
      const n = Math.floor(rnd() * 3);
      let cursor = 8 * 60 + Math.floor(rnd() * 4) * 30;
      for (let k = 0; k < n; k++) {
        const len = (1 + Math.floor(rnd() * 3)) * 60;
        if (cursor + len > 20 * 60) break;
        out.push({ id: `seed-${v.id}-${k}`, venueId: v.id, date, startTime: toTime(cursor), endTime: toTime(cursor + len), seed: true, purpose: 'Booked', status: 'approved' });
        cursor += len + (1 + Math.floor(rnd() * 3)) * 60;
      }
    });
    return out;
  }

  // ---------- public API ----------
  api.init = async () => {
    try {
      await http('/health');
      api.demo = false;
    } catch (error) {
      if (error.status === 401) {
        api.demo = false;
        return false;
      }
      const localDevelopment = ['localhost', '127.0.0.1'].includes(location.hostname);
      if (!localDevelopment) {
        api.demo = false;
        throw fail('The booking service could not reach its database. Please refresh in a moment or contact the site administrator.');
      }
      api.demo = true;
    }
    return api.demo;
  };

  api.me = () => http('/me');

  api.getVenues = async () => {
    if (!demoVenues) {
      const res = await fetch('/data/venues.json');
      if (!res.ok) throw fail('Could not load the venue list.');
      demoVenues = (await res.json()).map(norm);
    }
    return demoVenues;
  };

  api.getBookings = async ({ date }) => {
    if (!api.demo) return http(`/bookings?date=${encodeURIComponent(date)}`);
    const venues = await api.getVenues();
    return [...seeded(date, venues), ...readDemo().filter((b) => b.date === date)];
  };

  api.getMyBookings = async (email) => {
    if (!api.demo) return http(`/bookings?email=${encodeURIComponent(email)}`);
    const venues = await api.getVenues();
    return readDemo()
      .filter((b) => b.email.toLowerCase() === email.toLowerCase())
      .map((b) => ({ ...b, venueName: venues.find((v) => v.id === b.venueId)?.name || 'Venue' }));
  };

  api.getAdminBookings = () => http('/admin/bookings');
  api.reviewBooking = (id, status, note = '') => http(`/admin/bookings/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ status, note }),
  });

  api.createBooking = async (b) => {
    if (!api.demo) return http('/bookings', { method: 'POST', body: JSON.stringify(b) });
    const venues = await api.getVenues();
    const venue = venues.find((v) => v.id === b.venueId);
    const clash = (await api.getBookings({ date: b.date })).find(
      (x) => x.venueId === b.venueId && toMin(b.startTime) < toMin(x.endTime) && toMin(b.endTime) > toMin(x.startTime)
    );
    if (clash) throw fail(`${venue.name} is already booked from ${fmtRange(clash.startTime, clash.endTime)}. Pick another time.`, 409);
    const saved = { ...b, id: 'demo-' + Date.now(), venueName: venue.name, status: 'pending' };
    writeDemo([...readDemo(), saved]);
    return saved;
  };

  api.cancelBooking = async (id, email) => {
    if (!api.demo) return http(`/bookings/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    writeDemo(readDemo().filter((b) => b.id !== id));
    return { ok: true };
  };
})();
