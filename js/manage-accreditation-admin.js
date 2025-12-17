// manage-accreditation-admin.js
(() => {
  // ===== Light fallbacks (only define if missing) =====
  if (typeof window._esc !== 'function') {
    window._esc = (s) =>
      String(s ?? '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[m]));
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
    if (s === 'pending') return 'text-bg-warning';
    if (s === 'accredited') return 'text-bg-success';
    if (s === 'reaccredited') return 'text-bg-primary';
    if (s === 'declined') return 'text-bg-danger';
    if (s === 'for reaccreditation') return 'text-bg-info';
    if (s === 'reviewed') return 'text-bg-info'; // Added this line
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
    return s;
  };

  const pretty = (s) => {
    const raw = String(s || '').trim();
    if (!raw) return '—';
    const low = raw.toLowerCase();
    const map = {
      // groups & statuses
      reaccreditation: 'Reaccreditation',
      new: 'New Accreditation',
      submitted: 'submitted',
      approved: 'approved',
      declined: 'declined',
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
      if (!isNaN(s) && !isNaN(e)) {
        return { start: s, end: e, single: null, label: `${s}-${e}` };
      }
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
  function initAdminTypeahead({ input, menu, hidden, endpoint = 'php/get-manage-admins.php' }) {
    const elInput = (typeof input === 'string') ? document.querySelector(input) : input;
    const elMenu  = (typeof menu === 'string') ? document.querySelector(menu) : menu;
    const elHidden= (typeof hidden === 'string') ? document.querySelector(hidden) : hidden;
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
        elMenu.innerHTML = '<span class="dropdown-item text-muted">No results</span>';
        return;
      }
      rows.forEach((u) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item text-wrap';
        btn.innerHTML = `
          <div class="fw-semibold">${_esc(u.full_name || '—')}</div>
          <small class="text-muted">
            ${_esc(u.id_number || '')}${u.email ? (' · ' + _esc(u.email)) : ''}
          </small>
        `;
        btn.addEventListener('click', () => {
          elInput.value  = `${u.full_name || ''} (${u.id_number || ''})`.trim();
          elHidden.value = (u.id_number || '').trim();
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
        const admins = Array.isArray(data)
          ? data.filter((u) =>
              String(u.role || '').toLowerCase().includes('admin')
            )
          : [];
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

  // ===== Manage Accreditation (ADMIN-SCOPED) =====
  let lastAccrSnap = '';
  let accrRefreshTimer = null;
  let accrFetchFn = null;

  // Active AY cache + sticky guard
  let activeAY = { start: null, end: null, single: null, label: '—' };
  let hasGoodActiveAY = false;
  
  // ===== AUTO-RELOAD: Active AY Snapshot =====
  let lastAYSnap = '';

  // Keep last selected org (for edit modal prefill)
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

    // Tables for each tab - UPDATED: Merged pending and pendingReaccr, merged active and reaccredited
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

    // ===== Details modal refs =====
    const detailsModal = document.getElementById('accrDetailsModal');
    const detailsBody  = detailsModal?.querySelector('.modal-body');
    const orgNameEl    = document.getElementById('accrOrgName');
    const scopeBadge   = document.getElementById('accrScopeBadge');
    const courseAbbrEl = document.getElementById('accrCourseAbbr');
    const yearEl       = document.getElementById('accrYear');
    const statusEl     = document.getElementById('accrStatus');
    const docsWrap     = document.getElementById('accrDocsWrap');
    const openReaccr   = document.getElementById('openReaccrBtn');
    const activeAYBadge= section.querySelector('#activeAYBadge');

    const orgLogoEl    = document.getElementById('accrOrgLogo');
    const orgAbbrEl    = document.getElementById('accrOrgAbbr');

    // Add org modal bits
    const addOrgBtn   = section.querySelector('#openAddOrgModal');
    const addOrgModal = document.getElementById('addOrgModal');
    const addOrgForm  = document.getElementById('addOrgForm');
    const saveAddOrg  = document.getElementById('saveAddOrgBtn');

    // Admin selector (Add)
    const addAdminSearch   = document.getElementById('addAdminSearch');
    const addAdminMenu     = document.getElementById('addAdminMenu');
    const addAdminIdHidden = document.getElementById('addAdminIdHidden');

    // Reaccr modal bits
    const reaccrModal = document.getElementById('reaccrModal');
    const reaccrForm  = document.getElementById('reaccrForm');
    const saveReaccr  = document.getElementById('saveReaccrBtn');

    // Edit Organization modal bits
    const editOrgModal = document.getElementById('editOrgModal');
    const openEditOrg  = document.getElementById('openEditOrgBtn');
    const editOrgForm  = document.getElementById('editOrgForm');
    const saveEditOrg  = document.getElementById('saveEditOrgBtn');

    const editOrgId    = document.getElementById('editOrgId');
    const editOrgName  = document.getElementById('editOrgName');
    const editOrgAbbr  = document.getElementById('editOrgAbbr');

    const editAdminSearch   = document.getElementById('editAdminSearch');
    const editAdminMenu     = document.getElementById('editAdminMenu');
    const editAdminIdHidden = document.getElementById('editAdminIdHidden');

    const editScopeGeneral   = document.getElementById('edit-scope-general');
    const editScopeExclusive = document.getElementById('edit-scope-exclusive');
    const editExclusiveRow   = document.getElementById('editExclusiveCourseRow');
    const editCourseChips    = document.getElementById('editOrgCourseChips');
    const editLogoInput      = document.getElementById('editOrgLogo');

    // ===== Details modal show/hide & scrolling =====
    let detailsModalInstance = null;
    function toggleDetails(show) {
      if (!detailsModal) return;
      if (!detailsModalInstance) detailsModalInstance = new bootstrap.Modal(detailsModal);
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
      if (yearEl)        yearEl.textContent       = activeAY.label || '—';

      syncNewAccrButton();
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

    // ===== TABLE STATES / PAGINATION =====
    let rows = [];
    let selectedOrgId = null;

    // ---- UNIFIED pagination design (same as super-admin) ----
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
          single: r.active_year,
        });
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.innerHTML = `
          <td>${r.id}</td>
          <td>${_esc(r.name)}</td>
          <td>${_esc(r.scope)}</td>
          <td>${_esc(r.course_abbr || '—')}</td>
          <td><span class="badge ${statusBadgeClass(r.status)}">${_esc(r.status)}</span></td>
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
        if (st === 'pending' || st === 'for accreditation' || st === 'for reaccreditation') {
          pending.push(r);
        }
        if (st === 'accredited' || st === 'reaccredited') {
          active.push(r);
        }
        if (st === 'declined') {
          returned.push(r);
        }
      });

      tables.manage.rows        = rows.slice();
      tables.pending.rows       = pending;
      tables.active.rows        = active;
      tables.returned.rows      = returned;

      Object.values(tables).forEach((state) => filterRowsForState(state));
      syncNewAccrButton();
    }

    // Bind search inputs
    Object.values(tables).forEach((state) => {
      if (!state.search) return;
      state.search.addEventListener(
        'input',
        debounce(() => filterRowsForState(state), 150)
      );
    });

    // --- helper: disable/enable "New Accreditation" button when an org already exists in ACTIVE AY ---
    function syncNewAccrButton() {
      if (!addOrgBtn) return;
      if (!activeAY || !activeAY.label || activeAY.label === '—') {
        addOrgBtn.disabled = false;
        addOrgBtn.style.opacity = '';
        addOrgBtn.style.pointerEvents = '';
        return;
      }
      const hasOrgInActiveAY = rows.some((r) => {
        const ay = normAY({
          start: r.start_year ?? r.active_start_year,
          end: r.end_year ?? r.active_end_year,
          single: r.active_year,
        });
        return ayEqual(ay, activeAY);
      });

      if (hasOrgInActiveAY) {
        addOrgBtn.disabled = true;
        addOrgBtn.style.opacity = '0.5';
        addOrgBtn.style.pointerEvents = 'none';
      } else {
        addOrgBtn.disabled = false;
        addOrgBtn.style.opacity = '';
        addOrgBtn.style.pointerEvents = '';
      }
    }

    // === Admin doc row builder (NO bulk approve/decline; only view + replace declined) ===
    function setDocRowUI(rowDiv, newStatus, newReason, newPath) {
      const st = String(newStatus || '').toLowerCase();
      const statusSpan = rowDiv.querySelector('[data-doc-status]');
      const reasonEl   = rowDiv.querySelector('[data-doc-reason]');

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
      if (reasonEl) {
        if (st === 'declined' && newReason) {
          reasonEl.style.display = '';
          reasonEl.textContent = `Reason: ${newReason}`;
        } else {
          reasonEl.style.display = 'none';
          reasonEl.textContent = '';
        }
      }
      // After replace -> "submitted" (pending re-review)
      if (st === 'submitted' && newPath) {
        const viewA = rowDiv.querySelector('a.btn.btn-sm.btn-outline-secondary');
        if (viewA) viewA.href = newPath;
      }
    }

    async function replaceDeclinedFile(fileId, file, rowDiv) {
      try {
        const fd = new FormData();
        fd.append('file_id', String(fileId));
        fd.append('file', file);

        const btn = rowDiv.querySelector('[data-doc-action="replace"]');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Uploading...';
        }

        const res = await fetchJSON('php/replace-accreditation-file.php', {
          method: 'POST',
          body: fd,
        });
        setDocRowUI(rowDiv, res.new_status || 'submitted', null, res.file_path);
        showSuccessModal('File replaced and resubmitted ✅');
      } catch (err) {
        console.error('[accr-admin] replace error', err);
        showErrorModal(err.message || 'Failed to replace file.');
      } finally {
        const btn = rowDiv.querySelector('[data-doc-action="replace"]');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Replace';
        }
      }
    }

    function buildDocRow(f) {
      const row = document.createElement('div');
      row.className =
        'accr-doc-row d-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2';
      row.dataset.fileId   = f.id;
      row.dataset.docType  = (f.doc_type || '').toLowerCase();
      row.dataset.docGroup = (f.doc_group || '').toLowerCase();

      const left = document.createElement('div');
      left.className = 'flex-grow-1 min-w-0 me-2';

      const label = pretty(f.doc_type);
      const stLow = String(f.status || '').toLowerCase();

      left.innerHTML = `
        <div class="small text-muted">${_esc(pretty(f.doc_group))}</div>
        <div class="fw-semibold text-truncate" title="${_esc(label)}">
          ${_esc(label)}
        </div>
        <div class="small">
          Status:
          <span data-doc-status class="badge ${
            stLow === 'approved'
              ? 'text-bg-success'
              : stLow === 'declined'
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

      // View
      const viewA = document.createElement('a');
      viewA.className = 'btn btn-sm btn-outline-secondary';
      viewA.href = f.file_path;
      viewA.target = '_blank';
      viewA.textContent = 'View';
      right.appendChild(viewA);

      // Replace if declined (still allowed for admin)
      if (stLow === 'declined') {
        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'btn btn-sm btn-primary';
        replaceBtn.dataset.docAction = 'replace';
        replaceBtn.dataset.fileId = f.id;
        replaceBtn.textContent = 'Replace';
        right.appendChild(replaceBtn);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.pdf,.png,.jpg,.jpeg';
        fileInput.className = 'd-none';
        fileInput.dataset.fileId = f.id;
        right.appendChild(fileInput);

        replaceBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          await replaceDeclinedFile(f.id, file, row);
        });
      }

      row.appendChild(left);
      row.appendChild(right);
      return row;
    }

    // Utility: set status badge text/class in header
    function setOrgStatusUI(newStatus) {
      if (!statusEl) return;
      statusEl.textContent = newStatus || '—';
      statusEl.className = `badge ${statusBadgeClass(newStatus)}`;
    }

    // ===== ADMIN-SCOPED LIST: server endpoint + client-side guard =====
    async function fetchOrgs() {
      try {
        const data = await fetchJSON(
          'php/get-accreditation-organizations-admin.php?t=' + Date.now()
        );
        
        // ===== AUTO-RELOAD: Compare snapshot =====
        const snap = JSON.stringify(data || []);
        if (snap === lastAccrSnap) return;
        lastAccrSnap = snap;

        const prevSelected = selectedOrgId;
        rows = data || [];

        // If AY not set yet, try guess from first org
        if (!hasGoodActiveAY && (!activeAY || !activeAY.label || activeAY.label === '—')) {
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

        if (prevSelected && rows.some((r) => Number(r.id) === Number(prevSelected))) {
          selectedOrgId = prevSelected;
        } else {
          selectedOrgId = null;
          toggleDetails(false);
        }
      } catch (e) {
        console.error('[accr-admin] load error', e);
        const manageState = tables.manage;
        if (manageState && manageState.tbody) {
          manageState.tbody.innerHTML =
            '<tr><td colspan="6" class="text-danger text-center small">Failed to load organizations.</td></tr>';
          const c = ensurePagerContainer(manageState);
          if (c) c.innerHTML = '';
        }
      }
    }
    accrFetchFn = fetchOrgs;

    // click row anywhere in the module -> show details modal + load files
    section.addEventListener('click', async (e) => {
      const tr = e.target.closest('tbody tr[data-id]');
      if (!tr || !section.contains(tr)) return;

      const orgId = Number(tr.dataset.id);
      if (!orgId) return;

      selectedOrgId = orgId;

      try {
        const resp = await fetchJSON(
          `php/get-organization.php?id=${encodeURIComponent(orgId)}&t=${Date.now()}`
        );
        const o = resp.org || {};
        const files = resp.files || [];
        lastSelectedOrg = o;

        const sysAY = activeAY;
        const orgAY = normAY({
          start: o.start_year ?? o.active_start_year ?? o.last_accredited_start_year,
          end: o.end_year ?? o.active_end_year ?? o.last_accredited_end_year,
          single: o.active_year,
        });

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
            o.scope === 'exclusive' ? (o.course_abbr || '—') : '—';
        }
        if (yearEl) yearEl.textContent = sysAY.label || '—';

        setOrgStatusUI(o.status || '—');

        // Render docs (admin simple view)
        if (docsWrap) {
          docsWrap.innerHTML = '';
          files.forEach((f) => docsWrap.appendChild(buildDocRow(f)));
        }

        // Reaccreditation button: ONLY if status is "For Reaccreditation"
        const orgStatusNorm = normalizeStatus(o.status);
        const needsReaccr = orgStatusNorm === 'for reaccreditation';
        if (openReaccr) {
          if (needsReaccr) openReaccr.classList.remove('d-none');
          else openReaccr.classList.add('d-none');
        }

        toggleDetails(true);

        // Wire the "Edit Organization" button to open + prefill the modal (admin-limited)
        if (openEditOrg) {
          openEditOrg.onclick = async () => {
            if (editOrgId) editOrgId.value = o.id || '';
            if (editOrgName) editOrgName.value = o.name || '';
            if (editOrgAbbr) editOrgAbbr.value = o.abbreviation || '';

            const adminId = o.admin_id_number || '';
            const adminName = o.admin_full_name || '';
            const adminLabel =
              adminName && adminId ? `${adminName} (${adminId})` : adminId || '';

            if (editAdminSearch) {
              editAdminSearch.value = adminLabel;
              editAdminSearch.readOnly = true;
              editAdminSearch.setAttribute('readonly', '');
              editAdminSearch.classList.add('bg-light');
              editAdminSearch.title =
                'Admin assignment is fixed and cannot be changed.';
            }
            if (editAdminIdHidden) {
              editAdminIdHidden.value = adminId;
            }
            if (editAdminMenu) {
              editAdminMenu.classList.remove('show');
              editAdminMenu.innerHTML = '';
            }

            // scope: set from org, then lock (uneditable)
            const isExclusive =
              String(o.scope || '').toLowerCase() === 'exclusive';
            if (editScopeGeneral) {
              editScopeGeneral.checked = !isExclusive;
              editScopeGeneral.disabled = true;
              editScopeGeneral.setAttribute('disabled', '');
              editScopeGeneral.title = 'Scope cannot be changed by admin.';
            }
            if (editScopeExclusive) {
              editScopeExclusive.checked = isExclusive;
              editScopeExclusive.disabled = true;
              editScopeExclusive.setAttribute('disabled', '');
              editScopeExclusive.title = 'Scope cannot be changed by admin.';
            }

            toggleEditExclusiveRow();
            await loadEditCourseChips(o.course_abbr || '');
            if (editLogoInput) editLogoInput.value = '';

            new bootstrap.Modal(editOrgModal).show();
          };
        }
      } catch (err) {
        console.error('[accr-admin] get-organization error', err);
        showErrorModal(err.message || 'Failed to load organization.');
      }
    });

    // ----- Add Organization Modal (New) -----
    const loadCourseChips = async () => {
      const chipsWrap = document.getElementById('orgCourseChips');
      if (!chipsWrap) return;
      chipsWrap.innerHTML = 'Loading courses...';
      try {
        const courses = await fetchJSON('php/get-active-courses.php?t=' + Date.now());
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
            const label = document.createElement('label');
            label.className =
              'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;
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
      const isExcl = addOrgForm
        ?.querySelector('#scope-exclusive')
        ?.checked;
      exclRow.classList.toggle('d-none', !isExcl);
      if (isExcl) loadCourseChips();
    };

    addOrgForm
      ?.querySelector('#scope-exclusive')
      ?.addEventListener('change', toggleExclusive);
    addOrgForm
      ?.querySelector('#scope-general')
      ?.addEventListener('change', toggleExclusive);

    // NEW: PDS adders (renamed to pds_officers[])
    document.getElementById('addMoreBiodata')?.addEventListener('click', () => {
      const div = document.createElement('div');
      div.innerHTML =
        '<input type="file" class="form-control" name="pds_officers[]" accept="image/*,.pdf">';
      document.getElementById('bioList')?.appendChild(div.firstElementChild);
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

      // Set author/admin IDs to the logged-in admin
      const me = getLocalIdNumber();
      fd.set('author_id_number', me);
      fd.set('admin_id_number', me);

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
        console.error('[accr-admin] add org error', e);
        showErrorModal(e.message || 'Failed to submit.');
      } finally {
        saveAddOrg.disabled = false;
        saveAddOrg.textContent = 'Submit';
      }
    });

    // Open Add Org (prefill author & admin with own id)
    addOrgBtn?.addEventListener('click', () => {
      if (addOrgBtn.disabled) return;
      addOrgForm?.reset();
      addOrgForm?.querySelector('#scope-general')?.click();

      const myId = getLocalIdNumber();

      const fAuthor = addOrgForm?.querySelector('[name="author_id_number"]');
      if (fAuthor) fAuthor.value = myId;

      if (addAdminSearch) {
        addAdminSearch.value = myId;
        addAdminSearch.readOnly = true;
        addAdminSearch.setAttribute('readonly', '');
        addAdminSearch.title = 'Assigned to your admin ID';
      }
      if (addAdminIdHidden) addAdminIdHidden.value = myId;

      if (addAdminMenu) {
        addAdminMenu.classList.remove('show');
        addAdminMenu.innerHTML = '';
      }

      toggleExclusive();
    });

    // ----- Reaccreditation Modal -----
    document.getElementById('addMoreReBiodata')?.addEventListener('click', () => {
      const div = document.createElement('div');
      div.innerHTML =
        '<input type="file" class="form-control" name="pds_officers[]" accept="image/*,.pdf">';
      document.getElementById('reBioList')?.appendChild(div.firstElementChild);
    });

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
      // general_program optional
    ];

    openReaccr?.addEventListener('click', () => {
      if (!selectedOrgId) return;
      reaccrForm?.reset();
      reaccrForm.querySelector('[name="org_id"]').value = selectedOrgId;
      const f = reaccrForm?.querySelector('[name="author_id_number"]');
      if (f) f.value = getLocalIdNumber();
      new bootstrap.Modal(reaccrModal).show();
    });

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
        console.error('[accr-admin] reaccr error', e);
        showErrorModal(e.message || 'Failed to submit.');
      } finally {
        saveReaccr.disabled = false;
        saveReaccr.textContent = 'Submit';
      }
    });

    // ===== Edit Organization MODAL =====
    const toggleEditExclusiveRow = () => {
      if (!editExclusiveRow) return;
      const isExcl = !!editScopeExclusive?.checked;
      editExclusiveRow.classList.toggle('d-none', !isExcl);
    };
    editScopeExclusive?.addEventListener('change', toggleEditExclusiveRow);
    editScopeGeneral?.addEventListener('change', toggleEditExclusiveRow);

    async function loadEditCourseChips(selectedAbbr = '') {
      if (!editCourseChips) return;
      editCourseChips.innerHTML = 'Loading courses...';
      try {
        const courses = await fetchJSON('php/get-active-courses.php?t=' + Date.now());
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

            // LOCK COURSE/DEPARTMENT (admin cannot change)
            input.disabled = true;
            input.setAttribute('disabled', '');
            input.title = 'Department is fixed and cannot be changed by admin.';

            const label = document.createElement('label');
            label.className =
              'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;
            label.title = 'Department is fixed and cannot be changed by admin.';

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

    // Save Edit Organization (admin-limited)
    saveEditOrg?.addEventListener('click', async () => {
      if (!editOrgForm) return;
      const fd = new FormData(editOrgForm);

      const orgId = Number(fd.get('org_id') || 0);
      const name = (fd.get('org_name') || '').toString().trim();
      const abbr = (fd.get('org_abbr') || '').toString().trim();

      const scope =
        lastSelectedOrg &&
        String(lastSelectedOrg.scope || '').toLowerCase() === 'exclusive'
          ? 'exclusive'
          : 'general';

      let course = '';
      if (scope === 'exclusive') {
        course = lastSelectedOrg && lastSelectedOrg.course_abbr
          ? String(lastSelectedOrg.course_abbr).trim()
          : '';
        if (!course) {
          showErrorModal('Course/Department is missing for this organization.');
          return;
        }
        fd.set('course_abbr', course);
      } else {
        fd.delete('course_abbr');
      }

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

      fd.set('scope', scope);

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
        const prevId = selectedOrgId;
        refreshAccreditation();
        selectedOrgId = prevId;
      } catch (e) {
        showErrorModal(e.message || 'Failed to update organization.');
      }
    });

    // Backdrop cleanup
    ['addOrgModal', 'reaccrModal', 'editOrgModal', 'accrDetailsModal'].forEach(
      (id) => {
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
      }
    );

    // Init admin typeahead for "Add" (for completeness, though we auto-lock to own ID)
    initAdminTypeahead({
      input: addAdminSearch,
      menu: addAdminMenu,
      hidden: addAdminIdHidden,
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
  }

  // ===== Boot it up (SPA-safe) =====
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
      const toAccr = e.target.closest(
        '[data-route="manage-accreditation"], [href="#manage-accreditation"]'
      );
      if (toAccr) setTimeout(initIfFound, 0);
    });
  });
})();