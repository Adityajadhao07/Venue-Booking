(() => {
  const { esc, fmtDate, fmtRange, api, toast } = window.VBS;
  const $ = (selector) => document.querySelector(selector);

  function requestCard(b, pending) {
    const stateLabel = b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Declined' : 'Pending';
    const dateReceived = b.createdAt ? new Date(`${b.createdAt.replace(' ', 'T')}Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `<article class="admin-request ${pending ? 'is-pending' : ''}">
      <div class="admin-request-main">
        <div class="admin-request-title"><h3>${esc(b.venueName)}</h3><span class="status-badge ${esc(b.status)}">${stateLabel}</span></div>
        <p class="admin-request-time">${esc(fmtDate(b.date))}<span>·</span>${esc(fmtRange(b.startTime, b.endTime))}</p>
        <p class="admin-request-purpose">${esc(b.purpose)}</p>
        <div class="admin-request-meta"><span><b>Requested by</b> ${esc(b.name)}</span><a href="mailto:${esc(b.email)}">${esc(b.email)}</a><span>${esc(b.attendees)} attendees</span>${dateReceived ? `<span>Submitted ${esc(dateReceived)}</span>` : ''}</div>
      </div>
      ${pending ? `<div class="admin-review-controls"><label class="sr-only" for="note-${esc(b.id)}">Optional note for the student</label><input id="note-${esc(b.id)}" class="admin-note" maxlength="500" placeholder="Optional note to student"><div class="admin-actions"><button class="btn small" data-review="approved" data-id="${esc(b.id)}">Approve request</button><button class="btn danger small" data-review="rejected" data-id="${esc(b.id)}">Decline</button></div></div>` : `<p class="admin-reviewed">${b.reviewedBy ? `Reviewed by ${esc(b.reviewedBy)}` : 'Reviewed'}${b.reviewedAt ? ` · ${esc(new Date(b.reviewedAt).toLocaleDateString('en-IN'))}` : ''}</p>`}
    </article>`;
  }

  function render(bookings) {
    const pending = bookings.filter((b) => b.status === 'pending');
    const approved = bookings.filter((b) => b.status === 'approved');
    const rejected = bookings.filter((b) => b.status === 'rejected');
    $('#metrics').innerHTML = `<article class="metric-card metric-attention"><span>Needs review</span><strong>${pending.length}</strong><small>Requests awaiting a decision</small></article><article class="metric-card"><span>Approved</span><strong>${approved.length}</strong><small>Room bookings confirmed</small></article><article class="metric-card"><span>Declined</span><strong>${rejected.length}</strong><small>Requests with a decision</small></article>`;
    $('#pendingCount').textContent = pending.length;
    $('#pendingList').innerHTML = pending.length ? pending.map((b) => requestCard(b, true)).join('') : `<div class="admin-empty"><span class="admin-empty-mark">✓</span><h3>All caught up</h3><p>There are no booking requests waiting for review.</p></div>`;
    const history = bookings.filter((b) => b.status === 'approved' || b.status === 'rejected').slice(0, 30);
    $('#historyList').innerHTML = history.length ? history.map((b) => requestCard(b, false)).join('') : '<p class="admin-history-empty">Reviewed requests will appear here.</p>';
  }

  async function load() {
    $('#pendingList').innerHTML = '<div class="skeleton"></div>';
    try { render(await api.getAdminBookings()); }
    catch (err) {
      $('#pendingList').innerHTML = `<div class="error-box"><h2>Could not load requests</h2><p>${esc(err.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      $('#retry').addEventListener('click', load);
    }
  }

  document.body.addEventListener('click', async (event) => {
    if (event.target.closest('#logout')) {
      await fetch('/api/logout', { method: 'POST' });
      location.href = 'login.html';
      return;
    }
    const button = event.target.closest('[data-review]');
    if (!button) return;
    const card = button.closest('.admin-request');
    const note = card.querySelector('.admin-note')?.value.trim() || '';
    const approve = button.dataset.review === 'approved';
    if (!approve && !confirm('Decline this booking request? The student will be notified.')) return;
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api.reviewBooking(button.dataset.id, button.dataset.review, note);
      toast(approve ? 'Booking approved. The student has been notified.' : 'Request declined. The student has been notified.');
      await load();
    } catch (err) { toast(err.message, true); await load(); }
  });

  (async () => {
    try {
      const user = await api.me();
      if (user.role !== 'admin') { location.href = 'index.html'; return; }
      await load();
    } catch { location.href = 'login.html'; }
  })();
})();
