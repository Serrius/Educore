// manage-accreditation-special-admin.js
(() => {
  // ===== Light fallbacks (only define if missing) =====
  if (typeof window._esc !== 'function') {
    window._esc = (s) =>
      String(s ?? '').replace(/[&<>"']/g, (m) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[m]),
      );
  }

  if (typeof window.fetchJSON !== 'function') {
    window.fetchJSON = async (url, options = {}) => {
      const resp = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
        ...options,
      });
      const text = await resp.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!resp.ok) {
        const msg =
          (data && (data.error || data.message)) ||
          `Request failed (${resp.status})`;
        const err = new Error(msg);
        err.status = resp.status;
        err.data = data;
        err.raw = text;
        throw err;
      }
      return data;
    };
  }

  // Define modal functions if they don't exist
  if (typeof window.showSuccessModal !== 'function') {
    window.showSuccessModal = (m) => alert(m || 'Success');
  }
  if (typeof window.showErrorModal !== 'function') {
    window.showErrorModal = (m) => alert(m || 'Something went wrong');
  }

  const debounce = (fn, wait = 150) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, a), wait);
    };
  };

  // ===== Helpers =====
  const getLocalIdNumber = () =>
    (localStorage.getItem('id_number') || '').trim();

  const statusBadgeClass = (st) => {
    const s = String(st || '').toLowerCase();
    if (s === 'pending' || s === 'for accreditation') return 'text-bg-warning';
    if (s === 'accredited') return 'text-bg-success';
    if (s === 'reaccredited') return 'text-bg-primary';
    if (s === 'declined') return 'text-bg-danger';
    if (s === 'for reaccreditation') return 'text-bg-info';
    if (s === 'reviewed') return 'text-bg-info';
    if (s === 'submitted') return 'text-bg-secondary';
    return 'text-bg-secondary';
  };

  const normalizeStatus = (st) => {
    const s = String(st || '').toLowerCase().trim();
    if (!s) return 'unknown';
    if (s === 'for reaccreditation') return 'for reaccreditation';
    if (s === 'reaccredited') return 'reaccredited';
    if (s === 'accredited') return 'accredited';
    if (s === 'pending') return 'pending';
    if (s === 'declined' || s === 'returned') return 'declined';
    if (s === 'for accreditation') return 'for accreditation';
    if (s === 'reviewed') return 'reviewed';
    if (s === 'submitted') return 'submitted';
    return s;
  };

  const normalizeStr = (v) => String(v || '').trim().toLowerCase();

  const pretty = (s) => {
    const raw = String(s || '').trim();
    if (!raw) return '—';
    const low = raw.toLowerCase();
    const map = {
      // groups & statuses
      reaccreditation: 'Reaccreditation',
      new: 'New Accreditation',
      submitted: 'Submitted',
      reviewed: 'Reviewed',
      approved: 'Approved',
      declined: 'Returned',
      'for reaccreditation': 'For Reaccreditation',
      'for accreditation': 'For Accreditation',

      // org statuses
      pending: 'Pending',
      accredited: 'Accredited',
      reaccredited: 'Reaccredited',
      'for reaccreditation': 'For Reaccreditation',
      'for accreditation': 'For Accreditation',

      // legacy/kept
      application_letter: 'Application Letter',
      bank_passbook: 'Bank Passbook',
      certificate: 'Certificate of Accreditation',
      certificate_accreditation: 'Certificate of Accreditation',
      cbl: 'CBL',
      officers_list: 'Officers List',
      updated_list: 'Updated Officers List',

      // NEW checklist keys
      concept_paper: 'Concept Paper',
      vmgo: 'VMGO',
      logo_explanation: 'Logo Design with Explanation',
      org_chart: 'Organizational Chart',
      members_list: 'Members List',
      pds_officers: 'PDS of Officers',
      adviser_moderator_acceptance: 'Adviser/Moderator Acceptance',
      proposed_program: 'Proposed Program of Activities (New)',
      awfp: 'Annual Work & Financial Plan (AWFP)',
      accomplishment_report: 'Accomplishment Report',
      financial_statement: 'Financial Statement (Audited)',
      trainings_report: 'Report on Conduct of Trainings',
      presidents_report: "President's Report",
      advisers_report: "Adviser's/Moderator's Report",
      general_program: 'General Program of Activities (Old)',
      evaluation: 'Evaluation (Moderator/Officers/Org)',
      contact_details: 'Contact Details (Adviser/Officers)',
    };
    if (map[low]) return map[low];
    if (low === 'cbl') return 'CBL';
    return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // --- Academic Year helpers ---
  function normAY({ start, end, single } = {}) {
    if (typeof single === 'string' && /^\d{4}\s*-\s*\d{4}$/.test(single)) {
      const [s, e] = single.split('-').map((v) => parseInt(v.trim(), 10));
      if (!isNaN(s) && !isNaN(e)) {
        return { start: s, end: e, single: null, label: `${s}-${e}` };
      }
    }
    if (typeof single === 'number' && Number.isFinite(single)) {
      return { start: null, end: null, single, label: String(single) };
    }

    const si = start != null && start !== '' ? parseInt(start, 10) : null;
    const ei = end != null && end !== '' ? parseInt(end, 10) : null;

    if (Number.isFinite(si) && Number.isFinite(ei)) {
      return { start: si, end: ei, single: null, label: `${si}-${ei}` };
    }

    if (single != null && single !== '') {
      const sn = parseInt(single, 10);
      if (Number.isFinite(sn)) {
        return { start: null, end: null, single: sn, label: String(sn) };
      }
      if (typeof single === 'string') {
        return { start: null, end: null, single: null, label: single };
      }
    }

    return { start: null, end: null, single: null, label: '—' };
  }

  function ayEqual(a, b) {
    if (!a || !b) return false;
    if (a.start != null && a.end != null && b.start != null && b.end != null) {
      return (
        Number(a.start) === Number(b.start) &&
        Number(a.end) === Number(b.end)
      );
    }
    if (a.single != null && b.single != null) {
      return Number(a.single) === Number(b.single);
    }
    return a.label === b.label && a.label !== '—';
  }

  // ===== Admin search (typeahead) =====
  function initAdminTypeahead({
    input,
    menu,
    hidden,
    endpoint = 'php/get-manage-admins.php',
    getDeptFilter,
  }) {
    const elInput =
      typeof input === 'string' ? document.querySelector(input) : input;
    const elMenu =
      typeof menu === 'string' ? document.querySelector(menu) : menu;
    const elHidden =
      typeof hidden === 'string' ? document.querySelector(hidden) : hidden;

    if (!elInput || !elMenu || !elHidden) return;

    const closeMenu = () => {
      elMenu.classList.remove('show');
      elMenu.innerHTML = '';
    };
    const openMenu = () => {
      if (!elMenu.classList.contains('show')) elMenu.classList.add('show');
    };

    const renderItems = (rows = []) => {
      elMenu.innerHTML = '';
      if (!rows.length) {
        elMenu.innerHTML =
          '<span class="dropdown-item text-muted">No results</span>';
        return;
      }
      rows.forEach((u) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item text-wrap';
        btn.innerHTML = `
          <div class="fw-semibold">${_esc(u.full_name || '—')}</div>
          <small class="text-muted">${_esc(u.id_number || '')}${u.email ? ' · ' + _esc(u.email) : ''}</small>
        `;
        btn.addEventListener('click', () => {
          const idn = (u.id_number || '').trim();
          elInput.value =
            u.full_name && idn
              ? `${u.full_name} (${idn})`
              : u.full_name || idn || '';
          elHidden.value = idn;
          closeMenu();
        });
        elMenu.appendChild(btn);
      });
    };

    const doSearch = debounce(async (q) => {
      if (!q || q.length < 2) {
        closeMenu();
        return;
      }
      try {
        const url = `${endpoint}?q=${encodeURIComponent(q)}&t=${Date.now()}`;
        const data = await fetchJSON(url);

        let rows = [];
        if (Array.isArray(data)) {
          rows = data;
        } else if (data && Array.isArray(data.admins)) {
          rows = data.admins;
        } else if (data && Array.isArray(data.results)) {
          rows = data.results;
        }

        let admins = rows;
        const hasRoleAdmin = rows.some((u) =>
          String(u.role || '').toLowerCase().includes('admin'),
        );
        if (hasRoleAdmin) {
          admins = rows.filter((u) =>
            String(u.role || '').toLowerCase().includes('admin'),
          );
        }

        const qLower = q.toLowerCase();
        if (!admins.length && rows.length) {
          admins = rows.filter(
            (u) =>
              String(u.id_number || '').toLowerCase().includes(qLower) ||
              String(u.full_name || '').toLowerCase().includes(qLower),
          );
        }

        // ===== Department filter (for EXCLUSIVE scope) =====
        const filterDeptRaw =
          typeof getDeptFilter === 'function' ? getDeptFilter() : null;
        const filterDept = normalizeStr(filterDeptRaw);
        if (filterDept) {
          admins = admins.filter(
            (u) => normalizeStr(u.department) === filterDept,
          );
        }

        renderItems(admins.slice(0, 20));
        openMenu();
      } catch {
        renderItems([]);
        openMenu();
      }
    }, 180);

    elInput.addEventListener('input', () => {
      elHidden.value = '';
      doSearch(elInput.value.trim());
    });

    elInput.addEventListener('focus', () => {
      if (elMenu.innerHTML.trim()) openMenu();
    });

    document.addEventListener('click', (e) => {
      if (
        !e.target.closest('#' + (elMenu.id || '')) &&
        !e.target.closest('#' + (elInput.id || ''))
      ) {
        closeMenu();
      }
    });
  }

  // ===== Manage Accreditation (SPECIAL ADMIN) =====
  let lastAccrSnap = '';
  let accrRefreshTimer = null;
  let accrFetchFn = null;

  // Active AY cache
  let activeAY = { start: null, end: null, single: null, label: '—' };
  let hasGoodActiveAY = false;
  let lastAYSnap = '';

  function refreshAccreditation() {
    if (typeof accrFetchFn === 'function') accrFetchFn();
  }

  function initManageAccreditation() {
    const section = document.querySelector('#manage-accreditation');
    if (!section || section.dataset.accrInit === 'true') return;

    // Reset state
    lastAccrSnap = '';
    lastAYSnap = '';
    if (accrRefreshTimer) {
      clearInterval(accrRefreshTimer);
      accrRefreshTimer = null;
    }
    accrFetchFn = null;
    activeAY = { start: null, end: null, single: null, label: '—' };
    hasGoodActiveAY = false;

    section.dataset.accrInit = 'true';

    // Tables for each tab - SIMPLIFIED (4 tabs)
    const tables = {
      pending: {
        key: 'pending',
        tbody: section.querySelector('#pendingAccrTable tbody'),
        search: section.querySelector('#pendingAccrSearch'),
        rows: [],
        filtered: [],
        page: 1,
        perPage: 10,
        pager: null,
      },
      active: {
        key: 'active',
        tbody: section.querySelector('#activeAccrTable tbody'),
        search: section.querySelector('#activeAccrSearch'),
        rows: [],
        filtered: [],
        page: 1,
        perPage: 10,
        pager: null,
      },
      returned: {
        key: 'returned',
        tbody: section.querySelector('#returnedAccrTable tbody'),
        search: section.querySelector('#returnedAccrSearch'),
        rows: [],
        filtered: [],
        page: 1,
        perPage: 10,
        pager: null,
      },
      manage: {
        key: 'manage',
        tbody: section.querySelector('#accrTable tbody'),
        search: section.querySelector('#accrSearch'),
        rows: [],
        filtered: [],
        page: 1,
        perPage: 10,
        pager: null,
      },
    };

    // ===== GLOBAL MODAL REFS =====
    const detailsModal = document.getElementById('accrDetailsModal');
    const orgNameEl = document.getElementById('accrOrgName');
    const orgAbbrEl = document.getElementById('accrOrgAbbr');
    const orgLogoEl = document.getElementById('accrOrgLogo');
    const scopeBadge = document.getElementById('accrScopeBadge');
    const courseAbbrEl = document.getElementById('accrCourseAbbr');
    const yearEl = document.getElementById('accrYear');
    const statusEl = document.getElementById('accrStatus');
    const docsWrap = document.getElementById('accrDocsWrap');
    const bulkSelectAll = document.getElementById('accrBulkSelectAll');
    const bulkReturnBtn = document.getElementById('accrBulkReturnBtn');
    const openEditOrgBtn = document.getElementById('openEditOrgBtn');
    const activeAYBadge = section.querySelector('#activeAYBadge');

    // Edit modal refs
    const editOrgModal = document.getElementById('editOrgModal');
    const editOrgForm = document.getElementById('editOrgForm');
    const saveEditOrg = document.getElementById('saveEditOrgBtn');
    const editOrgId = document.getElementById('editOrgId');
    const editOrgName = document.getElementById('editOrgName');
    const editOrgAbbr = document.getElementById('editOrgAbbr');
    const editAdminSearch = document.getElementById('editAdminSearch');
    const editAdminMenu = document.getElementById('editAdminMenu');
    const editAdminIdHidden = document.getElementById('editAdminIdHidden');
    const editScopeGeneral = document.getElementById('edit-scope-general');
    const editScopeExclusive = document.getElementById('edit-scope-exclusive');
    const editExclusiveRow = document.getElementById('editExclusiveCourseRow');
    const editCourseChips = document.getElementById('editOrgCourseChips');

    // Decline modal refs
    const declineReasonModal = document.getElementById('declineReasonModal');
    const declineReasonForm = document.getElementById('declineReasonForm');
    const confirmDeclineBtn = document.getElementById('confirmDeclineBtn');

    // Add modal refs
    const addOrgBtn = section.querySelector('#openAddOrgModal');
    const addOrgModal = document.getElementById('addOrgModal');
    const addOrgForm = document.getElementById('addOrgForm');
    const saveAddOrg = document.getElementById('saveAddOrgBtn');
    const addAdminSearch = document.getElementById('addAdminSearch');
    const addAdminMenu = document.getElementById('addAdminMenu');
    const addAdminIdHidden = document.getElementById('addAdminIdHidden');

    // REVIEW MODAL REFS
    let reviewConfirmModal = document.getElementById('reviewConfirmModal');
    let confirmReviewBtn = document.getElementById('confirmReviewBtn');
    let reviewModalInstance = null;
    
    // BULK REVIEW BUTTON - will be created dynamically
    let bulkReviewBtn = null;
    
    let detailsModalInstance = null;
    let declineModalInstance = null;
    let actionContext = null;

    // ===== Helper functions =====
    
    // ===== Helper function to load course chips for ADD modal =====
async function loadAddCourseChips(selectedAbbr = '') {
  const addCourseChips = document.getElementById('orgCourseChips');
  if (!addCourseChips) return;
  
  addCourseChips.innerHTML = 'Loading courses...';
  try {
    const courses = await fetchJSON('php/get-active-courses.php?t=' + Date.now());
    addCourseChips.innerHTML = '';
    
    if (Array.isArray(courses) && courses.length) {
      courses.forEach((c) => {
        const id = `add-org-course-${c.id}`;
        const input = document.createElement('input');
        input.type = 'radio';
        input.className = 'btn-check';
        input.name = 'course_abbr';
        input.id = id;
        input.value = c.abbreviation;
        input.required = true;
        
        if (String(c.abbreviation || '').toUpperCase() === String(selectedAbbr || '').toUpperCase()) {
          input.checked = true;
        }

        // Changing department in add modal clears admin selection
        input.addEventListener('change', () => {
          resetAddAdminSelection();
        });

        const label = document.createElement('label');
        label.className = 'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
        label.setAttribute('for', id);
        label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;
        
        addCourseChips.appendChild(input);
        addCourseChips.appendChild(label);
      });
    } else {
      addCourseChips.innerHTML = '<div class="text-danger small">No active courses available.</div>';
    }
  } catch (error) {
    console.error('Failed to load courses:', error);
    addCourseChips.innerHTML = '<div class="text-danger small">Failed to load courses.</div>';
  }
}
    
    function resetAddAdminSelection() {
      if (addAdminSearch) addAdminSearch.value = '';
      if (addAdminIdHidden) addAdminIdHidden.value = '';
      if (addAdminMenu) {
        addAdminMenu.innerHTML = '';
        addAdminMenu.classList.remove('show');
      }
    }

    function resetEditAdminSelection() {
      if (editAdminSearch) editAdminSearch.value = '';
      if (editAdminIdHidden) editAdminIdHidden.value = '';
      if (editAdminMenu) {
        editAdminMenu.innerHTML = '';
        editAdminMenu.classList.remove('show');
      }
    }

    function toggleDetails(show) {
      if (!detailsModal) return;
      if (!detailsModalInstance) {
        detailsModalInstance = new bootstrap.Modal(detailsModal);
      }
      if (show) detailsModalInstance.show();
      else detailsModalInstance.hide();
    }

    // ===== Create and Add Review button to bulk actions =====
    function addReviewButtonToUI() {
      const bulkActionsContainer = document.querySelector('.btn-group.btn-group-sm');
      if (!bulkActionsContainer) return;
      
      // Check if already exists
      if (document.getElementById('accrBulkReviewBtn')) return;
      
      // Create Review button
      const reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'btn btn-outline-primary';
      reviewBtn.id = 'accrBulkReviewBtn';
      reviewBtn.disabled = true;
      reviewBtn.innerHTML = '<i class="bi bi-check-circle"></i> Review Selected';
      
      // Insert before Return button
      if (bulkReturnBtn) {
        bulkActionsContainer.insertBefore(reviewBtn, bulkReturnBtn);
      } else {
        bulkActionsContainer.appendChild(reviewBtn);
      }
      bulkReviewBtn = reviewBtn;
      
      // Attach click handler
      reviewBtn.addEventListener('click', handleBulkReviewClick);
    }

    // ===== Handle Bulk Review Button Click =====
    function handleBulkReviewClick() {
      const rowsSel = getSelectedDocRows();
      if (!rowsSel.length) {
        showErrorModal('Select at least one document.');
        return;
      }
      openActionModal('review', { mode: 'bulk', rows: rowsSel });
    }

    // ===== Ensure Review Modal is Available and Hooked Up =====
    function ensureReviewModal() {
      if (!reviewConfirmModal) {
        reviewConfirmModal = document.getElementById('reviewConfirmModal');
      }
      if (!confirmReviewBtn) {
        confirmReviewBtn = document.getElementById('confirmReviewBtn');
      }
      
      // If modal doesn't exist in DOM, create it
      if (!reviewConfirmModal) {
        const modalHTML = `
          <div class="modal fade" id="reviewConfirmModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header border-0">
                  <h5 class="modal-title">Mark as Reviewed</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                  <p>Are you sure you want to mark the selected document(s) as <strong>Reviewed</strong>?</p>
                  <p class="small text-muted">This will change the status from "submitted" to "reviewed".</p>
                  <p class="small text-muted"><strong>Note:</strong> Marking as reviewed does NOT mean the organization is accredited. "Reviewed" is an intermediate status between "submitted" and "approved". The organization still needs to go through the full accreditation process.</p>
                </div>
                <div class="modal-footer border-0">
                  <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button class="btn btn-review" id="confirmReviewBtn">Mark as Reviewed</button>
                </div>
              </div>
            </div>
          </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        reviewConfirmModal = document.getElementById('reviewConfirmModal');
        confirmReviewBtn = document.getElementById('confirmReviewBtn');
      }
      
      // Ensure confirm button has event listener
      if (confirmReviewBtn && !confirmReviewBtn.hasReviewListener) {
        confirmReviewBtn.addEventListener('click', handleConfirmReview);
        confirmReviewBtn.hasReviewListener = true;
      }
      
      // Initialize Bootstrap modal instance
      if (!reviewModalInstance) {
        reviewModalInstance = new bootstrap.Modal(reviewConfirmModal);
      }
    }

    // === Active AY UI ===
    function setActiveAYUI(ayObj) {
      const next = ayObj || { label: '—' };
      const label = next.label || '—';
      const isGood = label !== '—' && label.trim() !== '';
      if (isGood) {
        activeAY = next;
        hasGoodActiveAY = true;
      } else if (!hasGoodActiveAY) {
        activeAY = next;
      } else {
        return;
      }

      if (activeAYBadge) activeAYBadge.textContent = activeAY.label || '—';
      if (yearEl) yearEl.textContent = activeAY.label || '—';
    }

    async function fetchActiveAY() {
      try {
        const d = await fetchJSON('php/get-active-academic-year.php?t=' + Date.now());
        
        let ay;
        if (d.school_year) {
          const [start, end] = d.school_year.split('-').map(Number);
          ay = { start, end, single: null, label: d.school_year };
        } else if (d.label) {
          ay = {
            start: d.start_year ?? null,
            end: d.end_year ?? null,
            single: d.active_year ?? null,
            label: String(d.label),
          };
        } else {
          ay = normAY({ start: d.start_year, end: d.end_year, single: d.active_year });
        }
        
        const currentAYSnap = JSON.stringify(ay);
        if (currentAYSnap === lastAYSnap) return;
        lastAYSnap = currentAYSnap;
        
        setActiveAYUI(ay);
      } catch {}
    }

    // ===== TABLE FUNCTIONS =====
    let rows = [];
    let selectedOrgId = null;

    function ensurePagerContainer(state) {
      if (!state || !state.tbody) return null;
      const table = state.tbody.closest('table');
      if (!table || !table.parentNode) return null;
      if (state.pager && state.pager.parentNode) return state.pager;
      const div = document.createElement('div');
      div.className = 'd-flex justify-content-between align-items-center mt-2 small';
      table.parentNode.appendChild(div);
      state.pager = div;
      return div;
    }

    function renderPager(key) {
      const state = tables[key];
      if (!state || !state.tbody) return;
      const container = ensurePagerContainer(state);
      if (!container) return;

      const total = state.filtered.length;
      if (!total) {
        container.innerHTML = '<span class="text-muted">0 records</span>';
        return;
      }

      const perPage = state.perPage || 10;
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      if (!state.page || state.page < 1) state.page = 1;
      if (state.page > totalPages) state.page = totalPages;
      const page = state.page;

      const from = (page - 1) * perPage + 1;
      const to = Math.min(page * perPage, total);

      let html = `<span>Showing ${from}–${to} of ${total}</span>`;
      html += '<nav class="ms-auto"><ul class="pagination pagination-sm mb-0">';

      const disabledPrev = page === 1 ? ' disabled' : '';
      const disabledNext = page === totalPages ? ' disabled' : '';

      html += `<li class="page-item${disabledPrev}"><a class="page-link" href="#" data-page="prev">&laquo;</a></li>`;
      for (let p = 1; p <= totalPages; p += 1) {
        const active = p === page ? ' active' : '';
        html += `<li class="page-item${active}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
      }
      html += `<li class="page-item${disabledNext}"><a class="page-link" href="#" data-page="next">&raquo;</a></li>`;
      html += '</ul></nav>';

      container.innerHTML = html;

      container.querySelectorAll('a.page-link').forEach((a) => {
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          const val = a.dataset.page;
          if (val === 'prev') state.page -= 1;
          else if (val === 'next') state.page += 1;
          else state.page = parseInt(val, 10);
          renderTable(key);
        });
      });
    }

    function renderTable(key) {
      const state = tables[key];
      if (!state || !state.tbody) return;

      const tbody = state.tbody;
      tbody.innerHTML = '';

      const data = state.filtered || [];
      const perPage = state.perPage || 10;
      const totalPages = Math.max(1, Math.ceil((data.length || 0) / perPage));
      if (!state.page || state.page < 1) state.page = 1;
      if (state.page > totalPages) state.page = totalPages;

      if (!data.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="text-center text-muted small">No records found.</td>';
        tbody.appendChild(tr);
        renderPager(key);
        return;
      }

      const start = (state.page - 1) * perPage;
      const slice = data.slice(start, start + perPage);

      slice.forEach((r) => {
        const ay = normAY({ 
          start: r.start_year ?? r.active_start_year,
          end: r.end_year ?? r.active_end_year,
          single: r.active_year 
        });
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.innerHTML = `
          <td>${r.id}</td>
          <td>${_esc(r.name)}</td>
          <td>${_esc(r.scope)}</td>
          <td>${_esc(r.course_abbr || '—')}</td>
          <td><span class="badge ${statusBadgeClass(r.status)}">${_esc(pretty(r.status))}</span></td>
          <td>${_esc(ay.label)}</td>
        `;
        tbody.appendChild(tr);
      });

      renderPager(key);
    }

    function filterRowsForState(state) {
      if (!state) return;
      const q = (state.search?.value || '').toLowerCase().trim();

      state.filtered = (state.rows || []).filter((r) => {
        if (!q) return true;
        const ay = normAY({ 
          start: r.start_year ?? r.active_start_year,
          end: r.end_year ?? r.active_end_year,
          single: r.active_year 
        });
        return (
          String(r.id).includes(q) ||
          String(r.name || '').toLowerCase().includes(q) ||
          String(r.scope || '').toLowerCase().includes(q) ||
          String(r.course_abbr || '').toLowerCase().includes(q) ||
          String(r.status || '').toLowerCase().includes(q) ||
          String(ay.label || '').toLowerCase().includes(q)
        );
      });

      state.page = 1;
      renderTable(state.key);
    }

    function categorizeRows() {
      const pending = [];
      const active = [];
      const returned = [];

      rows.forEach((r) => {
        const st = normalizeStatus(r.status);
        
        // PENDING: combined new & reaccreditation (INCLUDES REVIEWED)
        if (st === 'submitted' || st === 'pending' || 
            st === 'for accreditation' || st === 'for reaccreditation' || 
            st === 'reviewed') {
          pending.push(r);
        }
        // ACTIVE: only accredited/reaccredited/approved (NOT REVIEWED)
        else if (st === 'accredited' || st === 'reaccredited' || st === 'approved') {
          active.push(r);
        }
        // RETURNED
        else if (st === 'declined' || st === 'returned') {
          returned.push(r);
        }
      });

      tables.manage.rows = rows.slice();
      tables.pending.rows = pending;
      tables.active.rows = active;
      tables.returned.rows = returned;

      Object.values(tables).forEach((state) => filterRowsForState(state));
    }

    // Bind search inputs
    Object.values(tables).forEach((state) => {
      if (!state.search) return;
      state.search.addEventListener('input', debounce(() => filterRowsForState(state), 150));
    });

    // === Document Row Functions ===
    const getDocCheckboxes = () =>
      docsWrap ? Array.from(docsWrap.querySelectorAll('.accr-doc-check:not(:disabled)')) : [];

    const getSelectedDocRows = () => {
      if (!docsWrap) return [];
      return Array.from(docsWrap.querySelectorAll('.accr-doc-row')).filter((row) => {
        const cb = row.querySelector('.accr-doc-check');
        return cb && cb.checked && !cb.disabled;
      });
    };

    const syncBulkCheckboxState = () => {
      if (!bulkSelectAll) return;
      const cbs = getDocCheckboxes();
      if (!cbs.length) {
        bulkSelectAll.checked = false;
        bulkSelectAll.indeterminate = false;
        bulkSelectAll.disabled = true;
        return;
      }
      bulkSelectAll.disabled = false;
      const checkedCount = cbs.filter((cb) => cb.checked).length;
      bulkSelectAll.checked = checkedCount === cbs.length;
      bulkSelectAll.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
    };

    const syncBulkButtonsState = () => {
      const cbs = getDocCheckboxes();
      const anyEnabled = cbs.length > 0;
      const anyChecked = cbs.some((cb) => cb.checked);

      if (!anyEnabled) {
        if (bulkReviewBtn) bulkReviewBtn.disabled = true;
        if (bulkReturnBtn) bulkReturnBtn.disabled = true;
        return;
      }

      if (bulkReviewBtn) bulkReviewBtn.disabled = !anyChecked;
      if (bulkReturnBtn) bulkReturnBtn.disabled = !anyChecked;
    };

    // === Build Document Row with Review button ===
    function buildDocRow(f) {
      const row = document.createElement('div');
      row.className = 'accr-doc-row d-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2';
      row.dataset.fileId = f.id;
      row.dataset.docType = (f.doc_type || '').toLowerCase();
      row.dataset.docGroup = (f.doc_group || '').toLowerCase();

      const stLow = String(f.status || '').toLowerCase();
      const isLocked = stLow === 'approved' || stLow === 'declined';
      const isReviewed = stLow === 'reviewed';

      const checkWrap = document.createElement('div');
      checkWrap.className = 'form-check flex-shrink-0 mt-1';
      const cbDisabledAttr = isLocked || isReviewed ? 'disabled aria-disabled="true"' : '';
      checkWrap.innerHTML = `<input class="form-check-input accr-doc-check" type="checkbox" data-file-id="${f.id}" ${cbDisabledAttr}>`;

      const left = document.createElement('div');
      left.className = 'flex-grow-1 min-w-0 me-2';
      const label = pretty(f.doc_type);

      left.innerHTML = `
        <div class="small text-muted">${_esc(pretty(f.doc_group))}</div>
        <div class="fw-semibold text-truncate" title="${_esc(label)}">${_esc(label)}</div>
        <div class="small">
          Status: <span data-doc-status class="badge ${
            stLow === 'approved' ? 'text-bg-success' :
            stLow === 'declined' ? 'text-bg-danger' :
            stLow === 'reviewed' ? 'text-bg-info' : 'text-bg-warning'
          }">${_esc(pretty(f.status))}</span>
        </div>
        <div class="small text-danger" data-doc-reason style="${f.reason ? '' : 'display:none;'}">
          Reason: ${_esc(f.reason || '')}
        </div>
      `;

      const right = document.createElement('div');
      right.className = 'd-flex flex-wrap gap-2 flex-shrink-0';

      // View button
      const viewA = document.createElement('a');
      viewA.className = 'btn btn-sm btn-outline-secondary';
      viewA.href = f.file_path;
      viewA.target = '_blank';
      viewA.textContent = 'View';
      right.appendChild(viewA);

      // REVIEW button
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'btn btn-sm btn-outline-primary';
      reviewBtn.textContent = 'Review';
      reviewBtn.dataset.docAction = 'review';
      reviewBtn.dataset.fileId = f.id;
      if (isLocked || isReviewed) {
        reviewBtn.disabled = true;
        reviewBtn.setAttribute('aria-disabled', 'true');
      }
      right.appendChild(reviewBtn);

      // RETURN button
      const returnBtn = document.createElement('button');
      returnBtn.className = 'btn btn-sm btn-outline-danger';
      returnBtn.textContent = 'Return';
      returnBtn.dataset.docAction = 'decline';
      returnBtn.dataset.fileId = f.id;
      if (isLocked) {
        returnBtn.disabled = true;
        returnBtn.setAttribute('aria-disabled', 'true');
      }
      right.appendChild(returnBtn);

      row.appendChild(checkWrap);
      row.appendChild(left);
      row.appendChild(right);

      setDocRowUI(row, f.status, f.reason || '');
      return row;
    }

    function setOrgStatusUI(newStatus) {
      if (!statusEl) return;
      statusEl.textContent = pretty(newStatus || '—');
      statusEl.className = `badge ${statusBadgeClass(newStatus)}`;
    }

    function setDocRowUI(rowDiv, fileStatus, reasonText) {
      const st = normalizeStatus(fileStatus);
      const statusSpan = rowDiv.querySelector('[data-doc-status]');
      const reasonEl = rowDiv.querySelector('[data-doc-reason]');
      const reviewBtn = rowDiv.querySelector('[data-doc-action="review"]');
      const returnBtn = rowDiv.querySelector('[data-doc-action="decline"]');
      const cb = rowDiv.querySelector('.accr-doc-check');

      if (statusSpan) {
        statusSpan.textContent = pretty(st);
        statusSpan.className = 'badge ' + (
          st === 'approved' ? 'text-bg-success' :
          st === 'declined' ? 'text-bg-danger' :
          st === 'reviewed' ? 'text-bg-info' : 'text-bg-warning'
        );
      }

      if (st === 'declined') {
        if (reasonEl) reasonEl.style.display = '';
        if (reasonEl) reasonEl.textContent = `Reason: ${reasonText || ''}`;
        if (reviewBtn) reviewBtn.disabled = true;
        if (returnBtn) returnBtn.disabled = true;
        if (cb) { cb.checked = false; cb.disabled = true; }
      } else if (st === 'approved') {
        if (reasonEl) reasonEl.style.display = 'none';
        if (reviewBtn) reviewBtn.disabled = true;
        if (returnBtn) returnBtn.disabled = true;
        if (cb) { cb.checked = false; cb.disabled = true; }
      } else if (st === 'reviewed') {
        if (reasonEl) reasonEl.style.display = 'none';
        if (reviewBtn) reviewBtn.disabled = true;
        if (returnBtn) returnBtn.disabled = false;
        if (cb) { cb.checked = false; cb.disabled = true; }
      } else {
        if (reasonEl) {
          if (reasonText) {
            reasonEl.style.display = '';
            reasonEl.textContent = `Reason: ${reasonText}`;
          } else {
            reasonEl.style.display = 'none';
          }
        }
        if (reviewBtn) reviewBtn.disabled = false;
        if (returnBtn) returnBtn.disabled = false;
        if (cb) cb.disabled = false;
      }

      syncBulkCheckboxState();
      syncBulkButtonsState();
    }

    // === Action Modal Functions ===
    function openActionModal(type, ctx) {
      actionContext = ctx;
      
      if (type === 'review') {
        ensureReviewModal();
        if (reviewModalInstance) {
          reviewModalInstance.show();
        } else {
          showErrorModal('Review modal not available.');
        }
      } else if (type === 'decline') {
        if (!declineReasonModal || !confirmDeclineBtn) {
          showErrorModal('Return modal not available.');
          return;
        }
        const textarea = declineReasonForm.querySelector('textarea[name="reason"]');
        if (textarea) textarea.value = '';
        if (!declineModalInstance) declineModalInstance = new bootstrap.Modal(declineReasonModal);
        declineModalInstance.show();
      }
    }

    async function handleSingleAction(fileId, rowDiv, action, reason = '') {
      if (!fileId || !rowDiv) return;
      
      const reviewBtn = rowDiv.querySelector('[data-doc-action="review"]');
      const returnBtn = rowDiv.querySelector('[data-doc-action="decline"]');
      if (reviewBtn) reviewBtn.disabled = true;
      if (returnBtn) returnBtn.disabled = true;

      try {
        const endpoint = 'php/review-accreditation-file.php';
        const body = action === 'review' 
          ? JSON.stringify({ file_id: fileId, action: 'review' })
          : JSON.stringify({ file_id: fileId, action: 'decline', reason });

        const res = await fetchJSON(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        });

        const newStatus = action === 'review' ? 'reviewed' : 'declined';
        setDocRowUI(rowDiv, res.file_status || newStatus, reason);

        // IMPORTANT: When marking as reviewed, DON'T set organization as accredited
        // Only update org status if it's a decline/return action
        /*if (action === 'decline' && res.org_status_updated && res.org_new_status) {
          setOrgStatusUI(res.org_new_status);
          refreshAccreditation();
        }*/

        showSuccessModal(action === 'review' ? 'Document marked as reviewed ✅' : 'Document returned ✅');
      } catch (err) {
        if (reviewBtn) reviewBtn.disabled = false;
        if (returnBtn) returnBtn.disabled = false;
        showErrorModal(err.message || `Failed to ${action} document.`);
      }
    }

    async function handleBulkAction(rowsToProcess, action, reason = '') {
      if (!rowsToProcess || !rowsToProcess.length) return;

      if (bulkReviewBtn) bulkReviewBtn.disabled = true;
      if (bulkReturnBtn) bulkReturnBtn.disabled = true;

      try {
        for (const row of rowsToProcess) {
          const fileId = Number(row.dataset.fileId || row.querySelector('.accr-doc-check')?.dataset.fileId);
          if (!fileId) continue;

          const endpoint = 'php/review-accreditation-file.php';
          const body = action === 'review' 
            ? JSON.stringify({ file_id: fileId, action: 'review' })
            : JSON.stringify({ file_id: fileId, action: 'decline', reason });

          const res = await fetchJSON(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
          });

          const newStatus = action === 'review' ? 'reviewed' : 'declined';
          setDocRowUI(row, res.file_status || newStatus, reason);
        }

        showSuccessModal(action === 'review' ? 'Documents marked as reviewed ✅' : 'Documents returned ✅');
      } catch (err) {
        showErrorModal(err.message || `Failed to ${action} documents.`);
        if (bulkReviewBtn) bulkReviewBtn.disabled = false;
        if (bulkReturnBtn) bulkReturnBtn.disabled = false;
      }
    }

    // ===== Handle Confirm Review Button Click =====
    async function handleConfirmReview() {
      if (!actionContext) return;
      try {
        if (actionContext.mode === 'single') {
          await handleSingleAction(actionContext.fileId, actionContext.rowDiv, 'review');
        } else if (actionContext.mode === 'bulk') {
          await handleBulkAction(actionContext.rows, 'review');
        }
      } finally {
        actionContext = null;
        if (reviewModalInstance) reviewModalInstance.hide();
      }
    }

    // ===== Fetch Organizations =====
    async function fetchOrgs() {
      try {
        const data = await fetchJSON('php/get-accreditation-organizations.php?t=' + Date.now());
        
        const snap = JSON.stringify(data || []);
        if (snap === lastAccrSnap) return;
        lastAccrSnap = snap;

        const prevSelected = selectedOrgId;
        rows = data || [];

        if (!hasGoodActiveAY && rows.length) {
          const ayGuess = normAY({ 
            single: rows[0].active_year, 
            start: rows[0].start_year ?? rows[0].active_start_year,
            end: rows[0].end_year ?? rows[0].active_end_year
          });
          setActiveAYUI(ayGuess);
        }

        categorizeRows();

        if (prevSelected && rows.some((r) => Number(r.id) === Number(prevSelected))) {
          selectedOrgId = prevSelected;
        } else {
          selectedOrgId = null;
          toggleDetails(false);
        }
      } catch (e) {
        console.error('[accr-special-admin] load error', e);
        const manageState = tables.manage;
        if (manageState && manageState.tbody) {
          manageState.tbody.innerHTML = '<tr><td colspan="6" class="text-danger text-center small">Failed to load.</td></tr>';
          const c = ensurePagerContainer(manageState);
          if (c) c.innerHTML = '';
        }
      }
    }
    accrFetchFn = fetchOrgs;

    // ===== Click Row to Show Details =====
    section.addEventListener('click', async (e) => {
      const tr = e.target.closest('tbody tr[data-id]');
      if (!tr || !section.contains(tr)) return;

      const orgId = Number(tr.dataset.id);
      if (!orgId) return;

      selectedOrgId = orgId;

      try {
        const resp = await fetchJSON(`php/get-organization.php?id=${encodeURIComponent(orgId)}&t=${Date.now()}`);
        const o = resp.org || {};
        const files = resp.files || [];

        const sysAY = activeAY;
        const orgAY = normAY({ 
          start: o.start_year ?? o.active_start_year,
          end: o.end_year ?? o.active_end_year,
          single: o.active_year 
        });

        // Update modal UI
        if (orgLogoEl) {
          if (o.logo_path) {
            orgLogoEl.src = o.logo_path;
            orgLogoEl.classList.remove('d-none');
          } else {
            orgLogoEl.src = '';
            orgLogoEl.classList.add('d-none');
          }
        }
        if (orgAbbrEl) orgAbbrEl.textContent = o.abbreviation ? `(${o.abbreviation})` : '';
        if (orgNameEl) orgNameEl.textContent = o.name || '—';
        if (scopeBadge) scopeBadge.textContent = o.scope || '—';
        if (courseAbbrEl) {
          courseAbbrEl.textContent = o.scope === 'exclusive' ? o.course_abbr || '—' : '—';
        }
        if (yearEl) {
          const ayLabel = ayEqual(orgAY, sysAY) ? sysAY.label : orgAY.label || sysAY.label || '—';
          yearEl.textContent = ayLabel || '—';
        }

        setOrgStatusUI(o.status || '—');

        // Clear and populate documents
        if (docsWrap) {
          docsWrap.innerHTML = '';
          if (bulkSelectAll) {
            bulkSelectAll.checked = false;
            bulkSelectAll.indeterminate = false;
          }
          
          // Add review functionality to UI
          addReviewButtonToUI();
          ensureReviewModal();
          
          syncBulkButtonsState();

          files.forEach((f) => docsWrap.appendChild(buildDocRow(f)));

          syncBulkCheckboxState();
          syncBulkButtonsState();
        }

        // Set up Edit button with proper admin selection
        if (openEditOrgBtn) {
          openEditOrgBtn.onclick = async () => {
            if (editOrgId) editOrgId.value = o.id || '';
            if (editOrgName) editOrgName.value = o.name || '';
            if (editOrgAbbr) editOrgAbbr.value = o.abbreviation || '';

            const isExclusive = o.scope === 'exclusive';
            if (editScopeGeneral) editScopeGeneral.checked = !isExclusive;
            if (editScopeExclusive) editScopeExclusive.checked = isExclusive;
            
            // Show/hide exclusive row
            if (editExclusiveRow) {
              editExclusiveRow.classList.toggle('d-none', !isExclusive);
            }

            // Load course chips for edit
            if (editCourseChips && isExclusive) {
              await loadEditCourseChips(o.course_abbr || '');
            } else if (editCourseChips) {
              editCourseChips.innerHTML = '';
            }

            // Prefill admin with typeahead support
            const adminId = o.admin_id_number || '';
            const adminName = o.admin_full_name || '';
            const adminLabel = adminName && adminId ? `${adminName} (${adminId})` : adminId || '';
            if (editAdminSearch) editAdminSearch.value = adminLabel;
            if (editAdminIdHidden) editAdminIdHidden.value = adminId;

            // Initialize admin typeahead for edit modal
            initAdminTypeahead({
              input: editAdminSearch,
              menu: editAdminMenu,
              hidden: editAdminIdHidden,
              getDeptFilter: () => {
                if (!editOrgForm) return null;
                const scopeVal = editOrgForm.querySelector(
                  'input[name="scope"]:checked',
                )?.value;
                if (scopeVal !== 'exclusive') return null;
                const checkedCourse = editOrgForm.querySelector(
                  'input[name="course_abbr"]:checked',
                );
                return checkedCourse ? checkedCourse.value : null;
              },
            });

            new bootstrap.Modal(editOrgModal).show();
          };
        }

        toggleDetails(true);
      } catch (err) {
        console.error('[accr-special-admin] get-organization error', err);
        showErrorModal('Failed to load organization.');
      }
    });

    // ===== Event Listeners =====
    // Document action handlers
    if (docsWrap) {
      docsWrap.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-doc-action]');
        if (!btn) return;

        const action = btn.dataset.docAction;
        const fileId = Number(btn.dataset.fileId);
        if (!fileId) return;

        const rowDiv = btn.closest('.accr-doc-row');
        openActionModal(action, { mode: 'single', fileId, rowDiv });
      });

      docsWrap.addEventListener('change', (e) => {
        const cb = e.target.closest('.accr-doc-check');
        if (!cb) return;
        syncBulkCheckboxState();
        syncBulkButtonsState();
      });
    }

    // Bulk selection
    if (bulkSelectAll) {
      bulkSelectAll.addEventListener('change', () => {
        const checked = bulkSelectAll.checked;
        getDocCheckboxes().forEach((cb) => { cb.checked = checked; });
        syncBulkCheckboxState();
        syncBulkButtonsState();
      });
    }

    // Bulk Return button
    if (bulkReturnBtn) {
      bulkReturnBtn.addEventListener('click', () => {
        const rowsSel = getSelectedDocRows();
        if (!rowsSel.length) {
          showErrorModal('Select at least one document.');
          return;
        }
        openActionModal('decline', { mode: 'bulk', rows: rowsSel });
      });
    }

    // Confirm Decline button
    if (confirmDeclineBtn) {
      confirmDeclineBtn.addEventListener('click', async () => {
        if (!actionContext) return;
        const textarea = declineReasonForm.querySelector('textarea[name="reason"]');
        const reason = (textarea?.value || '').trim();
        if (!reason) {
          showErrorModal('Please provide a reason.');
          return;
        }

        try {
          if (actionContext.mode === 'single') {
            await handleSingleAction(actionContext.fileId, actionContext.rowDiv, 'decline', reason);
          } else if (actionContext.mode === 'bulk') {
            await handleBulkAction(actionContext.rows, 'decline', reason);
          }
        } finally {
          actionContext = null;
          if (declineModalInstance) declineModalInstance.hide();
        }
      });
    }

    // Initialize Add Org form if exists
    if (addOrgForm) {
      // Setup scope toggle
    const scopeExclusive = addOrgForm.querySelector('#scope-exclusive');
    const scopeGeneral = addOrgForm.querySelector('#scope-general');
    const exclRow = document.getElementById('exclusiveCourseRow');
    
    if (scopeExclusive && scopeGeneral && exclRow) {
      const toggleExcl = () => {
        exclRow.classList.toggle('d-none', !scopeExclusive.checked);
        // Clear admin when scope changes
        resetAddAdminSelection();
        
        // Load course chips when exclusive is selected
        if (scopeExclusive.checked) {
          loadAddCourseChips();
        } else {
          // Clear course chips when switching to general
          const addCourseChips = document.getElementById('orgCourseChips');
          if (addCourseChips) addCourseChips.innerHTML = '';
        }
      };
      scopeExclusive.addEventListener('change', toggleExcl);
      scopeGeneral.addEventListener('change', toggleExcl);
    }

      // Add more biodata button
      const addMoreBio = document.getElementById('addMoreBiodata');
      const bioList = document.getElementById('bioList');
      if (addMoreBio && bioList) {
        addMoreBio.addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.className = 'form-control';
          input.name = 'pds_officers[]';
          input.accept = 'image/*,.pdf';
          bioList.appendChild(input);
        });
      }

      // Initialize admin typeahead for add modal
      if (addAdminSearch && addAdminMenu && addAdminIdHidden) {
        initAdminTypeahead({
          input: addAdminSearch,
          menu: addAdminMenu,
          hidden: addAdminIdHidden,
          getDeptFilter: () => {
            if (!addOrgForm) return null;
            const scopeVal = addOrgForm.querySelector(
              'input[name="scope"]:checked',
            )?.value;
            if (scopeVal !== 'exclusive') return null;
            const checkedCourse = addOrgForm.querySelector(
              'input[name="course_abbr"]:checked',
            );
            return checkedCourse ? checkedCourse.value : null;
          },
        });
      }

      // Save Add Org
      if (saveAddOrg) {
        saveAddOrg.addEventListener('click', async () => {
          if (!addOrgForm) return;
          const fd = new FormData(addOrgForm);
          
          // Basic validation
          if (!fd.get('org_name') || !fd.get('org_abbr')) {
            showErrorModal('Organization name and abbreviation are required.');
            return;
          }
          
          fd.set('author_id_number', getLocalIdNumber());
          saveAddOrg.disabled = true;
          const oldText = saveAddOrg.textContent;
          saveAddOrg.textContent = 'Submitting...';
          
          try {
            const resp = await fetch('php/add-organization.php', { method: 'POST', body: fd });
            const data = await resp.json();
            if (!resp.ok || !data?.success) throw new Error(data?.message || 'Submit failed');
            
            bootstrap.Modal.getInstance(addOrgModal)?.hide();
            showSuccessModal('Organization submitted ✅');
            refreshAccreditation();
          } catch (e) {
            showErrorModal(e.message || 'Failed to submit.');
          } finally {
            saveAddOrg.disabled = false;
            saveAddOrg.textContent = oldText;
          }
        });
      }
    }

    // Save Edit Org
    if (saveEditOrg && editOrgForm) {
      saveEditOrg.addEventListener('click', async () => {
        const fd = new FormData(editOrgForm);
        const orgId = Number(fd.get('org_id') || 0);
        
        if (!orgId || !fd.get('org_name') || !fd.get('org_abbr')) {
          showErrorModal('Required fields missing.');
          return;
        }
        
        try {
          const resp = await fetch('php/update-organization.php', { method: 'POST', body: fd });
          const data = await resp.json();
          if (!resp.ok || !data?.success) throw new Error(data?.message || 'Update failed.');
          
          showSuccessModal('Organization updated ✅');
          bootstrap.Modal.getInstance(editOrgModal)?.hide();
          refreshAccreditation();
        } catch (e) {
          showErrorModal(e.message || 'Failed to update.');
        }
      });
    }

    // Helper function to load course chips for edit modal
    async function loadEditCourseChips(selectedAbbr = '') {
      if (!editCourseChips) return;
      editCourseChips.innerHTML = 'Loading courses...';
      try {
        const courses = await fetchJSON(
          'php/get-active-courses.php?t=' + Date.now(),
        );
        editCourseChips.innerHTML = '';
        if (Array.isArray(courses) && courses.length) {
          courses.forEach((c) => {
            const id = `edit-org-course-${c.id}`;
            const input = document.createElement('input');
            input.type = 'radio';
            input.className = 'btn-check';
            input.name = 'course_abbr';
            input.id = id;
            input.value = c.abbreviation;
            input.required = true;
            if (
              String(c.abbreviation || '').toUpperCase() ===
              String(selectedAbbr || '').toUpperCase()
            ) {
              input.checked = true;
            }

            // Changing department in edit also clears admin selection
            input.addEventListener('change', () => {
              resetEditAdminSelection();
            });

            const label = document.createElement('label');
            label.className =
              'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${_esc(
              c.abbreviation || '—',
            )}</strong>`;
            editCourseChips.appendChild(input);
            editCourseChips.appendChild(label);
          });
        } else {
          editCourseChips.innerHTML =
            '<div class="text-danger small">No active courses.</div>';
        }
      } catch {
        editCourseChips.innerHTML =
          '<div class="text-danger small">Failed to load courses.</div>';
      }
    }

    // Initialize
    fetchActiveAY();
    fetchOrgs();

    // Clean up modal backdrops
    const modalIds = ['editOrgModal', 'addOrgModal', 'accrDetailsModal', 'declineReasonModal', 'reviewConfirmModal'];
    modalIds.forEach((id) => {
      const m = document.getElementById(id);
      m?.addEventListener('hidden.bs.modal', () => {
        document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
          backdrop.classList.remove('show');
          setTimeout(() => backdrop.remove(), 150);
        });
        
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
      });
    });
    
    if (accrRefreshTimer) clearInterval(accrRefreshTimer);
    accrRefreshTimer = setInterval(() => {
      fetchActiveAY();
      fetchOrgs();
    }, 3000);
  }

  // ===== Initialize =====
  document.addEventListener('DOMContentLoaded', () => {
    const initIfFound = () => {
      const panel = document.querySelector('#manage-accreditation');
      if (panel && !panel.dataset.accrInit) {
        initManageAccreditation();
        if (typeof refreshAccreditation === 'function') refreshAccreditation();
      }
    };

    initIfFound();

    const contentArea = document.getElementById('content-area') || document.body;
    const observer = new MutationObserver(initIfFound);
    observer.observe(contentArea, { childList: true, subtree: true });

    document.addEventListener('spa:navigated', initIfFound);
    document.addEventListener('click', (e) => {
      const toAccr = e.target.closest('[data-route="manage-accreditation"], [href="#manage-accreditation"]');
      if (toAccr) setTimeout(initIfFound, 0);
    });
  });
})();//org_status_updated