// manage-accreditation.js
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
      } catch {}
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
  const getLocalIdNumber = () => (localStorage.getItem('id_number') || '').trim();

  const statusBadgeClass = (st) => {
    const s = String(st || '').toLowerCase();
    if (s === 'pending' || s === 'for accreditation') return 'text-bg-warning';
    if (s === 'accredited') return 'text-bg-success';
    if (s === 'reaccredited') return 'text-bg-primary';
    if (s === 'declined') return 'text-bg-danger';
    if (s === 'for reaccreditation') return 'text-bg-info';
    if (s === 'reviewed') return 'text-bg-info';
    return 'text-bg-secondary';
  };

  const normalizeStatus = (st) => String(st || '').trim().toLowerCase();
  const normalizeStr = (v) => String(v || '').trim().toLowerCase();

  // Pretty labels for statuses / doc types / groups
  const pretty = (s) => {
    const raw = String(s || '').trim();
    if (!raw) return '—';
    const low = raw.toLowerCase();
    const map = {
      // doc groups / statuses
      reaccreditation: 'Reaccreditation',
      new: 'New Accreditation',
      submitted: 'Submitted',
      approved: 'Approved',
      declined: 'Returned',

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
      presidents_report: 'President\'s Report',
      advisers_report: 'Adviser\'s/Moderator\'s Report',
      general_program: 'General Program of Activities (Old)',
      evaluation: 'Evaluation (Moderator/Officers/Org)',
      contact_details: 'Contact Details (Adviser/Officers)',
    };
    if (map[low]) return map[low];
    if (low === 'cbl') return 'CBL';
    return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // --- Academic Year helpers (support start/end or legacy single field) ---
  function normAY({ start, end, single } = {}) {
    if (typeof single === 'string' && /^\d{4}\s*-\s*\d{4}$/.test(single)) {
      const [s, e] = single.split('-').map((v) => parseInt(v.trim(), 10));
      if (!isNaN(s) && !isNaN(e)) return { start: s, end: e, single: null, label: `${s}-${e}` };
    }
    if (typeof single === 'number' && Number.isFinite(single)) {
      return { start: null, end: null, single, label: String(single) };
    }
    const si = (start != null && start !== '') ? parseInt(start, 10) : null;
    const ei = (end != null && end !== '') ? parseInt(end, 10) : null;
    if (Number.isFinite(si) && Number.isFinite(ei)) {
      return { start: si, end: ei, single: null, label: `${si}-${ei}` };
    }
    if (single != null && single !== '') {
      const sn = parseInt(single, 10);
      if (Number.isFinite(sn)) return { start: null, end: null, single: sn, label: String(sn) };
      if (typeof single === 'string') return { start: null, end: null, single: null, label: single };
    }
    return { start: null, end: null, single: null, label: '—' };
  }

  function ayEqual(a, b) {
    if (!a || !b) return false;
    if (a.start != null && a.end != null && b.start != null && b.end != null) {
      return Number(a.start) === Number(b.start) && Number(a.end) === Number(b.end);
    }
    if (a.single != null && b.single != null) return Number(a.single) === Number(b.single);
    return a.label === b.label && a.label !== '—';
  }

  // ===== Admin search (typeahead) =====
  // NOW supports optional getDeptFilter() so we can filter admins by department
  function initAdminTypeahead({
    input,
    menu,
    hidden,
    endpoint = 'php/get-manage-admins.php',
    getDeptFilter,
  }) {
    const elInput = (typeof input === 'string') ? document.querySelector(input) : input;
    const elMenu = (typeof menu === 'string') ? document.querySelector(menu) : menu;
    const elHidden = (typeof hidden === 'string') ? document.querySelector(hidden) : hidden;
    if (!elInput || !elMenu || !elHidden) return;

    const closeMenu = () => { elMenu.classList.remove('show'); elMenu.innerHTML = ''; };
    const openMenu = () => { if (!elMenu.classList.contains('show')) elMenu.classList.add('show'); };

    const renderItems = (rows = []) => {
      elMenu.innerHTML = '';
      if (!rows.length) {
        elMenu.innerHTML = '<span class="dropdown-item text-muted">No results</span>';
        return;
      }
      rows.forEach((u) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item text-wrap';
        btn.innerHTML = `
          <div class="fw-semibold">${_esc(u.full_name || '—')}</div>
          <small class="text-muted">${_esc(u.id_number || '')}${u.email ? (' · ' + _esc(u.email)) : ''}</small>
        `;
        btn.addEventListener('click', () => {
          const idn = (u.id_number || '').trim();
          elInput.value = (u.full_name && idn)
            ? `${u.full_name} (${idn})`
            : (u.full_name || idn || '');
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

        // If role field clearly marks admins, filter to those only
        let admins = rows;
        const hasRoleAdmin = rows.some((u) =>
          String(u.role || '').toLowerCase().includes('admin'),
        );
        if (hasRoleAdmin) {
          admins = rows.filter((u) =>
            String(u.role || '').toLowerCase().includes('admin'),
          );
        }

        // Allow fallback if nothing matched role check
        const qLower = q.toLowerCase();
        if (!admins.length && rows.length) {
          admins = rows.filter((u) =>
            String(u.id_number || '').toLowerCase().includes(qLower)
            || String(u.full_name || '').toLowerCase().includes(qLower),
          );
        }

        // ===== Department filter (for EXCLUSIVE scope) =====
        const filterDeptRaw = typeof getDeptFilter === 'function' ? getDeptFilter() : null;
        const filterDept = normalizeStr(filterDeptRaw);
        if (filterDept) {
          admins = admins.filter((u) => normalizeStr(u.department) === filterDept);
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
      if (!e.target.closest('#' + (elMenu.id || '')) && !e.target.closest('#' + (elInput.id || ''))) {
        closeMenu();
      }
    });
  }

  // ===== Manage Accreditation =====
  let lastAccrSnap = '';
  let accrRefreshTimer = null;
  let accrFetchFn = null;

  // cache for active AY + sticky guard
  let activeAY = { start: null, end: null, single: null, label: '—' };
  let hasGoodActiveAY = false;
  
  // ===== AUTO-RELOAD: Active AY Snapshot =====
  let lastAYSnap = '';

  // Keep last selected org (for edit modal & status buttons)
  let lastSelectedOrg = null;

  function refreshAccreditation() {
    if (typeof accrFetchFn === 'function') accrFetchFn();
  }

  function initManageAccreditation() {
    const section = document.querySelector('#manage-accreditation');
    if (!section || section.dataset.accrInit === 'true') return;

    // RESET state on re-mounts
    lastAccrSnap = '';
    lastAYSnap = '';
    if (accrRefreshTimer) {
      clearInterval(accrRefreshTimer);
      accrRefreshTimer = null;
    }
    accrFetchFn = null;
    activeAY = { start: null, end: null, single: null, label: '—' };
    hasGoodActiveAY = false;
    lastSelectedOrg = null;

    section.dataset.accrInit = 'true';

    // ===== TABLE STATES (for pagination + filtering) =====
    let rows = []; // all orgs from PHP

    const tables = {
      pending: {
        key: 'pending',
        tbody: section.querySelector('#pendingAccrTable tbody'),
        search: section.querySelector('#pendingAccrSearch'),
        rows: [], filtered: [], page: 1, perPage: 10, pager: null,
      },
      active: {
        key: 'active',
        tbody: section.querySelector('#activeAccrTable tbody'),
        search: section.querySelector('#activeAccrSearch'),
        rows: [], filtered: [], page: 1, perPage: 10, pager: null,
      },
      returned: {
        key: 'returned',
        tbody: section.querySelector('#returnedAccrTable tbody'),
        search: section.querySelector('#returnedAccrSearch'),
        rows: [], filtered: [], page: 1, perPage: 10, pager: null,
      },
      manage: {
        key: 'manage',
        tbody: section.querySelector('#accrTable tbody'),
        search: section.querySelector('#accrSearch'),
        rows: [], filtered: [], page: 1, perPage: 10, pager: null,
      },
    };

    // ===== Details modal refs =====
    const detailsModal = document.getElementById('accrDetailsModal');
    const detailsBody = detailsModal?.querySelector('.modal-body');
    const orgNameEl = document.getElementById('accrOrgName');
    const scopeBadge = document.getElementById('accrScopeBadge');
    const courseAbbrEl = document.getElementById('accrCourseAbbr');
    const yearEl = document.getElementById('accrYear');
    const statusEl = document.getElementById('accrStatus');
    const docsWrap = document.getElementById('accrDocsWrap');
    const openReaccr = document.getElementById('openReaccrBtn');
    const activeAYBadge = section.querySelector('#activeAYBadge');

    const orgLogoEl = document.getElementById('accrOrgLogo');
    const orgAbbrEl = document.getElementById('accrOrgAbbr');

    // New status buttons inside details modal
    const accreditOrgBtn = document.getElementById('accreditOrgBtn');
    const reaccreditOrgBtn = document.getElementById('reaccreditOrgBtn');

    // Confirm Status modal (single reusable)
    const confirmStatusModalEl = document.getElementById('confirmStatusModal');
    const confirmStatusTitle = document.getElementById('confirmStatusTitle');
    const confirmStatusBody = document.getElementById('confirmStatusBody');
    const confirmStatusBtn = document.getElementById('confirmStatusBtn');
    let confirmStatusModalInstance = null;
    let statusActionContext = null;

    // Bulk selection controls
    const bulkSelectAll = document.getElementById('accrBulkSelectAll');
    const bulkApproveBtn = document.getElementById('accrBulkApproveBtn');
    const bulkDeclineBtn = document.getElementById('accrBulkDeclineBtn');
    if (bulkDeclineBtn) {
      bulkDeclineBtn.innerHTML =
        '<i class="bi bi-arrow-counterclockwise"></i> Return Selected';
    }

    // Add org modal bits
    const addOrgBtn = section.querySelector('#openAddOrgModal');
    const addOrgModal = document.getElementById('addOrgModal');
    const addOrgForm = document.getElementById('addOrgForm');
    const saveAddOrg = document.getElementById('saveAddOrgBtn');

    // Admin selector (Add)
    const addAdminSearch = document.getElementById('addAdminSearch');
    const addAdminMenu = document.getElementById('addAdminMenu');
    const addAdminIdHidden = document.getElementById('addAdminIdHidden');

    // Reaccr modal bits
    const reaccrModal = document.getElementById('reaccrModal');
    const reaccrForm = document.getElementById('reaccrForm');
    const saveReaccr = document.getElementById('saveReaccrBtn');

    // Edit Organization modal bits
    const editOrgModal = document.getElementById('editOrgModal');
    const openEditOrg = document.getElementById('openEditOrgBtn');
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
    const editLogoInput = document.getElementById('editOrgLogo');

    // ===== Helpers to reset admin selection =====
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

    // ===== Details modal show/hide & scrolling =====
    let detailsModalInstance = null;
    function toggleDetails(show) {
      if (!detailsModal) return;
      if (!detailsModalInstance) {
        detailsModalInstance = new bootstrap.Modal(detailsModal);
      }
      if (show) detailsModalInstance.show();
      else detailsModalInstance.hide();
    }

    if (detailsBody) {
      detailsBody.classList.add('overflow-auto');
      detailsBody.style.maxHeight = '70vh';
    }
    if (docsWrap) {
      docsWrap.classList.add('overflow-auto');
      docsWrap.style.maxHeight = '48vh';
      docsWrap.style.wordBreak = 'break-word';
    }

    // ========== BULK SELECTION HELPERS ==========
    const getDocCheckboxes = () =>
      docsWrap
        ? Array.from(docsWrap.querySelectorAll('.accr-doc-check:not(:disabled)'))
        : [];

    const getSelectedDocRows = () => {
      if (!docsWrap) return [];
      return Array.from(docsWrap.querySelectorAll('.accr-doc-row')).filter(
        (row) => {
          const cb = row.querySelector('.accr-doc-check');
          return cb && cb.checked && !cb.disabled;
        },
      );
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
      bulkSelectAll.indeterminate =
        checkedCount > 0 && checkedCount < cbs.length;
    };

    const syncBulkButtonsState = () => {
      const cbs = getDocCheckboxes();
      const anyEnabled = cbs.length > 0;
      const anyChecked = cbs.some((cb) => cb.checked);

      if (!anyEnabled) {
        if (bulkApproveBtn) bulkApproveBtn.disabled = true;
        if (bulkDeclineBtn) bulkDeclineBtn.disabled = true;
        return;
      }

      if (bulkApproveBtn) bulkApproveBtn.disabled = !anyChecked;
      if (bulkDeclineBtn) bulkDeclineBtn.disabled = !anyChecked;
    };

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
        
        // Handle both old and new response formats
        let ay;
        if (d.school_year) {
          // Parse from school_year format "2025-2026"
          const [start, end] = d.school_year.split('-').map(Number);
          ay = {
            start: start,
            end: end,
            single: null,
            label: d.school_year
          };
        } else if (d.label) {
          // Use new format
          ay = {
            start: d.start_year ?? null,
            end: d.end_year ?? null,
            single: d.active_year ?? null,
            label: String(d.label),
          };
        } else {
          // Fallback
          ay = normAY({
            start: d.start_year,
            end: d.end_year,
            single: d.active_year,
          });
        }
        
        // ===== AUTO-RELOAD: Compare snapshot =====
        const currentAYSnap = JSON.stringify(ay);
        if (currentAYSnap === lastAYSnap) return;
        lastAYSnap = currentAYSnap;
        
        setActiveAYUI(ay);
      } catch {
        // keep last good badge if fetch fails
      }
    }

    // ===== PAGINATION HELPERS =====
    function ensurePagerContainer(state) {
      if (!state || !state.tbody) return null;
      const table = state.tbody.closest('table');
      if (!table || !table.parentNode) return null;
      if (state.pager && state.pager.parentNode) return state.pager;
      const div = document.createElement('div');
      div.className =
        'd-flex justify-content-between align-items-center mt-2 small';
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
      html +=
        '<nav class="ms-auto"><ul class="pagination pagination-sm mb-0">';

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
          if (val === 'prev') {
            if (state.page > 1) state.page -= 1;
          } else if (val === 'next') {
            if (state.page < totalPages) state.page += 1;
          } else {
            const n = parseInt(val, 10);
            if (!isNaN(n)) state.page = n;
          }
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
        tr.innerHTML =
          '<td colspan="6" class="text-center text-muted small">No records found.</td>';
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
          single: r.active_year,
        });
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.innerHTML = `
          <td>${_esc(r.id)}</td>
          <td>${_esc(r.name)}</td>
          <td>${_esc(r.scope)}</td>
          <td>${_esc(r.course_abbr || '—')}</td>
          <td><span class="badge ${statusBadgeClass(
            r.status,
          )}">${_esc(pretty(r.status))}</span></td>
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
          single: r.active_year,
        });
        return (
          String(r.id).toLowerCase().includes(q) ||
          (r.name || '').toLowerCase().includes(q) ||
          (r.scope || '').toLowerCase().includes(q) ||
          (r.course_abbr || '').toLowerCase().includes(q) ||
          (r.status || '').toLowerCase().includes(q) ||
          (ay.label || '').toLowerCase().includes(q)
        );
      });
      state.page = 1;
      renderTable(state.key);
    }

    function categorizeRows() {
      // reset
      Object.values(tables).forEach((s) => {
        s.rows = [];
        s.filtered = [];
        s.page = 1;
      });

      // manage gets everything
      tables.manage.rows = rows.slice();

      rows.forEach((r) => {
        const st = normalizeStatus(r.status);
        if (st === 'pending' || st === 'for accreditation' || st === 'for reaccreditation') {
          tables.pending.rows.push(r);
        }
        if (st === 'accredited' || st === 'reaccredited') {
          tables.active.rows.push(r);
        }
        if (st === 'declined') {
          tables.returned.rows.push(r);
        }
      });

      Object.values(tables).forEach(filterRowsForState);
    }

    // --- Reaccredit button visibility controller ---
    function syncReaccrButton({ orgAY, sysAY, files, orgId } = {}) {
      if (!openReaccr) return;
      const needsReaccr = !ayEqual(orgAY, sysAY);
      const reaccrFiles = (files || []).filter(
        (f) => String(f.doc_group).toLowerCase() === 'reaccreditation',
      );
      const hasPending = reaccrFiles.some(
        (f) => String(f.status).toLowerCase() === 'submitted',
      );
      const allApproved =
        isAllReaccrApprovedDOM() || isAllReaccrApprovedArray(reaccrFiles);

      if (needsReaccr && !hasPending && !allApproved && reaccrFiles.length === 0) {
        openReaccr.classList.remove('d-none');
        openReaccr.dataset.orgId = orgId || '';
      } else {
        openReaccr.classList.add('d-none');
        openReaccr.dataset.orgId = '';
      }
    }

    // === Required set for Reaccreditation (for detection only, no auto-status) ===
    const REACCR_REQUIRED_TYPES = [
      'officers_list',
      'members_list',
      'pds_officers',
      'adviser_moderator_acceptance',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
    ];

    function isAllReaccrApprovedArray(files) {
      if (!Array.isArray(files) || !files.length) return false;
      const byType = {};
      files.forEach((f) => {
        const type = String(f.doc_type || '').toLowerCase();
        const st = String(f.status || '').toLowerCase();
        if (!byType[type]) {
          byType[type] = { approved: false, count: 0, approvedCount: 0 };
        }
        byType[type].count += 1;
        if (st === 'approved') {
          byType[type].approved = true;
          byType[type].approvedCount += 1;
        }
      });
      return REACCR_REQUIRED_TYPES.every((t) =>
        t === 'pds_officers'
          ? !!byType[t] && byType[t].approvedCount > 0
          : !!byType[t] && byType[t].approved,
      );
    }

    function isAllReaccrApprovedDOM() {
      const drows = docsWrap?.querySelectorAll('.accr-doc-row') || [];
      const byType = {};
      drows.forEach((r) => {
        if ((r.dataset.docGroup || '').toLowerCase() !== 'reaccreditation') return;
        const type = (r.dataset.docType || '').toLowerCase();
        const st = (
          r.querySelector('[data-doc-status]')?.textContent || ''
        )
          .toLowerCase()
          .trim();
        if (!byType[type]) {
          byType[type] = { approved: false, count: 0, approvedCount: 0 };
        }
        byType[type].count += 1;
        if (st === 'approved') {
          byType[type].approved = true;
          byType[type].approvedCount += 1;
        }
      });
      return REACCR_REQUIRED_TYPES.every((t) =>
        t === 'pds_officers'
          ? !!byType[t] && byType[t].approvedCount > 0
          : !!byType[t] && byType[t].approved,
      );
    }

    // === NEW Accreditation required set (for detection only, no auto-status) ===
    const NEW_STATUS_REQUIRED_TYPES = [
      'concept_paper',
      'vmgo',
      'logo_explanation',
      'org_chart',
      'officers_list',
      'members_list',
      'adviser_moderator_acceptance',
      'proposed_program',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
    ];

    function isAllNewApprovedArray(files) {
      if (!Array.isArray(files) || !files.length) return false;
      const byType = {};
      files.forEach((f) => {
        if (String(f.doc_group || '').toLowerCase() !== 'new') return;
        const type = String(f.doc_type || '').toLowerCase();
        const st = String(f.status || '').toLowerCase();
        if (!byType[type]) byType[type] = { approved: false };
        if (st === 'approved') byType[type].approved = true;
      });
      return NEW_STATUS_REQUIRED_TYPES.every(
        (t) => !!byType[t] && byType[t].approved,
      );
    }

    function isAllNewApprovedDOM() {
      const drows = docsWrap?.querySelectorAll('.accr-doc-row') || [];
      const byType = {};
      drows.forEach((r) => {
        if ((r.dataset.docGroup || '').toLowerCase() !== 'new') return;
        const type = (r.dataset.docType || '').toLowerCase();
        const st = (
          r.querySelector('[data-doc-status]')?.textContent || ''
        )
          .toLowerCase()
          .trim();
        if (!byType[type]) byType[type] = { approved: false };
        if (st === 'approved') byType[type].approved = true;
      });
      return NEW_STATUS_REQUIRED_TYPES.every(
        (t) => !!byType[t] && byType[t].approved,
      );
    }

    function computeOrgAY(o) {
      if (!o) {
        return { start: null, end: null, single: null, label: '—' };
      }
      return normAY({
        start:
          o.start_year ??
          o.active_start_year ??
          o.last_accredited_start_year,
        end: o.end_year ?? o.active_end_year ?? o.last_accredited_end_year,
        single: o.active_year,
      });
    }

    function setOrgStatusUI(newStatus) {
      const st = String(newStatus || '').trim();
      if (!st) return;
      if (statusEl) {
        statusEl.textContent = pretty(st);
        statusEl.className = `badge ${statusBadgeClass(st)}`;
      }
    }

    // ===== Status action buttons (Accredit / Reaccredit) + confirm modal =====
    function syncStatusActionButtonsFromDOM() {
      if (!lastSelectedOrg) {
        accreditOrgBtn?.classList.add('d-none');
        reaccreditOrgBtn?.classList.add('d-none');
        return;
      }

      const org = lastSelectedOrg;
      const orgStatus = normalizeStatus(org.status);
      const orgAY = computeOrgAY(org);
      const sysAY = activeAY;

      const allNew = isAllNewApprovedDOM();
      const allRe = isAllReaccrApprovedDOM();

      // Default: hide
      accreditOrgBtn?.classList.add('d-none');
      reaccreditOrgBtn?.classList.add('d-none');

      // Show "Mark as Accredited" if all NEW docs are approved and org is not yet Accredited/Reaccredited
      if (
        accreditOrgBtn &&
        allNew &&
        orgStatus !== 'accredited' &&
        orgStatus !== 'reaccredited'
      ) {
        accreditOrgBtn.classList.remove('d-none');
        accreditOrgBtn.disabled = false;
      }

      // Show "Mark as Reaccredited" if all REACCR docs approved and AY differs from active
      if (
        reaccreditOrgBtn &&
        allRe &&
        !ayEqual(orgAY, sysAY) &&
        orgStatus !== 'reaccredited'
      ) {
        reaccreditOrgBtn.classList.remove('d-none');
        reaccreditOrgBtn.disabled = false;
      }
    }

    function openConfirmStatusModal(mode) {
      if (!lastSelectedOrg || !confirmStatusBtn || !confirmStatusBody) return;
      if (!confirmStatusModalEl) return;

      const org = lastSelectedOrg;
      const ayLabel = activeAY.label || 'the active Academic Year';

      statusActionContext = {
        mode,
        orgId: org.id,
      };

      if (mode === 'accredit') {
        if (confirmStatusTitle) {
          confirmStatusTitle.textContent = 'Mark as Accredited';
        }
        confirmStatusBody.textContent = `Are you sure you want to mark "${org.name || 'this organization'}" as Accredited for ${ayLabel}? This will finalize its new accreditation.`;
        confirmStatusBtn.textContent = 'Yes, Mark as Accredited';
      } else {
        if (confirmStatusTitle) {
          confirmStatusTitle.textContent = 'Mark as Reaccredited';
        }
        confirmStatusBody.textContent = `Are you sure you want to mark "${org.name || 'this organization'}" as Reaccredited for ${ayLabel}? This will finalize its reaccreditation.`;
        confirmStatusBtn.textContent = 'Yes, Mark as Reaccredited';
      }

      confirmStatusBtn.disabled = false;

      if (!confirmStatusModalInstance) {
        confirmStatusModalInstance = new bootstrap.Modal(confirmStatusModalEl);
      }
      confirmStatusModalInstance.show();
    }

    accreditOrgBtn?.addEventListener('click', () => {
      openConfirmStatusModal('accredit');
    });

    reaccreditOrgBtn?.addEventListener('click', () => {
      openConfirmStatusModal('reaccredit');
    });

    confirmStatusBtn?.addEventListener('click', async () => {
      if (!statusActionContext) return;
      const { mode, orgId } = statusActionContext;
      if (!mode || !orgId) return;

      const oldText = confirmStatusBtn.textContent;
      confirmStatusBtn.disabled = true;
      confirmStatusBtn.textContent =
        mode === 'accredit' ? 'Updating status...' : 'Updating status...';

      try {
        const res = await fetchJSON('php/finalize-accreditation-status.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: orgId, mode }),
        });

        if (!res || res.success === false) {
          throw new Error(res?.message || 'Failed to update organization status.');
        }

        const newStatus =
          res.new_status ||
          (mode === 'accredit' ? 'accredited' : 'reaccredited');

        if (lastSelectedOrg) {
          lastSelectedOrg.status = newStatus;
        }
        setOrgStatusUI(newStatus);

        showSuccessModal(
          mode === 'accredit'
            ? 'Organization marked as Accredited ✅'
            : 'Organization marked as Reaccredited ✅',
        );

        statusActionContext = null;
        if (confirmStatusModalInstance) confirmStatusModalInstance.hide();

        // Refresh tables and hide buttons accordingly
        refreshAccreditation();
        syncStatusActionButtonsFromDOM();
      } catch (err) {
        console.error('[accr] finalize status error', err);
        showErrorModal(err.message || 'Failed to update organization status.');
        confirmStatusBtn.disabled = false;
        confirmStatusBtn.textContent = oldText;
      }
    });

    // ===== FETCH ORGS (PHP) =====
    async function fetchOrgs() {
      try {
        const data = await fetchJSON(
          'php/get-accreditation-organizations.php?t=' + Date.now(),
        );
        
        // ===== AUTO-RELOAD: Compare snapshot =====
        const snap = JSON.stringify(data || []);
        if (snap === lastAccrSnap) return;
        lastAccrSnap = snap;

        const prevSelected = lastSelectedOrg?.id || null;
        rows = data || [];

        // If AY not set yet, try guess from first org
        if (
          !hasGoodActiveAY &&
          (!activeAY || !activeAY.label || activeAY.label === '—')
        ) {
          if (rows.length) {
            const ayGuess = normAY({
              single: rows[0].active_year,
              start: rows[0].start_year ?? rows[0].active_start_year,
              end: rows[0].end_year ?? rows[0].active_end_year,
            });
            setActiveAYUI(ayGuess);
          }
        }

        categorizeRows();

        if (
          prevSelected &&
          rows.some((r) => Number(r.id) === Number(prevSelected))
        ) {
          lastSelectedOrg = rows.find(
            (r) => Number(r.id) === Number(prevSelected),
          );
        } else {
          lastSelectedOrg = null;
        }
      } catch (e) {
        console.error('[accr] load error', e);
        Object.values(tables).forEach((state) => {
          if (!state.tbody) return;
          state.tbody.innerHTML =
            '<tr><td colspan="6" class="text-danger text-center small">Failed to load organizations.</td></tr>';
          const c = ensurePagerContainer(state);
          if (c) c.innerHTML = '';
        });
      }
    }
    accrFetchFn = fetchOrgs;

    // ===== Details: click any row in any table =====
    section.addEventListener('click', async (e) => {
      const tr = e.target.closest('tbody tr[data-id]');
      if (!tr || !section.contains(tr)) return;

      const orgId = Number(tr.dataset.id);
      if (!orgId) return;

      try {
        const resp = await fetchJSON(
          `php/get-organization.php?id=${encodeURIComponent(
            orgId,
          )}&t=${Date.now()}`,
        );
        const o = resp.org || {};
        const files = resp.files || [];
        lastSelectedOrg = o;

        const sysAY = activeAY;
        const orgAY = computeOrgAY(o);

        if (orgLogoEl) {
          if (o.logo_path) {
            orgLogoEl.src = o.logo_path;
            orgLogoEl.classList.remove('d-none');
          } else {
            orgLogoEl.src = '';
            orgLogoEl.classList.add('d-none');
          }
        }
        if (orgAbbrEl) {
          orgAbbrEl.textContent = o.abbreviation ? `(${o.abbreviation})` : '';
        }

        if (orgNameEl) orgNameEl.textContent = o.name || '—';
        if (scopeBadge) scopeBadge.textContent = o.scope || '—';
        if (courseAbbrEl) {
          courseAbbrEl.textContent =
            o.scope === 'exclusive' ? o.course_abbr || '—' : '—';
        }
        if (yearEl) yearEl.textContent = sysAY.label || '—';

        setOrgStatusUI(o.status || '—');

        function prettyDoc(dt) {
          return pretty(dt);
        }

        if (docsWrap) {
          docsWrap.innerHTML = '';
          if (bulkSelectAll) {
            bulkSelectAll.checked = false;
            bulkSelectAll.indeterminate = false;
          }
          syncBulkButtonsState();

          files.forEach((f) => {
            const row = document.createElement('div');
            row.className =
              'accr-doc-row d-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2';
            row.dataset.fileId = f.id;
            row.dataset.docType = (f.doc_type || '').toLowerCase();
            row.dataset.docGroup = (f.doc_group || '').toLowerCase();

            const st = normalizeStatus(f.status);
            const isLocked = st === 'approved' || st === 'declined';

            const checkWrap = document.createElement('div');
            checkWrap.className = 'form-check flex-shrink-0 mt-1';
            const cbDisabledAttr = isLocked
              ? 'disabled aria-disabled="true"'
              : '';
            checkWrap.innerHTML = `
              <input class="form-check-input accr-doc-check" type="checkbox" data-file-id="${f.id}" ${cbDisabledAttr}>
            `;

            const left = document.createElement('div');
            left.className = 'flex-grow-1 min-w-0 me-2';
            left.innerHTML = `
              <div class="small text-muted">${_esc(pretty(f.doc_group))}</div>
              <div class="fw-semibold text-truncate" title="${_esc(
                prettyDoc(f.doc_type),
              )}">
                ${_esc(prettyDoc(f.doc_type))}
              </div>
              <div class="small">
                Status:
                <span data-doc-status class="badge ${
                  st === 'approved'
                    ? 'text-bg-success'
                    : st === 'declined'
                      ? 'text-bg-danger'
                      : 'text-bg-warning'
                }">${_esc(pretty(f.status))}</span>
              </div>
              <div class="small text-danger" data-doc-reason style="${
                f.reason ? '' : 'display:none;'
              }">
                Reason: ${_esc(f.reason || '')}
              </div>
            `;

            const right = document.createElement('div');
            right.className = 'd-flex flex-wrap gap-2 flex-shrink-0';
            const btnDisabledAttr = isLocked
              ? 'disabled aria-disabled="true"'
              : '';
            right.innerHTML = `
              <a class="btn btn-sm btn-outline-secondary" href="${_esc(
                f.file_path,
              )}" target="_blank">View</a>
              <button class="btn btn-sm btn-success" data-doc-action="approve" data-file-id="${f.id}" ${btnDisabledAttr}>Approve</button>
              <button class="btn btn-sm btn-danger" style="display:none;" data-doc-action="decline" data-file-id="${f.id}" ${btnDisabledAttr}>Return</button>
            `;

            row.appendChild(checkWrap);
            row.appendChild(left);
            row.appendChild(right);
            docsWrap.appendChild(row);

            setDocRowUI(row, f.status, f.reason || '');
          });

          syncBulkCheckboxState();
          syncBulkButtonsState();
        }

        syncReaccrButton({ orgAY, sysAY, files, orgId });

        // Decide whether to show "Mark as Accredited/Reaccredited"
        syncStatusActionButtonsFromDOM();

        toggleDetails(true);

        // Wire Edit Organization button
        if (openEditOrg) {
          openEditOrg.onclick = async () => {
            if (editOrgId) editOrgId.value = o.id || '';
            if (editOrgName) editOrgName.value = o.name || '';
            if (editOrgAbbr) editOrgAbbr.value = o.abbreviation || '';

            const adminId = o.admin_id_number || '';
            const adminName = o.admin_full_name || '';
            const adminLabel =
              adminName && adminId
                ? `${adminName} (${adminId})`
                : adminId || '';

            if (editAdminSearch) editAdminSearch.value = adminLabel;
            if (editAdminIdHidden) editAdminIdHidden.value = adminId;

            const isExclusive =
              String(o.scope || '').toLowerCase() === 'exclusive';
            if (editScopeGeneral) editScopeGeneral.checked = !isExclusive;
            if (editScopeExclusive) editScopeExclusive.checked = isExclusive;

            // Just show/hide the row; DON'T auto-clear admin when opening modal
            toggleEditExclusiveRow();

            await loadEditCourseChips(o.course_abbr || '');

            if (editLogoInput) editLogoInput.value = '';

            new bootstrap.Modal(editOrgModal).show();
          };
        }
      } catch (err) {
        console.error('[accr] get-organization error', err);
        showErrorModal(err.message || 'Failed to load organization.');
      }
    });

    // Approve/Return UI updater per doc-row
    function setDocRowUI(rowDiv, fileStatus, reasonText) {
      const st = normalizeStatus(fileStatus);
      const statusSpan = rowDiv.querySelector('[data-doc-status]');
      const reasonEl = rowDiv.querySelector('[data-doc-reason]');
      const approveBtn = rowDiv.querySelector('[data-doc-action="approve"]');
      const declineBtn = rowDiv.querySelector('[data-doc-action="decline"]');
      const cb = rowDiv.querySelector('.accr-doc-check');

      if (statusSpan) {
        statusSpan.textContent = pretty(st);
        statusSpan.className =
          'badge ' +
          (st === 'approved'
            ? 'text-bg-success'
            : st === 'declined'
              ? 'text-bg-danger'
              : 'text-bg-warning');
      }

      if (st === 'declined') {
        if (reasonEl) {
          reasonEl.style.display = '';
          reasonEl.textContent = `Reason: ${reasonText || ''}`;
        }
        if (approveBtn) approveBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;
        if (cb) {
          cb.checked = false;
          cb.disabled = true;
          cb.setAttribute('aria-disabled', 'true');
        }
      } else if (st === 'approved') {
        if (reasonEl) {
          reasonEl.style.display = 'none';
          reasonEl.textContent = '';
        }
        if (approveBtn) approveBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = true;
        if (cb) {
          cb.checked = false;
          cb.disabled = true;
          cb.setAttribute('aria-disabled', 'true');
        }
      } else {
        if (reasonEl) {
          if (reasonText) {
            reasonEl.style.display = '';
            reasonEl.textContent = `Reason: ${reasonText}`;
          } else {
            reasonEl.style.display = 'none';
            reasonEl.textContent = '';
          }
        }
        if (approveBtn) approveBtn.disabled = false;
        if (declineBtn) declineBtn.disabled = false;
        if (cb) {
          cb.disabled = false;
          cb.removeAttribute('aria-disabled');
        }
      }

      syncBulkCheckboxState();
      syncBulkButtonsState();
    }

    // Approve/Return a single document
    if (docsWrap) {
      docsWrap.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.target.closest('[data-doc-action]');
        if (!btn) return;

        const fileId = Number(btn.dataset.fileId);
        const action = btn.dataset.docAction; // "approve" or "decline"
        if (!fileId || !action) return;

        let reason = '';
        if (action === 'decline') {
          const rowDiv = btn.closest('.accr-doc-row');
          openDeclineModal({
            mode: 'single',
            fileId,
            rowDiv,
          });
          return;
        }

        const prevDisabled = btn.disabled;
        btn.disabled = true;

        try {
          const res = await fetchJSON('php/review-accreditation-file.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, action, reason }),
          });

          const rowDiv = btn.closest('.accr-doc-row');
          if (rowDiv) {
            setDocRowUI(
              rowDiv,
              res.file_status || (action === 'approve' ? 'approved' : 'declined'),
              reason,
            );
          }

          // Server may update org status
          /*if (res.org_status_updated && res.org_new_status) {
            if (lastSelectedOrg) lastSelectedOrg.status = res.org_new_status;
            setOrgStatusUI(res.org_new_status);
            refreshAccreditation();
          } */

          // After each approval/return, recalc whether status buttons should show
          syncStatusActionButtonsFromDOM();

          const sysAY = activeAY;
          const orgAY = sysAY; // placeholder to keep existing reaccr button logic
          syncReaccrButton({
            orgAY,
            sysAY,
            files: null,
            orgId: lastSelectedOrg?.id || null,
          });

          syncBulkCheckboxState();
          syncBulkButtonsState();

          if (action === 'approve') {
            showSuccessModal('Document approved ✅');
          } else {
            showSuccessModal('Document returned ✅');
          }
        } catch (err) {
          btn.disabled = prevDisabled;
          console.error('[accr] review error', err);
          showErrorModal(err.message || 'Failed to review document.');
        }
      });

      // Track checkbox changes for bulk UI
      docsWrap.addEventListener('change', (e) => {
        const cb = e.target.closest('.accr-doc-check');
        if (!cb) return;
        syncBulkCheckboxState();
        syncBulkButtonsState();
      });
    }

    // Bulk "Select all"
    if (bulkSelectAll && docsWrap) {
      bulkSelectAll.addEventListener('change', () => {
        const checked = bulkSelectAll.checked;
        getDocCheckboxes().forEach((cb) => {
          cb.checked = checked;
        });
        syncBulkCheckboxState();
        syncBulkButtonsState();
      });
    }

    // Bulk Approve
    if (bulkApproveBtn && docsWrap) {
      bulkApproveBtn.addEventListener('click', async () => {
        const rowsSel = getSelectedDocRows();
        if (!rowsSel.length) {
          showErrorModal('Select at least one document.');
          return;
        }
        bulkApproveBtn.disabled = true;
        if (bulkDeclineBtn) bulkDeclineBtn.disabled = true;

        try {
          for (const row of rowsSel) {
            const fileId = Number(
              row.dataset.fileId ||
                row.querySelector('.accr-doc-check')?.dataset.fileId,
            );
            if (!fileId) continue;

            const res = await fetchJSON('php/review-accreditation-file.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_id: fileId,
                action: 'approve',
                reason: '',
              }),
            });

            setDocRowUI(row, res.file_status || 'approved', '');
          }

          // Re-sync status buttons based on DOM after bulk updates
          syncStatusActionButtonsFromDOM();

          const sysAY = activeAY;
          const orgAY = sysAY;
          syncReaccrButton({
            orgAY,
            sysAY,
            files: null,
            orgId: lastSelectedOrg?.id || null,
          });

          syncBulkCheckboxState();
          syncBulkButtonsState();

          showSuccessModal('Selected documents approved ✅');
        } catch (err) {
          console.error('[accr] bulk approve error', err);
          showErrorModal(err.message || 'Failed to approve some documents.');
        } finally {
          bulkApproveBtn.disabled = false;
          if (bulkDeclineBtn) {
            bulkDeclineBtn.disabled = !getDocCheckboxes().some(
              (cb) => cb.checked,
            );
          }
        }
      });
    }

    // Bulk Return
    if (bulkDeclineBtn && docsWrap) {
      bulkDeclineBtn.addEventListener('click', async () => {
        const rowsSel = getSelectedDocRows();
        if (!rowsSel.length) {
          showErrorModal('Select at least one document.');
          return;
        }

        openDeclineModal({
          mode: 'bulk',
          rows: rowsSel,
        });
      });
    }

    // ===== SEARCH BINDINGS FOR EACH TABLE =====
    Object.values(tables).forEach((state) => {
      if (state.search) {
        state.search.addEventListener(
          'input',
          debounce(() => filterRowsForState(state), 120),
        );
      }
    });

    // ----- Add Organization Modal (New) -----
    const loadCourseChips = async () => {
      const chipsWrap = document.getElementById('orgCourseChips');
      if (!chipsWrap) return;
      chipsWrap.innerHTML = 'Loading courses...';
      try {
        const courses = await fetchJSON(
          'php/get-active-courses.php?t=' + Date.now(),
        );
        chipsWrap.innerHTML = '';
        if (Array.isArray(courses) && courses.length) {
          courses.forEach((c) => {
            const id = `org-course-${c.id}`;
            const input = document.createElement('input');
            input.type = 'radio';
            input.className = 'btn-check';
            input.name = 'course_abbr';
            input.id = id;
            input.value = c.abbreviation;
            input.required = true;

            // When department changes in EXCLUSIVE scope, clear admin
            input.addEventListener('change', () => {
              resetAddAdminSelection();
            });

            const label = document.createElement('label');
            label.className =
              'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${_esc(
              c.abbreviation || '—',
            )}</strong>`;
            chipsWrap.appendChild(input);
            chipsWrap.appendChild(label);
          });
        } else {
          chipsWrap.innerHTML =
            '<div class="text-danger small">No active courses.</div>';
        }
      } catch {
        chipsWrap.innerHTML =
          '<div class="text-danger small">Failed to load courses.</div>';
      }
    };

    const toggleExclusive = () => {
      const exclRow = document.getElementById('exclusiveCourseRow');
      if (!exclRow) return;
      const isExcl =
        addOrgForm?.querySelector('#scope-exclusive')?.checked || false;
      exclRow.classList.toggle('d-none', !isExcl);

      // Whenever scope changes, clear current admin selection
      resetAddAdminSelection();

      if (isExcl) {
        // Load courses for exclusive & force department-based filtering
        loadCourseChips();
      }
    };

    addOrgForm
      ?.querySelector('#scope-exclusive')
      ?.addEventListener('change', toggleExclusive);
    addOrgForm
      ?.querySelector('#scope-general')
      ?.addEventListener('change', toggleExclusive);

    // NEW: PDS adders (renamed to pds_officers[])
    document
      .getElementById('addMoreBiodata')
      ?.addEventListener('click', () => {
        const div = document.createElement('div');
        div.innerHTML =
          '<input type="file" class="form-control" name="pds_officers[]" accept="image/*,.pdf">';
        document.getElementById('bioList')?.appendChild(div.firstElementChild);
      });

    // Admin typeahead (Add)
    initAdminTypeahead({
      input: addAdminSearch,
      menu: addAdminMenu,
      hidden: addAdminIdHidden,
      getDeptFilter: () => {
        if (!addOrgForm) return null;
        const scopeVal = addOrgForm.querySelector(
          'input[name="scope"]:checked',
        )?.value;
        if (scopeVal !== 'exclusive') return null; // GENERAL: no filtering
        const checkedCourse = addOrgForm.querySelector(
          'input[name="course_abbr"]:checked',
        );
        return checkedCourse ? checkedCourse.value : null; // EXCLUSIVE: filter by selected course_abbr
      },
    });

    // Client-side guard for NEW required set
    const NEW_REQUIRED_KEYS = [
      'concept_paper',
      'vmgo',
      'logo_explanation',
      'org_chart',
      'officers_list',
      'members_list',
      'adviser_moderator_acceptance',
      'proposed_program',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
    ];

    // Save Add Org
    saveAddOrg?.addEventListener('click', async () => {
      if (!addOrgForm) return;
      const fd = new FormData(addOrgForm);

      if (fd.get('scope') === 'exclusive' && !fd.get('course_abbr')) {
        showErrorModal('Select a course/department for exclusive scope.');
        return;
      }
      const abbr = (fd.get('org_abbr') || '').toString().trim();
      if (!abbr) {
        showErrorModal('Please provide an organization abbreviation.');
        return;
      }

      for (const k of NEW_REQUIRED_KEYS) {
        const f = fd.get(k);
        if (!f || (f instanceof File && !f.name)) {
          showErrorModal(`Missing: ${pretty(k)}`);
          return;
        }
      }
      const hasPds = [
        ...addOrgForm.querySelectorAll('input[name="pds_officers[]"]'),
      ].some((inp) => inp.files && inp.files.length);
      if (!hasPds) {
        showErrorModal('Add at least one PDS of Officers file.');
        return;
      }

      fd.set('author_id_number', getLocalIdNumber());

      saveAddOrg.disabled = true;
      saveAddOrg.textContent = 'Submitting...';
      try {
        const resp = await fetch('php/add-organization.php', {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.success) {
          throw new Error(data?.message || 'Submit failed');
        }
        bootstrap.Modal.getInstance(addOrgModal)?.hide();
        showSuccessModal('Organization submitted ✅');
        refreshAccreditation();
      } catch (e) {
        console.error('[accr] add org error', e);
        showErrorModal(e.message || 'Failed to submit.');
      } finally {
        saveAddOrg.disabled = false;
        saveAddOrg.textContent = 'Submit';
      }
    });

    // Open Add Org (prefill author & clear admin)
    addOrgBtn?.addEventListener('click', () => {
      addOrgForm?.reset();
      addOrgForm?.querySelector('#scope-general')?.click(); // default GENERAL -> no department filter
      const f = addOrgForm?.querySelector('[name="author_id_number"]');
      const d = document.getElementById('addAuthorIdDisplay');
      const idn = getLocalIdNumber();
      if (f) f.value = idn;
      if (d) d.value = idn;
      resetAddAdminSelection();
      toggleExclusive();
    });

    // ----- Reaccreditation Modal -----
    document
      .getElementById('addMoreReBiodata')
      ?.addEventListener('click', () => {
        const div = document.createElement('div');
        div.innerHTML =
          '<input type="file" class="form-control" name="pds_officers[]" accept="image/*,.pdf">';
        document.getElementById('reBioList')?.appendChild(
          div.firstElementChild,
        );
      });

    openReaccr?.addEventListener('click', () => {
      if (!lastSelectedOrg?.id) return;
      reaccrForm?.reset();
      reaccrForm.querySelector('[name="org_id"]').value = lastSelectedOrg.id;
      const f = reaccrForm?.querySelector('[name="author_id_number"]');
      if (f) f.value = getLocalIdNumber();
      new bootstrap.Modal(reaccrModal).show();
    });

    // Client-side guard for REACCR required set
    const REACCR_REQUIRED_KEYS = [
      'officers_list',
      'members_list',
      'adviser_moderator_acceptance',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
    ];

    saveReaccr?.addEventListener('click', async () => {
      if (!reaccrForm) return;
      const fd = new FormData(reaccrForm);
      const orgId = Number(fd.get('org_id') || 0);
      if (!orgId) {
        showErrorModal('Missing org id');
        return;
      }

      for (const k of REACCR_REQUIRED_KEYS) {
        const f = fd.get(k);
        if (!f || (f instanceof File && !f.name)) {
          showErrorModal(`Missing: ${pretty(k)}`);
          return;
        }
      }
      const hasPds = [
        ...reaccrForm.querySelectorAll('input[name="pds_officers[]"]'),
      ].some((inp) => inp.files && inp.files.length);
      if (!hasPds) {
        showErrorModal('Add at least one PDS of Officers file.');
        return;
      }

      fd.set('author_id_number', getLocalIdNumber());

      saveReaccr.disabled = true;
      saveReaccr.textContent = 'Submitting...';
      try {
        const resp = await fetch('php/add-reaccreditation.php', {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.success) {
          throw new Error(data?.message || 'Submit failed');
        }
        bootstrap.Modal.getInstance(reaccrModal)?.hide();
        showSuccessModal('Reaccreditation submitted ✅');
        refreshAccreditation();
      } catch (e) {
        console.error('[accr] reaccr error', e);
        showErrorModal(e.message || 'Failed to submit.');
      } finally {
        saveReaccr.disabled = false;
        saveReaccr.textContent = 'Submit';
      }
    });

    // ===== Edit Organization MODAL =====
    const toggleEditExclusiveRow = (opts = {}) => {
      if (!editExclusiveRow) return;
      const isExcl = !!editScopeExclusive?.checked;
      editExclusiveRow.classList.toggle('d-none', !isExcl);

      // Only reset admin when explicitly requested (when user changes scope)
      if (opts.resetAdmin) {
        resetEditAdminSelection();
      }
    };
    editScopeExclusive?.addEventListener('change', () =>
      toggleEditExclusiveRow({ resetAdmin: true }),
    );
    editScopeGeneral?.addEventListener('change', () =>
      toggleEditExclusiveRow({ resetAdmin: true }),
    );

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

    // Admin typeahead (Edit)
    initAdminTypeahead({
      input: editAdminSearch,
      menu: editAdminMenu,
      hidden: editAdminIdHidden,
      getDeptFilter: () => {
        if (!editOrgForm) return null;
        const scopeVal = editOrgForm.querySelector(
          'input[name="scope"]:checked',
        )?.value;
        if (scopeVal !== 'exclusive') return null; // GENERAL: see all admins
        const checkedCourse = editOrgForm.querySelector(
          'input[name="course_abbr"]:checked',
        );
        return checkedCourse ? checkedCourse.value : null; // EXCLUSIVE: filter by department/course_abbr
      },
    });

    // Save Edit Organization
    saveEditOrg?.addEventListener('click', async () => {
      if (!editOrgForm) return;
      const fd = new FormData(editOrgForm);

      const orgId = Number(fd.get('org_id') || 0);
      const name = (fd.get('org_name') || '').toString().trim();
      const abbr = (fd.get('org_abbr') || '').toString().trim();
      const scope = fd.get('scope') === 'exclusive' ? 'exclusive' : 'general';
      const course = (fd.get('course_abbr') || '').toString().trim();

      if (!orgId) {
        showErrorModal('Missing organization id.');
        return;
      }
      if (!name) {
        showErrorModal('Organization name is required.');
        return;
      }
      if (!abbr) {
        showErrorModal('Abbreviation is required.');
        return;
      }
      if (scope === 'exclusive' && !course) {
        showErrorModal('Select a course for exclusive scope.');
        return;
      }

      try {
        const resp = await fetch('php/update-organization.php', {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.success) {
          throw new Error(data?.message || 'Update failed.');
        }

        showSuccessModal('Organization updated ✅');
        bootstrap.Modal.getInstance(editOrgModal)?.hide();
        refreshAccreditation();
      } catch (e) {
        showErrorModal(e.message || 'Failed to update organization.');
      }
    });

    // Decline reason modal (for single + bulk Return)
    const declineReasonModal = document.getElementById('declineReasonModal');
    const declineReasonForm = document.getElementById('declineReasonForm');
    const confirmDeclineBtn = document.getElementById('confirmDeclineBtn');
    let declineModalInstance = null;
    let declineContext = null;

    function openDeclineModal(ctx) {
      declineContext = ctx;
      if (!declineReasonModal || !declineReasonForm || !confirmDeclineBtn) {
        showErrorModal('Return reason modal is not available.');
        return;
      }
      const textarea = declineReasonForm.querySelector(
        'textarea[name="reason"]',
      );
      if (textarea) textarea.value = '';

      if (!declineModalInstance) {
        declineModalInstance = new bootstrap.Modal(declineReasonModal);
      }
      declineModalInstance.show();
    }

    async function handleSingleReturn(fileId, rowDiv, reason) {
      if (!fileId || !rowDiv) return;
      const declineBtn = rowDiv.querySelector('[data-doc-action="decline"]');
      const prevDisabled = declineBtn ? declineBtn.disabled : false;
      if (declineBtn) declineBtn.disabled = true;

      try {
        const res = await fetchJSON('php/review-accreditation-file.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: fileId, action: 'decline', reason }),
        });

        setDocRowUI(rowDiv, res.file_status || 'declined', reason);

        if (res.org_status_updated && res.org_new_status) {
          if (lastSelectedOrg) lastSelectedOrg.status = res.org_new_status;
          setOrgStatusUI(res.org_new_status);
          refreshAccreditation();
        }

        // Update status buttons (should hide if any doc is declined)
        syncStatusActionButtonsFromDOM();

        showSuccessModal('Document returned ✅');
      } catch (err) {
        if (declineBtn) declineBtn.disabled = prevDisabled;
        console.error('[accr] single decline error', err);
        showErrorModal(err.message || 'Failed to return document.');
      }
    }

    async function handleBulkReturn(rowsToReturn, reason) {
      if (!rowsToReturn || !rowsToReturn.length) return;

      const prevApprove = bulkApproveBtn?.disabled ?? false;
      const prevDecline = bulkDeclineBtn?.disabled ?? false;
      if (bulkApproveBtn) bulkApproveBtn.disabled = true;
      if (bulkDeclineBtn) bulkDeclineBtn.disabled = true;

      try {
        for (const row of rowsToReturn) {
          const fileId = Number(
            row.dataset.fileId ||
              row.querySelector('.accr-doc-check')?.dataset.fileId,
          );
          if (!fileId) continue;

          const res = await fetchJSON('php/review-accreditation-file.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, action: 'decline', reason }),
          });

          setDocRowUI(row, res.file_status || 'declined', reason);
        }

        // After bulk decline, status buttons should be hidden (requirements broken)
        syncStatusActionButtonsFromDOM();

        showSuccessModal('Selected documents returned ✅');
      } catch (err) {
        console.error('[accr] bulk decline error', err);
        showErrorModal(err.message || 'Failed to return some documents.');
        if (bulkApproveBtn) bulkApproveBtn.disabled = prevApprove;
        if (bulkDeclineBtn) bulkDeclineBtn.disabled = prevDecline;
      }
    }

    // Confirm button inside decline reason modal
    confirmDeclineBtn?.addEventListener('click', async () => {
      if (!declineContext) return;
      const textarea = declineReasonForm.querySelector(
        'textarea[name="reason"]',
      );
      const reason = (textarea?.value || '').trim();
      if (!reason) {
        showErrorModal('Please provide a reason.');
        return;
      }

      try {
        if (declineContext.mode === 'single') {
          await handleSingleReturn(
            declineContext.fileId,
            declineContext.rowDiv,
            reason,
          );
        } else if (declineContext.mode === 'bulk') {
          await handleBulkReturn(declineContext.rows, reason);
        }
      } finally {
        declineContext = null;
        if (declineModalInstance) declineModalInstance.hide();
      }
    });

    // Backdrop cleanup
    [
      'addOrgModal',
      'reaccrModal',
      'editOrgModal',
      'accrDetailsModal',
      'declineReasonModal',
      'confirmStatusModal',
    ].forEach((id) => {
      const m = document.getElementById(id);
      m?.addEventListener('hidden.bs.modal', () => {
        document.querySelectorAll('.modal-backdrop').forEach((el) => {
          el.classList.remove('show');
          el.classList.add('fade');
          setTimeout(() => el.remove(), 200);
        });
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
      });
    });

    // Start: fetch AY immediately, then orgs; set combined interval
    fetchActiveAY();
    fetchOrgs();

    if (accrRefreshTimer) clearInterval(accrRefreshTimer);
    // ===== AUTO-RELOAD: Polling interval =====
    accrRefreshTimer = setInterval(() => {
      fetchActiveAY();
      fetchOrgs();
    }, 3000); // Poll every 3 seconds
    
    // Disable the button that opens reaccreditation modal
      if (openReaccr) {
        openReaccr.disabled = true;
        openReaccr.classList.add('d-none');
        openReaccr.style.display = 'none';
      }

      // Disable the "Mark as Reaccredited" button
      if (reaccreditOrgBtn) {
        reaccreditOrgBtn.disabled = true;
        reaccreditOrgBtn.classList.add('d-none');
        reaccreditOrgBtn.style.display = 'none';
      }
  }

  // ===== Boot it up (SPA-safe) =====
  document.addEventListener('DOMContentLoaded', () => {
    const initIfFound = () => {
      const panel = document.querySelector('#manage-accreditation');
      if (panel && !panel.dataset.accrInit) {
        lastAccrSnap = '';
        initManageAccreditation();
        if (typeof refreshAccreditation === 'function') {
          refreshAccreditation();
        }
      }
    };

    initIfFound();
    const contentArea = document.getElementById('content-area') || document.body;
    const observer = new MutationObserver(initIfFound);
    observer.observe(contentArea, { childList: true, subtree: true });

    document.addEventListener('spa:navigated', initIfFound);
    document.addEventListener('click', (e) => {
      const toAccr = e.target.closest(
        '[data-route="manage-accreditation"], [href="#manage-accreditation"]',
      );
      if (toAccr) setTimeout(initIfFound, 0);
    });
  });
})();//org_status_updated