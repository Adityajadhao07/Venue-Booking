(() => {
  const { esc, toMin, fmtRange, fmtDate, todayStr, nowMin, toast, api } = window.VBS;
  const $ = (s) => document.querySelector(s);
  let email = '';

  const isPast = (b) => b.date < todayStr() || (b.date === todayStr() && toMin(b.endTime) <= nowMin());
  const reviewedDate = (value) => {
    if (!value) return '';
    const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN');
  };
  const badge = (status) => {
    const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Declined' : status === 'cancelled' ? 'Cancelled' : 'Pending review';
    return `<span class="status-badge ${esc(status || 'pending')}">${label}</span>`;
  };

  function card(b, past) {
    const dateReviewed = reviewedDate(b.reviewedAt);
    const review = b.reviewedAt
      ? `<p class="booking-review">Reviewed${b.reviewedBy ? ` by ${esc(b.reviewedBy)}` : ''}${dateReviewed ? ` · ${esc(dateReviewed)}` : ''}</p>`
      : '';
    const canCancel = !past && !['rejected', 'cancelled'].includes(b.status);
    return `<article class="booking ${past ? 'past' : ''} booking-${esc(b.status || 'approved')}">
      <h3 class="code">${esc(b.venueName || 'Venue')}</h3>
      <div class="booking-details">
        <div class="booking-topline">${badge(b.status)}<p class="when">${esc(fmtDate(b.date))}, ${esc(fmtRange(b.startTime, b.endTime))}</p></div>
        <p class="what">${esc(b.purpose)}${b.attendees ? ` · ${esc(b.attendees)} people` : ''}</p>${review}
      </div>
      ${canCancel ? `<button class="btn danger small" data-cancel="${esc(b.id)}" aria-label="Cancel booking for ${esc(b.venueName)} on ${esc(fmtDate(b.date))}">Cancel request</button>` : ''}
    </article>`;
  }

  function render(list) {
    const sorted = [...list].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const active = sorted.filter((b) => !isPast(b) && !['rejected', 'cancelled'].includes(b.status));
    const declined = sorted.filter((b) => b.status === 'rejected' && !isPast(b));
    const cancelled = sorted.filter((b) => b.status === 'cancelled');
    const past = sorted.filter((b) => isPast(b) && b.status !== 'cancelled').reverse();
    const pendingCount = active.filter((b) => b.status === 'pending').length;
    $('#bookingSummary').hidden = false;
    $('#bookingSummary').innerHTML = `<div><strong>${active.length}</strong><span>Upcoming</span></div><div><strong>${pendingCount}</strong><span>Awaiting review</span></div><div><strong>${active.filter((b) => b.status === 'approved').length}</strong><span>Approved</span></div>`;
    $('#out').innerHTML = list.length ?
      `<h2 class="section-title">Upcoming</h2>${active.length ? `<div class="list">${active.map((b) => card(b, false)).join('')}</div>` : `<div class="empty"><h2>Nothing upcoming</h2><p>Find a room when you’re ready to plan your next session.</p><a class="btn" href="index.html">Find a room</a></div>`}` +
      (declined.length ? `<h2 class="section-title">Declined requests</h2><div class="list">${declined.map((b) => card(b, false)).join('')}</div>` : '') +
      (cancelled.length ? `<h2 class="section-title">Cancelled requests</h2><div class="list">${cancelled.map((b) => card(b, true)).join('')}</div>` : '') +
      (past.length ? `<h2 class="section-title">Past</h2><div class="list">${past.map((b) => card(b, true)).join('')}</div>` : '')
      : `<div class="empty"><h2>No booking requests yet</h2><p>Once you request a room, its approval status and details will appear here.</p><a class="btn" href="index.html">Find a room</a></div>`;
  }

  async function load() {
    $('#out').innerHTML = '<div class="skeleton"></div>';
    try { render(await api.getMyBookings(email)); }
    catch (e) {
      $('#out').innerHTML = `<div class="error-box"><h2>Could not load bookings</h2><p>${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').addEventListener('click', load);
    }
  }

  $('#out').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cancel]');
    if (!btn || !confirm('Cancel this booking request?')) return;
    btn.disabled = true;
    try { await api.cancelBooking(btn.dataset.cancel, email); toast('Booking request cancelled.'); load(); }
    catch (err) { btn.disabled = false; toast(err.message, true); }
  });

  (async () => {
    try {
      const user = await api.me();
      email = user.email;
      $('#bookingOwner').textContent = `Signed in as ${user.username} · ${user.email}`;
      if (user.role === 'admin') $('#adminNav').hidden = false;
      await load();
    } catch { location.href = 'login.html'; }
  })();
})();
