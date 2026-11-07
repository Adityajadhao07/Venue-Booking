(() => {
  const { esc, toMin, toTime, fmtTime, fmtRange, fmtDate, todayStr, nowMin, store, toast, ribbon, START, END, api } = window.VBS;
  const $ = (s) => document.querySelector(s);

  const state = { venues: [], bookings: [], date: todayStr(), q: '', type: '', minCap: 0, proj: false, sound: false, from: '', to: '', sort: 'name' };
  let current = null;

  const timeOptions = (first, last, blankLabel) => {
    let html = blankLabel ? `<option value="">${blankLabel}</option>` : '';
    for (let m = first; m <= last; m += 30) html += `<option value="${toTime(m)}">${fmtTime(m)}</option>`;
    return html;
  };
  const overlaps = (aS, aE, b) => aS < toMin(b.endTime) && aE > toMin(b.startTime);
  const forVenue = (id) => state.bookings.filter((b) => b.venueId === id).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));

  // ---------- list ----------
  function visible() {
    const win = state.from && state.to && toMin(state.to) > toMin(state.from) ? [toMin(state.from), toMin(state.to)] : null;
    const list = state.venues.filter((v) => {
      if (state.q && !v.name.toLowerCase().includes(state.q)) return false;
      if (state.type && v.type !== state.type) return false;
      if (v.capacity < state.minCap) return false;
      if (state.proj && !v.projector) return false;
      if (state.sound && !v.soundSystem) return false;
      if (win && forVenue(v.id).some((b) => overlaps(win[0], win[1], b))) return false;
      return true;
    });
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      'cap-desc': (a, b) => b.capacity - a.capacity || by.name(a, b),
      'cap-asc': (a, b) => a.capacity - b.capacity || by.name(a, b),
    }[state.sort];
    return list.sort(by);
  }

  function plate(v) {
    const bks = forVenue(v.id);
    const mins = bks.reduce((s, b) => s + toMin(b.endTime) - toMin(b.startTime), 0);
    const status = mins ? `<span class="status some">${+(mins / 60).toFixed(1)} h booked</span>` : '<span class="status free">Free all day</span>';
    const sel = state.from && state.to && toMin(state.to) > toMin(state.from) ? { start: toMin(state.from), end: toMin(state.to) } : null;
    return `<article class="plate">
      <div class="plate-head"><h3 class="code${v.name.length > 6 ? ' long' : ''}">${esc(v.name)}</h3><p class="kind">${esc(v.type)}</p></div>
      <div class="plate-body">
        <p class="seats"><b>${v.capacity}</b>seats</p>
        <ul class="gear">
          <li class="${v.projector ? 'on' : 'off'}">Projector</li>
          <li class="${v.soundSystem ? 'on' : 'off'}">Sound system</li>
        </ul>
        ${ribbon(bks, sel)}
        <div class="plate-foot">${status}<button class="btn small" data-book="${v.id}" aria-label="Book ${esc(v.name)}">Book</button></div>
      </div>
    </article>`;
  }

  function render() {
    const list = visible();
    $('#count').textContent = `${list.length} of ${state.venues.length} venues on ${fmtDate(state.date)}`;
    if (!list.length) {
      $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>No venues match</h2><p>Try fewer seats, a shorter time window, or remove an equipment filter.</p><button class="btn ghost" id="emptyReset">Clear filters</button></div>`;
      return;
    }
    $('#grid').innerHTML = list.map(plate).join('');
  }

  function showLoading() {
    $('#grid').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
  }

  async function loadBookings() {
    try {
      state.bookings = await api.getBookings({ date: state.date });
    } catch (e) {
      state.bookings = [];
      toast('Could not load bookings for this date. ' + e.message, true);
    }
    render();
  }

  // ---------- booking sheet ----------
  function firstGap(id) {
    if (state.from && state.to && toMin(state.to) > toMin(state.from)) return [toMin(state.from), toMin(state.to)];
    const bks = forVenue(id);
    let t = Math.max(9 * 60, state.date === todayStr() ? Math.ceil(nowMin() / 30) * 30 : 0);
    for (; t + 60 <= END; t += 30) if (!bks.some((b) => overlaps(t, t + 60, b))) return [t, t + 60];
    return [9 * 60, 10 * 60];
  }

  function updateSheetRibbon() {
    if (!current) return;
    const s = toMin($('#bStart').value), e = toMin($('#bEnd').value);
    $('#sheetRibbon').innerHTML = ribbon(forVenue(current.id), e > s ? { start: s, end: e } : null, true);
  }

  function openSheet(id) {
    current = state.venues.find((v) => v.id === id);
    if (!current) return;
    $('#sheetCode').textContent = current.name;
    $('#sheetCode').classList.toggle('long', current.name.length > 6);
    $('#sheetMeta').textContent = `${current.type}, ${current.capacity} seats`;
    $('#sheetDate').textContent = fmtDate(state.date);
    $('#bStart').innerHTML = timeOptions(START, END - 30);
    $('#bEnd').innerHTML = timeOptions(START + 30, END);
    const [s, e] = firstGap(current.id);
    $('#bStart').value = toTime(s);
    $('#bEnd').value = toTime(e);
    $('#bName').value = api.user?.username || store.get('vbs.name');
    $('#bEmail').value = api.user?.email || store.get('vbs.email');
    $('#bName').readOnly = !!api.user;
    $('#bEmail').readOnly = !!api.user;
    $('#bAttendees').value = '';
    $('#bAttendees').max = current.capacity;
    $('#bPurpose').value = '';
    $('#formError').hidden = true;
    const bks = forVenue(current.id);
    $('#busyList').textContent = bks.length ? 'Already booked: ' + bks.map((b) => fmtRange(b.startTime, b.endTime)).join(', ') : 'Nobody has booked this room on this date.';
    updateSheetRibbon();
    $('#sheet').showModal();
    $('#bName').focus();
  }

  function formError(msg) {
    const box = $('#formError');
    box.textContent = msg;
    box.hidden = !msg;
  }

  async function submit(ev) {
    ev.preventDefault();
    formError('');
    const s = toMin($('#bStart').value), e = toMin($('#bEnd').value);
    const name = $('#bName').value.trim(), email = $('#bEmail').value.trim();
    const attendees = Number($('#bAttendees').value), purpose = $('#bPurpose').value.trim();

    if (e <= s) return formError('The end time must be after the start time.');
    if (state.date === todayStr() && s < nowMin()) return formError('That start time has already passed. Choose a later time.');
    if (!name) return formError('Enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return formError('Enter a valid email address, for example name@college.edu.');
    if (!attendees || attendees < 1) return formError('Enter how many people will attend.');
    if (attendees > current.capacity) return formError(`${current.name} seats ${current.capacity}. Reduce the number of people or choose a bigger room.`);
    if (!purpose) return formError('Say what the booking is for.');
    const clash = forVenue(current.id).find((b) => overlaps(s, e, b));
    if (clash) return formError(`${current.name} is booked from ${fmtRange(clash.startTime, clash.endTime)}. Pick a time outside that slot.`);

    const btn = $('#bSubmit');
    btn.disabled = true;
    btn.textContent = 'Booking';
    try {
      await api.createBooking({ venueId: current.id, date: state.date, startTime: toTime(s), endTime: toTime(e), name, email, attendees, purpose });
      store.set('vbs.name', name);
      store.set('vbs.email', email);
      $('#sheet').close();
      toast(api.demo ? `Request for ${current.name} saved in this browser (demo).` : `Request sent for ${current.name}, ${fmtRange(toTime(s), toTime(e))}. It is pending administrator approval.`);
      await loadBookings();
    } catch (err) {
      formError(err.message);
      if (err.status === 409) loadBookings();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send booking request';
    }
  }

  // ---------- wiring ----------
  function resetFilters() {
    Object.assign(state, { q: '', type: '', minCap: 0, proj: false, sound: false, from: '', to: '' });
    $('#fQ').value = ''; $('#fType').value = ''; $('#fCap').value = '';
    $('#fProj').checked = false; $('#fSound').checked = false;
    $('#fFrom').value = ''; $('#fTo').value = '';
    render();
  }

  function wire() {
    $('#fDate').value = state.date;
    $('#fDate').min = todayStr();
    $('#fFrom').innerHTML = timeOptions(START, END - 30, 'Any time');
    $('#fTo').innerHTML = timeOptions(START + 30, END, 'Any time');

    $('#fDate').addEventListener('change', (e) => {
      state.date = e.target.value || todayStr();
      showLoading();
      loadBookings();
    });
    $('#fQ').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
    $('#fType').addEventListener('change', (e) => { state.type = e.target.value; render(); });
    $('#fCap').addEventListener('input', (e) => { state.minCap = Number(e.target.value) || 0; render(); });
    $('#fProj').addEventListener('change', (e) => { state.proj = e.target.checked; render(); });
    $('#fSound').addEventListener('change', (e) => { state.sound = e.target.checked; render(); });
    $('#fFrom').addEventListener('change', (e) => { state.from = e.target.value; render(); });
    $('#fTo').addEventListener('change', (e) => { state.to = e.target.value; render(); });
    $('#fSort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    $('#fReset').addEventListener('click', resetFilters);

    $('#grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]');
      if (b) openSheet(Number(b.dataset.book) || b.dataset.book);
      if (e.target.closest('#emptyReset')) resetFilters();
    });

    $('#bStart').addEventListener('change', () => {
      const s = toMin($('#bStart').value);
      if (toMin($('#bEnd').value) <= s) $('#bEnd').value = toTime(Math.min(s + 60, END));
      updateSheetRibbon();
    });
    $('#bEnd').addEventListener('change', updateSheetRibbon);
    $('#bookForm').addEventListener('submit', submit);
    $('#sheetClose').addEventListener('click', () => $('#sheet').close());
    $('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) $('#sheet').close(); });

    if (window.matchMedia('(max-width: 880px)').matches) $('#filters').open = false;
  }

  async function init() {
    wire();
    showLoading();
    try {
      await api.init();
    } catch (e) {
      $('#count').textContent = 'Booking service unavailable';
      $('#grid').innerHTML = `<div class="error-box" style="grid-column:1/-1"><h2>Could not connect to the booking service</h2><p>${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').addEventListener('click', () => location.reload());
      return;
    }
    try { api.user = await api.me(); } catch { location.href = 'login.html'; return; }
    if (api.user.role === 'admin') location.href = 'admin.html';
    $('#demoNote').hidden = !api.demo;
    try {
      state.venues = await api.getVenues();
    } catch (e) {
      $('#count').textContent = 'Venues did not load';
      $('#grid').innerHTML = `<div class="error-box" style="grid-column:1/-1"><h2>Could not load venues</h2><p>${esc(e.message)} Check that the server is running, then try again.</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').addEventListener('click', () => location.reload());
      return;
    }
    const types = [...new Set(state.venues.map((v) => v.type))].sort();
    $('#fType').innerHTML = '<option value="">All types</option>' + types.map((t) => `<option>${esc(t)}</option>`).join('');
    await loadBookings();
  }

  init();
})();
