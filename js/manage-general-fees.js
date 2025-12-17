// /assets/js/manage-general-fees.js
// Manage General Org Fees (scope: general/inclusive). SPA-safe; initializes when #general-fees is injected.

(() => {
  // Optional: flip this on in the console to see filtering details
  // window.GEN_FEES_DEBUG = 1;
  window.GEN_FEES_DEBUG = window.GEN_FEES_DEBUG ?? 0;

  // ===== utils =====
  const _esc = (s)=>String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  async function fetchJSON(url, options={}){
    const r = await fetch(url, { credentials:'include', cache:'no-store', ...options });
    const t = await r.text(); let d=null; try{ d=JSON.parse(t)}catch{}
    if(!r.ok){
      let msg = (d && (d.error || d.message)) || `HTTP ${r.status}`;
      if (d && d.detail) msg += ` — ${d.detail}`;
      const e=new Error(msg); e.data=d; throw e;
    }
    return d;
  }
  const money = (n,c='PHP') => `${c} ${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`;
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
  let GEN_AY_SPANS = [];
  let GEN_ACTIVE_SPAN = null;   // { start_year, end_year }
  let GEN_ACTIVE_YEAR = null;   // 1st or 2nd year of span (semester selector)
  let GEN_ORGS = [];
  let GEN_FILTERED_ORGS = [];
  let GEN_SELECTED = null; // { org, fee, payments, summary, students }

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
  let root, genAySpanSelect, genActiveYearSelect, genRefreshBtn, genOrgSearch, genOrgGrid, genEmptyState, genGridView, genDetailView, genBackToGrid;
  let genOrgTitle, genOrgSubtitle, genOrgStatusBadge, genHeaderAY, genOrgInfo;

  // unified form (fee + treasurer)
  let genFeeForm, genFeeTitle, genFeeAmount, genFeeCurrency, genFeeDescription, genTreasurerName, genTreasurerIdHidden, genTreasurerSuggest, genCurrentFeeSummary, genFeeAlert, genSaveFeeBtn;

  // tables/controls
  let genPaidTbody, genUnpaidTbody, genPaidSearch, genUnpaidSearch, genAddPaymentBtn, genExportUnpaidBtn, genExportPaidBtn;
  let genPrintPaidBtn, genPrintUnpaidBtn;
  
  // pagination elements
  let genPaidPagination, genUnpaidPagination;

  // reports/print
  let genKpiToday, genKpiWeek, genKpiMonth, genKpiSemester, genKpiUnpaid, genPrintBtn, genPrintArea, genPrintOrgName, genPrintAY, genPrintActive, genPToday, genPWeek, genPMonth, genPSemester, genPUnpaid, genPrintPaymentsBody, genPrintTotalAmount;

  // Payment modal elements
  let addPaymentModalEl, addPaymentModal, payerNameInput, payerIdHiddenPay, payerSuggestPay, payAmountInput, payMethodSelect, payNoteInput, confirmAddPaymentBtn;

  // ===== helper: lock / unlock buttons for active AY only =====
  function isActiveContext() {
    if (!GEN_ACTIVE_SPAN || !GEN_AY_SPANS.length) return true; // if not known, don't block user
    const activeRow = GEN_AY_SPANS.find(a => String(a.status || '').toLowerCase() === 'active');
    if (!activeRow) return true;

    const spanMatch =
      +activeRow.start_year === +GEN_ACTIVE_SPAN.start_year &&
      +activeRow.end_year   === +GEN_ACTIVE_SPAN.end_year;

    const targetYear = Number(activeRow.active_year || activeRow.start_year);
    const yearMatch  = GEN_ACTIVE_YEAR != null && +GEN_ACTIVE_YEAR === targetYear;

    return spanMatch && yearMatch;
  }

  function setBtnEnabled(el, enabled) {
    if (!el) return;
    el.disabled = !enabled;
    el.classList.toggle('opacity-50', !enabled);
    el.classList.toggle('pe-none', !enabled);
  }

  // === NEW: header helper showing AY + Semester ===
  function updateHeaderAYSpan() {
    if (!genHeaderAY) return;
    if (!GEN_ACTIVE_SPAN) {
      safe.text(genHeaderAY, '—');
      return;
    }
    const ayTxt = prettyAY(GEN_ACTIVE_SPAN.start_year, GEN_ACTIVE_SPAN.end_year);
    const semTxt = semLabelFor(GEN_ACTIVE_YEAR);
    if (semTxt && semTxt !== '—') {
      safe.text(genHeaderAY, `${ayTxt} · ${semTxt}`);
    } else {
      safe.text(genHeaderAY, ayTxt);
    }
  }

  function updateActiveContextUI() {
    const isActive = isActiveContext();

    // 1) Buttons that MODIFY data (lock when NOT active) - BUT KEEP addPaymentBtn ALWAYS ENABLED
    const lockButtons = [
      genSaveFeeBtn,
      // genAddPaymentBtn, // REMOVED - users should always be able to add payments
      // confirmAddPaymentBtn // REMOVED - so treasurers can accept late payments
    ];
    lockButtons.forEach(btn => setBtnEnabled(btn, isActive));

    // 2) Buttons that should ALWAYS be usable
    [genAddPaymentBtn, genPrintBtn, genPrintPaidBtn, genPrintUnpaidBtn, genExportPaidBtn, genExportUnpaidBtn]
      .forEach(btn => setBtnEnabled(btn, true));

    // 3) Fee inputs - only amount and description should be editable
    // Title and currency are now read-only
    if (genFeeTitle) {
      genFeeTitle.readOnly = true; // Always read-only
      genFeeTitle.disabled = false; // But not disabled (so it's visible)
    }
    
    if (genFeeAmount) {
      genFeeAmount.disabled = !isActive; // Only amount is editable in active context
    }
    
    if (genFeeCurrency) {
      genFeeCurrency.readOnly = true; // Always read-only
      genFeeCurrency.disabled = true; // Always disabled (PHP fixed)
    }
    
    if (genFeeDescription) {
      genFeeDescription.disabled = !isActive;
    }
    
    if (genTreasurerName) {
      genTreasurerName.disabled = !isActive;
    }

    // 4) Toggle READ-ONLY badge
    const badge = document.getElementById('genReadOnlyBadge');
    if (badge) {
      if (isActive) {
        badge.classList.add('d-none');
      } else {
        badge.classList.remove('d-none');
      }
    }
  }

  // ===== init (idempotent) =====
  async function init(){
    if (mounted) return;
    root = document.querySelector('#general-fees');
    if (!root) return;
    mounted = true;

    // query elements
    genAySpanSelect = root.querySelector('#genAySpanSelect');
    genActiveYearSelect = root.querySelector('#genActiveYearSelect');
    genRefreshBtn = root.querySelector('#genRefreshBtn');
    genOrgSearch = root.querySelector('#genOrgSearch');
    genOrgGrid = root.querySelector('#genOrgGrid');
    genEmptyState = root.querySelector('#genEmptyState');
    genGridView = root.querySelector('#genGridView');
    genDetailView = root.querySelector('#genDetailView');
    genBackToGrid = root.querySelector('#genBackToGrid');

    genOrgTitle = root.querySelector('#genOrgTitle');
    genOrgSubtitle = root.querySelector('#genOrgSubtitle');
    genOrgStatusBadge = root.querySelector('#genOrgStatusBadge');
    // 🔁 HEADER: resolve globally first (in case it's outside #general-fees)
    genHeaderAY = document.getElementById('genHeaderAY') || root.querySelector('#genHeaderAY');
    genOrgInfo = root.querySelector('#genOrgInfo');

    // unified org form (fee + treasurer)
    genFeeForm = root.querySelector('#genFeeForm');
    genFeeTitle = root.querySelector('#genFeeTitle');
    genFeeAmount = root.querySelector('#genFeeAmount');
    genFeeCurrency = root.querySelector('#genFeeCurrency');
    genFeeDescription = root.querySelector('#genFeeDescription');
    genTreasurerName = root.querySelector('#genTreasurerName');
    genTreasurerIdHidden = root.querySelector('#genTreasurerIdHidden');
    genTreasurerSuggest = root.querySelector('#genTreasurerSuggest');
    genCurrentFeeSummary = root.querySelector('#genCurrentFeeSummary');
    genFeeAlert = root.querySelector('#genFeeAlert');
    genSaveFeeBtn = root.querySelector('#genSaveFeeBtn');

    // tables/controls
    genPaidTbody = root.querySelector('#genPaidTbody');
    genUnpaidTbody = root.querySelector('#genUnpaidTbody');
    genPaidSearch = root.querySelector('#genPaidSearch');
    genUnpaidSearch = root.querySelector('#genUnpaidSearch');
    genAddPaymentBtn = root.querySelector('#genAddPaymentBtn');
    genExportUnpaidBtn = root.querySelector('#genExportUnpaidBtn');
    genExportPaidBtn = root.querySelector('#genExportPaidBtn');
    genPrintPaidBtn = root.querySelector('#genPrintPaidBtn');
    genPrintUnpaidBtn = root.querySelector('#genPrintUnpaidBtn');
    
    // pagination containers
    genPaidPagination = root.querySelector('#genPaidPagination');
    genUnpaidPagination = root.querySelector('#genUnpaidPagination');

    // reports/print
    genKpiToday = root.querySelector('#genKpiToday');
    genKpiWeek = root.querySelector('#genKpiWeek');
    genKpiMonth = root.querySelector('#genKpiMonth');
    genKpiSemester = root.querySelector('#genKpiSemester');
    genKpiUnpaid = root.querySelector('#genKpiUnpaid');
    genPrintBtn = root.querySelector('#genPrintBtn');
    genPrintArea = root.querySelector('#genPrintArea');
    genPrintOrgName = root.querySelector('#genPrintOrgName');
    genPrintAY = root.querySelector('#genPrintAY');
    genPrintActive = root.querySelector('#genPrintActive');
    genPToday = root.querySelector('#genPToday');
    genPWeek = root.querySelector('#genPWeek');
    genPMonth = root.querySelector('#genPMonth');
    genPSemester = root.querySelector('#genPSemester');
    genPUnpaid = root.querySelector('#genPUnpaid');
    genPrintPaymentsBody = root.querySelector('#genPrintPaymentsBody');
    genPrintTotalAmount = root.querySelector('#genPrintTotalAmount');

    // Payment modal nodes (modal is outside #general-fees; use document)
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
    if (!genExportPaidBtn && genAddPaymentBtn?.parentElement) {
      genExportPaidBtn = document.createElement('button');
      genExportPaidBtn.id = 'genExportPaidBtn';
      genExportPaidBtn.type = 'button';
      genExportPaidBtn.className = 'btn btn-outline-secondary';
      genExportPaidBtn.textContent = 'Export CSV';
      genAddPaymentBtn.parentElement.insertBefore(genExportPaidBtn, genAddPaymentBtn.nextSibling);
    }

    // If print buttons don't exist, inject them
    if (!genPrintPaidBtn && genAddPaymentBtn?.parentElement) {
      genPrintPaidBtn = document.createElement('button');
      genPrintPaidBtn.id = 'genPrintPaidBtn';
      genPrintPaidBtn.type = 'button';
      genPrintPaidBtn.className = 'btn btn-outline-secondary';
      genPrintPaidBtn.innerHTML = '<i class="bi bi-printer me-1"></i>Print Paid List';
      genAddPaymentBtn.parentElement.insertBefore(genPrintPaidBtn, genExportPaidBtn?.nextSibling || genAddPaymentBtn.nextSibling);
    }

    if (!genPrintUnpaidBtn && genExportUnpaidBtn?.parentElement) {
      genPrintUnpaidBtn = document.createElement('button');
      genPrintUnpaidBtn.id = 'genPrintUnpaidBtn';
      genPrintUnpaidBtn.type = 'button';
      genPrintUnpaidBtn.className = 'btn btn-outline-secondary';
      genPrintUnpaidBtn.innerHTML = '<i class="bi bi-printer me-1"></i>Print Unpaid List';
      genExportUnpaidBtn.parentElement.insertBefore(genPrintUnpaidBtn, genExportUnpaidBtn.nextSibling);
    }

    // If pagination containers don't exist, create them
    if (!genPaidPagination) {
      const paidTableContainer = genPaidTbody?.closest('.table-responsive')?.parentElement || 
                               genPaidTbody?.closest('.table')?.parentElement;
      if (paidTableContainer) {
        genPaidPagination = document.createElement('div');
        genPaidPagination.id = 'genPaidPagination';
        genPaidPagination.className = 'd-flex justify-content-between align-items-center mt-3';
        paidTableContainer.appendChild(genPaidPagination);
      }
    }

    if (!genUnpaidPagination) {
      const unpaidTableContainer = genUnpaidTbody?.closest('.table-responsive')?.parentElement || 
                                  genUnpaidTbody?.closest('.table')?.parentElement;
      if (unpaidTableContainer) {
        genUnpaidPagination = document.createElement('div');
        genUnpaidPagination.id = 'genUnpaidPagination';
        genUnpaidPagination.className = 'd-flex justify-content-between align-items-center mt-3';
        unpaidTableContainer.appendChild(genUnpaidPagination);
      }
    }

    // load & render
    await loadAY();          // fills selects and sets GEN_ACTIVE_SPAN/YEAR
    await loadOrgs();        // fills GEN_ORGS for the chosen span
    renderGrid();
    updateActiveContextUI();

    // handlers
    genAySpanSelect?.addEventListener('change', onSpanChange);
    genActiveYearSelect?.addEventListener('change', onActiveYearChange);
    genRefreshBtn?.addEventListener('click', () => {
      loadOrgs().then(renderGrid);
      if (GEN_SELECTED) openOrg(GEN_SELECTED.org.id, {silent:true});
    });
    genOrgSearch?.addEventListener('input', () => { filterGrid(genOrgSearch.value); renderGrid(); });
    genBackToGrid?.addEventListener('click', () => { genDetailView.classList.add('d-none'); genGridView.classList.remove('d-none'); });
    genPrintBtn?.addEventListener('click', printSummaryReport);
    genPrintPaidBtn?.addEventListener('click', printPaidList);
    genPrintUnpaidBtn?.addEventListener('click', printUnpaidList);

    // dirty tracking
    [genFeeTitle, genFeeAmount, genFeeCurrency, genFeeDescription, genTreasurerName].forEach(el=>{
      el?.addEventListener('input', ()=> feeFormDirty = true);
      el?.addEventListener('change', ()=> feeFormDirty = true);
    });

    // unified save
    genFeeForm?.addEventListener('submit', onSaveOrgFeeAndTreasurer);

    // treasurer typeahead
    genTreasurerName?.addEventListener('input', onTreasurerInput);
    genTreasurerName?.addEventListener('keydown', onTreasurerKeydown);
    document.addEventListener('click', (e)=> {
      if (genTreasurerSuggest && !genTreasurerSuggest.contains(e.target) && e.target !== genTreasurerName) hideTreasurerSuggest();
      if (payerSuggestPay && !payerSuggestPay.contains(e.target) && e.target !== payerNameInput) hidePayerSuggest();
    });

    genPaidSearch?.addEventListener('input', () => {
      PAGINATION_CONFIG.paid.currentPage = 1;
      renderPaid();
    });
    genUnpaidSearch?.addEventListener('input', () => {
      PAGINATION_CONFIG.unpaid.currentPage = 1;
      renderUnpaid();
    });
    genExportPaidBtn?.addEventListener('click', exportPaidCSV);

    // Payment modal open
    if (genAddPaymentBtn) {
      genAddPaymentBtn.addEventListener('click', () => {
        if (!GEN_SELECTED?.fee) { showError('Set a fee first.'); return; }
        // Prefill
        if (payerNameInput)   payerNameInput.value   = '';
        if (payerIdHiddenPay) payerIdHiddenPay.value = '';
        if (payAmountInput)   payAmountInput.value   = (GEN_SELECTED.fee.amount ?? '') + '';
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
    if (genPaidTbody) {
      genPaidTbody.addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-action="print-receipt"]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const row = (GEN_SELECTED?.payments||[]).find(x=>String(x.id)===String(id));
        if (!row) { showError('Receipt not found.'); return; }
        printSingleReceipt(row);
      });
    }

    // periodic refresh (slow, and don't clobber forms while editing)
    intervalId = setInterval(async () => {
      await loadOrgs();
      renderGrid();
      if (GEN_SELECTED && !document.querySelector('.modal.show')) {
        await openOrg(GEN_SELECTED.org.id, {silent:true});
      }
    }, 15000);
  }

  // ===== destroy on unmount =====
  function destroy(){
    if (!mounted) return;
    mounted = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    GEN_SELECTED = null; GEN_ORGS = []; GEN_FILTERED_ORGS = []; GEN_AY_SPANS = []; GEN_ACTIVE_SPAN = null; GEN_ACTIVE_YEAR = null;
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

  // Map raw year to Semester label based on current active span
  function semLabelFor(year) {
    if (year == null || year === '') return '—';
    if (!GEN_ACTIVE_SPAN) return String(year);
    const y = Number(year);
    if (!Number.isFinite(y)) return String(year);
    if (+GEN_ACTIVE_SPAN.start_year === y) return '1st Semester';
    if (+GEN_ACTIVE_SPAN.end_year   === y) return '2nd Semester';
    return String(year);
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

  // ===== AY =====
  async function loadAY(){
    try{
      const activeRaw = await fetchJSON('php/get-active-academic-year.php?t='+Date.now());
      const active = normalizeActiveAY(activeRaw);

      const listRaw = await fetchJSON('php/get-academic-years.php?t='+Date.now());
      const list = normalizeAYList(listRaw);

      const inList = list.find(a => a.start_year===active.start_year && a.end_year===active.end_year);
      GEN_AY_SPANS = inList ? list : [{...active, status:'Active'}, ...list];

      GEN_ACTIVE_SPAN = { start_year: active.start_year, end_year: active.end_year };
      GEN_ACTIVE_YEAR = Number.isFinite(active.active_year) ? active.active_year : active.start_year;
    }catch(e){
      console.warn('[general-fees] loadAY active failed, falling back:', e);
      try{
        const listRaw = await fetchJSON('php/get-academic-years.php?t='+Date.now());
        const list = normalizeAYList(listRaw);
        if (!list.length) throw new Error('No AY rows');
        GEN_AY_SPANS = list;
        const act = list.find(a => String(a.status).toLowerCase()==='active') || list[0];
        GEN_ACTIVE_SPAN = { start_year: act.start_year, end_year: act.end_year };
        GEN_ACTIVE_YEAR = Number.isFinite(act.active_year) ? act.active_year : act.start_year;
      }catch(e2){
        console.error('[general-fees] loadAY error:', e2);
        GEN_AY_SPANS = [];
        GEN_ACTIVE_SPAN = null; GEN_ACTIVE_YEAR = null;
      }
    }

    genAySpanSelect.innerHTML = GEN_AY_SPANS.map(a=>{
      const sel = (+a.start_year===+GEN_ACTIVE_SPAN?.start_year && +a.end_year===+GEN_ACTIVE_SPAN?.end_year) ? 'selected':'';
      const tag = (String(a.status).toLowerCase()==='active') ? ' (Active)' : '';
      return `<option value="${a.start_year}-${a.end_year}" ${sel}>${_esc(a.start_year)}–${_esc(a.end_year)}${tag}</option>`;
    }).join('') || `<option value="">—</option>`;

    renderActiveYearOptions();

    if (GEN_ACTIVE_SPAN) {
      const v = `${GEN_ACTIVE_SPAN.start_year}-${GEN_ACTIVE_SPAN.end_year}`;
      if (genAySpanSelect && genAySpanSelect.value !== v) genAySpanSelect.value = v;
    }
    if (GEN_ACTIVE_YEAR && genActiveYearSelect && genActiveYearSelect.value !== String(GEN_ACTIVE_YEAR)) {
      genActiveYearSelect.value = String(GEN_ACTIVE_YEAR);
    }

    updateHeaderAYSpan();
    updateActiveContextUI();
  }

  function renderActiveYearOptions(){
    const sy = GEN_ACTIVE_SPAN?.start_year, ey = GEN_ACTIVE_SPAN?.end_year;
    if(!sy || !ey){
      if (genActiveYearSelect) genActiveYearSelect.innerHTML = `<option value="">—</option>`;
      return;
    }
    const yOpt = `
      <option value="${sy}" ${+GEN_ACTIVE_YEAR===+sy ? 'selected':''}>1st Semester</option>
      <option value="${ey}" ${+GEN_ACTIVE_YEAR===+ey ? 'selected':''}>2nd Semester</option>
    `;
    if (genActiveYearSelect) genActiveYearSelect.innerHTML = yOpt;
  }

  function onSpanChange(){
    const [sy,ey] = (genAySpanSelect.value||'').split('-').map(v=>parseInt(v,10));
    if(Number.isFinite(sy) && Number.isFinite(ey)){
      GEN_ACTIVE_SPAN = {start_year:sy, end_year:ey};
      GEN_ACTIVE_YEAR = sy; // default to first year of span
      renderActiveYearOptions();
      loadOrgs().then(renderGrid);
      updateHeaderAYSpan();
      updateActiveContextUI();
      // reset detail when span changes (prevents carrying over wrong semester data)
      if(GEN_SELECTED){
        genDetailView.classList.add('d-none'); genGridView.classList.remove('d-none'); GEN_SELECTED=null;
      }
    }
  }

  async function onActiveYearChange(){
    const y = parseInt(genActiveYearSelect.value,10);
    if(!Number.isFinite(y)) return;
    GEN_ACTIVE_YEAR = y;
    updateHeaderAYSpan();
    updateActiveContextUI();

    // Force a full, ordered refresh against the current org
    if (GEN_SELECTED) {
      console.debug('[general-fees] onActiveYearChange -> refresh', { GEN_ACTIVE_YEAR, GEN_ACTIVE_SPAN, org: GEN_SELECTED.org?.id });
      await loadAllStudents();
      await loadFee(GEN_SELECTED.org?.id);
      await loadPayments();
      renderFee();
      renderPaid();
      renderUnpaid();
      computeKPIs();
      renderPrintPayments();
    }
  }

  // ===== Orgs (general/inclusive only) =====
  async function loadOrgs(){
    try{
      const qs = new URLSearchParams({ scope: 'general', t: Date.now().toString() });
      if (GEN_ACTIVE_SPAN?.start_year && GEN_ACTIVE_SPAN?.end_year) {
        qs.set('start_year', GEN_ACTIVE_SPAN.start_year);
        qs.set('end_year', GEN_ACTIVE_SPAN.end_year);
      }
      const url = 'php/get-accreditation-organizations.php?' + qs.toString();
      const raw = await fetchJSON(url);

      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.organizations) ? raw.organizations : []);
      GEN_ORGS = list.filter(o => ['general','inclusive'].includes(String(o.scope).toLowerCase()));
      filterGrid(genOrgSearch?.value);
    }catch(e){
      console.error('[general-fees] loadOrgs error:', e);
      showError('Failed to load organizations.');
      GEN_ORGS = []; GEN_FILTERED_ORGS = [];
    }
  }

  function filterGrid(q){
    q = String(q||'').toLowerCase().trim();
    if(!q){ GEN_FILTERED_ORGS = GEN_ORGS.slice(); return; }
    GEN_FILTERED_ORGS = GEN_ORGS.filter(o =>
      String(o.name||'').toLowerCase().includes(q) ||
      String(o.abbreviation||'').toLowerCase().includes(q)
    );
  }

  function renderGrid(){
    genOrgGrid.innerHTML = '';
    if (!GEN_FILTERED_ORGS.length) {
      const ayText = prettyAY(GEN_ACTIVE_SPAN?.start_year, GEN_ACTIVE_SPAN?.end_year);
      genEmptyState.innerHTML = `
        <div class="mb-2">No organizations found for AY ${_esc(ayText)}.</div>
        <div class="small">Try changing the Academic Year filters or your search.</div>
      `;
      genEmptyState.classList.remove('d-none');
      return;
    }

    genEmptyState.classList.add('d-none');

    GEN_FILTERED_ORGS.forEach(o => {
      const ay = prettyAY(o.start_year || o.active_start_year, o.end_year || o.active_end_year);

      // ✅ Use logo_path if present, else placeholder
      const logo = o.logo_path
        ? `${_esc(o.logo_path)}`
        : 'assets/images/image-placeholder.svg';

      const badge  = statusBadge(o.status);
      const abbr   = o.abbreviation ? `(${_esc(o.abbreviation)})` : '';
      const status = String(o.status || '').toLowerCase();
      const clickable = (status === 'accredited' || status === 'reaccredited');
      const disabledStyle = clickable ? '' : 'opacity:.6;';
      const tooltip = clickable ? '' : 'title="Only Accredited/Reaccredited orgs are manageable"';

      genOrgGrid.insertAdjacentHTML('beforeend', `
        <div class="col-12 col-sm-6 col-lg-4 col-xxl-3 d-flex">
          <div class="card gen-org-card w-100 ${clickable ? '' : 'disabled'}"
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

    genOrgGrid.querySelectorAll('.gen-org-card').forEach(card => {
      const clickable = card.getAttribute('data-clickable') === '1';
      if (!clickable) return; // only accredited/reaccredited are clickable
      card.addEventListener('click', () => openOrg(parseInt(card.dataset.id, 10)));
    });
  }

  // ===== Detail =====
  async function openOrg(orgId, {silent=false} = {}){
    const org = GEN_ORGS.find(o=>+o.id===+orgId);
    if(!org) return;

    GEN_SELECTED = GEN_SELECTED && GEN_SELECTED.org && GEN_SELECTED.org.id===org.id
      ? GEN_SELECTED
      : { org, fee:null, payments:[], summary:null, students:[] };

    window.GEN_SELECTED = GEN_SELECTED;

    safe.text(genOrgTitle, org.name || '—');
    safe.text(genOrgSubtitle, `${org.abbreviation? '('+org.abbreviation+')':''}`);
    safe.text(genOrgStatusBadge, org.status || '—');
    if (genOrgStatusBadge) genOrgStatusBadge.className = `badge ${statusBadge(org.status)} badge-status`;

    updateHeaderAYSpan();

    if (genOrgInfo) {
      genOrgInfo.innerHTML = `
        <div><span class="text-muted"><i class="bi bi-person-workspace me-1"></i>Scope:</span> General/Inclusive</div>
        <div><span class="text-muted"><i class="bi bi-mortarboard me-1"></i>Course:</span> ${_esc(org.course_abbr||'—')}</div>
        <div><span class="text-muted"><i class="bi bi-calendar3 me-1"></i>AY:</span> ${prettyAY(org.start_year||org.active_start_year, org.end_year||org.active_end_year)}</div>
        <div><span class="text-muted"><i class="bi bi-clock-history me-1"></i>Semester:</span> ${_esc(semLabelFor(GEN_ACTIVE_YEAR) ?? '—')}</div>
        <div><span class="text-muted"><i class="bi bi-patch-check-fill me-1"></i>Status:</span> ${_esc(org.status||'—')}</div>
      `;
    }

    console.debug('[general-fees] openOrg', { orgId, GEN_ACTIVE_YEAR, GEN_ACTIVE_SPAN });

    // Load ALL students (general fees)
    await loadAllStudents();
    await loadFee(org.id);
    await loadPayments();

    renderFee();
    renderPaid();
    renderUnpaid();
    computeKPIs();

    safe.text(genPrintOrgName, org.name || '—');
    safe.text(genPrintAY, prettyAY(GEN_ACTIVE_SPAN?.start_year, GEN_ACTIVE_SPAN?.end_year));
    safe.text(genPrintActive, semLabelFor(GEN_ACTIVE_YEAR) ?? '—');
    renderPrintPayments();

    updateActiveContextUI();

    if (!silent) {
      genGridView?.classList.add('d-none');
      genDetailView?.classList.remove('d-none');
    }
  }

  // ===== Fee + Treasurer =====
  async function loadFee(org_id){
    const mySeq = ++feeFetchSeq;
    try{
      const q = new URLSearchParams({
        org_id,
        fee_category: 'general',
        active_year: String(GEN_ACTIVE_YEAR ?? ''),
      });
      if (GEN_ACTIVE_SPAN?.start_year) q.set('start_year', GEN_ACTIVE_SPAN.start_year);
      if (GEN_ACTIVE_SPAN?.end_year)   q.set('end_year',   GEN_ACTIVE_SPAN.end_year);

      const data = await fetchJSON('php/get-organization-fee.php?'+q.toString());
      if (mySeq !== feeFetchSeq) return;
      GEN_SELECTED.fee = data?.fee || null;
      console.debug('[general-fees] loadFee', { org_id, GEN_ACTIVE_YEAR, GEN_ACTIVE_SPAN, fee: GEN_SELECTED.fee });
    }catch(e){
      if (mySeq !== feeFetchSeq) return;
      console.error('[general-fees] loadFee error:', e);
      GEN_SELECTED.fee = null;
    }
  }

  function renderFee(){
  const f = GEN_SELECTED.fee;
  if(!f){
    safe.show(genFeeAlert);
    safe.text(genFeeAlert, 'No fee set for this organization and semester. Create one below.');
    if (!feeFormDirty) {
      // Always generate fee title from org name
      const orgName = GEN_SELECTED?.org?.name || 'Organization';
      if (genFeeTitle) {
        genFeeTitle.value = `${orgName} Fee`;
        genFeeTitle.readOnly = true; // Make it read-only
      }
      if (genFeeAmount) genFeeAmount.value = '';
      if (genFeeCurrency) {
        genFeeCurrency.value = 'PHP';
        genFeeCurrency.readOnly = true; // Make it read-only
        genFeeCurrency.disabled = true; // Also disable it
      }
      if (genFeeDescription) genFeeDescription.value = '';
      if (genTreasurerName) genTreasurerName.value = '';
      if (genTreasurerIdHidden) genTreasurerIdHidden.value = '';
    }
    safe.text(genCurrentFeeSummary, '—');
    return;
  }
  
  genFeeAlert?.classList.add('d-none');
  if (!feeFormDirty) {
    // ALWAYS overwrite with org name + Fee format
    const orgName = GEN_SELECTED?.org?.name || 'Organization';
    if (genFeeTitle) {
      genFeeTitle.value = `${orgName} Fee`; // Always overwrite
      genFeeTitle.readOnly = true; // Make it read-only
    }
    if (genFeeAmount) genFeeAmount.value = f.amount || '';
    if (genFeeCurrency) {
      genFeeCurrency.value = 'PHP';
      genFeeCurrency.readOnly = true; // Make it read-only
      genFeeCurrency.disabled = true; // Also disable it
    }
    if (genFeeDescription) genFeeDescription.value = f.description || '';
  }

  // treasurer: show name (if we know it), submit ID
  const id = f.treasurer_id_number || '';
  if (id) {
    const s = (GEN_SELECTED.students||[]).find(x=>String(x.id_number)===String(id));
    if (genTreasurerName) genTreasurerName.value = s ? `${s.full_name} (${s.id_number})` : id;
    if (genTreasurerIdHidden) genTreasurerIdHidden.value = id;
  } else {
    if (!feeFormDirty) {
      if (genTreasurerName) genTreasurerName.value = '';
      if (genTreasurerIdHidden) genTreasurerIdHidden.value = '';
    }
  }

  const activeLbl = semLabelFor(f.active_year ?? GEN_ACTIVE_YEAR);
  const spanTxt = (f.start_year && f.end_year)
    ? `AY ${_esc(f.start_year)}–${_esc(f.end_year)}`
    : `Semester: ${_esc(activeLbl)}`;

  // Show AY-only hint if payments lack active_year
  const ayOnly = !(GEN_SELECTED?.payments||[]).some(p => p.active_year != null && p.active_year !== '');
  safe.html(
    genCurrentFeeSummary,
    `${_esc(f.title)} — <strong>${money(f.amount, f.currency)}</strong> (${spanTxt})` +
    (ayOnly ? ` <span class="text-muted ms-1">(AY-only data)</span>` : '')
    );
  }

  async function onSaveOrgFeeAndTreasurer(e){
  e.preventDefault();
  const org_id = GEN_SELECTED?.org?.id;
  if(!org_id){ showError('No organization selected.'); return; }
  if (!GEN_ACTIVE_YEAR){ showError('Academic Year not loaded yet.'); return; }

  // Treasurer must be chosen (schema NOT NULL + FK)
  const treasId = (genTreasurerIdHidden?.value || '').trim();
  if (!treasId) { showError('Please choose a Treasurer from the suggestions.'); genTreasurerName?.focus(); return; }

  const payload = new FormData();
  payload.set('org_id', org_id);
  payload.set('fee_category', 'general');
  
  // ALWAYS use org name + Fee format
  const orgName = GEN_SELECTED?.org?.name || 'Organization';
  payload.set('title', `${orgName} Fee`);
  
  payload.set('amount', (genFeeAmount?.value||'').trim());
  payload.set('currency', 'PHP'); // Always PHP
  payload.set('description', (genFeeDescription?.value||'').trim());
  payload.set('active_year', String(GEN_ACTIVE_YEAR));
  payload.set('treasurer_id_number', treasId);
  if (GEN_ACTIVE_SPAN?.start_year) payload.set('start_year', GEN_ACTIVE_SPAN.start_year);
  if (GEN_ACTIVE_SPAN?.end_year)   payload.set('end_year',   GEN_ACTIVE_SPAN.end_year);

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
    if (genTreasurerIdHidden) genTreasurerIdHidden.value = '';
    const q = (genTreasurerName?.value || '').trim().toLowerCase();
    renderTreasurerSuggest(q);
  }

  function onTreasurerKeydown(e){
    if (e.key === 'Enter') {
      const first = genTreasurerSuggest?.querySelector?.('[data-id]');
      if (first) { pickTreasurer(first.dataset.id, first.dataset.label); e.preventDefault(); }
    }
  }

  function renderTreasurerSuggest(q){
    if (!genTreasurerSuggest) return;
    const all = (GEN_SELECTED?.students || []);
    let results = [];
    if (q) {
      results = all.filter(s =>
        String(s.id_number||'').toLowerCase().includes(q) ||
        String(s.full_name||'').toLowerCase().includes(q)
      ).slice(0,8);
    }
    if (!q || results.length === 0) {
      genTreasurerSuggest.innerHTML = '';
      genTreasurerSuggest.classList.add('d-none');
      return;
    }
    genTreasurerSuggest.innerHTML = results.map(s=>{
      const label = `${s.full_name} (${s.id_number})`;
      return `<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" data-id="${_esc(s.id_number)}" data-label="${_esc(label)}">
        <span>${_esc(s.full_name)}</span>
        <span class="text-muted small">${_esc(s.id_number)}</span>
      </button>`;
    }).join('');
    genTreasurerSuggest.classList.remove('d-none');
    genTreasurerSuggest.onclick = (e)=>{
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      pickTreasurer(btn.dataset.id, btn.dataset.label);
    };
  }

  function pickTreasurer(id, label){
    if (genTreasurerName) genTreasurerName.value = label || id;
    if (genTreasurerIdHidden) genTreasurerIdHidden.value = id;
    hideTreasurerSuggest();
  }

  function hideTreasurerSuggest(){
    if (!genTreasurerSuggest) return;
    genTreasurerSuggest.innerHTML = '';
    genTreasurerSuggest.classList.add('d-none');
  }

  // ---- Payer typeahead (Payment modal) ----
  function onPayerInput(){
    if (payerIdHiddenPay) payerIdHiddenPay.value = '';
    const q = (payerNameInput?.value || '').trim().toLowerCase();
    renderPayerSuggest(q);
  }

  function renderPayerSuggest(q){
    if (!payerSuggestPay) return;
    const all = (GEN_SELECTED?.students || []);
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
    const f = GEN_SELECTED?.fee;
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
    if (GEN_ACTIVE_SPAN?.start_year) fd.set('start_year', GEN_ACTIVE_SPAN.start_year);
    if (GEN_ACTIVE_SPAN?.end_year)   fd.set('end_year',   GEN_ACTIVE_SPAN.end_year);
    fd.set('active_year', String(f.active_year ?? GEN_ACTIVE_YEAR ?? ''));

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
    const f = GEN_SELECTED?.fee;
    if(!f){
      GEN_SELECTED.payments=[]; GEN_SELECTED.summary=null;
      return;
    }
    const mySeq = ++paymentsFetchSeq;

    // Helper: client-filter by span and active_year
    const clientFilter = (rows) => {
      const sy = +GEN_ACTIVE_SPAN?.start_year;
      const ey = +GEN_ACTIVE_SPAN?.end_year;
      const ay = +GEN_ACTIVE_YEAR;

      const keep = rows.filter(p => {
        // Span filter only if row has BOTH start_year & end_year
        let bySpan = true;
        const hasSpan = p.start_year != null && p.start_year !== '' &&
                        p.end_year   != null && p.end_year   !== '';
        if (hasSpan && sy && ey) {
          bySpan = (+p.start_year === sy) && (+p.end_year === ey);
        }

        // Active-year (semester) filter only if row has active_year
        let byAY = true;
        const hasAY = p.active_year != null && p.active_year !== '';
        if (hasAY && ay) {
          byAY = (+p.active_year === ay);
        }

        return bySpan && byAY;
      });

      if (window.GEN_FEES_DEBUG) {
        console.debug('[general-fees] clientFilter:', {
          in: rows.length, out: keep.length, sy, ey, ay,
          sample: rows.slice(0,3)
        });
      }
      return keep;
    };

    try{
      // First try WITH active_year (correct case)
      const q1 = new URLSearchParams({ org_fee_id: f.id });
      if (GEN_ACTIVE_YEAR != null) q1.set('active_year', String(GEN_ACTIVE_YEAR));
      if (GEN_ACTIVE_SPAN?.start_year) q1.set('start_year', GEN_ACTIVE_SPAN.start_year);
      if (GEN_ACTIVE_SPAN?.end_year)   q1.set('end_year',   GEN_ACTIVE_SPAN.end_year);

      console.debug('[general-fees] loadPayments primary', Object.fromEntries(q1.entries()));
      const data1 = await fetchJSON('php/get-organization-fee-payments.php?'+q1.toString());
      if (mySeq !== paymentsFetchSeq) return;

      let rows = Array.isArray(data1?.payments) ? data1.payments : [];
      let summary = data1?.summary || null;

      // Backend fallback: if empty, retry WITHOUT active_year and then filter on client
      if (!rows.length) {
        const q2 = new URLSearchParams({ org_fee_id: f.id });
        if (GEN_ACTIVE_SPAN?.start_year) q2.set('start_year', GEN_ACTIVE_SPAN.start_year);
        if (GEN_ACTIVE_SPAN?.end_year)   q2.set('end_year',   GEN_ACTIVE_SPAN.end_year);
        console.debug('[general-fees] loadPayments fallback', Object.fromEntries(q2.entries()));

        const data2 = await fetchJSON('php/get-organization-fee-payments.php?'+q2.toString());
        if (mySeq !== paymentsFetchSeq) return;
        rows = Array.isArray(data2?.payments) ? clientFilter(data2.payments) : [];
        summary = data2?.summary || null;
      }

      // Extra permissive: only org_fee_id (some backends ignore extras)
      if (!rows.length) {
        const q3 = new URLSearchParams({ org_fee_id: f.id });
        console.debug('[general-fees] loadPayments permissive', Object.fromEntries(q3.entries()));
        const data3 = await fetchJSON('php/get-organization-fee-payments.php?' + q3.toString());
        if (mySeq !== paymentsFetchSeq) return;
        rows = Array.isArray(data3?.payments) ? clientFilter(data3.payments) : [];
        summary = data3?.summary || summary;
      }

      GEN_SELECTED.payments = rows;
      GEN_SELECTED.summary  = summary;
      console.debug('[general-fees] payments loaded', { count: rows.length, GEN_ACTIVE_YEAR, GEN_ACTIVE_SPAN, fee_id: f.id });
    }catch(e){
      if (mySeq !== paymentsFetchSeq) return;
      console.error('[general-fees] loadPayments error:', e);
      GEN_SELECTED.payments = []; GEN_SELECTED.summary = null;
    }
  }

  function getPaidFilteredRows(){
    const qRaw = (genPaidSearch?.value || '').trim().toLowerCase();
    const rows = (GEN_SELECTED?.payments || []);
    if (!qRaw) return rows.slice();

    const terms = qRaw.split(/\s+/).filter(Boolean);
    const t = v => String(v ?? '').toLowerCase();

    return rows.filter(p => {
      const course      = p.course_abbr ?? p.department ?? GEN_SELECTED?.org?.course_abbr ?? '';
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
    const f = GEN_SELECTED?.fee;
    const allRows = getPaidFilteredRows();
    
    // Update pagination config
    PAGINATION_CONFIG.paid.totalItems = allRows.length;
    PAGINATION_CONFIG.paid.totalPages = Math.ceil(allRows.length / PAGINATION_CONFIG.paid.pageSize);
    
    // Get paginated rows
    const rows = getPaginatedRows(allRows, PAGINATION_CONFIG.paid);
    
    if (!genPaidTbody) return;

    genPaidTbody.innerHTML = '';

    if (!f) {
      genPaidTbody.innerHTML = `<tr><td colspan="10" class="text-muted">Set a fee to see payments.</td></tr>`;
      return;
    }
    if (!rows.length) {
      genPaidTbody.innerHTML = `<tr><td colspan="10" class="text-muted">No data available</td></tr>`;
      return;
    }

    rows.forEach(p => {
      const course     = p.course_abbr ?? p.department ?? GEN_SELECTED?.org?.course_abbr ?? '—';
      const schoolYear = p.school_year ?? '—';
      const yearLevel  = p.year_level ?? p.year ?? '—';

      // define sy/ey safely for this row
      const sy  = p.start_year ?? f.start_year ?? GEN_ACTIVE_SPAN?.start_year ?? '';
      const ey  = p.end_year   ?? f.end_year   ?? GEN_ACTIVE_SPAN?.end_year   ?? '';
      const semLbl = semLabelFor(p.active_year ?? f.active_year ?? GEN_ACTIVE_YEAR ?? '—');
      const ayTxt = (sy && ey) ? `${sy}–${ey} (${semLbl})` : semLbl;

      genPaidTbody.insertAdjacentHTML('beforeend', `
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
          <td>${_esc(ayTxt)}</td>
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
    updatePagination(PAGINATION_CONFIG.paid, genPaidPagination, renderPaid);
  }

  function exportPaidCSV(){
    const rows = getPaidFilteredRows();
    if (!rows.length) { showError('Nothing to export.'); return; }
    const f = GEN_SELECTED?.fee;

    const headers = [
      'Receipt','Payer ID','Name','Course','School Year','Year Level',
      'Amount','Currency','Method','Status','Paid On',
      'AY / Semester','Start Year','End Year'
    ];
    const lines = [headers.join(',')];

    rows.forEach(p=>{
      const course     = p.course_abbr ?? p.department ?? GEN_SELECTED?.org?.course_abbr ?? '';
      const schoolYear = p.school_year ?? '';
      const yearLevel  = p.year_level ?? p.year ?? '';
      const sy  = p.start_year ?? f?.start_year ?? GEN_ACTIVE_SPAN?.start_year ?? '';
      const ey  = p.end_year   ?? f?.end_year   ?? GEN_ACTIVE_SPAN?.end_year   ?? '';
      const semLbl = semLabelFor(p.active_year ?? f?.active_year ?? GEN_ACTIVE_YEAR ?? '—');
      const ayTxt = (sy && ey) ? `${sy}–${ey} (${semLbl})` : semLbl;

      const fields = [
        p.receipt_no || '',
        p.payer_id_number || p.payer_id || '',
        p.full_name || '',
        course,
        schoolYear,
        yearLevel,
        (p.paid_amount ?? p.amount ?? '').toString(),
        (f?.currency || 'PHP'),
        p.payment_method || p.method || '',
        p.status || '',
        p.paid_on || p.paid_at || '',
        ayTxt,
        p.start_year ?? '',
        p.end_year ?? '',
      ].map(v => `"${String(v).replace(/"/g,'""')}"`);
      lines.push(fields.join(','));
    });

    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const orgAbbr = (GEN_SELECTED?.org?.abbreviation || 'general').toLowerCase();
    const spanTag = GEN_ACTIVE_SPAN ? `${GEN_ACTIVE_SPAN.start_year}-${GEN_ACTIVE_SPAN.end_year}` : 'ay';
    a.download = `paid_${orgAbbr}_${spanTag}_active-${GEN_ACTIVE_YEAR || ''}.csv`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    showSuccess('Paid list exported.');
  }

  // GENERAL FEES – uses window.GEN_SELECTED
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

  // ===== Students / Unpaid (ALL students) =====
  async function loadAllStudents(){
    const mySeq = ++rosterFetchSeq;
    try{
      // ✅ Simpler: don't filter by active_year, just send AY span (optional)
      const qs = new URLSearchParams();
      if (GEN_ACTIVE_SPAN?.start_year) qs.set('start_year', GEN_ACTIVE_SPAN.start_year);
      if (GEN_ACTIVE_SPAN?.end_year)   qs.set('end_year',   GEN_ACTIVE_SPAN.end_year);

      const url = 'php/get-all-students.php?' + qs.toString();
      const data = await fetchJSON(url);
      if (mySeq !== rosterFetchSeq) return;

      const students = Array.isArray(data?.students) ? data.students : [];

      if (window.GEN_FEES_DEBUG) {
        console.debug('[general-fees] loadAllStudents result', {
          count: students.length,
          sample: students.slice(0,3)
        });
      }

      GEN_SELECTED.students = students;
      console.debug('[general-fees] loadAllStudents', {
        count: GEN_SELECTED.students.length,
        GEN_ACTIVE_YEAR,
        GEN_ACTIVE_SPAN
      });
    }catch(e){
      if (mySeq !== rosterFetchSeq) return;
      console.error('[general-fees] loadAllStudents error:', e);
      GEN_SELECTED.students = [];
    }
  }


  function renderUnpaid(){
    const pays = (GEN_SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
    const all = GEN_SELECTED.students||[];
    let list = all.filter(s=>!paidSet.has(String(s.id_number)));
    const q = (genUnpaidSearch?.value||'').toLowerCase().trim();
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
    
    if (!genUnpaidTbody) return;
    genUnpaidTbody.innerHTML = '';
    if(!all.length){
      genUnpaidTbody.innerHTML = `<tr><td colspan="4" class="text-muted">No student data available for this semester.</td></tr>`;
      return;
    }
    if(!paginatedList.length){
      genUnpaidTbody.innerHTML = `<tr><td colspan="4" class="text-muted">Everyone is paid. 🎉</td></tr>`;
      return;
    }
    paginatedList.forEach(s=>{
      genUnpaidTbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${_esc(s.id_number||'—')}</td>
          <td>${_esc(s.full_name||'—')}</td>
          <td>${_esc(s.year_level||'—')}</td>
          <td>${_esc(s.course_abbr||s.department||'—')}</td>
        </tr>
      `);
    });
    
    // Update pagination UI
    updatePagination(PAGINATION_CONFIG.unpaid, genUnpaidPagination, renderUnpaid);
  }

  // ==== Export "Unpaid" to CSV ====
  function exportUnpaidCSV(){
    const pays = (GEN_SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
    const all = GEN_SELECTED.students||[];
    let list = all.filter(s=>!paidSet.has(String(s.id_number)));
    const q = (genUnpaidSearch?.value||'').toLowerCase().trim();
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
    const orgAbbr = (GEN_SELECTED?.org?.abbreviation || 'general').toLowerCase();
    const spanTag = GEN_ACTIVE_SPAN ? `${GEN_ACTIVE_SPAN.start_year}-${GEN_ACTIVE_SPAN.end_year}` : 'ay';
    a.download = `unpaid_${orgAbbr}_${spanTag}_active-${GEN_ACTIVE_YEAR || ''}.csv`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    showSuccess('Unpaid list exported.');
  }
  genExportUnpaidBtn?.addEventListener('click', exportUnpaidCSV);

  // ===== KPIs / Reports =====
  function computeKPIs(){
    // Prefer server summary if available (already filtered by AY + span)
    const s = GEN_SELECTED?.summary;
    if (s) {
      safe.text(genKpiToday, s.paid_today ?? 0);    safe.text(genPToday, s.paid_today ?? 0);
      safe.text(genKpiWeek,  s.paid_week ?? 0);     safe.text(genPWeek,  s.paid_week ?? 0);
      safe.text(genKpiMonth, s.paid_month ?? 0);    safe.text(genPMonth, s.paid_month ?? 0);
      safe.text(genKpiSemester, s.paid_semester ?? 0); safe.text(genPSemester, s.paid_semester ?? 0);

      // unpaid still computed client-side against roster
      const pays = (GEN_SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
      const paidSet = new Set(pays.map(p=>String(p.payer_id_number||p.payer_id)));
      const unpaid  = (GEN_SELECTED?.students||[]).filter(s=>!paidSet.has(String(s.id_number))).length;
      safe.text(genKpiUnpaid, unpaid);  safe.text(genPUnpaid, unpaid);
      return;
    }

    // Fallback: compute on client
    const pays = (GEN_SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
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
    const unpaid  = (GEN_SELECTED?.students||[]).filter(s=>!paidSet.has(String(s.id_number))).length;

    safe.text(genKpiToday, today);    safe.text(genPToday, today);
    safe.text(genKpiWeek,  week);     safe.text(genPWeek,  week);
    safe.text(genKpiMonth, month);    safe.text(genPMonth, month);
    safe.text(genKpiSemester, sem);   safe.text(genPSemester, sem);
    safe.text(genKpiUnpaid, unpaid);  safe.text(genPUnpaid, unpaid);
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

  //Do not remove --important
  function renderPrintPayments(){
    const f = GEN_SELECTED?.fee;
    const list = (GEN_SELECTED?.payments||[]).filter(p=>String(p.status).toLowerCase()==='confirmed');
    let total = 0;
    if (!genPrintPaymentsBody || !genPrintTotalAmount) return;
    genPrintPaymentsBody.innerHTML = list.map(p=>{
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
    genPrintTotalAmount.textContent = money(total, f?.currency||'PHP');
  }

  function printSummaryReport() {
  const f   = GEN_SELECTED?.fee || {};
  const org = GEN_SELECTED?.org || {};
  const payments = (GEN_SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );
  const roster = GEN_SELECTED?.students || [];

  if (!org || !f) {
    showError('No general fee selected to print.');
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

  // ===== AY / sem display (general scope) =====
  const sy  = f.start_year ?? GEN_ACTIVE_SPAN?.start_year ?? '';
  const ey  = f.end_year   ?? GEN_ACTIVE_SPAN?.end_year   ?? '';
  const ayTxt = (sy && ey) ? `${sy}-${ey}` : '—';
  const activeTxt = semLabelFor(
    GEN_SELECTED?.fee?.active_year ?? GEN_ACTIVE_YEAR ?? '—'
  );
  const nowText = now.toLocaleString();

  let content = `
    <div class="report-header">
      <h2>General Organization Fee Summary</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.abbreviation || '—')})</div>
        <div><strong>Fee:</strong> ${_esc(f.title || 'General Org Fee')}</div>
        <div><strong>Academic Year:</strong> ${_esc(ayTxt)} · Semester: ${_esc(activeTxt || '—')}</div>
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

  // ===== Confirmed payments =====
  if (!payments.length) {
    content += `<p class="no-data">No confirmed payments yet.</p>`;
  } else {
    const rowsHtml = payments.map(p => {
      const a = amt(p);
      const course = p.course_abbr ?? p.department ?? org.course_abbr ?? '—';
      const full   = p.full_name || '—';
      const ayInt  = p.active_year ?? f.active_year ?? GEN_ACTIVE_YEAR ?? '—';

      return `
        <tr>
          <td>${_esc(p.paid_on || p.paid_at || '—')}</td>
          <td><code>${_esc(p.receipt_no || '—')}</code></td>
          <td>${_esc(p.payer_id_number || p.payer_id || '—')}</td>
          <td>${_esc(full)}</td>
          <td>${_esc(course)}</td>
          <td>${_esc(ayInt)}</td>
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
            <th>Active Year</th>
            <th class="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  // ===== Unpaid =====
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

  const titleText = `${org.name || '—'} — General Fee Summary`;
  sendPDFToServer(titleText, content, 'general-fees-summary');
  }

  // === NEW: separate simple print for Paid list only ===
  function printPaidList() {
  const f   = GEN_SELECTED?.fee || {};
  const org = GEN_SELECTED?.org || {};
  const list = (GEN_SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );

  if (!org || !f) {
    showError('No general fee selected to print.');
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
      <h2>Paid Students — ${_esc(f.title || 'General Org Fee')}</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.abbreviation || '—')})</div>
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
  sendPDFToServer(titleText, content, 'general-fees-paid');
  }

  // === NEW: separate simple print for Unpaid list only ===
  function printUnpaidList() {
  const org    = GEN_SELECTED?.org || {};
  const pays   = (GEN_SELECTED?.payments || []).filter(
    p => String(p.status).toLowerCase() === 'confirmed'
  );
  const roster = GEN_SELECTED?.students || [];

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
      <h2>Unpaid Students — ${_esc(GEN_SELECTED?.fee?.title || 'General Org Fee')}</h2>
      <div class="report-meta">
        <div><strong>Organization:</strong> ${_esc(org.name || '—')} (${_esc(org.abbreviation || '—')})</div>
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
  sendPDFToServer(titleText, content, 'general-fees-unpaid');
  }

  // ===== SPA mount/unmount detection =====
  const contentArea = document.getElementById('content-area') || document.body;
  const observer = new MutationObserver(() => {
    const pageNow = document.querySelector('#general-fees');
    if (pageNow && !mounted) init();
    if (!pageNow && mounted) destroy();
  });
  observer.observe(contentArea, { childList:true, subtree:true });

  // run once in case already present
  if (document.querySelector('#general-fees')) init();
})();
//renderGrid