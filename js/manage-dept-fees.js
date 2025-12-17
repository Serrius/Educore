// manage-dept-fees.js  (SPA-safe; initializes when #dept-fees is injected into #content-area)

(() => {
  // Optional: flip this on in the console to see filtering details
  // window.DEPT_FEES_DEBUG = 1;
  window.DEPT_FEES_DEBUG = window.DEPT_FEES_DEBUG ?? 0;

  // ===== utils =====
  const _esc = (s)=>String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  async function fetchJSON(url, options={}) {
    const r = await fetch(url, { credentials:'include', cache:'no-store', ...options });
    const t = await r.text(); let d=null; try{ d=JSON.parse(t)}catch{}
    if(!r.ok){
      let msg = (d && (d.error || d.message)) || `HTTP ${r.status}`;
      if (d && d.detail) msg += ` — ${d.detail}`;
      const e=new Error(msg); e.data=d; throw e;
    }
    return d;
  }
  const money = (n,c='PHP') =>
    `${c} ${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const statusBadge = (s)=>{
    s=String(s||'').toLowerCase();
    if(s==='pending') return 'text-bg-warning';
    if(s==='accredited') return 'text-bg-success';
    if(s==='reaccredited') return 'text-bg-primary';
    if(s==='declined') return 'text-bg-danger';
    return 'text-bg-secondary';
  };
  const prettyAY = (sy,ey)=> (sy && ey) ? `${sy}–${ey}` : '—';
  const parseDT = (s)=> { if(!s) return new Date('Invalid'); const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? new Date(s) : d; };

  // === Semester helpers (same idea as event-expenses.js) ===
  function getSemesterLabelForYear(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null) return null;
    const ay = Number(activeYear);
    if (!Number.isFinite(ay)) return null;
    if (ay === Number(startYear)) return '1st Semester';
    if (ay === Number(endYear))   return '2nd Semester';
    return `AY Segment ${ay}`;
  }

  // Format something like: "1st Semester, AY 2024-2025" or "AY 2024-2025" if no sem
  function formatAYAndSemester(startYear, endYear, activeYear) {
    const sy = startYear != null ? Number(startYear) : null;
    const ey = endYear   != null ? Number(endYear)   : null;
    const sem = getSemesterLabelForYear(sy, ey, activeYear);

    if (sy == null || ey == null) {
      if (sem && activeYear != null) return `${sem} (${activeYear})`;
      return activeYear != null ? String(activeYear) : '—';
    }

    const range = `${sy}-${ey}`;
    if (!sem) return `AY ${range}`;
    return `${sem}, AY ${range}`;
  }

  // App-wide success/error modals (fallback to alert)
  const showError   = (m)=> (typeof window.showErrorModal   === 'function' ? window.showErrorModal(m)   : alert(m||'Something went wrong'));
  const showSuccess = (m)=> (typeof window.showSuccessModal === 'function' ? window.showSuccessModal(m) : alert(m||'Success'));

  // Safe DOM setters
  const safe = {
    text: (el, v) => { if (el) el.textContent = v; },
    html: (el, v) => { if (el) el.innerHTML = v; },
    show: (el) => { if (el) el.classList.remove('d-none'); },
    hide: (el) => { if (el) el.classList.add('d-none'); },
  };

  // ===== module state (per mount) =====
  let mounted = false;
  let intervalId = null;
  let AY_SPANS = [];
  let ACTIVE_SPAN = null;   // { start_year, end_year }
  let ACTIVE_YEAR = null;   // numeric year inside the span (used as "active_year")
  let ORGS = [];
  let FILTERED_ORGS = [];
  let SELECTED = null; // { org, fee, payments, summary, students }

  // dirty/UX protection so refresh doesn't wipe inputs
  let feeFormDirty = false;

  // sequence guards to avoid stale overwrites
  let feeFetchSeq = 0;
  let paymentsFetchSeq = 0;
  let rosterFetchSeq = 0;

  // ===== Pagination Settings =====
  const PAGINATION_CONFIG = {
    paid: {
      currentPage: 1,
      pageSize: 15,
      totalItems: 0,
      totalPages: 0
    },
    unpaid: {
      currentPage: 1,
      pageSize: 15,
      totalItems: 0,
      totalPages: 0
    }
  };

  // ===== DOM (resolved per init) =====
  let root, aySpanSelect, activeYearSelect, refreshBtn, orgSearch, orgGrid, emptyState, gridView, detailView, backToGrid;
  let orgTitle, orgSubtitle, orgStatusBadge, headerAY, orgInfo;

  // unified form (fee + treasurer)
  let feeForm, feeTitle, feeAmount, feeCurrency, feeDescription, treasurerName, treasurerIdHidden, treasurerSuggest, currentFeeSummary, feeAlert, saveFeeBtn;

  // tables/controls
  let paidpaidTbody, unpaidpaidTbody, paidSearch, unpaidSearch, addPaymentBtn, exportUnpaidBtn, exportPaidBtn;
  let printPaidBtn, printUnpaidBtn;
  
  // pagination elements
  let paidPagination, unpaidPagination;

  // reports/print
  let kpiToday, kpiWeek, kpiMonth, kpiSemester, kpiUnpaid, printBtn, printArea, printOrgName, printAY, printActive, pToday, pWeek, pMonth, pSemester, pUnpaid, printPaymentsBody, printTotalAmount;

  // Payment modal elements
  let addPaymentModalEl, addPaymentModal, payerNameInput, payerIdHiddenPay, payerSuggestPay, payAmountInput, payMethodSelect, payNoteInput, confirmAddPaymentBtn;

  // ===== helper: lock / unlock buttons for active AY only =====
  function isActiveContext() {
    if (!ACTIVE_SPAN || !AY_SPANS.length) return true; // if not known, don't block user
    const activeRow = AY_SPANS.find(a => String(a.status || '').toLowerCase() === 'active');
    if (!activeRow) return true;

    const spanMatch =
      +activeRow.start_year === +ACTIVE_SPAN.start_year &&
      +activeRow.end_year   === +ACTIVE_SPAN.end_year;

    const targetYear = Number(activeRow.active_year || activeRow.start_year);
    const yearMatch  = ACTIVE_YEAR != null && +ACTIVE_YEAR === targetYear;

    return spanMatch && yearMatch;
  }

  function setBtnEnabled(el, enabled) {
    if (!el) return;
    el.disabled = !enabled;
    el.classList.toggle('opacity-50', !enabled);
    el.classList.toggle('pe-none', !enabled);
  }

  function updateHeaderAYSpan() {
    if (!headerAY) return;
    if (!ACTIVE_SPAN) {
      safe.text(headerAY, '—');
      return;
    }
    
    const ayTxt = prettyAY(ACTIVE_SPAN.start_year, ACTIVE_SPAN.end_year);
    const semTxt = getSemesterLabelForYear(ACTIVE_SPAN.start_year, ACTIVE_SPAN.end_year, ACTIVE_YEAR);
    
    if (semTxt && semTxt !== '—') {
      safe.text(headerAY, `${ayTxt} · ${semTxt}`);
    } else {
      safe.text(headerAY, ayTxt);
    }
  }

  function updateActiveContextUI() {
    const isActive = isActiveContext();

    // 1) Buttons that MODIFY data (lock when NOT active) - BUT KEEP addPaymentBtn ALWAYS ENABLED
    const lockButtons = [
      saveFeeBtn,
      // addPaymentBtn, // REMOVED - users should always be able to add payments
      // confirmAddPaymentBtn // REMOVED - to allow treasurers accept late payments
    ];
    lockButtons.forEach(btn => setBtnEnabled(btn, isActive));

    // 2) Buttons that should ALWAYS be usable
    [addPaymentBtn, printBtn, printPaidBtn, printUnpaidBtn, exportPaidBtn, exportUnpaidBtn]
      .forEach(btn => setBtnEnabled(btn, true));

    // 3) Fee inputs - only amount and description should be editable
    // Title and currency are now read-only
    if (feeTitle) {
      feeTitle.readOnly = true; // Always read-only
      feeTitle.disabled = false; // But not disabled (so it's visible)
    }
    
    if (feeAmount) {
      feeAmount.disabled = !isActive; // Only amount is editable in active context
    }
    
    if (feeCurrency) {
      feeCurrency.readOnly = true; // Always read-only
      feeCurrency.disabled = true; // Always disabled (PHP fixed)
    }
    
    if (feeDescription) {
      feeDescription.disabled = !isActive;
    }
    
    if (treasurerName) {
      treasurerName.disabled = !isActive;
    }

    // 4) Toggle READ-ONLY badge
    const badge = document.getElementById('dfReadOnlyBadge');
    if (badge) {
      if (isActive) {
        badge.classList.add('d-none');
      } else {
        badge.classList.remove('d-none');
      }
    }
  }

  // ===== Pagination Functions =====
  function updatePagination(config, container, onPageChange) {
    if (!container) return;
    
    const { currentPage, pageSize, totalItems, totalPages } = config;
    
    if (totalItems === 0) {
      container.innerHTML = '<div class="text-muted small">No items to display</div>';
      return;
    }
    
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);
    
    // Create pagination HTML
    let paginationHtml = `
      <div class="small text-muted">
        Showing ${startItem} to ${endItem} of ${totalItems} items
      </div>
      <nav aria-label="Table navigation">
        <ul class="pagination pagination-sm mb-0">
    `;
    
    // Previous button
    paginationHtml += `
      <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage - 1}" ${currentPage === 1 ? 'tabindex="-1" aria-disabled="true"' : ''}>
          <i class="bi bi-chevron-left"></i>
        </a>
      </li>
    `;
    
    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }
    
    // Next button
    paginationHtml += `
      <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'tabindex="-1" aria-disabled="true"' : ''}>
          <i class="bi bi-chevron-right"></i>
        </a>
      </li>
    `;
    
    paginationHtml += `
        </ul>
      </nav>
    `;
    
    container.innerHTML = paginationHtml;
    
    // Add event listeners to pagination links
    container.querySelectorAll('.page-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(link.dataset.page);
        if (!isNaN(page) && page >= 1 && page <= totalPages && page !== currentPage) {
          config.currentPage = page;
          onPageChange();
        }
      });
    });
  }

  function getPaginatedRows(rows, config) {
    const { currentPage, pageSize } = config;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return rows.slice(startIndex, endIndex);
  }

  // ===== init (idempotent) =====
  async function init(){
    if (mounted) return;
    root = document.querySelector('#dept-fees');
    if (!root) return;
    mounted = true;

    // query elements
    aySpanSelect = root.querySelector('#aySpanSelect');
    activeYearSelect = root.querySelector('#activeYearSelect');
    refreshBtn = root.querySelector('#refreshBtn');
    orgSearch = root.querySelector('#orgSearch');
    orgGrid = root.querySelector('#orgGrid');
    emptyState = root.querySelector('#emptyState');
    gridView = root.querySelector('#gridView');
    detailView = root.querySelector('#detailView');
    backToGrid = root.querySelector('#backToGrid');

    orgTitle = root.querySelector('#orgTitle');
    orgSubtitle = root.querySelector('#orgSubtitle');
    orgStatusBadge = root.querySelector('#orgStatusBadge');
    headerAY = root.querySelector('#headerAY');
    orgInfo = root.querySelector('#orgInfo');

    // unified org form (fee + treasurer)
    feeForm = root.querySelector('#feeForm');
    feeTitle = root.querySelector('#feeTitle');
    feeAmount = root.querySelector('#feeAmount');
    feeCurrency = root.querySelector('#feeCurrency');
    feeDescription = root.querySelector('#feeDescription');
    treasurerName = root.querySelector('#treasurerName');
    treasurerIdHidden = root.querySelector('#treasurerIdHidden');
    treasurerSuggest = root.querySelector('#treasurerSuggest');
    currentFeeSummary = root.querySelector('#currentFeeSummary');
    feeAlert = root.querySelector('#feeAlert');
    saveFeeBtn = root.querySelector('#saveFeeBtn');

    // --- robust tbody lookups (works with multiple possible IDs/data-attrs) ---
    const findOne = (rootEl, sels) => {
      for (const s of sels) {
        const el = rootEl.querySelector(s);
        if (el) return el;
      }
      return null;
    };
    const paidTbodyCandidates = [
      '#paidpaidTbody',
      '#paidTbody',
      '#paid-body',
      'tbody[data-role="paid"]'
    ];
    const unpaidTbodyCandidates = [
      '#unpaidpaidTbody',
      '#unpaidTbody',
      '#unpaid-body',
      'tbody[data-role="unpaid"]'
    ];

    paidpaidTbody   = findOne(root, paidTbodyCandidates);
    unpaidpaidTbody = findOne(root, unpaidTbodyCandidates);

    if (!paidpaidTbody)   console.warn('[dept-fees] Missing paid <tbody>. Tried:', paidTbodyCandidates.join(', '));
    if (!unpaidpaidTbody) console.warn('[dept-fees] Missing unpaid <tbody>. Tried:', unpaidTbodyCandidates.join(', '));

    paidSearch = root.querySelector('#paidSearch');
    unpaidSearch = root.querySelector('#unpaidSearch');
    addPaymentBtn = root.querySelector('#addPaymentBtn');
    exportUnpaidBtn = root.querySelector('#exportUnpaidBtn');
    exportPaidBtn = root.querySelector('#exportPaidBtn');
    printPaidBtn = root.querySelector('#printPaidBtn');
    printUnpaidBtn = root.querySelector('#printUnpaidBtn');
    
    // pagination containers
    paidPagination = root.querySelector('#paidPagination');
    unpaidPagination = root.querySelector('#unpaidPagination');

    kpiToday = root.querySelector('#kpiToday');
    kpiWeek = root.querySelector('#kpiWeek');
    kpiMonth = root.querySelector('#kpiMonth');
    kpiSemester = root.querySelector('#kpiSemester');
    kpiUnpaid = root.querySelector('#kpiUnpaid');
    printBtn = root.querySelector('#printBtn');
    printArea = root.querySelector('#printArea');
    printOrgName = root.querySelector('#printOrgName');
    printAY = root.querySelector('#printAY');
    printActive = root.querySelector('#printActive');
    pToday = root.querySelector('#pToday');
    pWeek = root.querySelector('#pWeek');
    pMonth = root.querySelector('#pMonth');
    pSemester = root.querySelector('#pSemester');
    pUnpaid = root.querySelector('#pUnpaid');
    printPaymentsBody = root.querySelector('#printPaymentsBody');
    printTotalAmount = root.querySelector('#printTotalAmount');

    // Payment modal nodes (modal is outside #dept-fees; use document)
    addPaymentModalEl    = document.getElementById('addPaymentModal');
    payerNameInput       = document.getElementById('payerSearchName');
    payerIdHiddenPay     = document.getElementById('payerIdHidden');
    payerSuggestPay      = document.getElementById('payerSuggest');
    payAmountInput       = document.getElementById('payAmount');
    payMethodSelect      = document.getElementById('payMethod');
    payNoteInput         = document.getElementById('payNote');
    confirmAddPaymentBtn = document.getElementById('confirmAddPaymentBtn');
    if (addPaymentModalEl) addPaymentModal = new bootstrap.Modal(addPaymentModalEl);

    // If "Export CSV" (paid) button doesn't exist in HTML, inject it next to Record Payment
    if (!exportPaidBtn && addPaymentBtn?.parentElement) {
      exportPaidBtn = document.createElement('button');
      exportPaidBtn.id = 'exportPaidBtn';
      exportPaidBtn.type = 'button';
      exportPaidBtn.className = 'btn btn-outline-secondary';
      exportPaidBtn.textContent = 'Export CSV';
      addPaymentBtn.parentElement.insertBefore(exportPaidBtn, addPaymentBtn.nextSibling);
    }

    // If print buttons don't exist, inject them
    if (!printPaidBtn && addPaymentBtn?.parentElement) {
      printPaidBtn = document.createElement('button');
      printPaidBtn.id = 'printPaidBtn';
      printPaidBtn.type = 'button';
      printPaidBtn.className = 'btn btn-outline-secondary';
      printPaidBtn.innerHTML = '<i class="bi bi-printer me-1"></i>Print Paid List';
      addPaymentBtn.parentElement.insertBefore(printPaidBtn, exportPaidBtn?.nextSibling || addPaymentBtn.nextSibling);
    }

    if (!printUnpaidBtn && exportUnpaidBtn?.parentElement) {
      printUnpaidBtn = document.createElement('button');
      printUnpaidBtn.id = 'printUnpaidBtn';
      printUnpaidBtn.type = 'button';
      printUnpaidBtn.className = 'btn btn-outline-secondary';
      printUnpaidBtn.innerHTML = '<i class="bi bi-printer me-1"></i>Print Unpaid List';
      exportUnpaidBtn.parentElement.insertBefore(printUnpaidBtn, exportUnpaidBtn.nextSibling);
    }

    // If pagination containers don't exist, create them
    if (!paidPagination) {
      const paidTableContainer = paidpaidTbody?.closest('.table-responsive')?.parentElement || 
                               paidpaidTbody?.closest('.table')?.parentElement;
      if (paidTableContainer) {
        paidPagination = document.createElement('div');
        paidPagination.id = 'paidPagination';
        paidPagination.className = 'd-flex justify-content-between align-items-center mt-3';
        paidTableContainer.appendChild(paidPagination);
      }
    }

    if (!unpaidPagination) {
      const unpaidTableContainer = unpaidpaidTbody?.closest('.table-responsive')?.parentElement || 
                                  unpaidpaidTbody?.closest('.table')?.parentElement;
      if (unpaidTableContainer) {
        unpaidPagination = document.createElement('div');
        unpaidPagination.id = 'unpaidPagination';
        unpaidPagination.className = 'd-flex justify-content-between align-items-center mt-3';
        unpaidTableContainer.appendChild(unpaidPagination);
      }
    }

    // load & render
    await loadAY();          // fills selects and sets ACTIVE_SPAN/YEAR
    await loadOrgs();        // fills ORGS for the chosen span
    renderGrid();
    updateActiveContextUI();

    // handlers
    aySpanSelect?.addEventListener('change', onSpanChange);
    activeYearSelect?.addEventListener('change', onActiveYearChange);
    refreshBtn?.addEventListener('click', () => {
      loadOrgs().then(renderGrid);
      if (SELECTED) openOrg(SELECTED.org.id, {silent:true});
    });
    orgSearch?.addEventListener('input', () => { filterGrid(orgSearch.value); renderGrid(); });
    backToGrid?.addEventListener('click', () => { detailView.classList.add('d-none'); gridView.classList.remove('d-none'); });
    printBtn?.addEventListener('click', printSummaryReport);
    printPaidBtn?.addEventListener('click', printPaidList);
    printUnpaidBtn?.addEventListener('click', printUnpaidList);

    // dirty tracking
    [feeTitle, feeAmount, feeCurrency, feeDescription, treasurerName].forEach(el=>{
      el?.addEventListener('input', ()=> feeFormDirty = true);
      el?.addEventListener('change', ()=> feeFormDirty = true);
    });

    // unified save
    feeForm?.addEventListener('submit', onSaveOrgFeeAndTreasurer);

    // treasurer typeahead
    treasurerName?.addEventListener('input', onTreasurerInput);
    treasurerName?.addEventListener('keydown', onTreasurerKeydown);
    document.addEventListener('click', (e)=> {
      if (treasurerSuggest && !treasurerSuggest.contains(e.target) && e.target !== treasurerName) hideTreasurerSuggest();
      if (payerSuggestPay && !payerSuggestPay.contains(e.target) && e.target !== payerNameInput) hidePayerSuggest();
    });

    paidSearch?.addEventListener('input', () => {
      PAGINATION_CONFIG.paid.currentPage = 1;
      renderPaid();
    });
    unpaidSearch?.addEventListener('input', () => {
      PAGINATION_CONFIG.unpaid.currentPage = 1;
      renderUnpaid();
    });
    exportPaidBtn?.addEventListener('click', exportPaidCSV);

    // Payment modal open
    if (addPaymentBtn) {
      addPaymentBtn.addEventListener('click', () => {
        if (!SELECTED?.fee) { showError('Set a fee first.'); return; }
        // Prefill
        if (payerNameInput)   payerNameInput.value   = '';
        if (payerIdHiddenPay) payerIdHiddenPay.value = '';
        if (payAmountInput)   payAmountInput.value   = (SELECTED.fee.amount ?? '') + '';
        if (payMethodSelect)  payMethodSelect.value  = 'cash';
        if (payNoteInput)     payNoteInput.value     = '';
        if (payerSuggestPay){ payerSuggestPay.innerHTML = ''; payerSuggestPay.classList.add('d-none'); }
        addPaymentModal?.show();
        setTimeout(()=> payerNameInput?.focus(), 100);
      });
    }

    // Payment modal interactions
    if (payerNameInput) {
      payerNameInput.addEventListener('input', onPayerInput);
      payerNameInput.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter') {
          const first = payerSuggestPay?.querySelector?.('[data-id]');
          if (first) { pickPayer(first.dataset.id, first.dataset.label); e.preventDefault(); }
        }
      });
    }
    confirmAddPaymentBtn?.addEventListener('click', onConfirmAddPayment);

    // delegate actions in "Paid" table (print per receipt)
    if (paidpaidTbody) {
      paidpaidTbody.addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-action="print-receipt"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const row = (SELECTED?.payments||[]).find(x=>String(x.id)===String(id));
        if (!row) { showError('Receipt not found.'); return; }
        printSingleReceipt(row);
      });
    }

    // periodic refresh (slow, and don't clobber forms while editing)
    intervalId = setInterval(async () => {
      await loadOrgs();
      renderGrid();
      if (SELECTED && !document.querySelector('.modal.show')) {
        await openOrg(SELECTED.org.id, {silent:true});
      }
    }, 15000);
  }

  // ===== destroy on unmount =====
  function destroy(){
    if (!mounted) return;
    mounted = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    SELECTED = null; ORGS = []; FILTERED_ORGS = []; AY_SPANS = []; ACTIVE_SPAN = null; ACTIVE_YEAR = null;
    feeFormDirty = false;
    feeFetchSeq = 0;
    paymentsFetchSeq = 0;
    rosterFetchSeq = 0;
    
    // Reset pagination
    PAGINATION_CONFIG.paid.currentPage = 1;
    PAGINATION_CONFIG.unpaid.currentPage = 1;
  }

  // ===== AY helpers (normalize any backend shape) =====
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

  // ===== AY =====
  async function loadAY(){
    try{
      const activeRaw = await fetchJSON('php/get-active-academic-year.php?t='+Date.now());
      const active = normalizeActiveAY(activeRaw);

      const listRaw = await fetchJSON('php/get-academic-years.php?t='+Date.now());
      const list = normalizeAYList(listRaw);

      const inList = list.find(a => a.start_year===active.start_year && a.end_year===active.end_year);
      AY_SPANS = inList ? list : [{...active, status:'Active'}, ...list];

      ACTIVE_SPAN = { start_year: active.start_year, end_year: active.end_year };
      ACTIVE_YEAR = Number.isFinite(active.active_year) ? active.active_year : active.start_year;
    }catch(e){
      console.warn('[dept-fees] loadAY active failed, falling back:', e);
      try{
        const listRaw = await fetchJSON('php/get-academic-years.php?t='+Date.now());
        const list = normalizeAYList(listRaw);
        if (!list.length) throw new Error('No AY rows');
        AY_SPANS = list;
        const act = list.find(a => String(a.status).toLowerCase()==='active') || list[0];
        ACTIVE_SPAN = { start_year: act.start_year, end_year: act.end_year };
        ACTIVE_YEAR = Number.isFinite(act.active_year) ? act.active_year : act.start_year;
      }catch(e2){
        console.error('[dept-fees] loadAY error:', e2);
        AY_SPANS = [];
        ACTIVE_SPAN = null; ACTIVE_YEAR = null;
      }
    }

    if (aySpanSelect) {
      aySpanSelect.innerHTML = AY_SPANS.map(a=>{
        const sel = (+a.start_year===+ACTIVE_SPAN?.start_year && +a.end_year===+ACTIVE_SPAN?.end_year) ? 'selected':'';
        const tag = (String(a.status).toLowerCase()==='active') ? ' (Active)' : '';
        return `<option value="${a.start_year}-${a.end_year}" ${sel}>${_esc(a.start_year)}–${_esc(a.end_year)}${tag}</option>`;
      }).join('') || `<option value="">—</option>`;
    }

    renderActiveYearOptions();

    if (ACTIVE_SPAN && aySpanSelect) {
      const v = `${ACTIVE_SPAN.start_year}-${ACTIVE_SPAN.end_year}`;
      if (aySpanSelect.value !== v) aySpanSelect.value = v;
    }
    if (ACTIVE_YEAR && activeYearSelect && activeYearSelect.value !== String(ACTIVE_YEAR)) {
      activeYearSelect.value = String(ACTIVE_YEAR);
    }

    updateHeaderAYSpan();
    updateActiveContextUI();
  }

  function renderActiveYearOptions(){
    const sy = ACTIVE_SPAN?.start_year, ey = ACTIVE_SPAN?.end_year;
    if(!sy || !ey){
      if (activeYearSelect) activeYearSelect.innerHTML = `<option value="">—</option>`;
      return;
    }
    if (!activeYearSelect) return;

    // Label the raw years as "1st Semester" / "2nd Semester"
    let html = '';
    html += `<option value="${sy}" ${+sy===+ACTIVE_YEAR?'selected':''}>1st Semester</option>`;
    if (ey !== sy) {
      html += `<option value="${ey}" ${+ey===+ACTIVE_YEAR?'selected':''}>2nd Semester</option>`;
    }
    activeYearSelect.innerHTML = html;
  }

  function onSpanChange(){
    const [sy,ey] = (aySpanSelect.value||'').split('-').map(v=>parseInt(v,10));
    if(Number.isFinite(sy) && Number.isFinite(ey)){
      ACTIVE_SPAN = {start_year:sy, end_year:ey};
      ACTIVE_YEAR = sy; // default to first year of span (1st semester)
      renderActiveYearOptions();
      loadOrgs().then(renderGrid);
      updateActiveContextUI();
      // reset detail when span changes (prevents carrying over wrong semester data)
      if(SELECTED){
        detailView.classList.add('d-none'); gridView.classList.remove('d-none'); SELECTED=null;
      }
    }
  }

  async function onActiveYearChange(){
    const y = parseInt(activeYearSelect.value,10);
    if(!Number.isFinite(y)) return;
    ACTIVE_YEAR = y;
    updateActiveContextUI();

    // Force a full, ordered refresh against the current org
    if (SELECTED) {
      console.debug('[dept-fees] onActiveYearChange -> refresh', { ACTIVE_YEAR, ACTIVE_SPAN, org: SELECTED.org?.id });
      await loadDepartmentStudents(SELECTED.org?.course_abbr);
      await loadFee(SELECTED.org?.id);
      await loadPayments();
      renderFee();
      renderPaid();
      renderUnpaid();
      computeKPIs();
      renderPrintPayments();
    }
  }

  // ===== Orgs (exclusive only) =====
  async function loadOrgs(){
    try{
      const qs = new URLSearchParams({ scope: 'exclusive', t: Date.now().toString() });
      if (ACTIVE_SPAN?.start_year && ACTIVE_SPAN?.end_year) {
        qs.set('start_year', ACTIVE_SPAN.start_year);
        qs.set('end_year', ACTIVE_SPAN.end_year);
      }
      const url = 'php/get-department-organizations.php?' + qs.toString();
      const raw = await fetchJSON(url);

      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.organizations) ? raw.organizations : []);
      ORGS = list.filter(o => String(o.scope).toLowerCase() === 'exclusive');
      filterGrid(orgSearch?.value);
    }catch(e){
      console.error('[dept-fees] loadOrgs error:', e);
      showError('Failed to load organizations.');
      ORGS = []; FILTERED_ORGS = [];
    }
  }

  function filterGrid(q){
    q = String(q||'').toLowerCase().trim();
    if(!q){ FILTERED_ORGS = ORGS.slice(); return; }
    FILTERED_ORGS = ORGS.filter(o =>
      String(o.name||'').toLowerCase().includes(q) ||
      String(o.abbreviation||'').toLowerCase().includes(q) ||
      String(o.course_abbr||'').toLowerCase().includes(q)
    );
  }

  function renderGrid(){
    if (!orgGrid || !emptyState) return;

    orgGrid.innerHTML = '';
    if (!FILTERED_ORGS.length) {
      const ayText = prettyAY(ACTIVE_SPAN?.start_year, ACTIVE_SPAN?.end_year);
      emptyState.innerHTML = `
        <div class="mb-2">No organizations found for AY ${_esc(ayText)}.</div>
        <div class="small">Try changing the Academic Year filters or your search.</div>
      `;
      emptyState.classList.remove('d-none');
      return;
    }

    emptyState.classList.add('d-none');

    FILTERED_ORGS.forEach(o => {
      const ay = prettyAY(o.start_year || o.active_start_year, o.end_year || o.active_end_year);

      const logo = o.logo_path
        ? `${_esc(o.logo_path)}`
        : 'assets/images/image-placeholder.svg';

      const badge  = statusBadge(o.status);
      const abbr   = o.abbreviation ? `(${_esc(o.abbreviation)})` : '';
      const status = String(o.status || '').toLowerCase();
      const clickable = (status === 'accredited' || status === 'reaccredited');
      const disabledStyle = clickable ? '' : 'opacity:.6;';
      const tooltip = clickable ? '' : 'title="Only Accredited/Reaccredited orgs are manageable"';

     orgGrid.insertAdjacentHTML('beforeend', `
      <div class="col-12 col-sm-6 col-lg-4 col-xxl-3 d-flex">
        <div class="card org-card w-100 ${clickable ? '' : 'disabled'}"
            data-id="${o.id}" data-clickable="${clickable ? '1' : '0'}" ${tooltip}>
          <div class="card-body-custom">
            <div class="logo-container">
              <img src="${logo}"
                  alt="${_esc(o.name)} logo"
                  onerror="this.src='assets/images/image-placeholder.svg'">
            </div>
            <div class="card-content">
              <div class="card-header-row">
                <div class="org-name" title="${_esc(o.name)}">
                  ${_esc(o.name)}
                </div>
                <span class="status-badge ${status.toLowerCase()}">
                  ${_esc(o.status || '—')}
                </span>
              </div>
              <div class="org-subtitle">
                ${abbr ? `<strong class="text-dark">${_esc(o.abbreviation)}</strong>` : ''}
                ${abbr && o.course_abbr ? ' • ' : ''}
                ${o.course_abbr ? _esc(o.course_abbr) : '—'}
              </div>
              <div class="org-ay">
                <i class="bi bi-calendar3"></i>
                <span>AY ${ay}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    });

    orgGrid.querySelectorAll('.org-card').forEach(card => {
      const clickable = card.getAttribute('data-clickable') === '1';
      if (!clickable) return;
      card.addEventListener('click', () => openOrg(parseInt(card.dataset.id, 10)));
    });
  }

  // ===== Detail (DEPARTMENT FEES) =====
  async function openOrg(orgId, { silent = false } = {}) {
    orgId = Number(orgId);
    const org = ORGS.find(o => Number(o.id) === orgId);

    if (!org) {
      console.warn('[dept-fees] openOrg: org not found in ORGS for id', orgId);
      showError('Organization not found.');
      return;
    }

    // set SELECTED + global mirror for receipt printing
    SELECTED = {
      org,
      fee: null,
      payments: [],
      summary: null,
      students: []
    };
    window.DEPT_SELECTED = SELECTED;

    // header bits
    safe.text(orgTitle, org.name || '—');
    const abbr = org.abbreviation || org.abbr || '';
    safe.text(orgSubtitle, abbr ? `(${abbr})` : '');
    safe.text(orgStatusBadge, org.status || '—');
    if (orgStatusBadge) {
      orgStatusBadge.className = `badge ${statusBadge(org.status)} badge-status`;
    }

    updateHeaderAYSpan();

    if (orgInfo) {
      const ayText = prettyAY(org.start_year || org.active_start_year, org.end_year || org.active_end_year);
      orgInfo.innerHTML = `
        <div><span class="text-muted"><i class="bi bi-person-workspace me-1"></i>Scope:</span> Department</div>
        <div><span class="text-muted"><i class="bi bi-mortarboard me-1"></i>Course:</span> ${_esc(org.course_abbr || '—')}</div>
        <div><span class="text-muted"><i class="bi bi-calendar3 me-1"></i>AY:</span> ${ayText}</div>
        <div><span class="text-muted"><i class="bi bi-patch-check-fill me-1"></i>Status:</span> ${_esc(org.status || '—')}</div>
      `;
    }

    console.debug('[dept-fees] openOrg', { orgId, ACTIVE_YEAR, ACTIVE_SPAN, org });

    // load data
    await loadDepartmentStudents(org.course_abbr);
    await loadFee(org.id);
    await loadPayments();

    renderFee();
    renderPaid();
    renderUnpaid();
    computeKPIs();
    renderPrintPayments();

    // print header
    safe.text(printOrgName, org.name || '—');
    safe.text(printAY, prettyAY(ACTIVE_SPAN?.start_year, ACTIVE_SPAN?.end_year));
    safe.text(printActive, ACTIVE_YEAR ?? '—');

    updateActiveContextUI();

    if (!silent) {
      if (gridView) gridView.classList.add('d-none');
      if (detailView) detailView.classList.remove('d-none');
    }
  }

  // ===== Fee + Treasurer =====
  async function loadFee(org_id){
    const mySeq = ++feeFetchSeq;
    try{
      const q = new URLSearchParams({
        org_id,
        fee_category: 'department',
        active_year: String(ACTIVE_YEAR ?? ''),
      });
      if (ACTIVE_SPAN?.start_year) q.set('start_year', ACTIVE_SPAN.start_year);
      if (ACTIVE_SPAN?.end_year)   q.set('end_year',   ACTIVE_SPAN.end_year);

      const data = await fetchJSON('php/get-organization-fee.php?'+q.toString());
      if (mySeq !== feeFetchSeq) return;
      SELECTED.fee = data?.fee || null;
      console.debug('[dept-fees] loadFee', { org_id, ACTIVE_YEAR, ACTIVE_SPAN, fee: SELECTED.fee });
    }catch(e){
      if (mySeq !== feeFetchSeq) return;
      console.error('[dept-fees] loadFee error:', e);
      SELECTED.fee = null;
    }
  }

 function renderFee(){
  const f = SELECTED.fee;
  if(!f){
    safe.show(feeAlert);
    safe.text(feeAlert, 'No fee set for this organization and semester. Create one below.');
    if (!feeFormDirty) {
      // Always generate fee title from org name
      const orgName = SELECTED?.org?.name || 'Organization';
      if (feeTitle) {
        feeTitle.value = `${orgName} Fee`;
        feeTitle.readOnly = true; // Make it read-only
      }
      if (feeAmount) feeAmount.value = '';
      if (feeCurrency) {
        feeCurrency.value = 'PHP';
        feeCurrency.readOnly = true; // Make it read-only
        feeCurrency.disabled = true; // Also disable it
      }
      if (feeDescription) feeDescription.value = '';
      if (treasurerName) treasurerName.value = '';
      if (treasurerIdHidden) treasurerIdHidden.value = '';
    }
    safe.text(currentFeeSummary, '—');
    return;
  }
  
  feeAlert?.classList.add('d-none');
  if (!feeFormDirty) {
    // ALWAYS overwrite with org name + Fee format
    const orgName = SELECTED?.org?.name || 'Organization';
    if (feeTitle) {
      feeTitle.value = `${orgName} Fee`; // Always overwrite
      feeTitle.readOnly = true; // Make it read-only
    }
    if (feeAmount) feeAmount.value = f.amount || '';
    if (feeCurrency) {
      feeCurrency.value = 'PHP';
      feeCurrency.readOnly = true; // Make it read-only
      feeCurrency.disabled = true; // Also disable it
    }
    if (feeDescription) feeDescription.value = f.description || '';
  }

  // treasurer: show name (if we know it), submit ID
  const id = f.treasurer_id_number || '';
  if (id) {
    const s = (SELECTED.students||[]).find(x=>String(x.id_number)===String(id));
    if (treasurerName) treasurerName.value = s ? `${s.full_name} (${s.id_number})` : id;
    if (treasurerIdHidden) treasurerIdHidden.value = id;
  } else {
    if (!feeFormDirty) {
      if (treasurerName) treasurerName.value = '';
      if (treasurerIdHidden) treasurerIdHidden.value = '';
    }
  }

  const spanTxt = formatAYAndSemester(
    f.start_year ?? ACTIVE_SPAN?.start_year,
    f.end_year   ?? ACTIVE_SPAN?.end_year,
    f.active_year ?? ACTIVE_YEAR
  );

  const ayOnly = !(SELECTED?.payments||[]).some(p => p.active_year != null && p.active_year !== '');
  safe.html(
    currentFeeSummary,
    `${_esc(f.title)} — <strong>${money(f.amount, f.currency)}</strong> (${_esc(spanTxt)})` +
    (ayOnly ? ` <span class="text-muted ms-1">(AY-only data)</span>` : '')
  );
}

  async function onSaveOrgFeeAndTreasurer(e){
  e.preventDefault();
  const org_id = SELECTED?.org?.id;
  if(!org_id){ showError('No organization selected.'); return; }
  if (!ACTIVE_YEAR){ showError('Academic Year not loaded yet.'); return; }

  // Treasurer must be chosen (schema NOT NULL + FK)
  const treasId = (treasurerIdHidden?.value || '').trim();
  if (!treasId) { showError('Please choose a Treasurer from the suggestions.'); treasurerName?.focus(); return; }

  const payload = new FormData();
  payload.set('org_id', org_id);
  payload.set('fee_category', 'department');
  
  // ALWAYS use org name + Fee format
  const orgName = SELECTED?.org?.name || 'Organization';
  payload.set('title', `${orgName} Fee`);
  
  payload.set('amount', (feeAmount?.value||'').trim());
  payload.set('currency', 'PHP'); // Always PHP
  payload.set('description', (feeDescription?.value||'').trim());
  payload.set('active_year', String(ACTIVE_YEAR));
  payload.set('treasurer_id_number', treasId);
  if (ACTIVE_SPAN?.start_year) payload.set('start_year', ACTIVE_SPAN.start_year);
  if (ACTIVE_SPAN?.end_year)   payload.set('end_year',   ACTIVE_SPAN.end_year);

  try{
    const resp = await fetchJSON('php/save-organization-fee.php', { method:'POST', body: payload });
    if(!resp.success) throw new Error(resp.message||'Failed');
    showSuccess('Saved ✅');
    feeFormDirty = false;
    await loadFee(org_id);
    renderFee();
  }catch(err){ showError(err.message); }
  }

  // ---- Treasurer Typeahead ----
  function onTreasurerInput(){
    if (treasurerIdHidden) treasurerIdHidden.value = '';
    const q = (treasurerName?.value || '').trim().toLowerCase();
    renderTreasurerSuggest(q);
  }

  function onTreasurerKeydown(e){
    if (e.key === 'Enter') {
      const first = treasurerSuggest?.querySelector?.('[data-id]');
      if (first) { pickTreasurer(first.dataset.id, first.dataset.label); e.preventDefault(); }
    }
  }

  function renderTreasurerSuggest(q){
    if (!treasurerSuggest) return;
    const all = (SELECTED?.students || []);
    let results = [];
    if (q) {
      results = all.filter(s =>
        String(s.id_number||'').toLowerCase().includes(q) ||
        String(s.full_name||'').toLowerCase().includes(q)
      ).slice(0,8);
    }
    if (!q || results.length === 0) {
      treasurerSuggest.innerHTML = '';
      treasurerSuggest.classList.add('d-none');
      return;
    }
    treasurerSuggest.innerHTML = results.map(s=>{
      const label = `${s.full_name} (${s.id_number})`;
      return `<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-id="${_esc(s.id_number)}" data-label="${_esc(label)}">
        <span>${_esc(s.full_name)}</span>
        <span class="text-muted small">${_esc(s.id_number)}</span>
      </button>`;
    }).join('');
    treasurerSuggest.classList.remove('d-none');
    treasurerSuggest.onclick = (e)=>{
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      pickTreasurer(btn.dataset.id, btn.dataset.label);
    };
  }

  function pickTreasurer(id, label){
    if (treasurerName) treasurerName.value = label || id;
    if (treasurerIdHidden) treasurerIdHidden.value = id;
    hideTreasurerSuggest();
  }

  function hideTreasurerSuggest(){
    if (!treasurerSuggest) return;
    treasurerSuggest.innerHTML = '';
    treasurerSuggest.classList.add('d-none');
  }

  // ---- Payer typeahead (Payment modal) ----
  function onPayerInput(){
    if (payerIdHiddenPay) payerIdHiddenPay.value = '';
    const q = (payerNameInput?.value || '').trim().toLowerCase();
    renderPayerSuggest(q);
  }

  function renderPayerSuggest(q){
    if (!payerSuggestPay) return;
    const all = (SELECTED?.students || []);
    let results = [];
    if (q) {
      results = all.filter(s =>
        String(s.id_number||'').toLowerCase().includes(q) ||
        String(s.full_name||'').toLowerCase().includes(q)
      ).slice(0,8);
    }
    if (!q || results.length === 0) {
      payerSuggestPay.innerHTML = '';
      payerSuggestPay.classList.add('d-none');
      return;
    }
    payerSuggestPay.innerHTML = results.map(s=>{
      const label = `${s.full_name} (${s.id_number})`;
      return `<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-id="${_esc(s.id_number)}" data-label="${_esc(label)}">
        <span>${_esc(s.full_name)}</span>
        <span class="text-muted small">${_esc(s.id_number)}</span>
      </button>`;
    }).join('');
    payerSuggestPay.classList.remove('d-none');
    payerSuggestPay.onclick = (e)=>{
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      pickPayer(btn.dataset.id, btn.dataset.label);
    };
  }

  function pickPayer(id, label){
    if (payerNameInput) payerNameInput.value = label || id;
    if (payerIdHiddenPay) payerIdHiddenPay.value = id;
    hidePayerSuggest();
  }

  function hidePayerSuggest(){
    if (!payerSuggestPay) return;
    payerSuggestPay.innerHTML = '';
    payerSuggestPay.classList.add('d-none');
  }

  async function onConfirmAddPayment(){
    const f = SELECTED?.fee;
    if(!f){ showError('Set a fee first.'); return; }
    const payerId = (payerIdHiddenPay?.value || '').trim();
    if (!payerId) { showError('Please choose a payer from the suggestions.'); payerNameInput?.focus(); return; }
    const amt = parseFloat((payAmountInput?.value || '').trim());
    if (!Number.isFinite(amt) || amt <= 0) { showError('Enter a valid amount.'); payAmountInput?.focus(); return; }
    const method = (payMethodSelect?.value || 'cash').trim();
    const notes = (payNoteInput?.value || '').trim();

    const fd = new FormData();
    fd.set('org_fee_id', f.id);
    fd.set('payer_id_number', payerId);
    fd.set('paid_amount', String(amt));
    fd.set('payment_method', method);
    if (notes) fd.set('notes', notes);
    fd.set('status', 'confirmed');
    if (ACTIVE_SPAN?.start_year) fd.set('start_year', ACTIVE_SPAN.start_year);
    if (ACTIVE_SPAN?.end_year)   fd.set('end_year',   ACTIVE_SPAN.end_year);
    fd.set('active_year', String(f.active_year ?? ACTIVE_YEAR ?? ''));

    try{
      const r = await fetchJSON('php/add-organization-fee-payment.php', { method:'POST', body: fd });
      if (!r.success) throw new Error(r.message||'Failed');
      addPaymentModal?.hide();
      showSuccess('Payment recorded ✅');
      await loadPayments();
      renderPaid();
      computeKPIs();
      renderUnpaid();
      renderPrintPayments();
    }catch(err){ showError(err.message); }
  }

  // ===== Payments =====
  async function loadPayments(){
    const f = SELECTED?.fee;
    if(!f){
      SELECTED.payments=[]; SELECTED.summary=null;
      return;
    }
    const mySeq = ++paymentsFetchSeq;

    const clientFilter = (rows) => {
      const sy = +ACTIVE_SPAN?.start_year;
      const ey = +ACTIVE_SPAN?.end_year;
      const ay = +ACTIVE_YEAR;

      const keep = rows.filter(p => {
        let bySpan = true;
        const hasSpan = p.start_year != null && p.start_year !== '' &&
                        p.end_year   != null && p.end_year   !== '';
        if (hasSpan && sy && ey) {
          bySpan = (+p.start_year === sy) && (+p.end_year === ey);
        }

        let byAY = true;
        const hasAY = p.active_year != null && p.active_year !== '';
        if (hasAY && ay) {
          byAY = (+p.active_year === ay);
        }

        return bySpan && byAY;
      });

      if (window.DEPT_FEES_DEBUG) {
        console.debug('[dept-fees] clientFilter:', {
          in: rows.length, out: keep.length, sy, ey, ay,
          sample: rows.slice(0,3)
        });
      }
      return keep;
    };

    try{
      const q1 = new URLSearchParams({ org_fee_id: f.id });
      if (ACTIVE_YEAR != null) q1.set('active_year', String(ACTIVE_YEAR));
      if (ACTIVE_SPAN?.start_year) q1.set('start_year', ACTIVE_SPAN.start_year);
      if (ACTIVE_SPAN?.end_year)   q1.set('end_year',   ACTIVE_SPAN.end_year);

      console.debug('[dept-fees] loadPayments primary', Object.fromEntries(q1.entries()));
      const data1 = await fetchJSON('php/get-organization-fee-payments.php?'+q1.toString());
      if (mySeq !== paymentsFetchSeq) return;

      let rows = Array.isArray(data1?.payments) ? data1.payments : [];
      let summary = data1?.summary || null;

      if (!rows.length) {
        const q2 = new URLSearchParams({ org_fee_id: f.id });
        if (ACTIVE_SPAN?.start_year) q2.set('start_year', ACTIVE_SPAN.start_year);
        if (ACTIVE_SPAN?.end_year)   q2.set('end_year',   ACTIVE_SPAN.end_year);
        console.debug('[dept-fees] loadPayments fallback', Object.fromEntries(q2.entries()));

        const data2 = await fetchJSON('php/get-organization-fee-payments.php?'+q2.toString());
        if (mySeq !== paymentsFetchSeq) return;
        rows = Array.isArray(data2?.payments) ? clientFilter(data2.payments) : [];
        summary = data2?.summary || null;
      }

      if (!rows.length) {
        const q3 = new URLSearchParams({ org_fee_id: f.id });
        console.debug('[dept-fees] loadPayments permissive', Object.fromEntries(q3.entries()));
        const data3 = await fetchJSON('php/get-organization-fee-payments.php?' + q3.toString());
        if (mySeq !== paymentsFetchSeq) return;
        rows = Array.isArray(data3?.payments) ? clientFilter(data3.payments) : [];
        summary = data3?.summary || summary;
      }

      SELECTED.payments = rows;
      SELECTED.summary  = summary;
      console.debug('[dept-fees] payments loaded', { count: rows.length, ACTIVE_YEAR, ACTIVE_SPAN, fee_id: f.id });
    }catch(e){
      if (mySeq !== paymentsFetchSeq) return;
      console.error('[dept-fees] loadPayments error:', e);
      SELECTED.payments = []; SELECTED.summary = null;
    }
  }

  function getPaidFilteredRows(){
    const qRaw = (paidSearch?.value || '').trim().toLowerCase();
    const rows = (SELECTED?.payments || []);
    if (!qRaw) return rows.slice();

    const terms = qRaw.split(/\s+/).filter(Boolean);
    const t = v => String(v ?? '').toLowerCase();

    return rows.filter(p => {
      const course      = p.course_abbr ?? p.department ?? SELECTED?.org?.course_abbr ?? '';
      const schoolYear  = p.school_year ?? '';
      const yearLevel   = p.year_level ?? p.year ?? '';

      const hay = [
        p.payer_id_number ?? p.payer_id,
        p.receipt_no,
        p.full_name,
        course,
        schoolYear,
        yearLevel
      ].map(t).join(' ');

      return terms.every(w => hay.includes(w));
    });
  }

  function renderPaid(){
    const f = SELECTED?.fee;
    const allRows = getPaidFilteredRows();
    
    // Update pagination config
    PAGINATION_CONFIG.paid.totalItems = allRows.length;
    PAGINATION_CONFIG.paid.totalPages = Math.ceil(allRows.length / PAGINATION_CONFIG.paid.pageSize);
    
    // Get paginated rows
    const rows = getPaginatedRows(allRows, PAGINATION_CONFIG.paid);
    
    if (!paidpaidTbody) return;

    paidpaidTbody.innerHTML = '';

    if (!f) {
      paidpaidTbody.innerHTML = `<tr><td colspan="10" class="text-muted">Set a fee to see payments.</td></tr>`;
      return;
    }
    if (!rows.length) {
      paidpaidTbody.innerHTML = `<tr><td colspan="10" class="text-muted">No data available</td></tr>`;
      return;
    }

    rows.forEach(p => {
      const course     = p.course_abbr ?? p.department ?? SELECTED?.org?.course_abbr ?? '—';
      const schoolYear = p.school_year ?? '—';
      const yearLevel  = p.year_level ?? p.year ?? '—';

      const sy  = p.start_year ?? f.start_year ?? ACTIVE_SPAN?.start_year ?? null;
      const ey  = p.end_year   ?? f.end_year   ?? ACTIVE_SPAN?.end_year   ?? null;
      const termLabel = formatAYAndSemester(
        sy,
        ey,
        p.active_year ?? f.active_year ?? ACTIVE_YEAR
      );

      paidpaidTbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td><code>${_esc(p.receipt_no||'—')}</code></td>
          <td>${_esc(p.payer_id_number||p.payer_id||'—')}</td>
          <td>${_esc(p.full_name || '—')}</td>
          <td>${money(p.paid_amount ?? p.amount, f.currency||'PHP')}</td>
          <td><span class="badge ${
            String(p.status).toLowerCase()==='confirmed' ? 'text-bg-success'
            : String(p.status).toLowerCase()==='void' ? 'text-bg-danger'
            : 'text-bg-secondary'
          }">${_esc(p.status||'recorded')}</span></td>
          <td>${_esc(p.paid_on||p.paid_at||'—')}</td>
          <td>${_esc(course)}</td>
          <td>${_esc(termLabel)}</td>
          <td>${_esc(yearLevel)}</td>
          <td class="no-print text-end">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-action="print-receipt" data-id="${_esc(p.id)}">
              <i class="bi bi-printer"></i>
            </button>
          </td>
        </tr>
      `);
    });
    
    // Update pagination UI
    updatePagination(PAGINATION_CONFIG.paid, paidPagination, renderPaid);
  }

  function exportPaidCSV(){
    const rows = getPaidFilteredRows();
    if (!rows.length) { showError('Nothing to export.'); return; }
    const f = SELECTED?.fee;

    const headers = [
      'Receipt','Payer ID','Name','Course','School Year','Year Level',
      'Term','Amount','Currency','Method','Status','Paid On',
      'Start Year','End Year','Active Year'
    ];
    const lines = [headers.join(',')];

    rows.forEach(p=>{
      const course     = p.course_abbr ?? p.department ?? SELECTED?.org?.course_abbr ?? '';
      const schoolYear = p.school_year ?? '';
      const yearLevel  = p.year_level ?? p.year ?? '';
      const sy  = p.start_year ?? f?.start_year ?? ACTIVE_SPAN?.start_year ?? '';
      const ey  = p.end_year   ?? f?.end_year   ?? ACTIVE_SPAN?.end_year   ?? '';
      const actYear = p.active_year ?? f?.active_year ?? ACTIVE_YEAR ?? '';
      const termLabel = formatAYAndSemester(sy || null, ey || null, actYear || null);

      const fields = [
        p.receipt_no || '',
        p.payer_id_number || p.payer_id || '',
        p.full_name || '',
        course,
        schoolYear,
        yearLevel,
        termLabel,
        (p.paid_amount ?? p.amount ?? '').toString(),
        (f?.currency || 'PHP'),
        p.payment_method || p.method || '',
        p.status || '',
        p.paid_on || p.paid_at || '',
        sy,
        ey,
        actYear
      ].map(v => `"${String(v).replace(/"/g,'""')}"`);
      lines.push(fields.join(','));
    });

    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const orgAbbr = (SELECTED?.org?.abbreviation || 'dept').toLowerCase();
    const spanTag = ACTIVE_SPAN ? `${ACTIVE_SPAN.start_year}-${ACTIVE_SPAN.end_year}` : 'ay';
    a.download = `paid_${orgAbbr}_${spanTag}_active-${ACTIVE_YEAR || ''}.csv`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    showSuccess('Paid list exported.');
  }

  // DEPARTMENT FEES – uses window.DEPT_SELECTED
  function printSingleReceipt(p) {
    if (!p || !p.id) {
      showError('Receipt not found or has no ID.');
      return;
    }

    // Use the same mPDF receipt (with letterhead) as records.js
    const url = `php/records-print-org-fee.php?payment_id=${encodeURIComponent(p.id)}`;
    const w = window.open(url, '_blank');

    if (!w) {
      showError('Popup blocked. Please allow popups to print the receipt.');
    }
  }

  // ===== Students / Unpaid =====
  async function loadDepartmentStudents(course_abbr){
    if(!course_abbr){ SELECTED.students=[]; renderUnpaid(); return; }
    const mySeq = ++rosterFetchSeq;
    try{
      const q1 = new URLSearchParams({
        course_abbr,
        active_year: String(ACTIVE_YEAR ?? ''),
      });
      if (ACTIVE_SPAN?.start_year) q1.set('start_year', ACTIVE_SPAN.start_year);
      if (ACTIVE_SPAN?.end_year)   q1.set('end_year',   ACTIVE_SPAN.end_year);

      let data = await fetchJSON('php/get-department-students.php?'+q1.toString());
      if (mySeq !== rosterFetchSeq) return;
      let students = Array.isArray(data?.students) ? data.students : [];

      if (!students.length) {
        const q2 = new URLSearchParams({ course_abbr });
        if (ACTIVE_SPAN?.start_year) q2.set('start_year', ACTIVE_SPAN.start_year);
        if (ACTIVE_SPAN?.end_year)   q2.set('end_year',   ACTIVE_SPAN.end_year);
        data = await fetchJSON('php/get-department-students.php?'+q2.toString());
        if (mySeq !== rosterFetchSeq) return;
        students = Array.isArray(data?.students) ? data.students : [];
      }

      if (!students.length) {
        const q3 = new URLSearchParams({ course_abbr });
        data = await fetchJSON('php/get-department-students.php?'+q3.toString());
        if (mySeq !== rosterFetchSeq) return;
        students = Array.isArray(data?.students) ? data.students : [];
      }

      if (window.DEPT_FEES_DEBUG) {
        console.debug('[dept-fees] loadDepartmentStudents result', {
          count: students.length,
          sample: students.slice(0,3)
        });
      }

      SELECTED.students = students;
      console.debug('[dept-fees] loadDepartmentStudents', { course_abbr, count: SELECTED.students.length, ACTIVE_YEAR, ACTIVE_SPAN });
    }catch(e){
      if (mySeq !== rosterFetchSeq) return;
      console.error('[dept-fees] loadDepartmentStudents error:', e);
      SELECTED.students=[];
    }
  }

  function renderUnpaid(){
    const pays = (SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
    const all = SELECTED.students||[];
    let list = all.filter(s=>!paidSet.has(String(s.id_number)));
    const q = (unpaidSearch?.value||'').toLowerCase().trim();
    if(q){
      list = list.filter(s =>
        String(s.id_number||'').toLowerCase().includes(q) ||
        String(s.full_name||'').toLowerCase().includes(q) ||
        String(s.course_abbr||s.department||'').toLowerCase().includes(q)
      );
    }
    
    // Update pagination config
    PAGINATION_CONFIG.unpaid.totalItems = list.length;
    PAGINATION_CONFIG.unpaid.totalPages = Math.ceil(list.length / PAGINATION_CONFIG.unpaid.pageSize);
    
    // Get paginated rows
    const paginatedList = getPaginatedRows(list, PAGINATION_CONFIG.unpaid);
    
    if (!unpaidpaidTbody) return;
    unpaidpaidTbody.innerHTML = '';
    if(!all.length){
      unpaidpaidTbody.innerHTML = `<tr><td colspan="4" class="text-muted">No roster data available for this department and semester.</td></tr>`;
      return;
    }
    if(!paginatedList.length){
      unpaidpaidTbody.innerHTML = `<tr><td colspan="4" class="text-muted">Everyone is paid. 🎉</td></tr>`;
      return;
    }
    paginatedList.forEach(s=>{
      unpaidpaidTbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${_esc(s.id_number||'—')}</td>
          <td>${_esc(s.full_name||'—')}</td>
          <td>${_esc(s.year_level||'—')}</td>
          <td>${_esc(s.course_abbr||s.department||'—')}</td>
        </tr>
      `);
    });
    
    // Update pagination UI
    updatePagination(PAGINATION_CONFIG.unpaid, unpaidPagination, renderUnpaid);
  }

  // ==== Export "Unpaid" to CSV ====
  function exportUnpaidCSV(){
    const pays = (SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
    const all = SELECTED.students||[];
    let list = all.filter(s=>!paidSet.has(String(s.id_number)));
    const q = (unpaidSearch?.value||'').toLowerCase().trim();
    if(q){
      list = list.filter(s =>
        String(s.id_number||'').toLowerCase().includes(q) ||
        String(s.full_name||'').toLowerCase().includes(q) ||
        String(s.course_abbr||s.department||'').toLowerCase().includes(q)
      );
    }
    
    if (!list.length) { showError('Nothing to export.'); return; }
    const headers = ['ID Number','Name','Year Level','Course'];
    const lines = [headers.join(',')];
    list.forEach(s => {
      const fields = [
        s.id_number || '',
        s.full_name || '',
        s.year_level || '',
        s.course_abbr || s.department || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(fields.join(','));
    });
    
    if (lines.length === 1) { showError('No unpaid rows to export.'); return; }
    const csv = '\uFEFF' + lines.join('\n'); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const orgAbbr = (SELECTED?.org?.abbreviation || 'dept').toLowerCase();
    const spanTag = ACTIVE_SPAN ? `${ACTIVE_SPAN.start_year}-${ACTIVE_SPAN.end_year}` : 'ay';
    a.download = `unpaid_${orgAbbr}_${spanTag}_active-${ACTIVE_YEAR || ''}.csv`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    showSuccess('Unpaid list exported.');
  }
  exportUnpaidBtn?.addEventListener('click', exportUnpaidCSV);

  // ===== KPIs / Reports =====
  function computeKPIs(){
    const s = SELECTED?.summary;
    if (s) {
      safe.text(kpiToday, s.paid_today ?? 0);    safe.text(pToday, s.paid_today ?? 0);
      safe.text(kpiWeek,  s.paid_week ?? 0);     safe.text(pWeek,  s.paid_week ?? 0);
      safe.text(kpiMonth, s.paid_month ?? 0);    safe.text(pMonth, s.paid_month ?? 0);
      safe.text(kpiSemester, s.paid_semester ?? 0); safe.text(pSemester, s.paid_semester ?? 0);

      const pays = (SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
      const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
      const unpaid  = (SELECTED?.students||[]).filter(s=>!paidSet.has(String(s.id_number))).length;
      safe.text(kpiUnpaid, unpaid);  safe.text(pUnpaid, unpaid);
      return;
    }

    const pays = (SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay()+6)%7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const inRange = (d, start)=> (parseDT(d) >= start);

    const today = pays.filter(p=>inRange(p.paid_on||p.paid_at, startOfDay)).length;
    const week  = pays.filter(p=>inRange(p.paid_on||p.paid_at, startOfWeek)).length;
    const month = pays.filter(p=>inRange(p.paid_on||p.paid_at, startOfMonth)).length;
    const sem   = pays.length;

    const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
    const unpaid  = (SELECTED?.students||[]).filter(s=>!paidSet.has(String(s.id_number))).length;

    safe.text(kpiToday, today);    safe.text(pToday, today);
    safe.text(kpiWeek,  week);     safe.text(pWeek,  week);
    safe.text(kpiMonth, month);    safe.text(pMonth, month);
    safe.text(kpiSemester, sem);   safe.text(pSemester, sem);
    safe.text(kpiUnpaid, unpaid);  safe.text(pUnpaid, unpaid);
  }

  function renderPrintPayments(){
    const f = SELECTED?.fee;
    const list = (SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    let total = 0;
    if (!printPaymentsBody || !printTotalAmount) return;
    printPaymentsBody.innerHTML = list.map(p=>{
      const amt = Number(p.paid_amount ?? p.amount) || 0;
      total += amt;
      const fullName = p.full_name || '—';
      return `<tr>
        <td>${_esc(p.paid_on||p.paid_at||'—')}</td>
        <td><code>${_esc(p.receipt_no||'—')}</code></td>
        <td>${_esc(p.payer_id_number||p.payer_id||'—')}</td>
        <td>${_esc(fullName)}</td>
        <td class="text-end">${money(amt, f?.currency||'PHP')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="text-muted">No confirmed payments yet.</td></tr>`;
    printTotalAmount.textContent = money(total, f?.currency||'PHP');
  }

  // Reuse the mPDF + letterhead endpoint used by records.js
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

  function printSummaryReport() {
  const f   = SELECTED?.fee || {};
  const org = SELECTED?.org || {};
  const payments = (SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );
  const roster = SELECTED?.students || [];

  if (!org || !f) {
    showError('No department fee selected to print.');
    return;
  }

  // ===== Time windows =====
  const now = new Date();
  const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek  = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const amt = p => Number(p.paid_amount ?? p.amount) || 0;
  const dt  = p => parseDT(p.paid_on || p.paid_at);

  const todayPays = payments.filter(p => {
    const d = dt(p);
    return d && d >= startOfDay;
  });
  const weekPays = payments.filter(p => {
    const d = dt(p);
    return d && d >= startOfWeek;
  });
  const monthPays = payments.filter(p => {
    const d = dt(p);
    return d && d >= startOfMonth;
  });

  const todaySum = todayPays.reduce((t, p) => t + amt(p), 0);
  const weekSum  = weekPays.reduce((t, p) => t + amt(p), 0);
  const monthSum = monthPays.reduce((t, p) => t + amt(p), 0);
  const semSum   = payments.reduce((t, p) => t + amt(p), 0);

  const todayCnt = todayPays.length;
  const weekCnt  = weekPays.length;
  const monthCnt = monthPays.length;
  const semCnt   = payments.length;

  // ===== Unpaid derived from roster vs confirmed payments =====
  const paidSet = new Set(
    payments.map(p => String(p.payer_id_number || p.payer_id))
  );
  const unpaid = roster.filter(s => !paidSet.has(String(s.id_number)));
  const unpaidCnt = unpaid.length;
  const estOutstanding = (Number(f.amount) || 0) * unpaidCnt;

  // ===== AY / term display =====
  const sy = f.start_year ?? ACTIVE_SPAN?.start_year ?? null;
  const ey = f.end_year   ?? ACTIVE_SPAN?.end_year   ?? null;
  const termLabel = formatAYAndSemester(
    sy,
    ey,
    SELECTED?.fee?.active_year ?? ACTIVE_YEAR
  );
  const ayText = (sy && ey) ? `AY ${sy}-${ey}` : 'All School Years';
  const nowText = now.toLocaleString();

  // ===== Build letterhead-friendly HTML (uses export-records-pdf.css classes) =====
  let content = `
    <div class="report-header">
      <h2>Department Fee Summary</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.course_abbr || '—')})</div>
        <div><strong>Fee:</strong> ${_esc(f.title || 'Department Org Fee')}</div>
        <div><strong>Academic Term:</strong> ${_esc(termLabel || '—')} (${_esc(ayText)})</div>
        <div><strong>Generated on:</strong> ${_esc(nowText)}</div>
      </div>
    </div>

    <div>
      <div class="section-title">Summary</div>
      <table class="summary-table">
        <tbody>
          <tr>
            <th>Collected Today</th>
            <td>${money(todaySum, f.currency || 'PHP')} (${todayCnt} payments)</td>
          </tr>
          <tr>
            <th>Collected This Week</th>
            <td>${money(weekSum, f.currency || 'PHP')} (${weekCnt} payments)</td>
          </tr>
          <tr>
            <th>Collected This Month</th>
            <td>${money(monthSum, f.currency || 'PHP')} (${monthCnt} payments)</td>
          </tr>
          <tr>
            <th>Collected This Semester</th>
            <td>${money(semSum, f.currency || 'PHP')} (${semCnt} payments)</td>
          </tr>
          <tr>
            <th>Unpaid Students</th>
            <td>${unpaidCnt}</td>
          </tr>
          <tr>
            <th>Estimated Outstanding</th>
            <td>${money(estOutstanding, f.currency || 'PHP')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // ===== Confirmed payments table =====
  if (!payments.length) {
    content += `<p class="no-data">No confirmed payments yet.</p>`;
  } else {
    const rowsHtml = payments.map(p => {
      const a = amt(p);
      const course = p.course_abbr ?? p.department ?? org.course_abbr ?? '—';
      const full   = p.full_name || '—';
      const termRowLabel = formatAYAndSemester(
        p.start_year ?? sy,
        p.end_year   ?? ey,
        p.active_year ?? f.active_year ?? ACTIVE_YEAR
      );

      return `
        <tr>
          <td>${_esc(p.paid_on || p.paid_at || '—')}</td>
          <td><code>${_esc(p.receipt_no || '—')}</code></td>
          <td>${_esc(p.payer_id_number || p.payer_id || '—')}</td>
          <td>${_esc(full)}</td>
          <td>${_esc(course)}</td>
          <td>${_esc(termRowLabel)}</td>
          <td class="amount-cell text-end">${money(a, f.currency || 'PHP')}</td>
        </tr>
      `;
    }).join('');

    content += `
      <div class="section-title">Confirmed Payments</div>
      <table class="records-table">
        <thead>
          <tr>
            <th>Paid On</th>
            <th>Receipt #</th>
            <th>Payer ID</th>
            <th>Full Name</th>
            <th>Course</th>
            <th>Term</th>
            <th class="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  // ===== Unpaid list =====
  const UNPAID_CAP = 300;
  const unpaidRows = unpaid.slice(0, UNPAID_CAP).map(s => `
    <tr>
      <td>${_esc(s.id_number || '—')}</td>
      <td>${_esc(s.full_name || '—')}</td>
      <td>${_esc(s.year_level || '—')}</td>
      <td>${_esc(s.course_abbr || s.department || '—')}</td>
    </tr>
  `).join('');

  content += `
    <div class="section-title">Unpaid Students</div>
    <table class="records-table">
      <thead>
        <tr>
          <th>ID Number</th>
          <th>Full Name</th>
          <th>Year Level</th>
          <th>Course</th>
        </tr>
      </thead>
      <tbody>
        ${
          unpaidRows ||
          '<tr><td colspan="4" class="text-muted">No unpaid students 🎉</td></tr>'
        }
      </tbody>
    </table>
  `;

  if (unpaidCnt > UNPAID_CAP) {
    content += `<p class="no-data">Showing first ${UNPAID_CAP} of ${unpaidCnt} unpaid students.</p>`;
  }

  const titleText = `${org.name || '—'} — Department Fee Summary`;
  // This goes to export-records-pdf.php which adds the letterhead
  sendPDFToServer(titleText, content, 'dept-fees-summary');
  } 

  function printPaidList() {
  const f   = SELECTED?.fee || {};
  const org = SELECTED?.org || {};
  const list = (SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );

  if (!org || !f) {
    showError('No department fee selected to print.');
    return;
  }
  if (!list.length) {
    showError('No confirmed payments to print.');
    return;
  }

  const total = list.reduce(
    (t, p) => t + (Number(p.paid_amount ?? p.amount) || 0),
    0
  );
  const nowText = new Date().toLocaleString();

  const rowsHtml = list.map(p => {
    const course = p.course_abbr ?? p.department ?? org.course_abbr ?? '—';
    const full   = p.full_name ?? '—';
    const amtVal = Number(p.paid_amount ?? p.amount) || 0;

    return `
      <tr>
        <td>${_esc(p.paid_on || p.paid_at || '—')}</td>
        <td><code>${_esc(p.receipt_no || '—')}</code></td>
        <td>${_esc(p.payer_id_number || p.payer_id || '—')}</td>
        <td>${_esc(full)}</td>
        <td>${_esc(course)}</td>
        <td class="amount-cell text-end">${money(amtVal, f.currency || 'PHP')}</td>
      </tr>
    `;
  }).join('');

  const content = `
    <div class="report-header">
      <h2>Paid Students — ${_esc(f.title || 'Department Org Fee')}</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.course_abbr || '—')})</div>
        <div><strong>Generated on:</strong> ${_esc(nowText)}</div>
      </div>
    </div>

    <div>
      <div class="section-title">Paid Students</div>
      <table class="records-table">
        <thead>
          <tr>
            <th>Paid On</th>
            <th>Receipt #</th>
            <th>Payer ID</th>
            <th>Full Name</th>
            <th>Course</th>
            <th class="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div class="footer-note">
        Total Collected: ${money(total, f.currency || 'PHP')}
      </div>
    </div>
  `;

  const titleText = `${org.name || '—'} — Paid Students`;
  sendPDFToServer(titleText, content, 'dept-fees-paid');
  }

  function printUnpaidList() {
  const org    = SELECTED?.org || {};
  const pays   = (SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );
  const roster = SELECTED?.students || [];

  if (!org || !roster.length) {
    showError('No students loaded to print.');
    return;
  }

  const paidSet = new Set(
    pays.map(p => String(p.payer_id_number || p.payer_id))
  );
  const unpaid = roster.filter(s => !paidSet.has(String(s.id_number)));

  if (!unpaid.length) {
    showError('No unpaid students 🎉');
    return;
  }

  const nowText = new Date().toLocaleString();

  const rowsHtml = unpaid.map(s => `
    <tr>
      <td>${_esc(s.id_number || '—')}</td>
      <td>${_esc(s.full_name || '—')}</td>
      <td>${_esc(s.year_level || '—')}</td>
      <td>${_esc(s.course_abbr || s.department || '—')}</td>
    </tr>
  `).join('');

  const content = `
    <div class="report-header">
      <h2>Unpaid Students — ${_esc(SELECTED?.fee?.title || 'Department Org Fee')}</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.course_abbr || '—')})</div>
        <div><strong>Generated on:</strong> ${_esc(nowText)}</div>
      </div>
    </div>

    <div>
      <div class="section-title">Unpaid Students</div>
      <table class="records-table">
        <thead>
          <tr>
            <th>ID Number</th>
            <th>Full Name</th>
            <th>Year Level</th>
            <th>Course</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div class="footer-note">
        Total Unpaid Students: ${unpaid.length}
      </div>
    </div>
  `;

  const titleText = `${org.name || '—'} — Unpaid Students`;
  sendPDFToServer(titleText, content, 'dept-fees-unpaid');
  }

  // ===== SPA mount/unmount detection =====
  const contentArea = document.getElementById('content-area') || document.body;
  const observer = new MutationObserver(() => {
    const pageNow = document.querySelector('#dept-fees');
    if (pageNow && !mounted) init();
    if (!pageNow && mounted) destroy();
  });
  observer.observe(contentArea, { childList:true, subtree:true });

  if (document.querySelector('#dept-fees')) init();
})();
//printSingleReceipt