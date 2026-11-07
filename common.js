// Shared helpers. Loaded on every page before api.js.
(() => {
  const VBS = (window.VBS = window.VBS || {});

  VBS.START = 8 * 60;  // day ribbon starts at 8 am
  VBS.END = 20 * 60;   // and ends at 8 pm

  VBS.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  VBS.toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + (m || 0);
  };
  VBS.toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  VBS.fmtTime = (t) => {
    const min = typeof t === 'number' ? t : VBS.toMin(t);
    const h = Math.floor(min / 60), m = min % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
  };
  VBS.fmtRange = (a, b) => `${VBS.fmtTime(a)} to ${VBS.fmtTime(b)}`;

  VBS.todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  VBS.fmtDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  VBS.nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  VBS.store = {
    get(k, fallback = '') { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: fine */ } },
  };

  VBS.toast = (msg, isErr = false) => {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  };

  // One bar = one day (8 am to 8 pm). `booked` = [{startTime,endTime}], `sel` = {start,end} in minutes.
  VBS.ribbon = (booked, sel, big = false) => {
    const span = VBS.END - VBS.START;
    const pct = (min) => Math.max(0, Math.min(100, ((min - VBS.START) / span) * 100));
    const segs = booked.map((b) => {
      const l = pct(VBS.toMin(b.startTime)), r = pct(VBS.toMin(b.endTime));
      return `<i class="seg ${b.status === 'pending' ? 'pending' : ''}" style="left:${l}%;width:${r - l}%"></i>`;
    }).join('');
    const pick = sel ? `<i class="sel" style="left:${pct(sel.start)}%;width:${pct(sel.end) - pct(sel.start)}%"></i>` : '';
    const label = booked.length
      ? booked.map((b) => `${b.status === 'pending' ? 'Pending request' : 'Approved'} ${VBS.fmtRange(b.startTime, b.endTime)}`).join('; ')
      : 'Free all day';
    return `<div class="ribbon-wrap">
      <div class="ribbon${big ? ' big' : ''}" role="img" aria-label="${VBS.esc(label)}">${segs}${pick}</div>
      <div class="ticks" aria-hidden="true"><span>8 am</span><span>12 pm</span><span>4 pm</span><span>8 pm</span></div>
    </div>`;
  };
})();
