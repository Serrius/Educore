// records.js (SPA-safe, wired for your stack) - UPDATED FOR EVENT EXPENSES + mPDF + PAGINATION + FIXED SEMESTER HANDLING
;(function(){
  'use strict';

  // Support both old and new IDs (just in case)
  const PANEL_SEL   = '#recordsPage, #records-page';
  const ROUTE_MATCH = '[data-route="records"], [href="#records"]';
  let   lastRecordsSnap  = '';

  // ========================= In-Memory Store =============================
  const store = {
    records: /** @type {Array<RecordItem>} */ ([]),
    eventsData: /** @type {Object<string, EventWithDetails>} */ ({}), // New: store complete event data
    organizations: /** @type {Array<{abbr:string,name:string}>} */ ([]),
    currentPage: {
      orgFees: 1,
      eventExpenses: 1
    },
    pageSize: 5, // Records per page
    totalPages: {
      orgFees: 1,
      eventExpenses: 1
    },
    expandedEvents: /** @type {Set<string>} */ (new Set()), // Track which events are expanded
    filteredRecords: {
      orgFees: /** @type {Array<RecordItem>} */ ([]),
      eventExpenses: /** @type {Array<EventWithDetails>} */ ([])
    }
  };

  // Current user's role from localStorage
  const currentUserRole = (localStorage.getItem('role') || '').toLowerCase();
  
  // ========================= Academic Year State =========================
  const recordsActiveYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,      // null here means "All active years" for the selected SY
    baseStartYear: null,
    baseEndYear: null,
    baseActiveYear: null,
  };

  function recordsIsReadOnlyView() {
    const baseSy = recordsActiveYearState.baseStartYear;
    const baseEy = recordsActiveYearState.baseEndYear;
    const baseAy = recordsActiveYearState.baseActiveYear;

    // If no base AY configured, badge should never appear
    if (baseSy == null && baseEy == null && baseAy == null) return false;

    // Hide badge if ACTIVE YEAR = ALL
    if (recordsActiveYearState.activeYear == null) {
      return false;
    }

    // Hide badge when School Year = ALL
    if (
      recordsActiveYearState.startYear == null &&
      recordsActiveYearState.endYear == null
    ) {
      return false;
    }

    // Normal matching rules
    const sameSY =
      recordsActiveYearState.startYear === baseSy &&
      recordsActiveYearState.endYear === baseEy;

    const sameAY = recordsActiveYearState.activeYear === baseAy;

    return !(sameSY && sameAY);
  }

  function recordsUpdateReadOnlyUI(root) {
    const readOnly = recordsIsReadOnlyView();
    const badge = root.querySelector('#recordsReadOnlyBadge');
    
    if (badge) {
      badge.style.visibility = readOnly ? 'visible' : 'hidden';
    }
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

  async function loadRecordsActiveYear(root) {
    const apiBase = 'php/';
    const schoolYearEl     = root.querySelector('#recordsCurrentSchoolYear');
    const aySelect         = root.querySelector('#recordsAySelect');
    const activeYearSelect = root.querySelector('#recordsActiveYearSelect');

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
        console.error('[records] get-active-academic-year error:', e);
      }

      let active = null;
      if (activeRaw) {
        try {
          active = normalizeActiveAY(activeRaw);
          console.log('[records] Normalized active AY:', active);
        } catch (e) {
          console.warn('[records] normalizeActiveAY failed:', e);
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
          console.error('[records] Fallback AY loading error:', e2);
        }
      }

      if (active) {
        recordsActiveYearState.startYear = active.start_year;
        recordsActiveYearState.endYear = active.end_year;
        recordsActiveYearState.activeYear = active.active_year;
        recordsActiveYearState.baseStartYear = active.start_year;
        recordsActiveYearState.baseEndYear = active.end_year;
        recordsActiveYearState.baseActiveYear = active.active_year;
        recordsActiveYearState.schoolYearText = `${active.start_year}–${active.end_year}`;
        
        if (schoolYearEl) schoolYearEl.textContent = getStateAcademicYearLabel();
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
        console.error('[records] get-academic-years error:', e);
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
            const sel = (+a.start_year === +recordsActiveYearState?.startYear && +a.end_year === +recordsActiveYearState?.endYear) ? 'selected':'';
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
        const sy = recordsActiveYearState.startYear;
        const ey = recordsActiveYearState.endYear;

        if (sy == null && ey == null) {
          // All school years → AY selector disabled, just "All"
          activeYearSelect.innerHTML = '<option value="">All</option>';
          activeYearSelect.disabled = true;
        } else {
          let html = '';

          const selectedAll = recordsActiveYearState.activeYear == null ? 'selected' : '';
          html += `<option value="ALL" ${selectedAll}>All Semesters</option>`;

          if (sy) {
            html += `<option value="${sy}" ${
              recordsActiveYearState.activeYear === sy ? 'selected' : ''
            }>1st Semester</option>`;
          }
          if (ey && ey !== sy) {
            html += `<option value="${ey}" ${
              recordsActiveYearState.activeYear === ey ? 'selected' : ''
            }>2nd Semester</option>`;
          }
          activeYearSelect.innerHTML = html || '<option value="">—</option>';
          activeYearSelect.disabled = false;
        }
      }

      recordsUpdateReadOnlyUI(root);
    } catch (err) {
      console.error('[records] loadRecordsActiveYear error:', err);
      const schoolYearEl2 = schoolYearEl;
      const aySelect2 = aySelect;
      const activeYearSelect2 = activeYearSelect;
      if (schoolYearEl2) schoolYearEl2.textContent = 'Error loading AY';
      if (aySelect2) aySelect2.innerHTML = '<option value="ALL">All School Years</option>';
      if (activeYearSelect2) {
        activeYearSelect2.innerHTML = '<option value="">All</option>';
        activeYearSelect2.disabled = true;
      }
      recordsUpdateReadOnlyUI(root);
    }
  }

  // ========================= BOOT (your pattern) =========================
  document.addEventListener('DOMContentLoaded', () => {
    const initIfFound = () => {
      const panel = document.querySelector(PANEL_SEL);
      if (panel && !panel.dataset.recordsInit) {
        lastRecordsSnap = '';
        initRecords(panel);
        if (typeof refreshRecords === 'function') refreshRecords(panel);
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
  function initRecords(root){
    // Flag so we only init once per injection
    root.dataset.recordsInit = '1';

    // Cache nodes
    const orgFeesSearch = root.querySelector('#orgFeesSearch');
    const orgFeesOrgFilter = root.querySelector('#orgFeesOrgFilter');
    const orgFeesTbody = root.querySelector('#orgFeesTbody');
    const orgFeesPagination = root.querySelector('#orgFeesPagination');
    const orgFeesEmptyState = root.querySelector('#orgFeesEmptyState');

    const eventExpensesSearch = root.querySelector('#eventExpensesSearch');
    const eventExpensesOrgFilter = root.querySelector('#eventExpensesOrgFilter');
    const eventExpensesTbody = root.querySelector('#eventExpensesTbody');
    const eventExpensesPagination = root.querySelector('#eventExpensesPagination');
    const eventExpensesEmptyState = root.querySelector('#eventExpensesEmptyState');

    const aySelect = root.querySelector('#recordsAySelect');
    const activeYearSelect = root.querySelector('#recordsActiveYearSelect');
    const schoolYearEl = root.querySelector('#recordsCurrentSchoolYear');

    // Load organizations for filter
    loadOrganizations().then(orgs => {
      store.organizations = orgs;
      populateOrgFilter(orgFeesOrgFilter, orgs);
      populateOrgFilter(eventExpensesOrgFilter, orgs);
    });

    // Load AY info, then records
    loadRecordsActiveYear(root).then(() => {
      recordsUpdateReadOnlyUI(root);
      fetchAndRenderRecords();
    });

    // Event listeners for Organization Fees tab
    orgFeesSearch?.addEventListener('input', () => {
      store.currentPage.orgFees = 1;
      filterAndRenderOrgFees();
    });

    orgFeesOrgFilter?.addEventListener('change', () => {
      store.currentPage.orgFees = 1;
      filterAndRenderOrgFees();
    });

    // Event listeners for Event Expenses tab
    eventExpensesSearch?.addEventListener('input', () => {
      store.currentPage.eventExpenses = 1;
      filterAndRenderEventExpenses();
    });

    eventExpensesOrgFilter?.addEventListener('change', () => {
      store.currentPage.eventExpenses = 1;
      filterAndRenderEventExpenses();
    });

    // AY change listeners
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';

      if (val === 'ALL') {
        // Turn off AY filtering completely (all school years)
        recordsActiveYearState.startYear = null;
        recordsActiveYearState.endYear = null;
        recordsActiveYearState.activeYear = null;

        if (activeYearSelect) {
          activeYearSelect.innerHTML = '<option value="">All</option>';
          activeYearSelect.disabled = true;
        }
      } else {
        const [syRaw, eyRaw] = val.split('-');
        const sy = parseInt(syRaw, 10);
        const ey = parseInt(eyRaw, 10);

        recordsActiveYearState.startYear = !Number.isNaN(sy) ? sy : null;
        recordsActiveYearState.endYear   = !Number.isNaN(ey) ? ey : null;

        // If current active year is neither sy nor ey, default to sy
        if (
          recordsActiveYearState.activeYear !== sy &&
          recordsActiveYearState.activeYear !== ey
        ) {
          recordsActiveYearState.activeYear = sy || recordsActiveYearState.activeYear || null;
        }

        if (activeYearSelect) {
          let html = '';

          const selectedAll = recordsActiveYearState.activeYear == null ? 'selected' : '';
          html += `<option value="ALL" ${selectedAll}>All Semesters</option>`;

          if (!Number.isNaN(sy)) {
            html += `<option value="${sy}" ${
              recordsActiveYearState.activeYear === sy ? 'selected' : ''
            }>1st Semester</option>`;
          }
          if (!Number.isNaN(ey) && ey !== sy) {
            html += `<option value="${ey}" ${
              recordsActiveYearState.activeYear === ey ? 'selected' : ''
            }>2nd Semester</option>`;
          }
          activeYearSelect.innerHTML = html || '<option value="">—</option>';
          activeYearSelect.disabled = false;
        }
      }

      if (schoolYearEl) {
        schoolYearEl.textContent = getStateAcademicYearLabel();
      }

      recordsUpdateReadOnlyUI(root);
      store.currentPage.orgFees = 1;
      store.currentPage.eventExpenses = 1;
      store.expandedEvents.clear(); // Clear expanded events when changing AY
      fetchAndRenderRecords();
    });

    activeYearSelect?.addEventListener('change', () => {
      if (activeYearSelect.disabled) return;
      const val = activeYearSelect.value;

      if (val === 'ALL' || val === '') {
        // All active years within the selected SY
        recordsActiveYearState.activeYear = null;
      } else {
        const yr = parseInt(val, 10);
        if (!Number.isNaN(yr)) {
          recordsActiveYearState.activeYear = yr;
        }
      }

      if (schoolYearEl) {
        schoolYearEl.textContent = getStateAcademicYearLabel();
      }

      recordsUpdateReadOnlyUI(root);
      store.currentPage.orgFees = 1;
      store.currentPage.eventExpenses = 1;
      store.expandedEvents.clear(); // Clear expanded events when changing semester
      fetchAndRenderRecords();
    });

    // PDF Export Buttons
    document.getElementById('exportOrgFeesPdfBtn')?.addEventListener('click', () => exportToPDF('orgFees'));
    document.getElementById('exportEventExpensesPdfBtn')?.addEventListener('click', () => exportToPDF('eventExpenses'));

    // CSV Export Buttons
    document.getElementById('exportOrgFeesCsvBtn')?.addEventListener('click', () => exportToCSV('orgFees'));
    document.getElementById('exportEventExpensesCsvBtn')?.addEventListener('click', () => exportToCSV('eventExpenses'));

    // View details handler for organization fees
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="view-org-fee-details"]');
      if (btn) {
        const recordId = btn.getAttribute('data-id');
        const record = store.records.find(r => r.id === recordId && r.type === 'fee');
        if (record) {
          showOrgFeeDetails(record);
        }
        return;
      }
      
      // View event details handler
      const eventBtn = e.target.closest('[data-action="view-event-details"]');
      if (eventBtn) {
        const eventId = eventBtn.getAttribute('data-id');
        const event = store.eventsData[eventId];
        if (event) {
          showEventDetails(event);
        }
        return;
      }
      
      // Toggle event expansion handler
      const toggleBtn = e.target.closest('.toggle-event-details');
      if (toggleBtn) {
        const eventId = toggleBtn.getAttribute('data-event-id');
        if (eventId) {
          toggleEventExpansion(eventId);
        }
        return;
      }

      // Pagination click handlers
      const pageLink = e.target.closest('.page-link');
      if (pageLink && pageLink.hasAttribute('data-page')) {
        e.preventDefault();
        const page = parseInt(pageLink.getAttribute('data-page'));
        const isOrgFees = pageLink.closest('#orgFeesPagination');
        const isEventExpenses = pageLink.closest('#eventExpensesPagination');
        
        if (isOrgFees && page && page !== store.currentPage.orgFees) {
          store.currentPage.orgFees = page;
          filterAndRenderOrgFees();
        } else if (isEventExpenses && page && page !== store.currentPage.eventExpenses) {
          store.currentPage.eventExpenses = page;
          filterAndRenderEventExpenses();
        }
      }
    });

    // Helper: fetch records for current AY
    function fetchAndRenderRecords() {
      API.getRecords().then(data => {
        if (data?.success && Array.isArray(data.records)) {
          store.records = data.records.map(mapServerRecordToClient).filter(Boolean);
          
          // Load complete event data for events tab
          loadEventsData().then(() => {
            filterAndRenderOrgFees();
            filterAndRenderEventExpenses();
          });
        } else {
          store.records = [];
          store.eventsData = {};
          filterAndRenderOrgFees();
          filterAndRenderEventExpenses();
        }
      }).catch((error) => {
        console.error('Error fetching records:', error);
        store.records = [];
        store.eventsData = {};
        filterAndRenderOrgFees();
        filterAndRenderEventExpenses();
      });
    }

    function filterAndRenderOrgFees() {
      const searchTerm = (orgFeesSearch?.value || '').trim().toLowerCase();
      const orgFilterVal = orgFeesOrgFilter?.value || '';
      const sy = recordsActiveYearState.startYear;
      const ey = recordsActiveYearState.endYear;
      const ay = recordsActiveYearState.activeYear; // null = All active years

      // Filter by academic year and type (fee only)
      let filtered = store.records.filter(record => {
        const syMatch = !sy || record.start_year === sy;
        const eyMatch = !ey || record.end_year === ey;
        const ayMatch = ay == null || record.active_year === ay;
        const typeMatch = record.type === 'fee';
        
        return syMatch && eyMatch && ayMatch && typeMatch;
      });

      // Apply search and other filters
      if (searchTerm) {
        filtered = filtered.filter(record => 
          (record.receipt_no && record.receipt_no.toLowerCase().includes(searchTerm)) ||
          (record.payer_id_number && record.payer_id_number.toLowerCase().includes(searchTerm)) ||
          (record.payer_name && record.payer_name.toLowerCase().includes(searchTerm))
        );
      }

      if (orgFilterVal) {
        filtered = filtered.filter(record => record.organization_abbr === orgFilterVal);
      }

      // Store filtered records for pagination
      store.filteredRecords.orgFees = filtered;
      
      // Calculate total pages
      store.totalPages.orgFees = Math.ceil(filtered.length / store.pageSize);
      
      // Ensure current page is within bounds
      if (store.currentPage.orgFees > store.totalPages.orgFees) {
        store.currentPage.orgFees = Math.max(1, store.totalPages.orgFees);
      }

      renderOrgFeesTable(filtered);
      updateOrgFeesPagination();
      updateOrgFeesSummary(filtered);
    }

    function filterAndRenderEventExpenses() {
      const searchTerm = (eventExpensesSearch?.value || '').trim().toLowerCase();
      const orgFilterVal = eventExpensesOrgFilter?.value || '';
      const sy = recordsActiveYearState.startYear;
      const ey = recordsActiveYearState.endYear;
      const ay = recordsActiveYearState.activeYear; // null = All active years

      // Get all events from eventsData
      let events = Object.values(store.eventsData);

      // Filter by academic year
      events = events.filter(event => {
        const syMatch = !sy || event.start_year === sy;
        const eyMatch = !ey || event.end_year === ey;
        const ayMatch = ay == null || event.active_year === ay;
        return syMatch && eyMatch && ayMatch;
      });

      // Apply search and other filters
      if (searchTerm) {
        events = events.filter(event => 
          (event.title && event.title.toLowerCase().includes(searchTerm)) ||
          (event.organization && event.organization.toLowerCase().includes(searchTerm))
        );
      }

      if (orgFilterVal) {
        events = events.filter(event => event.organization_abbr === orgFilterVal);
      }

      // Store filtered events for pagination
      store.filteredRecords.eventExpenses = events;
      
      // Calculate total pages
      store.totalPages.eventExpenses = Math.ceil(events.length / store.pageSize);
      
      // Ensure current page is within bounds
      if (store.currentPage.eventExpenses > store.totalPages.eventExpenses) {
        store.currentPage.eventExpenses = Math.max(1, store.totalPages.eventExpenses);
      }

      renderEventExpensesTable(events);
      updateEventExpensesPagination();
      updateEventExpensesSummary(events);
    }

    function renderOrgFeesTable(filteredRecords) {
      if (!orgFeesTbody) return;
      
      const startIndex = (store.currentPage.orgFees - 1) * store.pageSize;
      const pageRecords = filteredRecords.slice(startIndex, startIndex + store.pageSize);
      
      if (pageRecords.length === 0) {
        orgFeesEmptyState?.classList.remove('d-none');
        orgFeesTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No organization fees found</td></tr>`;
        return;
      }
      
      orgFeesEmptyState?.classList.add('d-none');
      
      orgFeesTbody.innerHTML = pageRecords.map(record => `
        <tr>
          <td>${escapeHTML(record.date)}</td>
          <td>${escapeHTML(record.receipt_no || '—')}</td>
          <td>${escapeHTML(record.payer_id_number || '—')}</td>
          <td>${escapeHTML(record.payer_name || '—')}</td>
          <td>${escapeHTML(record.organization)}</td>
          <td class="text-end">${formatMoney(record.amount)}</td>
          <td>
            <span class="badge bg-success">
              Paid
            </span>
          </td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-primary" data-action="view-org-fee-details" data-id="${record.id}">
              <i class="bi bi-eye"> View</i>
            </button>
          </td>
        </tr>
      `).join('');
    }

    function renderEventExpensesTable(events) {
      if (!eventExpensesTbody) return;
      
      const startIndex = (store.currentPage.eventExpenses - 1) * store.pageSize;
      const pageEvents = events.slice(startIndex, startIndex + store.pageSize);
      
      if (pageEvents.length === 0) {
        eventExpensesEmptyState?.classList.remove('d-none');
        eventExpensesTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No events found</td></tr>`;
        return;
      }
      
      eventExpensesEmptyState?.classList.add('d-none');
      
      let html = '';
      pageEvents.forEach(event => {
        const isExpanded = store.expandedEvents.has(event.id);
        const totalCredits = event.credits.reduce((sum, credit) => sum + (credit.amount || 0), 0);
        const totalDebits = event.debits.reduce((sum, debit) => sum + (debit.amount || 0), 0);
        const balance = totalCredits - totalDebits;
        
        // Main event row
        html += `
          <tr class="event-summary-row">
            <td class="toggle-event-details" data-event-id="${event.id}" style="cursor: pointer;">
              <i class="bi bi-chevron-right event-details-icon ${isExpanded ? 'expanded' : ''}"></i>
            </td>
            <td>${escapeHTML(event.title)}</td>
            <td>${escapeHTML(event.organization)}</td>
            <td>${escapeHTML(event.date)}</td>
            <td class="text-end">${formatMoney(totalCredits)}</td>
            <td class="text-end">${formatMoney(totalDebits)}</td>
            <td class="text-end ${balance >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(balance)}</td>
            <td class="text-center">
              <span class="badge ${getEventStatusBadgeClass(event.status)}">
                ${escapeHTML(event.status)}
              </span>
            </td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline-primary" data-action="view-event-details" data-id="${event.id}">
                <i class="bi bi-eye"></i> Details
              </button>
            </td>
          </tr>
        `;
        
        // Expanded details row
        if (isExpanded) {
          html += `
            <tr class="event-row-details">
              <td colspan="9">
                <div class="p-3">
                  <h6 class="mb-3">Event Details</h6>
                  <div class="row mb-3">
                    <div class="col-md-6">
                      <div class="mb-2">
                        <span class="text-muted small">Location:</span>
                        <div>${escapeHTML(event.location || '—')}</div>
                      </div>
                      <div class="mb-2">
                        <span class="text-muted small">Scope:</span>
                        <div>${escapeHTML(event.scope === 'general' ? 'General (Campus-Wide)' : 'Organization')}</div>
                      </div>
                    </div>
                    <div class="col-md-6">
                      <div class="mb-2">
                        <span class="text-muted small">Academic Year:</span>
                        <div>${formatEventAcademicYear(event)}</div>
                      </div>
                      <div class="mb-2">
                        <span class="text-muted small">Organization Abbreviation:</span>
                        <div>${escapeHTML(event.organization_abbr || '—')}</div>
                      </div>
                    </div>
                  </div>
                  
                  <!-- Credits Section -->
                  <h6 class="mt-4 mb-2">Credits (Funds Received)</h6>
                  ${event.credits.length > 0 ? `
                  <div class="table-responsive">
                    <table class="table table-sm table-bordered">
                      <thead class="table-light">
                        <tr>
                          <th>Date</th>
                          <th>Source</th>
                          <th>Notes</th>
                          <th class="text-end">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${event.credits.map(credit => `
                          <tr>
                            <td>${escapeHTML(credit.date)}</td>
                            <td>${escapeHTML(credit.source)}</td>
                            <td>${escapeHTML(credit.notes || '')}</td>
                            <td class="text-end">${formatMoney(credit.amount)}</td>
                          </tr>
                        `).join('')}
                        <tr class="table-active">
                          <td colspan="3" class="text-end"><strong>Total Credits:</strong></td>
                          <td class="text-end"><strong>${formatMoney(totalCredits)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  ` : '<p class="text-muted">No credits recorded.</p>'}
                  
                  <!-- Debits Section (Expenses) -->
                  <h6 class="mt-4 mb-2">Debits (Expenses)</h6>
                  ${event.debits.length > 0 ? `
                  <div class="table-responsive">
                    <table class="table table-sm table-bordered">
                      <thead class="table-light">
                        <tr>
                          <th>Date</th>
                          <th>Category</th>
                          <th>Description</th>
                          <th class="text-center">Qty</th>
                          <th class="text-end">Unit Price</th>
                          <th class="text-end">Amount</th>
                          <th>Receipt No</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${event.debits.map(debit => `
                          <tr class="expense-item-row">
                            <td>${escapeHTML(debit.date)}</td>
                            <td>${escapeHTML(debit.category)}</td>
                            <td>${escapeHTML(debit.notes || '')}</td>
                            <td class="text-center">${debit.quantity || 1}</td>
                            <td class="text-end">${formatMoney(debit.unit_price)}</td>
                            <td class="text-end">${formatMoney(debit.amount)}</td>
                            <td>${escapeHTML(debit.receipt_number || '—')}</td>
                          </tr>
                        `).join('')}
                        <tr class="table-active">
                          <td colspan="5" class="text-end"><strong>Total Debits:</strong></td>
                          <td class="text-end"><strong>${formatMoney(totalDebits)}</strong></td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  ` : '<p class="text-muted">No expenses recorded.</p>'}
                  
                  <!-- Summary -->
                  <div class="alert ${balance >= 0 ? 'alert-success' : 'alert-danger'} mt-3">
                    <div class="row">
                      <div class="col-md-4">
                        <strong>Total Credits:</strong> ${formatMoney(totalCredits)}
                      </div>
                      <div class="col-md-4">
                        <strong>Total Debits:</strong> ${formatMoney(totalDebits)}
                      </div>
                      <div class="col-md-4">
                        <strong>Net Balance:</strong> ${formatMoney(balance)}
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }
      });
      
      eventExpensesTbody.innerHTML = html;
    }

    function toggleEventExpansion(eventId) {
      if (store.expandedEvents.has(eventId)) {
        store.expandedEvents.delete(eventId);
      } else {
        store.expandedEvents.add(eventId);
      }
      filterAndRenderEventExpenses();
    }

    function updateOrgFeesPagination() {
      if (!orgFeesPagination) return;
      
      const totalPages = store.totalPages.orgFees;
      const currentPage = store.currentPage.orgFees;
      
      if (totalPages <= 1) {
        orgFeesPagination.innerHTML = '';
        return;
      }
      
      let html = '';
      
      // Previous button
      if (currentPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a></li>`;
      } else {
        html += `<li class="page-item disabled"><a class="page-link" href="#" tabindex="-1">Previous</a></li>`;
      }
      
      // Page numbers
      const maxVisiblePages = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      
      for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
          html += `<li class="page-item active"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        } else {
          html += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
      }
      
      // Next button
      if (currentPage < totalPages) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage + 1}">Next</a></li>`;
      } else {
        html += `<li class="page-item disabled"><a class="page-link" href="#" tabindex="-1">Next</a></li>`;
      }
      
      orgFeesPagination.innerHTML = html;
    }

    function updateEventExpensesPagination() {
      if (!eventExpensesPagination) return;
      
      const totalPages = store.totalPages.eventExpenses;
      const currentPage = store.currentPage.eventExpenses;
      
      if (totalPages <= 1) {
        eventExpensesPagination.innerHTML = '';
        return;
      }
      
      let html = '';
      
      // Previous button
      if (currentPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a></li>`;
      } else {
        html += `<li class="page-item disabled"><a class="page-link" href="#" tabindex="-1">Previous</a></li>`;
      }
      
      // Page numbers
      const maxVisiblePages = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      
      for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
          html += `<li class="page-item active"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        } else {
          html += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
      }
      
      // Next button
      if (currentPage < totalPages) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${currentPage + 1}">Next</a></li>`;
      } else {
        html += `<li class="page-item disabled"><a class="page-link" href="#" tabindex="-1">Next</a></li>`;
      }
      
      eventExpensesPagination.innerHTML = html;
    }
  }

  // ========================= Helper Functions =========================
  async function loadEventsData() {
    try {
      const params = new URLSearchParams();
      
      if (recordsActiveYearState.startYear)
        params.set('start_year', String(recordsActiveYearState.startYear));
      if (recordsActiveYearState.endYear)
        params.set('end_year', String(recordsActiveYearState.endYear));
      if (recordsActiveYearState.activeYear)
        params.set('active_year', String(recordsActiveYearState.activeYear));

      const response = await fetch(`php/event-list-events.php?${params.toString()}`, {
        credentials: 'same-origin'
      });
      
      const data = await response.json();
      
      if (data?.success && Array.isArray(data.events)) {
        // Clear existing data
        store.eventsData = {};
        
        // Fetch details for each event
        const eventPromises = data.events.map(async (event) => {
          const eventId = event.id;
          try {
            const detailResponse = await fetch(`php/event-get-event.php?event_id=${encodeURIComponent(eventId)}`, {
              credentials: 'same-origin'
            });
            
            const detailData = await detailResponse.json();
            
            if (detailData) {
              const eventWithDetails = mapServerEventToFullEvent(event, detailData);
              store.eventsData[eventId] = eventWithDetails;
            }
          } catch (error) {
            console.error(`Error fetching details for event ${eventId}:`, error);
          }
        });
        
        await Promise.all(eventPromises);
      }
    } catch (error) {
      console.error('Error loading events data:', error);
    }
  }

  // ============ Academic Year + Semester formatting helpers ============
  function getSemesterLabelForYear(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return 'All Semesters';
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return `AY Segment ${activeYear}`;
  }

  // Used for header / export based on global state
  function getStateAcademicYearLabel() {
    const sy = recordsActiveYearState.startYear;
    const ey = recordsActiveYearState.endYear;
    const ay = recordsActiveYearState.activeYear;

    if (sy == null || ey == null) {
      return 'All School Years';
    }

    const range = `${sy}-${ey}`;
    const sem = getSemesterLabelForYear(sy, ey, ay);

    if (!sem) return `AY ${range}`;
    if (sem === 'All Semesters') return `AY ${range} – All Semesters`;
    return `${sem}, AY ${range}`;
  }

  // Used for individual records (modal + print view)
  function formatRecordAcademicYear(record) {
    const sy = record.start_year;
    const ey = record.end_year;
    const ay = record.active_year;

    if (sy == null || ey == null) {
      return record.academic_year || '—';
    }

    const range = `${sy}-${ey}`;
    const sem = getSemesterLabelForYear(sy, ey, ay);

    if (!sem) return `AY ${range}`;
    if (sem === 'All Semesters') return `AY ${range} – All Semesters`;
    return `${sem}, AY ${range}`;
  }

  // Used for event-level display
  function formatEventAcademicYear(event) {
    const sy = event.start_year;
    const ey = event.end_year;
    const ay = event.active_year;

    if (sy == null || ey == null) {
      return event.academic_year || '—';
    }

    const range = `${sy}-${ey}`;
    const sem = getSemesterLabelForYear(sy, ey, ay);

    if (!sem) return `AY ${range}`;
    if (sem === 'All Semesters') return `AY ${range} – All Semesters`;
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

  // ========================= PDF Export Function (UPDATED for mPDF) =========================
  function exportToPDF(tabType) {
    let title = '';
    let content = '';

    // Determine which tab we're exporting from
    switch (tabType) {
      case 'orgFees':
        title = 'Organization Fees Report';
        content = generateOrgFeesPDFContent();
        break;
      case 'eventExpenses':
        title = 'Event Expenses Report';
        content = generateEventExpensesPDFContent();
        break;
      default:
        showToast('Unknown export type.', 'warning');
        return;
    }

    if (!content) {
      showToast('Nothing to export for the current filters.', 'warning');
      return;
    }

    // Send HTML to mPDF endpoint (with letterhead configured server-side)
    sendPDFToServer(title, content, tabType);
  }

  function generateOrgFeesPDFContent() {
    const data = getFilteredOrgFees();
    const summary = calculateOrgFeesSummary(data);
    const ayText = getStateAcademicYearLabel();
    const nowText = new Date().toLocaleString();

    let content = `
      <div class="report-header">
        <h2>Organization Fees Report</h2>
        <div class="report-meta">
          <div><strong>Generated on:</strong> ${escapeHTML(nowText)}</div>
          <div><strong>Academic Year:</strong> ${escapeHTML(ayText)}</div>
        </div>
      </div>

      <div>
        <div class="section-title">Summary</div>
        <table class="summary-table">
          <tbody>
            <tr>
              <th>Total Fees</th>
              <td>${summary['Total Fees']}</td>
            </tr>
            <tr>
              <th>Total Amount</th>
              <td>${summary['Total Amount']}</td>
            </tr>
            <tr>
              <th>Paid Fees</th>
              <td>${summary['Paid Fees']}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <div class="section-title">Fee Details</div>
    `;

    if (!data.length) {
      content += `<p class="no-data">No organization fees found for the selected filters.</p>`;
    } else {
      content += `
        <table class="records-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt No</th>
              <th>Student ID</th>
              <th>Student Name</th>
              <th>Organization</th>
              <th class="text-end">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
      `;

      data.forEach(item => {
        content += `
          <tr>
            <td>${escapeHTML(item.date)}</td>
            <td>${escapeHTML(item.receipt_no || '—')}</td>
            <td>${escapeHTML(item.payer_id_number || '—')}</td>
            <td>${escapeHTML(item.payer_name || '—')}</td>
            <td>${escapeHTML(item.organization)}</td>
            <td class="text-end">${formatMoney(item.amount)}</td>
            <td>Paid</td>
          </tr>
        `;
      });

      content += `
          </tbody>
        </table>
      `;
    }

    content += `
      </div>

      <div class="footer-note">
        Generated via Records Module • ${escapeHTML(nowText)}
      </div>
    `;

    return content;
  }

  function generateEventExpensesPDFContent() {
    const events = getFilteredEventExpenses();
    const summary = calculateEventExpensesSummary(events);
    const ayText = getStateAcademicYearLabel();
    const nowText = new Date().toLocaleString();

    let content = `
      <div class="report-header">
        <h2>Event Expenses Report</h2>
        <div class="report-meta">
          <div><strong>Generated on:</strong> ${escapeHTML(nowText)}</div>
          <div><strong>Academic Year:</strong> ${escapeHTML(ayText)}</div>
        </div>
      </div>

      <div>
        <div class="section-title">Summary</div>
        <table class="summary-table">
          <tbody>
            <tr>
              <th>Total Events</th>
              <td>${summary['Total Events']}</td>
            </tr>
            <tr>
              <th>Total Credits</th>
              <td>${summary['Total Credits']}</td>
            </tr>
            <tr>
              <th>Total Debits</th>
              <td>${summary['Total Debits']}</td>
            </tr>
            <tr>
              <th>Net Balance</th>
              <td>${summary['Net Balance']}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    if (!events.length) {
      content += `<p class="no-data">No events found for the selected filters.</p>`;
    } else {
      events.forEach((event, index) => {
        const totalCredits = event.credits.reduce((sum, credit) => sum + (credit.amount || 0), 0);
        const totalDebits = event.debits.reduce((sum, debit) => sum + (debit.amount || 0), 0);
        const balance = totalCredits - totalDebits;
        const semLabel = getSemesterLabelForEvent(
          event.start_year,
          event.end_year,
          event.active_year != null ? event.active_year : (event.ay ? Number(event.ay) : null)
        ) || '—';

        content += `
          <div style="page-break-inside: avoid;">
            <div class="section-title">Event ${index + 1}: ${escapeHTML(event.title)}</div>
            
            <table class="meta-table" style="width:100%; border-collapse:collapse; margin-bottom:8pt;">
              <tr>
                <td style="width:50%; border:none; padding:0 4pt 4pt 0; font-size:9pt;">
                  <div><strong>Event:</strong> ${escapeHTML(event.title || '')}</div>
                  <div><strong>Organization:</strong> ${escapeHTML(event.organization || 'General (Campus-Wide)')}</div>
                  <div><strong>Venue:</strong> ${escapeHTML(event.location || '—')}</div>
                </td>
                <td style="width:50%; border:none; padding:0 0 4pt 4pt; font-size:9pt; text-align:right;">
                  <div><strong>Date:</strong> ${escapeHTML(event.date || '—')}</div>
                  <div><strong>School Year:</strong> ${escapeHTML(event.sy || '—')}</div>
                  <div><strong>Semester:</strong> ${escapeHTML(semLabel)}</div>
                </td>
              </tr>
            </table>

            <div style="margin: 8px 0;">
              <strong>Total Funds Received:</strong> ${formatMoney(totalCredits)} | 
              <strong>Total Expenses:</strong> ${formatMoney(totalDebits)} | 
              <strong>Remaining Balance:</strong> ${formatMoney(balance)}
            </div>
        `;

        // Credits table
        if (event.credits.length > 0) {
          content += `
            <div style="margin: 12px 0 4px 0;"><strong>Funds Received:</strong></div>
            <table class="expenses-table">
              <thead>
                <tr>
                  <th style="width:15%;">Date</th>
                  <th style="width:25%;">Source</th>
                  <th style="width:40%;">Notes</th>
                  <th style="width:20%;">Amount</th>
                </tr>
              </thead>
              <tbody>
          `;

          event.credits.forEach(credit => {
            content += `
              <tr>
                <td>${escapeHTML(credit.date)}</td>
                <td>${escapeHTML(credit.source)}</td>
                <td>${escapeHTML(credit.notes || '')}</td>
                <td style="text-align:right;">${formatMoney(credit.amount)}</td>
              </tr>
            `;
          });

          content += `
                <tr>
                  <td colspan="3" style="text-align:right; font-weight:bold;">Total Credits:</td>
                  <td style="text-align:right; font-weight:bold;">${formatMoney(totalCredits)}</td>
                </tr>
              </tbody>
            </table>
          `;
        }

        // Debits table (like liquidation report)
        if (event.debits.length > 0) {
          content += `
            <div style="margin: 12px 0 4px 0;"><strong>Expenses:</strong></div>
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
          `;

          event.debits.forEach((debit, idx) => {
            content += `
              <tr>
                <td>${idx + 1}</td>
                <td>${escapeHTML(debit.date)}</td>
                <td>${escapeHTML(debit.category)}</td>
                <td>${escapeHTML(debit.notes || '')}</td>
                <td style="text-align:center;">${debit.quantity || 1}</td>
                <td style="text-align:right;">${formatMoney(debit.unit_price)}</td>
                <td style="text-align:right;">${formatMoney(debit.amount)}</td>
                <td>${escapeHTML(debit.receipt_number || '')}</td>
              </tr>
            `;
          });

          content += `
                <tr>
                  <td colspan="6" style="text-align:right; font-weight:bold;">Total Expenses:</td>
                  <td style="text-align:right; font-weight:bold;">${formatMoney(totalDebits)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          `;
        }

        content += `
          </div>
          ${index < events.length - 1 ? '<hr style="margin: 20px 0;">' : ''}
        `;
      });
    }

    content += `
      <div class="footer-note">
        Generated via Records Module • ${escapeHTML(nowText)}
      </div>
    `;

    return content;
  }

  // ========================= CSV Export Function =========================
  function exportToCSV(tabType) {
    let data = [];
    let headers = [];
    let filename = '';

    // Determine which tab we're exporting from (respecting filters)
    switch(tabType) {
      case 'orgFees':
        data = getFilteredOrgFees();
        headers = ['Date', 'Receipt No', 'Student ID', 'Student Name', 'Organization', 'Amount', 'Status'];
        filename = `org_fees_${recordsActiveYearState.startYear || 'ALL'}-${recordsActiveYearState.endYear || 'ALL'}_${Date.now()}.csv`;
        break;
      case 'eventExpenses':
        // For event expenses CSV, we'll flatten the data
        data = getFlattenedEventExpensesForCSV();
        headers = ['Event', 'Organization', 'Date', 'Item Type', 'Item Description', 'Quantity', 'Unit Price', 'Amount', 'Receipt No', 'Status'];
        filename = `event_expenses_${recordsActiveYearState.startYear || 'ALL'}-${recordsActiveYearState.endYear || 'ALL'}_${Date.now()}.csv`;
        break;
      default:
        showToast('Unknown export type.', 'warning');
        return;
    }

    // Convert data to CSV
    const csvContent = convertToCSV(data, headers, tabType);
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('CSV export completed successfully!', 'success');
  }

  function getFlattenedEventExpensesForCSV() {
    const events = getFilteredEventExpenses();
    const flattened = [];
    
    events.forEach(event => {
      const totalCredits = event.credits.reduce((sum, credit) => sum + (credit.amount || 0), 0);
      const totalDebits = event.debits.reduce((sum, debit) => sum + (debit.amount || 0), 0);
      
      // Add event summary row
      flattened.push({
        Event: event.title,
        Organization: event.organization,
        Date: event.date,
        'Item Type': 'EVENT SUMMARY',
        'Item Description': 'Total Funds and Expenses',
        Quantity: '',
        'Unit Price': '',
        Amount: '',
        'Receipt No': '',
        Status: event.status,
        _isSummary: true
      });
      
      // Add credits rows
      event.credits.forEach(credit => {
        flattened.push({
          Event: event.title,
          Organization: event.organization,
          Date: credit.date,
          'Item Type': 'CREDIT',
          'Item Description': `${credit.source} - ${credit.notes || ''}`,
          Quantity: '',
          'Unit Price': '',
          Amount: formatMoneyForExport(credit.amount),
          'Receipt No': '',
          Status: event.status
        });
      });
      
      // Add debits rows
      event.debits.forEach(debit => {
        flattened.push({
          Event: event.title,
          Organization: event.organization,
          Date: debit.date,
          'Item Type': 'DEBIT',
          'Item Description': `${debit.category} - ${debit.notes || ''}`,
          Quantity: debit.quantity || 1,
          'Unit Price': formatMoneyForExport(debit.unit_price),
          Amount: formatMoneyForExport(debit.amount),
          'Receipt No': debit.receipt_number || '',
          Status: event.status
        });
      });
      
      // Add totals row
      flattened.push({
        Event: event.title,
        Organization: event.organization,
        Date: '',
        'Item Type': 'TOTALS',
        'Item Description': `Credits: ${formatMoneyForExport(totalCredits)} | Debits: ${formatMoneyForExport(totalDebits)} | Balance: ${formatMoneyForExport(totalCredits - totalDebits)}`,
        Quantity: '',
        'Unit Price': '',
        Amount: '',
        'Receipt No': '',
        Status: event.status
      });
      
      // Add separator
      flattened.push({
        Event: '',
        Organization: '',
        Date: '',
        'Item Type': '',
        'Item Description': '',
        Quantity: '',
        'Unit Price': '',
        Amount: '',
        'Receipt No': '',
        Status: ''
      });
    });
    
    return flattened;
  }

  function convertToCSV(data, headers, tabType) {
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.join(','));
    
    // Add data rows
    data.forEach(item => {
      const row = getRowDataForExport(item, tabType);
      // Escape CSV special characters and wrap in quotes if needed
      const escapedRow = row.map(cell => {
        const str = String(cell ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csvRows.push(escapedRow.join(','));
    });
    
    return csvRows.join('\n');
  }

  function getRowDataForExport(item, tabType) {
    switch(tabType) {
      case 'orgFees':
        return [
          item.date || '—',
          item.receipt_no || '—',
          item.payer_id_number || '—',
          item.payer_name || '—',
          item.organization || '—',
          formatMoneyForExport(item.amount),
          'Paid'
        ];
      case 'eventExpenses':
        // For flattened event expenses
        return [
          item.Event || '—',
          item.Organization || '—',
          item.Date || '—',
          item['Item Type'] || '—',
          item['Item Description'] || '—',
          item.Quantity || '',
          item['Unit Price'] || '',
          item.Amount || '',
          item['Receipt No'] || '—',
          item.Status || '—'
        ];
      default:
        return [];
    }
  }

  function formatMoneyForExport(amount) {
    return '₱' + (Number(amount)||0).toFixed(2);
  }

  // Helper functions for export
  function getFilteredOrgFees() {
    return store.filteredRecords.orgFees || [];
  }

  function getFilteredEventExpenses() {
    return store.filteredRecords.eventExpenses || [];
  }

  // ========================= Summary Calculations =========================
  function calculateOrgFeesSummary(filteredRecords) {
    const totalFees = filteredRecords.length;
    const totalAmount = filteredRecords.reduce((sum, record) => sum + record.amount, 0);
    const paidCount = filteredRecords.length; // All are paid now
    
    return {
      'Total Fees': totalFees,
      'Total Amount': formatMoney(totalAmount),
      'Paid Fees': paidCount
    };
  }

  function calculateEventExpensesSummary(filteredEvents) {
    const totalEvents = filteredEvents.length;
    const totalCredits = filteredEvents.reduce((sum, event) => 
      sum + event.credits.reduce((creditSum, credit) => creditSum + (credit.amount || 0), 0), 0);
    const totalDebits = filteredEvents.reduce((sum, event) => 
      sum + event.debits.reduce((debitSum, debit) => debitSum + (debit.amount || 0), 0), 0);
    const netBalance = totalCredits - totalDebits;
    
    return {
      'Total Events': totalEvents,
      'Total Credits': formatMoney(totalCredits),
      'Total Debits': formatMoney(totalDebits),
      'Net Balance': formatMoney(netBalance)
    };
  }

  // ========================= Update Summary Displays =====================
  function updateOrgFeesSummary(filteredRecords) {
    const summary = calculateOrgFeesSummary(filteredRecords);
    
    document.getElementById('orgFeesTotal').textContent = summary['Total Fees'];
    document.getElementById('orgFeesAmount').textContent = summary['Total Amount'];
    document.getElementById('orgFeesPaid').textContent = summary['Paid Fees'];
  }

  function updateEventExpensesSummary(filteredEvents) {
    const summary = calculateEventExpensesSummary(filteredEvents);

    document.getElementById('eventExpensesTotal').textContent = summary['Total Events'];
    document.getElementById('eventExpensesCredits').textContent = summary['Total Credits'];
    document.getElementById('eventExpensesDebits').textContent = summary['Total Debits'];
    document.getElementById('eventExpensesBalance').textContent = summary['Net Balance'];
    
    // Color code the balance
    const balanceEl = document.getElementById('eventExpensesBalance');
    const balance = parseFloat(summary['Net Balance'].replace('₱','').replace(/,/g,''));
    
    balanceEl.className = 'h5 mb-0';
    if (balance > 0) {
      balanceEl.classList.add('text-success');
    } else if (balance < 0) {
      balanceEl.classList.add('text-danger');
    }
  }

  // Optional external refresh (parity with your pattern)
  function refreshRecords(_root){ /* no-op placeholder */ }

  // ========================= Show Record Details =========================
  function showOrgFeeDetails(record) {
    const modal = document.getElementById('recordDetailsModal');
    const content = document.getElementById('recordDetailsContent');
    const title = document.getElementById('recordDetailsLabel');
    const printBtn = document.getElementById('recordPrintBtn');
    
    if (!modal || !content || !title) return;
    
    title.textContent = `Organization Fee Details`;
    const ayDisplay = formatRecordAcademicYear(record);
    
    const detailsHtml = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="mb-2">
            <span class="text-muted small">Date</span>
            <div>${escapeHTML(record.date)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Receipt No</span>
            <div>${escapeHTML(record.receipt_no || '—')}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Student ID</span>
            <div>${escapeHTML(record.payer_id_number || '—')}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Student Name</span>
            <div>${escapeHTML(record.payer_name || '—')}</div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-2">
            <span class="text-muted small">Organization</span>
            <div>${escapeHTML(record.organization)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Amount</span>
            <div class="fw-bold">${formatMoney(record.amount)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Status</span>
            <div><span class="badge bg-success">Paid</span></div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Academic Year</span>
            <div>${escapeHTML(ayDisplay)}</div>
          </div>
        </div>
      </div>
    `;
    
    content.innerHTML = detailsHtml;
    
    // Set up print button
    if (printBtn) {
      printBtn.onclick = () => printOrgFeeReceipt(record);
    }
    
    // Show modal
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  function showEventDetails(event) {
    const modal = document.getElementById('eventDetailsModal');
    const content = document.getElementById('eventDetailsContent');
    const title = document.getElementById('eventDetailsLabel');
    const printBtn = document.getElementById('eventPrintBtn');
    
    if (!modal || !content || !title) return;
    
    title.textContent = `Event Details - ${escapeHTML(event.title)}`;
    
    const totalCredits = event.credits.reduce((sum, credit) => sum + (credit.amount || 0), 0);
    const totalDebits = event.debits.reduce((sum, debit) => sum + (debit.amount || 0), 0);
    const balance = totalCredits - totalDebits;
    const ayDisplay = formatEventAcademicYear(event);
    
    const detailsHtml = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="mb-2">
            <span class="text-muted small">Event Title</span>
            <div class="fw-bold">${escapeHTML(event.title)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Organization</span>
            <div>${escapeHTML(event.organization)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Date</span>
            <div>${escapeHTML(event.date)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Location</span>
            <div>${escapeHTML(event.location || '—')}</div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-2">
            <span class="text-muted small">Scope</span>
            <div>${escapeHTML(event.scope === 'general' ? 'General (Campus-Wide)' : 'Organization')}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Academic Year</span>
            <div>${escapeHTML(ayDisplay)}</div>
          </div>
          <div class="mb-2">
            <span class="text-muted small">Status</span>
            <div><span class="badge ${getEventStatusBadgeClass(event.status)}">${escapeHTML(event.status)}</span></div>
          </div>
        </div>
      </div>
      
      <div class="row mt-4">
        <div class="col-12">
          <div class="alert ${balance >= 0 ? 'alert-success' : 'alert-danger'}">
            <div class="row">
              <div class="col-md-4">
                <strong>Total Credits:</strong> ${formatMoney(totalCredits)}
              </div>
              <div class="col-md-4">
                <strong>Total Debits:</strong> ${formatMoney(totalDebits)}
              </div>
              <div class="col-md-4">
                <strong>Net Balance:</strong> ${formatMoney(balance)}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Credits Section -->
      <h6 class="mt-4 mb-2">Credits (Funds Received)</h6>
      ${event.credits.length > 0 ? `
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Notes</th>
              <th class="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${event.credits.map(credit => `
              <tr>
                <td>${escapeHTML(credit.date)}</td>
                <td>${escapeHTML(credit.source)}</td>
                <td>${escapeHTML(credit.notes || '')}</td>
                <td class="text-end">${formatMoney(credit.amount)}</td>
              </tr>
            `).join('')}
            <tr class="table-active">
              <td colspan="3" class="text-end"><strong>Total Credits:</strong></td>
              <td class="text-end"><strong>${formatMoney(totalCredits)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : '<p class="text-muted">No credits recorded.</p>'}
      
      <!-- Debits Section (Expenses) -->
      <h6 class="mt-4 mb-2">Debits (Expenses)</h6>
      ${event.debits.length > 0 ? `
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th class="text-center">Qty</th>
              <th class="text-end">Unit Price</th>
              <th class="text-end">Amount</th>
              <th>Receipt No</th>
            </tr>
          </thead>
          <tbody>
            ${event.debits.map(debit => `
              <tr>
                <td>${escapeHTML(debit.date)}</td>
                <td>${escapeHTML(debit.category)}</td>
                <td>${escapeHTML(debit.notes || '')}</td>
                <td class="text-center">${debit.quantity || 1}</td>
                <td class="text-end">${formatMoney(debit.unit_price)}</td>
                <td class="text-end">${formatMoney(debit.amount)}</td>
                <td>${escapeHTML(debit.receipt_number || '—')}</td>
              </tr>
            `).join('')}
            <tr class="table-active">
              <td colspan="5" class="text-end"><strong>Total Debits:</strong></td>
              <td class="text-end"><strong>${formatMoney(totalDebits)}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      ` : '<p class="text-muted">No expenses recorded.</p>'}
    `;
    
    content.innerHTML = detailsHtml;
    
    // Set up print button for liquidation report (now via mPDF)
    if (printBtn) {
      printBtn.onclick = () => printEventLiquidation(event);
    }
    
    // Show modal
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  // ========================= Print / PDF Functions =========================

  function printOrgFeeReceipt(record) {
    const url = `php/records-print-org-fee.php?payment_id=${encodeURIComponent(record.id)}`;
    window.open(url, '_blank');
  }

  // ======================= BUILD LIQUIDATION CONTENT (mPDF) =======================
  function buildEventLiquidationPDFContent(event) {
    // In records.js, credits/debits are stored on the event object
    const credits = Array.isArray(event.credits) ? event.credits : [];
    const debits  = Array.isArray(event.debits)  ? event.debits  : [];

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
          <td style="text-align:right;">${formatMoney((d.amount || 0) / (d.quantity || 1 || 1))}</td>
          <td style="text-align:right;">${formatMoney(d.amount || 0)}</td>
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
        <td class="amount-cell">${formatMoney(totalCredits)}</td>
      </tr>
      <tr>
        <th>Total Expenses</th>
        <td class="amount-cell">${formatMoney(totalDebits)}</td>
      </tr>
      <tr>
        <th>Remaining Balance / (Deficit)</th>
        <td class="amount-cell">${formatMoney(balance)}</td>
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

  function printEventLiquidation(event) {
    const title = `Liquidation Report - ${event.title || ''}`;
    const content = buildEventLiquidationPDFContent(event);
    if (!content) {
      showToast('Nothing to print for this event.', 'warning');
      return;
    }
    // Use the same mPDF endpoint / letterhead as the other exports
    sendPDFToServer(title, content, 'eventLiquidation');
  }

  // =============================== Utils =================================
  function escapeHTML(s){
    return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
    }[c]));
  }

  function formatMoney(n){
    return '₱' + (Number(n)||0).toLocaleString('en-PH', {
        minimumFractionDigits:2,
        maximumFractionDigits:2
    });
  }

  function getTypeBadgeClass(type) {
    const typeMap = {
      'fee': 'bg-primary',
      'credit': 'bg-warning text-dark',
      'debit': 'bg-danger'
    };
    return typeMap[type] || 'bg-secondary';
  }

  function getEventStatusBadgeClass(status) {
    const statusMap = {
      'Draft': 'bg-secondary',
      'Submitted': 'bg-info',
      'Approved': 'bg-success',
      'Declined': 'bg-danger',
      'Completed': 'bg-primary'
    };
    return statusMap[status] || 'bg-secondary';
  }

  function getSemesterLabelForEvent(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    if (activeYear == null) return null;
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return null;
  }

  function showToast(message, type = 'info') {
    const toastEl = document.getElementById('recordsToast');
    const toastMsg = document.getElementById('recordsToastMsg');
    
    if (!toastEl || !toastMsg) return;
    
    // Update toast appearance based on type
    toastEl.className = `toast align-items-center text-bg-${type === 'warning' ? 'warning' : type === 'error' ? 'danger' : 'dark'} border-0`;
    toastMsg.textContent = message;
    
    // Show toast
    bootstrap.Toast.getOrCreateInstance(toastEl).show();
  }

  // ====================== Organizations loader ====================
  async function loadOrganizations(){
    try {
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
          logo_path: o.logo_path || o.logo || '' 
        }))
        .filter(o => o.abbr);
    } catch (e) {
      console.error('[records] Error loading organizations:', e);
      return [];
    }
  }

  function populateOrgFilter(selectEl, orgs) {
    if (!selectEl) return;
    
    let html = '';

    if (!orgs || !orgs.length) {
      // No orgs at all
      html = '<option value="">No Organizations</option>';
      selectEl.innerHTML = html;
      return;
    }

    // Only SUPER-ADMIN gets "All Organizations"
    if (currentUserRole === 'super-admin' || currentUserRole === 'special-admin') {
      html += '<option value="">All Organizations</option>';
    }

    orgs.forEach(org => {
      html += `<option value="${escapeHTML(org.abbr)}">${escapeHTML(org.name)}</option>`;
    });
    
    selectEl.innerHTML = html;
  }

  // ============== Map server records → client shapes (helpers) ===========
  function mapServerRecordToClient(row) {
    if (!row) return null;
    
    // The PHP already returns record_type field, so use it directly
    const type = row.record_type || 'unknown';
    
    // Format academic year
    const academic_year = row.start_year && row.end_year 
      ? `${row.start_year}-${row.end_year}` 
      : '—';
    
    // Create description based on record type
    let description = row.description || '—';
    
    // Change status from 'confirmed' to 'paid' for fee records
    let status = row.status || 'confirmed';
    if (type === 'fee' && status === 'confirmed') {
      status = 'paid';
    }
    
    // Create additional info object
    const additional_info = {};
    if (row.payer_id_number) additional_info['Payer ID'] = row.payer_id_number;
    if (row.full_name)      additional_info['Payer Name'] = row.full_name;
    if (row.receipt_no)     additional_info['Receipt No'] = row.receipt_no;
    if (row.payment_method) additional_info['Payment Method'] = row.payment_method;
    if (row.notes)          additional_info['Notes'] = row.notes;
    if (row.quantity && row.quantity > 1) additional_info['Quantity'] = row.quantity;
    
    return {
      id: String(row.id),
      date: row.date ? row.date.split(' ')[0] : '—', // Remove time part if exists
      type: type,
      organization: row.organization_name || '—',
      organization_abbr: row.organization_abbr || '',
      description: description,
      amount: Number(row.amount || 0),
      status: status,
      academic_year,
      start_year: row.start_year ? Number(row.start_year) : null,
      end_year: row.end_year ? Number(row.end_year) : null,
      active_year: row.active_year ? Number(row.active_year) : null,
      receipt_no: row.receipt_no || null,
      payer_id_number: row.payer_id_number || null,
      payer_name: row.full_name || null,
      event_id: row.event_id || null,
      event_name: row.event_name || null,
      receipt_number: row.receipt_number || null,
      quantity: row.quantity || 1,
      additional_info: Object.keys(additional_info).length > 0 ? additional_info : null
    };
  }

  function mapServerEventToFullEvent(eventRow, detailData) {
    // Extract credits and debits from detailData
    const credits = Array.isArray(detailData.credits)
      ? detailData.credits
      : (Array.isArray(detailData.data?.credits) ? detailData.data.credits : []);
    
    const debits = Array.isArray(detailData.debits)
      ? detailData.debits
      : (Array.isArray(detailData.data?.debits) ? detailData.data.debits : []);
    
    // Map event data
    const scope = (eventRow.scope || 'general').toLowerCase() === 'organization'
      ? 'organization'
      : 'general';
    
    const orgAbbr = eventRow.organization_abbr
      || eventRow.org_abbr
      || eventRow.organization
      || eventRow.department
      || '';
    
    const orgName = eventRow.organization_name
      || eventRow.org_name
      || eventRow.org
      || eventRow.org_full
      || '';
    
    const orgLabel = scope === 'general'
      ? 'General (Campus-Wide)'
      : (orgName || orgAbbr || 'Organization');
    
    // Parse academic year
    let startYear = eventRow.start_year != null ? Number(eventRow.start_year) : null;
    let endYear   = eventRow.end_year   != null ? Number(eventRow.end_year)   : null;
    
    if ((startYear == null || endYear == null) && (eventRow.school_year || eventRow.sy)) {
      const syText = String(eventRow.school_year || eventRow.sy);
      const m = syText.match(/(\d{4})\D+(\d{4})/);
      if (m) {
        startYear = Number(m[1]);
        endYear   = Number(m[2]);
      }
    }
    
    // Build sy text
    let syText = '';
    if (eventRow.sy) syText = eventRow.sy;
    else if (eventRow.school_year) syText = eventRow.school_year;
    else if (startYear && endYear) syText = `SY ${startYear}-${endYear}`;
    
    const activeYearNum = eventRow.active_year != null
      ? Number(eventRow.active_year)
      : (eventRow.ay != null ? Number(eventRow.ay) : null);
    
    const ay = activeYearNum != null ? String(activeYearNum) : '';
    
    const date = eventRow.event_date
      ? String(eventRow.event_date).slice(0,10)
      : (eventRow.date
        || (eventRow.created_at ? String(eventRow.created_at).slice(0,10) : '')
      );
    
    return {
      id: String(eventRow.id),
      title: eventRow.title || '',
      location: eventRow.location || '',
      scope,
      organization_abbr: orgAbbr || null,
      organization: orgLabel,
      date,
      sy: syText,
      ay,
      start_year: startYear,
      end_year: endYear,
      active_year: activeYearNum,
      status: eventRow.status || 'Draft',
      credits: credits.map(credit => ({
        id: String(credit.id),
        eventId: String(credit.event_id),
        date: credit.credit_date || credit.date || '',
        source: credit.source || '',
        notes: credit.notes || '',
        amount: Number(credit.amount || 0)
      })),
      debits: debits.map(debit => {
        const unitPrice = debit.unit_price 
          ? Number(debit.unit_price) 
          : (debit.calculated_unit_price ? Number(debit.calculated_unit_price) : 
            (debit.amount && debit.quantity ? Number(debit.amount) / Math.max(Number(debit.quantity), 1) : 0));
        
        return {
          id: String(debit.id),
          eventId: String(debit.event_id),
          date: debit.debit_date || debit.date || '',
          category: debit.category || '',
          notes: debit.notes || '',
          amount: Number(debit.amount || 0),
          unit_price: unitPrice,
          quantity: Number(debit.quantity || 1),
          receipt_number: debit.receipt_number || ''
        };
      })
    };
  }

  // ============================== API ====================================
  const API = {
    getRecords: () => {
      const params = new URLSearchParams();
      
      // Only send AY filters if not "All School Years"
      if (recordsActiveYearState.startYear != null)
        params.set('start_year', String(recordsActiveYearState.startYear));
      if (recordsActiveYearState.endYear != null)
        params.set('end_year', String(recordsActiveYearState.endYear));
      if (recordsActiveYearState.activeYear != null)
        params.set('active_year', String(recordsActiveYearState.activeYear));

      const qs = params.toString();
      const url = qs
        ? `php/get-records.php?${qs}`
        : 'php/get-records.php';

      return fetch(
        url,
        {credentials:'same-origin'}
      ).then(r => {
        if (!r.ok) throw new Error('Failed to fetch records');
        return r.json();
      }).then(data => {
        if (!data.success) {
          throw new Error(data.message || 'Failed to fetch records');
        }
        return data;
      });
    },
  };
})();
//Details