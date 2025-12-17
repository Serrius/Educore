/*  
  event-expenses.js (SPA-safe, wired for your stack)
  Uses mPDF (export-records-pdf.php) for printing with letterhead header/footer
  UPDATED WITH PROPER SEMESTER HANDLING (same as records.js)
*/
;(function(){
  'use strict';

  // Support both old and new IDs (just in case)
  const PANEL_SEL   = '#eventExpensesPage, #event-expenses-page';
  const ROUTE_MATCH = '[data-route="event-expenses"], [href="#event-expenses"]';
  let   lastEESnap  = '';
  let   currentEventId = '';

  // ========================= In-Memory Store =============================
  const store = {
    events:   /** @type {Array<EventItem>} */ ([]),
    credits:  /** @type {Record<string, CreditItem[]>} */ ({}),
    debits:   /** @type {Record<string, DebitItem[]>} */ ({}),
    seq: 1,
    // now holds ACTIVE ORGANIZATIONS (from organizations table)
    organizations: /** @type {{abbr:string,name:string,scope?:string,course?:string}[]} */ ([]),
  };
  
  // ========================= Admin/Treasurer Constraint ================================
  const currentUserRole = (localStorage.getItem('role') || '').toLowerCase();

  /**
   * @typedef {{
   *   id:string,
   *   title:string,
   *   location:string,
   *   scope:'general'|'organization',
   *   organization_abbr?:string,
   *   org_label?:string,
   *   date?:string,
   *   sy?:string,
   *   ay?:string,
   *   start_year?:number|null,
   *   end_year?:number|null,
   *   active_year?:number|null,
   *   semester?:string|null,
   *   status:'Draft'|'Submitted'|'Approved'|'Declined'
   * }} EventItem
   *
   * @typedef {{id:string, eventId:string, date:string, source:string, notes?:string, amount:number}} CreditItem
   * @typedef {{id:string, eventId:string, date:string, category:string, notes?:string, amount:number, quantity:number, receipt_number?:string, receiptName?:string, receiptUrl?:string}} DebitItem
   */

  // ========================= Academic Year State =========================
  const eeActiveYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,       // null = All Semesters within selected SY
    baseStartYear: null,
    baseEndYear: null,
    baseActiveYear: null,
  };

  function eeIsReadOnlyView() {
    const baseSy = eeActiveYearState.baseStartYear;
    const baseEy = eeActiveYearState.baseEndYear;
    const baseAy = eeActiveYearState.baseActiveYear;

    // If no base AY configured, badge should never appear
    if (baseSy == null && baseEy == null && baseAy == null) return false;

    // If ACTIVE YEAR = ALL SEMESTERS → do NOT force read-only
    if (eeActiveYearState.activeYear == null) {
      return false;
    }

    // If we somehow have "All School Years" (no start/end), don't lock
    if (eeActiveYearState.startYear == null && eeActiveYearState.endYear == null) {
      return false;
    }

    const sameSY =
      eeActiveYearState.startYear === baseSy &&
      eeActiveYearState.endYear === baseEy;

    const sameAY = eeActiveYearState.activeYear === baseAy;

    // if NOT same SY OR NOT same active year → read-only
    return !(sameSY && sameAY);
  }

  function eeUpdateReadOnlyUI(root) {
    const readOnly = eeIsReadOnlyView();

    const badge = root.querySelector('#eeReadOnlyBadge');
    const addEventBtn   = root.querySelector('#btnAddEvent');
    const emptyAddBtn   = root.querySelector('#btnEmptyAdd');
    const fundAddBtn    = root.querySelector('#fundAddBtn');
    const debitAddBtn   = root.querySelector('#debitAddBtn');

    if (badge) {
      badge.style.visibility = readOnly ? 'visible' : 'hidden';
    }

    const toggleBtn = (btn) => {
      if (!btn) return;
      if (readOnly) {
        btn.classList.add('disabled-action');
        btn.setAttribute('disabled', 'disabled');
      } else {
        btn.classList.remove('disabled-action');
        btn.removeAttribute('disabled');
      }
    };

    [addEventBtn, emptyAddBtn, fundAddBtn, debitAddBtn].forEach(toggleBtn);
  }

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

      eeUpdateReadOnlyUI(root);
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
      eeUpdateReadOnlyUI(root);
    }
  }

  // ========================= BOOT (your pattern) =========================
  document.addEventListener('DOMContentLoaded', () => {
    const initIfFound = () => {
      const panel = document.querySelector(PANEL_SEL);
      if (panel && !panel.dataset.eeInit) {
        lastEESnap = '';
        initEventExpenses(panel);
        if (typeof refreshEventExpenses === 'function') refreshEventExpenses(panel);
      }
    };

    // Try immediately once
    initIfFound();

    // Observe your content area like other modules
    const contentArea = document.getElementById('content-area') || document.body;
    const observer = new MutationObserver(initIfFound);
    observer.observe(contentArea, { childList: true, subtree: true });

    // Custom SPA hooks you already emit
    document.addEventListener('spa:navigated', initIfFound);

    // Route clicks (sidebar / links)
    document.addEventListener('click', (e) => {
      const toPanel = e.target.closest(ROUTE_MATCH);
      if (toPanel) setTimeout(initIfFound, 0);
    });
  });

  // ============================= Initializer =============================
  function initEventExpenses(root){
    // Flag so we only init once per injection
    root.dataset.eeInit = '1';

    // Cache nodes
    const listView    = root.querySelector('#eeListView');
    const eventView   = root.querySelector('#eeEventView');
    const searchBox   = root.querySelector('#eeSearch');
    const addBtn      = root.querySelector('#btnAddEvent');
    const emptyAddBtn = root.querySelector('#btnEmptyAdd');
    const grid        = root.querySelector('#eeCardsGrid');
    const emptyState  = root.querySelector('#eeEmptyState');
    const backBtn     = root.querySelector('#eeBackBtn');

    // AY controls (must exist in your HTML)
    const aySelect         = root.querySelector('#eeAySelect');
    const activeYearSelect = root.querySelector('#eeActiveYearSelect');

    // Bind modals (guard read-only)
    addBtn?.addEventListener('click', () => {
      if (eeIsReadOnlyView()) {
        alert('You can only add events in the current active academic year.');
        return;
      }
      openModal('#addEventModal');
    });
    emptyAddBtn?.addEventListener('click', () => {
      if (eeIsReadOnlyView()) {
        alert('You can only add events in the current active academic year.');
        return;
      }
      openModal('#addEventModal');
    });
    root.querySelector('#fundAddBtn')?.addEventListener('click', () => {
      if (eeIsReadOnlyView()) {
        alert('You can only add credits in the current active academic year.');
        return;
      }
      openModal('#addCreditModal');
    });
    root.querySelector('#debitAddBtn')?.addEventListener('click', () => {
      if (eeIsReadOnlyView()) {
        alert('You can only add expenses in the current active academic year.');
        return;
      }
      openModal('#addExpenseModal');
    });

    // Search
    searchBox?.addEventListener('input', () => renderCards());

    // Back
    backBtn?.addEventListener('click', () => showList());

    // Forms
    wireAddEventForm(root, () => { renderCards(); });
    wireAddCreditForm(root, () => {
      if (currentEventId) renderEventView(currentEventId, root);
      renderCards(); // refresh Items + ₱ on cards after add credit
    });
    wireAddExpenseForm(root, () => {
      if (currentEventId) renderEventView(currentEventId, root);
      renderCards(); // refresh Items + ₱ on cards after add expense
    });

    // Load ACTIVE ORGANIZATIONS
    loadActiveOrganizations()
      .then(list => {
        store.organizations = list;
        seedOrganizationOptions(root, list);
      })
      .catch(() => {
        store.organizations = [];
        seedOrganizationOptions(root, []);
      });

    // Helper: fetch events for current AY and prefetch details
    function fetchAndRenderEvents() {
      API.listEvents().then(data => {
        if (data?.success && Array.isArray(data.events)) {
          store.events = data.events
            .map(mapServerEventToClient)
            .filter(Boolean);

          // seed empty arrays so Items / ₱0.00 render cleanly
          for (const ev of store.events) {
            const id = String(ev.id);
            if (!store.credits[id]) store.credits[id] = [];
            if (!store.debits[id])  store.debits[id]  = [];
          }

          // PREFETCH details for all events → so cards have real items/amount on first view
          if (store.events.length) {
            const detailPromises = store.events.map(ev =>
              API.getEvent(ev.id).then(resp => {
                // 🔧 DON'T require resp.success here – many PHP scripts just return {event,credits,debits}
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
              renderCards(); // now with real Items + ₱
            });
          }
        }
        // first render (may show all 0.00 while details are still loading)
        renderCards();
      }).catch(() => renderCards());
    }

    // Load AY info, then events
    loadEEActiveYear(root).then(() => {
      eeUpdateReadOnlyUI(root);
      fetchAndRenderEvents();
    });

    // AY change listeners
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';
      
      if (val === 'ALL') {
        // Turn off AY filtering completely (all school years)
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

      eeUpdateReadOnlyUI(root);
      fetchAndRenderEvents();
    });

    activeYearSelect?.addEventListener('change', () => {
      if (activeYearSelect.disabled) return;
      const val = activeYearSelect.value;

      if (val === 'ALL' || val === '') {
        // All active years within the selected SY
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

      eeUpdateReadOnlyUI(root);
      fetchAndRenderEvents();
    });

    // ---------- Render helpers ----------
    function renderCards(){
      const q = (searchBox?.value || '').trim().toLowerCase();
      const sy = eeActiveYearState.startYear;
      const ey = eeActiveYearState.endYear;
      const ay = eeActiveYearState.activeYear; // null = All Semesters

      const events = store.events.filter(e => {
        // Filter by Academic Year + Active Year
        const syMatch = !sy || e.start_year === sy;
        const eyMatch = !ey || e.end_year === ey;
        const ayMatch = (ay == null) || e.active_year === ay || Number(e.ay || 0) === ay;

        if (!(syMatch && eyMatch && ayMatch)) return false;

        // Search filter
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
        // 🔧 Again: don't require data.success, just use whatever the PHP returns
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
        renderCards(); // keep cards in sync
      }).catch(() => {
        renderEventView(eventId, root);
        renderCards();
      });
    }
  }

  // Optional external refresh (parity with your pattern)
  function refreshEventExpenses(_root){ /* no-op placeholder */ }

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

    root.querySelector('#liqEvent').textContent   = e.title;
    root.querySelector('#liqOrg').textContent     = orgLabel;
    root.querySelector('#liqDate').textContent    = e.date || '—';
    const liqYearEl = root.querySelector('#liqYear');
    if (liqYearEl) liqYearEl.textContent = ayDisplay;
    root.querySelector('#liqCredits').textContent = `₱${formatMoney(totalC)}`;
    root.querySelector('#liqDebits').textContent  = `₱${formatMoney(totalD)}`;
    root.querySelector('#liqBalance').textContent = `₱${formatMoney(totalC-totalD)}`;

    const liqTbody = root.querySelector('#liqTbody');
    if (liqTbody) {
      if (dList.length) {
        liqTbody.innerHTML = dList.map((d, idx) => `
          <tr>
            <td class="align-middle text-center">${idx + 1}</td>
            <td class="align-middle">${d.date}</td>
            <td class="align-middle">${escapeHTML(d.category)}</td>
            <td class="align-middle">${escapeHTML(d.notes || '')}</td>
            <td class="align-middle text-center">${d.quantity}</td>
            <td class="align-middle text-end">₱${formatMoney(d.unit_price)}</td>
            <td class="align-middle text-end">₱${formatMoney(d.amount)}</td>
            <td class="align-middle">${escapeHTML(d.receipt_number || '')}</td>
          </tr>`).join('');
      } else {
        liqTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No items.</td></tr>`;
      }
    }

    const ledgerPrintBtn = root.querySelector('#ledgerPrintBtn');
    if (ledgerPrintBtn) {
      ledgerPrintBtn.onclick = () => printLedger(e, led);
    }
    const liqPrintBtn = root.querySelector('#liqPrintBtn');
    if (liqPrintBtn) {
      liqPrintBtn.onclick = () => printLiquidation(e, cList, dList);
    }

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

  // ============================ Wire Modals ===============================
  function wireAddEventForm(root, onSaved){
    // Modals are outside main panel → use global query
    const modalEl = document.getElementById('addEventModal');
    const form    = document.getElementById('addEventForm');
    const saveBtn = document.getElementById('aeSaveBtn');
    if (!modalEl || !form) return;

    const scopeSel = form.querySelector('#aeScope');
    const deptWrap = form.querySelector('#aeDeptWrap');   // used as ORG wrapper
    const deptSel  = form.querySelector('#aeDepartment'); // holds organization_abbr

    // Normalize current user role (in case it's undefined / different casing)
    const normalizedRole = String(window.currentUserRole || currentUserRole || '').toLowerCase();
    const isSuperAdmin   = (normalizedRole === 'super-admin' || normalizedRole === 'special-admin' || normalizedRole === 'system-admin');

    // === Initial state for Scope & Org ===
    if (scopeSel) {
      if (isSuperAdmin) {
        // 🔓 Super admin can always change scope
        scopeSel.removeAttribute('disabled');
        // Default to "general" on open if nothing selected
        if (!scopeSel.value) scopeSel.value = 'general';
      } else {
        // 🔒 Non-super-admin: always ORGANIZATION scope
        scopeSel.value = 'organization';
        scopeSel.setAttribute('disabled', 'disabled');
      }
    }

    if (!isSuperAdmin && deptWrap) {
      // For non-super-admin, org field is always visible
      deptWrap.classList.remove('d-none');
      // Seed org options if not yet populated
      if (typeof seedOrganizationOptions === 'function') {
        seedOrganizationOptions(root, store.organizations);
      }
    }

    // Scope change (still needed for super-admin only)
    scopeSel?.addEventListener('change', () => {
      if (scopeSel.value === 'organization') {
        deptWrap?.classList.remove('d-none');
        if (typeof seedOrganizationOptions === 'function') {
          seedOrganizationOptions(root, store.organizations);
        }
      } else {
        // Hide org selector when scope is not organization
        deptWrap?.classList.add('d-none');
      }
    });

    // Footer button triggers form submit
    saveBtn?.addEventListener('click', () => {
      form.requestSubmit();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (eeIsReadOnlyView()) {
        alert('You can only add events in the current active academic year.');
        return;
      }

      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }

      // 🔒 Scope: super-admin can choose, others are forced to "organization"
      let scopeVal = 'general';
      if (scopeSel) {
        scopeVal = scopeSel.value || 'general';
      }
      if (!isSuperAdmin) {
        scopeVal = 'organization';
      }

      const payload = {
        name:  form.querySelector('#aeName').value.trim(),
        location: form.querySelector('#aeLocation').value.trim(),
        scope: scopeVal,
        // BACKEND: save org abbreviation here (FK to organizations.abbreviation)
        organization_abbr:
          scopeVal === 'organization'
            ? (deptSel?.value || '')
            : null,
        // AY info for new event
        start_year:  eeActiveYearState.startYear,
        end_year:    eeActiveYearState.endYear,
        active_year: eeActiveYearState.activeYear || eeActiveYearState.startYear
      };

      // Extra guard: admins/treasurers MUST have org_abbr
      if (!isSuperAdmin && scopeVal === 'organization' && !payload.organization_abbr) {
        alert('Organization is required.');
        deptSel?.focus();
        return;
      }

      API.createEvent(payload).then(data => {
        if (data?.success && data.event) {
          const evt = mapServerEventToClient(data.event);
          if (evt) {
            const id = String(evt.id);
            store.events.unshift(evt);
            if (!store.credits[id]) store.credits[id] = [];
            if (!store.debits[id])  store.debits[id]  = [];
          }
        }

        closeModal(modalEl);
        form.reset();
        form.classList.remove('was-validated');

        // Restore locked UI after reset for non-super-admin
        if (!isSuperAdmin) {
          if (scopeSel) {
            scopeSel.value = 'organization';
            scopeSel.setAttribute('disabled', 'disabled');
          }
          if (deptWrap) {
            deptWrap.classList.remove('d-none');
          }
        } else {
          // For super admin, keep scope editable on next open
          if (scopeSel) {
            scopeSel.removeAttribute('disabled');
            scopeSel.value = 'general';
          }
          if (deptWrap) {
            deptWrap.classList.add('d-none');
          }
        }

        if (typeof onSaved === 'function') onSaved();
      }).catch(() => closeModal(modalEl));
    });
  }

  function wireAddCreditForm(root, onSaved){
    const modalEl = document.getElementById('addCreditModal');
    const form    = document.getElementById('addCreditForm');
    const saveBtn = document.getElementById('acSaveBtn');
    if (!modalEl || !form) return;

    // Footer button triggers form submit
    saveBtn?.addEventListener('click', () => {
      form.requestSubmit();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentEventId) return;

      if (eeIsReadOnlyView()) {
        alert('You can only add credits in the current active academic year.');
        return;
      }

      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
      }

      const payload = {
        event_id: currentEventId,
        date:   form.querySelector('#acDate').value || new Date().toISOString().slice(0,10),
        source: form.querySelector('#acSource').value.trim(),
        notes:  form.querySelector('#acNotes').value.trim(),
        amount: Number(form.querySelector('#acAmount').value || 0)
      };

      API.addCredit(payload).then(data => {
        if (data?.success && data.credit){
          const c = mapServerCreditToClient(data.credit);
          (store.credits[currentEventId] ||= []).push(c);
        }
        closeModal(modalEl);
        form.reset();
        form.classList.remove('was-validated');
        if (typeof onSaved === 'function') onSaved();
      });
    });
  }

  function wireAddExpenseForm(root, onSaved){
    const modalEl = document.getElementById('addExpenseModal');
    const form    = document.getElementById('addExpenseForm');
    const saveBtn = document.getElementById('axSaveBtn');
    if (!modalEl || !form) return;

    // Get form elements
    const unitPriceInput = form.querySelector('#axUnitPrice');
    const amountInput = form.querySelector('#axAmount');
    const quantityInput = form.querySelector('#axQuantity');
    
    // Calculate amount when unit price or quantity changes
    function calculateAmount() {
        const unitPrice = parseFloat(unitPriceInput.value) || 0;
        const quantity = parseInt(quantityInput.value) || 1;
        const amount = unitPrice * quantity;
        
        if (!isNaN(amount) && amount >= 0) {
            amountInput.value = amount.toFixed(2);
        }
    }
    
    // Calculate unit price when amount changes
    function calculateUnitPrice() {
        const amount = parseFloat(amountInput.value) || 0;
        const quantity = parseInt(quantityInput.value) || 1;
        const unitPrice = quantity > 0 ? amount / quantity : 0;
        
        if (!isNaN(unitPrice) && unitPrice >= 0) {
            unitPriceInput.value = unitPrice.toFixed(2);
        }
    }
    
    // Add event listeners for calculations
    if (unitPriceInput && amountInput && quantityInput) {
        unitPriceInput.addEventListener('input', calculateAmount);
        quantityInput.addEventListener('input', function() {
            calculateAmount();
            calculateUnitPrice(); // Also update unit price if amount is fixed
        });
        amountInput.addEventListener('input', calculateUnitPrice);
    }

    // Footer button triggers form submit
    saveBtn?.addEventListener('click', () => {
        form.requestSubmit();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentEventId) return;

        if (eeIsReadOnlyView()) {
            alert('You can only add expenses in the current active academic year.');
            return;
        }

        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }

        const category = form.querySelector('#axCategory').value;
        const notes    = form.querySelector('#axNotes').value.trim();
        const dateVal  = form.querySelector('#axDate').value || new Date().toISOString().slice(0,10);
        const unitPriceVal = parseFloat(form.querySelector('#axUnitPrice').value) || 0;
        const amountVal = parseFloat(form.querySelector('#axAmount').value) || 0;
        const quantityVal = parseInt(form.querySelector('#axQuantity').value) || 1;
        const receiptNumber = form.querySelector('#axReceiptNumber').value.trim();
        const fileInput= form.querySelector('#axReceipt');
        const file     = fileInput && fileInput.files ? fileInput.files[0] : null;

        // Validate that we have either unit price or amount
        if (unitPriceVal <= 0 && amountVal <= 0) {
            alert('Please provide either Unit Price or Total Amount.');
            return;
        }

        // Make receipt REQUIRED
        if (!file) {
            fileInput.classList.add('is-invalid');
            fileInput.focus();
            return;
        } else {
            fileInput.classList.remove('is-invalid');
        }

        // Use FormData so receipt file is actually sent
        const fd = new FormData();
        fd.set('event_id', currentEventId);
        fd.set('date', dateVal);
        fd.set('category', category);
        fd.set('notes', notes);
        fd.set('amount', String(amountVal));
        fd.set('unit_price', String(unitPriceVal));
        fd.set('quantity', String(quantityVal));
        fd.set('receipt_number', receiptNumber);
        fd.set('receipt', file);

        API.addExpense(fd).then(data => {
            if (data?.success && data.expense){
                const d = mapServerDebitToClient(data.expense);
                (store.debits[currentEventId] ||= []).push(d);
            }
            closeModal(modalEl);
            form.reset();
            form.classList.remove('was-validated');
            if (typeof onSaved === 'function') onSaved();
        }).catch(error => {
            console.error('Error adding expense:', error);
            alert('Error adding expense. Please try again.');
        });
    });
}

  // ============================== Store Ops ===============================
  function addEvent(e){
    store.events.unshift(e);
    store.credits[e.id] = [];
    store.debits[e.id]  = [];
  }
  function addCredit(c){ (store.credits[c.eventId] ||= []).push(c); }
  function addDebit(d){ (store.debits[d.eventId]  ||= []).push(d); }

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
  function openModal(sel){
    const el = document.querySelector(sel);
    if (!el) return;
    bootstrap.Modal.getOrCreateInstance(el).show();
  }
  function closeModal(el){
    (bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el)).hide();
  }

  // Sanitize text for printing - removes only dangerous HTML tags but keeps symbols
  function sanitizeForPrint(str) {
    if (!str) return '';
    // Remove only dangerous tags, but keep symbols like & and +
    return String(str).replace(/<\/?[^>]+(>|$)/g, '');
  }

  // Helper function to show toast notifications (optional, used elsewhere if needed)
  function showToast(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        color: white;
        border-radius: 4px;
        z-index: 10000;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        document.body.removeChild(toast);
    }, 4000);
  }

  // ============ Academic Year + Semester formatting helpers ============
  // For FILTER label (top of module) – can show "All Semesters"
  function getSemesterLabelForYear(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return 'All Semesters';
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return `AY Segment ${activeYear}`;
  }

  // For EVENT-LEVEL label (per event / prints) – NEVER "All Semesters"
  function getSemesterLabelForEvent(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return null;
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return null;
  }

  // Label for the current filter state (for #eeCurrentSchoolYear)
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

  // Used for event-level display + printing
  function formatEventAcademicYear(event) {
    let sy = event.start_year;
    let ey = event.end_year;

    // If start/end not set on the event, try to parse from sy text
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

  // ====================== mPDF send helper ======================
  function sendPDFToServer(title, content, type) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'php/export-records-pdf.php';
    form.target = '_blank';

    const titleInput = document.createElement('input');
    titleInput.type = 'hidden';
    titleInput.name = 'title';
    titleInput.value = title || 'Report';

    const typeInput = document.createElement('input');
    typeInput.type = 'hidden';
    typeInput.name = 'type';
    typeInput.value = type || '';

    const contentField = document.createElement('textarea');
    contentField.name = 'content';
    contentField.style.display = 'none';
    contentField.value = content || '';

    form.appendChild(titleInput);
    form.appendChild(typeInput);
    form.appendChild(contentField);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  // ======================= BUILD LIQUIDATION CONTENT (mPDF) =======================
  function buildEventLiquidationPDFContent(event, credits, debits) {
    const totalCredits = credits.reduce((s, c) => s + (c.amount || 0), 0);
    const totalDebits  = debits.reduce((s, d) => s + (d.amount || 0), 0);
    const balance      = totalCredits - totalDebits;

    const semLabel = getSemesterLabelForEvent(
      event.start_year,
      event.end_year,
      event.active_year != null
        ? event.active_year
        : (event.ay ? Number(event.ay) : null)
    ) || '—';

    let expenseRows = '';
    if (debits.length) {
      expenseRows = debits.map((d, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHTML(d.date || '')}</td>
          <td>${escapeHTML(d.category || '')}</td>
          <td>${escapeHTML(d.notes || '')}</td>
          <td style="text-align:center;">${d.quantity || 1}</td>
          <td style="text-align:right;">₱${formatMoney((d.amount || 0) / (d.quantity || 1 || 1))}</td>
          <td style="text-align:right;">₱${formatMoney(d.amount || 0)}</td>
          <td>${escapeHTML(d.receipt_number || '')}</td>
        </tr>
      `).join('');
    } else {
      expenseRows = `
        <tr>
          <td colspan="8" style="text-align:center;color:#666;padding:8pt;">
            No expenses recorded.
          </td>
        </tr>
      `;
    }

    return `
  <div class="report-header">
    <h2>LIQUIDATION REPORT</h2>
  </div>

  <table class="meta-table" style="width:100%; border-collapse:collapse; margin-bottom:14pt;">
    <tr>
      <td style="width:50%; border:none; padding:0 4pt 4pt 0; font-size:9pt;">
        <strong>Event:</strong> ${escapeHTML(event.title || '')}<br>
        <strong>Organization:</strong> ${escapeHTML(event.org_label || 'General (Campus-Wide)')}<br>
        <strong>Venue:</strong> ${escapeHTML(event.location || '—')}
      </td>
      <td style="width:50%; border:none; padding:0 0 4pt 4pt; font-size:9pt; text-align:right;">
        <strong>Date:</strong> ${escapeHTML(event.date || '—')}<br>
        <strong>School Year:</strong> ${escapeHTML(event.sy || '—')}<br>
        <strong>Semester:</strong> ${escapeHTML(semLabel)}
      </td>
    </tr>
  </table>

  <div class="section-title">I. SUMMARY OF FUNDS</div>

  <table class="summary-table">
    <tr>
      <th>Total Funds Received</th>
      <td class="amount-cell">₱${formatMoney(totalCredits)}</td>
    </tr>
    <tr>
      <th>Total Expenses</th>
      <td class="amount-cell">₱${formatMoney(totalDebits)}</td>
    </tr>
    <tr>
      <th>Remaining Balance / (Deficit)</th>
      <td class="amount-cell">₱${formatMoney(balance)}</td>
    </tr>
  </table>

  <div class="section-title">II. DETAILED EXPENSES</div>

  <table class="expenses-table">
    <thead>
      <tr>
        <th style="width:4%;">#</th>
        <th style="width:10%;">Date</th>
        <th style="width:16%;">Category</th>
        <th>Description</th>
        <th style="width:8%;">Qty</th>
        <th style="width:12%;">Unit Price</th>
        <th style="width:12%;">Amount</th>
        <th style="width:12%;">OR / Ref No.</th>
      </tr>
    </thead>
    <tbody>
      ${expenseRows}
    </tbody>
  </table>

  <div class="section-title">III. CERTIFICATION</div>
  <p style="font-size:10pt;margin-bottom:16pt; text-align:center;">
    This is to certify that the above liquidation report is true and correct<br>
    to the best of my knowledge and belief.
  </p>

  <table class="sign-table" style="width:100%; border-collapse:collapse; margin-top:12pt;">
    <tr>
      <td style="width:33%; text-align:center; border:none; padding-top:18pt;">
        <div style="width:80%;margin-bottom:5px auto 4pt auto;border-bottom:0.2mm solid #000;">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</div>
        <br>
        <div style="font-weight:bold;">Prepared by:</div>
        <div style="font-size:9pt;">Treasurer</div>
      </td>
      <td style="width:33%; text-align:center; border:none; padding-top:18pt;">
        <div style="width:80%;margin-bottom:5px auto 4pt auto;border-bottom:0.2mm solid #000;">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</div>
        <br>
        <div style="font-weight:bold;">Checked by:</div>
        <div style="font-size:9pt;">Organization President</div>
      </td>
      <td style="width:33%; text-align:center; border:none; padding-top:18pt;">
        <div style="width:80%;margin-bottom:5px auto 4pt auto;border-bottom:0.2mm solid #000;">&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</div>
        <br>
        <div style="font-weight:bold;">Approved by:</div>
        <div style="font-size:9pt;">Student Affairs Office</div>
      </td>
    </tr>
  </table>
  <span style="visibility:hidden;">Made By KIBP</span>
  `;
  }

  // ======================= BUILD LEDGER PDF CONTENT =======================
  function buildLedgerPDFContent(event, ledger) {
    const rows = ledger.length
      ? ledger.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHTML(r.date || '')}</td>
          <td>${escapeHTML(r.type || '')}</td>
          <td>${escapeHTML(r.desc || '')}</td>
          <td class="amount-cell">${r.credit ? '₱' + formatMoney(r.credit) : ''}</td>
          <td class="amount-cell">${r.debit ? '₱' + formatMoney(r.debit) : ''}</td>
          <td>${escapeHTML(r.reference || '')}</td>
          <td class="amount-cell">₱${formatMoney(r.balance || 0)}</td>
        </tr>
      `).join('')
      : `
        <tr>
          <td colspan="8" style="text-align:center;color:#666;padding:8pt;">
            No ledger entries.
          </td>
        </tr>
      `;

    const ayText = formatEventAcademicYear(event);
    const semLabel = getSemesterLabelForEvent(
      event.start_year,
      event.end_year,
      event.active_year != null
        ? event.active_year
        : (event.ay ? Number(event.ay) : null)
    ) || '—';

    return `
  <div class="report-header">
    <h2>EVENT LEDGER</h2>
  </div>

  <table class="meta-table" style="width:100%; border-collapse:collapse; margin-bottom:14pt;">
    <tr>
      <td style="width:50%; border:none; padding:0 4pt 4pt 0; font-size:9pt;">
        <strong>Event:</strong> ${escapeHTML(event.title || '')}<br>
        <strong>Organization:</strong> ${escapeHTML(event.org_label || 'General (Campus-Wide)')}<br>
        <strong>Date:</strong> ${escapeHTML(event.date || '—')}
      </td>
      <td style="width:50%; border:none; padding:0 0 4pt 4pt; font-size:9pt; text-align:right;">
        <strong>School Year:</strong> ${escapeHTML(event.sy || '—')}<br>
        <strong>Semester:</strong> ${escapeHTML(semLabel)}
      </td>
    </tr>
  </table>

  <table class="expenses-table">
    <thead>
      <tr>
        <th style="width:4%;">#</th>
        <th style="width:10%;">Date</th>
        <th style="width:12%;">Type</th>
        <th>Description</th>
        <th style="width:12%;">Credit</th>
        <th style="width:12%;">Debit</th>
        <th style="width:14%;">Reference</th>
        <th style="width:14%;">Running Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <span style="visibility:hidden;">Made By KIBP</span>
  `;
  }

  // ======================= PRINT WRAPPERS =======================
  function printLiquidation(event, credits, debits) {
    const content = buildEventLiquidationPDFContent(event, credits, debits);
    if (!content) {
      showToast('Nothing to print for this event.', 'warning');
      return;
    }
    sendPDFToServer(`Liquidation Report - ${event.title || ''}`, content, 'eventLiquidation');
  }

  function printLedger(event, ledger) {
    const content = buildLedgerPDFContent(event, ledger);
    if (!content) {
      showToast('Nothing to print for this event.', 'warning');
      return;
    }
    sendPDFToServer(`Ledger - ${event.title || ''}`, content, 'eventLedger');
  }

  // ============== Map server rows → client shapes (helpers) ==============
  function mapServerEventToClient(row){
    if (!row) return null;

    const scope = (row.scope || 'general').toLowerCase() === 'organization'
      ? 'organization'
      : 'general';

    const orgAbbr = row.organization_abbr
      || row.org_abbr
      || row.organization
      || row.department
      || '';

    const orgName = row.organization_name
      || row.org_name
      || row.org
      || row.org_full
      || '';

    const orgLabel = scope === 'general'
      ? 'General (Campus-Wide)'
      : (orgName || orgAbbr || 'Organization');

    // Try numeric fields first
    let startYear = row.start_year != null ? Number(row.start_year) : null;
    let endYear   = row.end_year   != null ? Number(row.end_year)   : null;

    // If missing, try to parse from school_year / sy strings
    if ((startYear == null || endYear == null) && (row.school_year || row.sy)) {
      const syText = String(row.school_year || row.sy);
      const m = syText.match(/(\d{4})\D+(\d{4})/);
      if (m) {
        startYear = Number(m[1]);
        endYear   = Number(m[2]);
      }
    }

    // Build sy text
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
      : (row.date
        || (row.created_at ? String(row.created_at).slice(0,10) : '')
      );

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
    // Try to get unit_price from different possible sources
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

  // ====================== Active Organizations loader ====================
  async function loadActiveOrganizations(){
    const r = await fetch('php/get-active-organizations.php', {credentials:'same-origin'});
    if (!r.ok) return [];
    const data = await r.json();
    let raw = [];
    if (Array.isArray(data)) raw = data;
    else if (Array.isArray(data.organizations)) raw = data.organizations;
    else if (Array.isArray(data.data)) raw = data.data;

    return raw
      .map(o => ({
        abbr:  o.abbreviation || o.abbr || '',
        name:  o.name || o.org_name || '',
        scope: o.scope || '',
        course: o.course_abbr || ''
      }))
      .filter(o => o.abbr);
  }

  function seedOrganizationOptions(_root, list){
    const sel = document.getElementById('aeDepartment');
    if (!sel) return;

    const role = currentUserRole;

    if (!list || !list.length) {
      sel.innerHTML =
        '<option value="" disabled selected>No active organizations</option>';
      sel.setAttribute('disabled', 'disabled');
      return;
    }

    sel.innerHTML =
      '<option value="" disabled>Select organization</option>' +
      list.map(o => {
        const label = o.name
          ? `${escapeHTML(o.abbr)} — ${escapeHTML(o.name)}`
          : escapeHTML(o.abbr);
        return `<option value="${escapeHTML(o.abbr)}">${label}</option>`;
      }).join('');

    if (role !== 'super-admin') {
      if (list.length === 1) {
        sel.value = list[0].abbr;
        sel.setAttribute('disabled', 'disabled');
      } else {
        sel.removeAttribute('disabled');
      }
    } else {
      sel.removeAttribute('disabled');
    }
  }

  // ============================== API (live) ===============================
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
        `php/event-list-events.php?${params.toString()}`,
        {credentials:'same-origin'}
      ).then(r=>r.json());
    },

    getEvent:  (id)   => fetch(
      `php/event-get-event.php?event_id=${encodeURIComponent(id)}`,
      {credentials:'same-origin'}
    ).then(r=>r.json()),

    createEvent: (payload) => fetch('php/event-create-event.php',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(r=>r.json()),

    addCredit:  (payload) => fetch('php/event-add-credit.php',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(r=>r.json()),

    // Supports BOTH: FormData (with file) and JSON (no file)
    addExpense: (payloadOrFormData) => {
      const opts = {
        method: 'POST',
        credentials: 'same-origin'
      };
      if (payloadOrFormData instanceof FormData) {
        // Let browser set multipart/form-data with boundary
        opts.body = payloadOrFormData;
      } else {
        opts.headers = {'Content-Type': 'application/json'};
        opts.body = JSON.stringify(payloadOrFormData || {});
      }
      return fetch('php/event-add-expense.php', opts).then(r => r.json());
    },
  };
})();
//super-admin