;(function(){
  'use strict';

  // 👇 Student-only panel + route (no longer collides with admin)
  const PANEL_SEL   = '#studentEventExpensesPage, #student-event-expenses-page';
  const ROUTE_MATCH = '[data-route="student-event-expenses"], [href="#student-event-expenses"]';
  let   lastEESnap  = '';
  let   currentEventId = '';

  // ========================= In-Memory Store =============================
  const store = {
    events:   /** @type {Array<EventItem>} */ ([]),
    credits:  /** @type {Record<string, CreditItem[]>} */ ({}),
    debits:   /** @type {Record<string, DebitItem[]>} */ ({}),
  };
  
  // ========================= Academic Year State =========================
  const eeActiveYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,
    baseStartYear: null,
    baseEndYear: null,
    baseActiveYear: null,
  };

  // ===== AY helpers (copied from manage-dept-fees.js) =====
  const toInt = (v)=> (v==null || v==='') ? NaN : parseInt(v,10);

  function normalizeActiveAY(resp){
    const src = resp?.data || resp?.active || resp || {};
    const sy = toInt(src.start_year ?? src.start ?? src.sy);
    const ey = toInt(src.end_year   ?? src.end   ?? src.ey);
    const ay = toInt(src.active_year ?? src.active ?? src.ay ?? sy);
    if (!Number.isFinite(sy) || !Number.isFinite(ey)) throw new Error('No active AY in response');
    return { start_year: sy, end_year: ey, active_year: Number.isFinite(ay) ? ay : sy };
  }

  function normalizeAYList(resp){
    const arr = Array.isArray(resp) ? resp : (Array.isArray(resp?.years) ? resp.years : (Array.isArray(resp?.data) ? resp.data : []));
    return arr.map(r=>({
      id: toInt(r.id),
      start_year: toInt(r.start_year ?? r.start ?? r.sy),
      end_year:   toInt(r.end_year   ?? r.end   ?? r.ey),
      active_year:toInt(r.active_year ?? r.active ?? r.ay ?? r.start_year),
      status: String(r.status ?? '').trim()
    })).filter(r=>Number.isFinite(r.start_year)&&Number.isFinite(r.end_year));
  }

  // ========================= BOOT =========================
  document.addEventListener('DOMContentLoaded', () => {
    const initIfFound = () => {
      const panel = document.querySelector(PANEL_SEL);
      if (panel && !panel.dataset.eeInit) {
        lastEESnap = '';
        initEventExpenses(panel);
        if (typeof refreshEventExpenses === 'function') refreshEventExpenses(panel);
      }
    };

    initIfFound();

    const contentArea = document.getElementById('content-area') || document.body;
    const observer = new MutationObserver(initIfFound);
    observer.observe(contentArea, { childList: true, subtree: true });

    document.addEventListener('spa:navigated', initIfFound);

    document.addEventListener('click', (e) => {
      const toPanel = e.target.closest(ROUTE_MATCH);
      if (toPanel) setTimeout(initIfFound, 0);
    });
  });

  // ============================= Initializer =============================
  function initEventExpenses(root){
    root.dataset.eeInit = '1';

    // Cache nodes
    const listView    = root.querySelector('#eeListView');
    const eventView   = root.querySelector('#eeEventView');
    const searchBox   = root.querySelector('#eeSearch');
    const grid        = root.querySelector('#eeCardsGrid');
    const emptyState  = root.querySelector('#eeEmptyState');
    const backBtn     = root.querySelector('#eeBackBtn');

    // AY controls
    const aySelect         = root.querySelector('#eeAySelect');
    const activeYearSelect = root.querySelector('#eeActiveYearSelect');

    // Remove/hide add buttons since students are view-only
    const addBtn = root.querySelector('#btnAddEvent');
    const emptyAddBtn = root.querySelector('#btnEmptyAdd');
    const fundAddBtn = root.querySelector('#fundAddBtn');
    const debitAddBtn = root.querySelector('#debitAddBtn');
    
    if (addBtn) addBtn.style.display = 'none';
    if (emptyAddBtn) emptyAddBtn.style.display = 'none';
    if (fundAddBtn) fundAddBtn.style.display = 'none';
    if (debitAddBtn) debitAddBtn.style.display = 'none';

    // Search
    searchBox?.addEventListener('input', () => renderCards());

    // Back
    backBtn?.addEventListener('click', () => showList());

    // Helper: fetch events for current AY
    function fetchAndRenderEvents() {
      API.listEvents().then(data => {
        if (data?.success && Array.isArray(data.events)) {
          store.events = data.events
            .map(mapServerEventToClient)
            .filter(Boolean);

          // Initialize empty arrays
          for (const ev of store.events) {
            const id = String(ev.id);
            if (!store.credits[id]) store.credits[id] = [];
            if (!store.debits[id])  store.debits[id]  = [];
          }

          // Prefetch details for all events
          if (store.events.length) {
            const detailPromises = store.events.map(ev =>
              API.getEvent(ev.id).then(resp => {
                if (!resp) return;
                const id = String(ev.id);
                const rawCredits = Array.isArray(resp.credits)
                  ? resp.credits
                  : (Array.isArray(resp.data?.credits) ? resp.data.credits : []);
                const rawDebits = Array.isArray(resp.debits)
                  ? resp.debits
                  : (Array.isArray(resp.data?.debits) ? resp.data.debits : []);
                store.credits[id] = rawCredits.map(mapServerCreditToClient);
                store.debits[id]  = rawDebits.map(mapServerDebitToClient);
              }).catch(() => {})
            );
            Promise.all(detailPromises).then(() => {
              renderCards();
            });
          }
        }
        renderCards();
      }).catch(() => renderCards());
    }

    // Load AY info, then events
    loadEEActiveYear(root).then(() => {
      fetchAndRenderEvents();
    });

    // AY change listeners
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';
      
      if (val === 'ALL') {
        eeActiveYearState.startYear = null;
        eeActiveYearState.endYear = null;
        eeActiveYearState.activeYear = null;

        if (activeYearSelect) {
          activeYearSelect.innerHTML = '<option value="">All</option>';
          activeYearSelect.disabled = true;
        }
      } else {
        const [syRaw, eyRaw] = val.split('-');
        const sy = parseInt(syRaw, 10);
        const ey = parseInt(eyRaw, 10);

        eeActiveYearState.startYear = !Number.isNaN(sy) ? sy : null;
        eeActiveYearState.endYear   = !Number.isNaN(ey) ? ey : null;

        // If current active year is neither sy nor ey, default to sy
        if (
          eeActiveYearState.activeYear !== sy &&
          eeActiveYearState.activeYear !== ey
        ) {
          eeActiveYearState.activeYear = sy || eeActiveYearState.activeYear || null;
        }

        if (activeYearSelect) {
          let html = '';
          const selectedAll = eeActiveYearState.activeYear == null ? 'selected' : '';
          html += `<option value="ALL" ${selectedAll}>All Semesters</option>`;

          if (!Number.isNaN(sy)) {
            html += `<option value="${sy}" ${
              eeActiveYearState.activeYear === sy ? 'selected' : ''
            }>1st Semester</option>`;
          }
          if (!Number.isNaN(ey) && ey !== sy) {
            html += `<option value="${ey}" ${
              eeActiveYearState.activeYear === ey ? 'selected' : ''
            }>2nd Semester</option>`;
          }
          activeYearSelect.innerHTML = html || '<option value="">—</option>';
          activeYearSelect.disabled = false;
        }
      }

      const schoolYearEl = root.querySelector('#eeCurrentSchoolYear');
      if (schoolYearEl) {
        schoolYearEl.textContent = getEEStateAcademicYearLabel();
      }

      fetchAndRenderEvents();
    });

    activeYearSelect?.addEventListener('change', () => {
      if (activeYearSelect.disabled) return;
      const val = activeYearSelect.value;

      if (val === 'ALL' || val === '') {
        eeActiveYearState.activeYear = null;
      } else {
        const yr = parseInt(val, 10);
        if (!Number.isNaN(yr)) {
          eeActiveYearState.activeYear = yr;
        }
      }

      const schoolYearEl = root.querySelector('#eeCurrentSchoolYear');
      if (schoolYearEl) {
        schoolYearEl.textContent = getEEStateAcademicYearLabel();
      }

      fetchAndRenderEvents();
    });

    // ---------- Render helpers ----------
    function renderCards(){
      const q = (searchBox?.value || '').trim().toLowerCase();
      const sy = eeActiveYearState.startYear;
      const ey = eeActiveYearState.endYear;
      const ay = eeActiveYearState.activeYear;

      const events = store.events.filter(e => {
        const syMatch = !sy || e.start_year === sy;
        const eyMatch = !ey || e.end_year === ey;
        const ayMatch = (ay == null) || e.active_year === ay || Number(e.ay || 0) === ay;

        if (!(syMatch && eyMatch && ayMatch)) return false;

        const titleMatch = e.title.toLowerCase().includes(q);
        const locMatch   = (e.location || '').toLowerCase().includes(q);
        const orgMatch   = (e.org_label || '').toLowerCase().includes(q);

        return !q || titleMatch || locMatch || orgMatch;
      });

      grid.innerHTML = '';
      if (!events.length) {
        emptyState?.classList.remove('d-none');
        return;
      }
      emptyState?.classList.add('d-none');

      for (const e of events) {
        const id = String(e.id);
        const creditsArr = store.credits[id] || [];
        const debitsArr  = store.debits[id]  || [];
        const itemsCount = creditsArr.length + debitsArr.length;
        const balance    = sumCredits(id) - sumDebits(id);

        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        col.innerHTML = `
          <div class="card h-100 shadow-sm ee-event-card" data-id="${id}" role="button">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start">
                <h6 class="mb-1">${escapeHTML(e.title)}</h6>
                <span class="badge bg-secondary">${escapeHTML(e.status)}</span>
              </div>
              <div class="small text-muted mb-2">
                ${escapeHTML(e.org_label || (e.scope === 'general' ? 'General (Campus-Wide)' : 'Organization'))}
                · <i class="bi bi-calendar3"></i> ${e.date || '—'}
              </div>
              <p class="mb-2 small text-truncate-2">${escapeHTML(e.location)}</p>
              <div class="d-flex justify-content-between align-items-center">
                <div class="small text-muted">Items: ${itemsCount}</div>
                <div class="fw-semibold">₱${formatMoney(balance)}</div>
              </div>
            </div>
          </div>`;
        col.querySelector('.ee-event-card').addEventListener('click', () => {
          showEvent(id);
        });
        grid.appendChild(col);
      }

      lastEESnap = grid.innerHTML.length + ':' + (searchBox?.value||'');
    }

    function showList(){
      listView?.classList.remove('d-none');
      eventView?.classList.add('d-none');
      currentEventId = '';
    }

    function showEvent(eventId){
      currentEventId = String(eventId);
      listView?.classList.add('d-none');
      eventView?.classList.remove('d-none');
      API.getEvent(eventId).then(data => {
        if (data) {
          const creditsRows = Array.isArray(data.credits)
            ? data.credits
            : (Array.isArray(data.data?.credits) ? data.data.credits : []);
          const debitsRows = Array.isArray(data.debits)
            ? data.debits
            : (Array.isArray(data.data?.debits) ? data.data.debits : []);
          store.credits[eventId] = creditsRows.map(mapServerCreditToClient);
          store.debits[eventId]  = debitsRows.map(mapServerDebitToClient);
          const idx = store.events.findIndex(x => String(x.id) === String(eventId));
          if (idx > -1 && data.event) {
            store.events[idx] = mapServerEventToClient(data.event);
          }
        }
        renderEventView(eventId, root);
        renderCards();
      }).catch(() => {
        renderEventView(eventId, root);
        renderCards();
      });
    }
  }

  function refreshEventExpenses(_root){ /* no-op */ }

  // ========================= Render Event View ============================
  function renderEventView(eventId, root){
    const e = store.events.find(x => String(x.id) === String(eventId));
    if (!e) return;

    const orgLabel = e.org_label || (e.scope === 'general'
      ? 'General (Campus-Wide)'
      : 'Organization');

    const ayDisplay = formatEventAcademicYear(e);

    root.querySelector('#eeEventHeaderTitle').textContent = e.title;
    root.querySelector('#eeEventStatus').textContent = e.status;
    root.querySelector('#eeEventMeta').textContent =
      `${orgLabel} · ${e.date || '—'} · ${e.sy || '—'}`;

    root.querySelector('#ovOrg').textContent  = orgLabel;
    root.querySelector('#ovDate').textContent = e.date || '—';
    root.querySelector('#ovYear').textContent = e.sy || '—';
    const ayEl = root.querySelector('#ovAY');
    if (ayEl) ayEl.textContent = ayDisplay;
    root.querySelector('#ovDesc').textContent = e.location || '—';

    const totalC = sumCredits(eventId);
    const totalD = sumDebits(eventId);
    root.querySelector('#ovCredits').textContent = `₱${formatMoney(totalC)}`;
    root.querySelector('#ovDebits').textContent  = `₱${formatMoney(totalD)}`;
    root.querySelector('#ovBalance').textContent = `₱${formatMoney(totalC - totalD)}`;

    const cList = store.credits[eventId] || [];
    const fundsTbody = root.querySelector('#fundsTbody');
    fundsTbody.innerHTML = cList.length ? cList.map(c => `
      <tr>
        <td class="align-middle">${c.date}</td>
        <td class="align-middle">${escapeHTML(c.source)}</td>
        <td class="align-middle">${escapeHTML(c.notes||'')}</td>
        <td class="align-middle text-end">₱${formatMoney(c.amount)}</td>
      </tr>`).join('') : `<tr><td colspan="4" class="text-center text-muted">No credits yet.</td></tr>`;

    const dList = store.debits[eventId] || [];
    const debitsTbody = root.querySelector('#debitsTbody');
    debitsTbody.innerHTML = dList.length ? dList.map(d => `
      <tr>
        <td class="align-middle">${d.date}</td>
        <td class="align-middle">${escapeHTML(d.category)}</td>
        <td class="align-middle">${escapeHTML(d.notes||'')}</td>
        <td class="align-middle text-center">${d.quantity}</td>
        <td class="align-middle text-end">₱${formatMoney(d.unit_price)}</td>
        <td class="align-middle text-end">₱${formatMoney(d.amount)}</td>
        <td class="align-middle">${escapeHTML(d.receipt_number||'')}</td>
        <td class="align-middle text-start">
          ${
            d.receiptUrl
              ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="view-receipt" data-url="${escapeAttr(d.receiptUrl)}">View</button>`
              : '—'
          }
        </td>
      </tr>`).join('') : `<tr><td colspan="8" class="text-center text-muted">No expenses yet.</td></tr>`;

    debitsTbody.onclick = onDebitsAction;

    const led = buildLedger(eventId, cList, dList);
    const ledgerTbody = root.querySelector('#ledgerTbody');
    ledgerTbody.innerHTML = led.length ? led.map(r => `
      <tr>
        <td class="align-middle">${r.date}</td>
        <td class="align-middle">${r.type}</td>
        <td class="align-middle">${escapeHTML(r.desc)}</td>
        <td class="align-middle text-end">${r.credit ? '₱'+formatMoney(r.credit) : ''}</td>
        <td class="align-middle text-end">${r.debit  ? '₱'+formatMoney(r.debit)  : ''}</td>
        <td class="align-middle text-end">${escapeHTML(r.reference)}</td>
        <td class="align-middle text-end">₱${formatMoney(r.balance)}</td>
      </tr>`).join('') : `<tr><td colspan="7" class="text-center text-muted">No entries.</td></tr>`;

    // Hide print buttons for students
    const ledgerPrintBtn = root.querySelector('#ledgerPrintBtn');
    const liqPrintBtn = root.querySelector('#liqPrintBtn');
    if (ledgerPrintBtn) ledgerPrintBtn.style.display = 'none';
    if (liqPrintBtn) liqPrintBtn.style.display = 'none';

    function onDebitsAction(ev){
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'view-receipt') {
        const url = btn.dataset.url;
        if (url) {
          window.open(url, '_blank', 'noopener');
        }
        return;
      }
    }
  }

  // =============================== Store Ops =================================
  function sumCredits(eventId){
    return (store.credits[eventId]||[]).reduce((a,b)=>a + (b.amount||0), 0);
  }
  function sumDebits(eventId){
    return (store.debits[eventId] ||[]).reduce((a,b)=>a + (b.amount||0), 0);
  }

  function buildLedger(eventId, credits, debits){
    const rows = [];
    const merged = [
      ...credits.map(c => ({
        date: c.date,
        type: 'CREDIT',
        desc: c.source,
        credit: c.amount,
        debit: 0,
        reference: '-'
      })),
      ...debits.map(d => ({
        date: d.date,
        type: 'DEBIT',
        desc: `${d.category} - ${d.notes || 'Expense'}`,
        credit: 0,
        debit: d.amount,
        reference: d.receipt_number || '-'
      }))
    ].sort((a,b) => (a.date||'').localeCompare(b.date||''));

    let bal = 0;
    for (const r of merged){
      bal += r.credit - r.debit;
      rows.push({
        date: r.date,
        type: r.type,
        desc: r.desc,
        credit: r.credit || 0,
        debit: r.debit || 0,
        balance: bal,
        reference: r.reference
      });
    }
    return rows;
  }

  // =============================== Utils =================================
  function escapeHTML(s){
    return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
    }[c]));
  }
  function escapeAttr(s){
    return (s==null?'':String(s)).replace(/["<>]/g, c => ({
      '"':'&quot;','<':'&lt;','>':'&gt;'
    }[c]));
  }
  function formatMoney(n){
    return (Number(n)||0).toLocaleString('en-PH', {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    });
  }

  // ============ Academic Year loading ============
  async function loadEEActiveYear(root) {
    const apiBase = 'php/';
    const schoolYearEl     = root.querySelector('#eeCurrentSchoolYear');
    const aySelect         = root.querySelector('#eeAySelect');
    const activeYearSelect = root.querySelector('#eeActiveYearSelect');

    try {
      // 1) Get CURRENT active academic year - USING SAME LOGIC AS manage-dept-fees.js
      let activeRaw = null;
      try {
        const r = await fetch(`${apiBase}get-active-academic-year.php?t=${Date.now()}`, {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        activeRaw = await r.json();
      } catch (e) {
        console.error('[ee] get-active-academic-year error:', e);
      }

      let active = null;
      if (activeRaw) {
        try {
          active = normalizeActiveAY(activeRaw);
          console.log('[ee] Normalized active AY:', active);
        } catch (e) {
          console.warn('[ee] normalizeActiveAY failed:', e);
        }
      }

      // If we couldn't get active year, try to get from list
      if (!active) {
        try {
          const listRaw = await fetch(`${apiBase}get-academic-years.php?t=${Date.now()}`, {
            credentials: 'same-origin',
            cache: 'no-store'
          });
          const listData = await listRaw.json();
          const list = normalizeAYList(listData);
          
          if (list.length) {
            const act = list.find(a => String(a.status).toLowerCase() === 'active') || list[0];
            active = { 
              start_year: act.start_year, 
              end_year: act.end_year, 
              active_year: Number.isFinite(act.active_year) ? act.active_year : act.start_year 
            };
          }
        } catch (e2) {
          console.error('[ee] Fallback AY loading error:', e2);
        }
      }

      if (active) {
        eeActiveYearState.startYear = active.start_year;
        eeActiveYearState.endYear = active.end_year;
        eeActiveYearState.activeYear = active.active_year;
        eeActiveYearState.baseStartYear = active.start_year;
        eeActiveYearState.baseEndYear = active.end_year;
        eeActiveYearState.baseActiveYear = active.active_year;
        eeActiveYearState.schoolYearText = `${active.start_year}–${active.end_year}`;
        
        if (schoolYearEl) schoolYearEl.textContent = getEEStateAcademicYearLabel();
      } else {
        if (schoolYearEl) schoolYearEl.textContent = 'No active academic year';
      }

      // 2) Load all AY options
      let listData = null;
      try {
        const r2 = await fetch(`${apiBase}get-academic-years.php?t=${Date.now()}`, {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        listData = await r2.json();
      } catch (e) {
        console.error('[ee] get-academic-years error:', e);
      }

      // SY dropdown (with "All School Years" at top)
      if (aySelect) {
        const options = [];

        // "All School Years" option
        options.push('<option value="ALL">All School Years</option>');

        let list = [];
        if (listData) {
          list = normalizeAYList(listData);
        }

        if (list.length) {
          list.forEach((a) => {
            const sel = (+a.start_year === +eeActiveYearState?.startYear && +a.end_year === +eeActiveYearState?.endYear) ? 'selected':'';
            const tag = (String(a.status).toLowerCase() === 'active') ? ' (Active)' : '';
            options.push(`<option value="${a.start_year}-${a.end_year}" ${sel}>${a.start_year}–${a.end_year}${tag}</option>`);
          });
        } else if (active) {
          const val = `${active.start_year}-${active.end_year}`;
          options.push(`<option value="${val}" selected>${active.start_year}–${active.end_year} (Active)</option>`);
        }

        aySelect.innerHTML = options.join('');
      }

      // Active Year dropdown (with "All Semesters" option when not on "All School Years")
      if (activeYearSelect) {
        const sy = eeActiveYearState.startYear;
        const ey = eeActiveYearState.endYear;

        if (sy == null && ey == null) {
          // All school years → AY selector disabled, just "All"
          activeYearSelect.innerHTML = '<option value="">All</option>';
          activeYearSelect.disabled = true;
        } else {
          let html = '';

          const selectedAll = eeActiveYearState.activeYear == null ? 'selected' : '';
          html += `<option value="ALL" ${selectedAll}>All Semesters</option>`;

          if (sy) {
            html += `<option value="${sy}" ${
              eeActiveYearState.activeYear === sy ? 'selected' : ''
            }>1st Semester</option>`;
          }
          if (ey && ey !== sy) {
            html += `<option value="${ey}" ${
              eeActiveYearState.activeYear === ey ? 'selected' : ''
            }>2nd Semester</option>`;
          }
          activeYearSelect.innerHTML = html || '<option value="">—</option>';
          activeYearSelect.disabled = false;
        }
      }
    } catch (err) {
      console.error('[ee] loadEEActiveYear error:', err);
      const schoolYearEl2 = schoolYearEl;
      const aySelect2 = aySelect;
      const activeYearSelect2 = activeYearSelect;
      if (schoolYearEl2) schoolYearEl2.textContent = 'Error loading AY';
      if (aySelect2) aySelect2.innerHTML = '<option value="ALL">All School Years</option>';
      if (activeYearSelect2) {
        activeYearSelect2.innerHTML = '<option value="">All</option>';
        activeYearSelect2.disabled = true;
      }
    }
  }

  function getSemesterLabelForYear(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return 'All Semesters';
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return `AY Segment ${activeYear}`;
  }

  function getSemesterLabelForEvent(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return null;
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return null;
  }

  function getEEStateAcademicYearLabel() {
    const sy = eeActiveYearState.startYear;
    const ey = eeActiveYearState.endYear;
    const ay = eeActiveYearState.activeYear;

    if (sy == null || ey == null) {
      return 'All School Years';
    }

    const range = `${sy}-${ey}`;
    const sem = getSemesterLabelForYear(sy, ey, ay);

    if (!sem) return `AY ${range}`;
    if (sem === 'All Semesters') return `AY ${range} – All Semesters`;
    return `${sem}, AY ${range}`;
  }

  function formatEventAcademicYear(event) {
    let sy = event.start_year;
    let ey = event.end_year;

    if ((sy == null || ey == null) && event.sy) {
      const m = String(event.sy).match(/(\d{4})\D+(\d{4})/);
      if (m) {
        sy = Number(m[1]);
        ey = Number(m[2]);
      }
    }

    const rawAy = event.active_year != null
      ? event.active_year
      : (event.ay ? Number(event.ay) : null);

    if (sy == null || ey == null) {
      const fallbackSY = event.sy || '';
      const fallbackAY = rawAy != null ? String(rawAy) : (event.ay || '');
      if (fallbackSY && fallbackAY) return `${fallbackAY}, ${fallbackSY}`;
      return fallbackSY || fallbackAY || '—';
    }

    const range = `${sy}-${ey}`;
    const sem = getSemesterLabelForEvent(sy, ey, rawAy);

    if (!sem) return `AY ${range}`;
    return `${sem}, AY ${range}`;
  }

  // ============== Map server rows → client shapes ==============
  function mapServerEventToClient(row){
    if (!row) return null;

    const scope = (row.scope || 'general').toLowerCase() === 'organization'
      ? 'organization'
      : 'general';

    const orgAbbr = row.organization_abbr || row.org_abbr || '';
    const orgName = row.org_name || row.organization_name || '';

    const orgLabel = scope === 'general'
      ? 'General (Campus-Wide)'
      : (orgName || orgAbbr || 'Organization');

    let startYear = row.start_year != null ? Number(row.start_year) : null;
    let endYear   = row.end_year   != null ? Number(row.end_year)   : null;

    if ((startYear == null || endYear == null) && (row.school_year || row.sy)) {
      const syText = String(row.school_year || row.sy);
      const m = syText.match(/(\d{4})\D+(\d{4})/);
      if (m) {
        startYear = Number(m[1]);
        endYear   = Number(m[2]);
      }
    }

    let syText = '';
    if (row.sy) syText = row.sy;
    else if (row.school_year) syText = row.school_year;
    else if (startYear && endYear) syText = `SY ${startYear}-${endYear}`;

    const activeYearNum = row.active_year != null
      ? Number(row.active_year)
      : (row.ay != null ? Number(row.ay) : null);

    const ay = activeYearNum != null ? String(activeYearNum) : '';

    const semLabel = getSemesterLabelForEvent(startYear, endYear, activeYearNum);

    const date = row.event_date
      ? String(row.event_date).slice(0,10)
      : (row.date || (row.created_at ? String(row.created_at).slice(0,10) : ''));

    return {
      id: String(row.id),
      title: row.title || '',
      location: row.location || '',
      scope,
      organization_abbr: orgAbbr || null,
      org_label: orgLabel,
      date,
      sy: syText,
      ay,
      start_year: startYear,
      end_year: endYear,
      active_year: activeYearNum,
      semester: semLabel,
      status: row.status || 'Draft'
    };
  }

  function mapServerCreditToClient(row){
    return {
      id: String(row.id),
      eventId: String(row.event_id),
      date: row.credit_date || row.date || '',
      source: row.source || '',
      notes: row.notes || '',
      amount: Number(row.amount || 0)
    };
  }

  function mapServerDebitToClient(row){
    const receiptPath = row.receipt_path || '';
    const unitPrice = row.unit_price 
        ? Number(row.unit_price) 
        : (row.calculated_unit_price ? Number(row.calculated_unit_price) : 
          (row.amount && row.quantity ? Number(row.amount) / Math.max(Number(row.quantity), 1) : 0));
    
    return {
        id: String(row.id),
        eventId: String(row.event_id),
        date: row.debit_date || row.date || '',
        category: row.category || '',
        notes: row.notes || '',
        amount: Number(row.amount || 0),
        unit_price: unitPrice,
        quantity: Number(row.quantity || 1),
        receipt_number: row.receipt_number || '',
        receiptName: receiptPath ? receiptPath.split('/').pop() : '',
        receiptUrl: receiptPath || ''
    };
  }

  // ============================== API ===============================
  const API = {
    listEvents: (q='') => {
      const params = new URLSearchParams();
      params.set('q', q || '');

      if (eeActiveYearState.startYear)
        params.set('start_year', String(eeActiveYearState.startYear));
      if (eeActiveYearState.endYear)
        params.set('end_year', String(eeActiveYearState.endYear));
      if (eeActiveYearState.activeYear)
        params.set('active_year', String(eeActiveYearState.activeYear));

      return fetch(
        `php/event-list-events-student.php?${params.toString()}`,
        {credentials:'same-origin'}
      ).then(r=>r.json());
    },

    getEvent:  (id)   => fetch(
      `php/event-get-event-student.php?event_id=${encodeURIComponent(id)}`,
      {credentials:'same-origin'}
    ).then(r=>r.json()),
  };
})();