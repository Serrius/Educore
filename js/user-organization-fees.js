// user-organization-fees.js
// User view: Organization fees with Paid / Unpaid tabs (cards only)

(function () {
  // ===== Global helpers (guarded) =====
  if (typeof window.fetchJSON === 'undefined') {
    window.fetchJSON = async function fetchJSON(url, options = {}) {
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

  if (typeof window.debounce === 'undefined') {
    window.debounce = function debounce(fn, wait = 150) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
      };
    };
  }

  if (typeof window.escapeHtml === 'undefined') {
    window.escapeHtml = function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (m) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[m])
      );
    };
  }

  // Helper: convert year number → Semester text
  function getSemesterDisplay(year, startYear, endYear) {
    if (year === startYear) return '1st Semester';
    if (year === endYear) return '2nd Semester';
    return `${year}`;
  }

  // AY state
  const activeYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,
  };

  // Page state
  const state = {
    allFees: [],
    filter: 'all', // 'all' | 'unpaid' | 'paid'
    currentPage: 1,
    itemsPerPage: 6,
    totalItems: 0,
  };

  let currentSection = null;
  let fetchFn = null;
  let refreshTimer = null;

  // === DOM helpers ===
  function getCardsContainer() {
    return document.getElementById('userOrgFeeCardsContainer');
  }
  function getPaginationContainer() {
    return document.getElementById('UserOrgFeePagination');
  }
  function getPaginationInfo() {
    return document.getElementById('UserOrgFeePaginationInfo');
  }

  // === Load AY (same pattern as announcements) ===
  async function loadActiveYear() {
    const apiBase = 'php/';
    const schoolYearEl = document.getElementById('userOrgFeeCurrentSchoolYear');
    const aySelect = document.getElementById('userOrgFeeAySelect');
    const activeYearSelect = document.getElementById(
      'userOrgFeeActiveYearSelect'
    );

    try {
      // Current active AY
      let activeData = null;
      try {
        activeData = await window.fetchJSON(
          `${apiBase}get-active-academic-year.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error('[user-orgfees] get-active-academic-year error:', e);
      }

      if (activeData && activeData.school_year) {
        activeYearState.schoolYearText = activeData.school_year;

        const parts = String(activeData.school_year).split('-');
        if (parts.length === 2) {
          const sy = parseInt(parts[0], 10);
          const ey = parseInt(parts[1], 10);
          let ay = null;

          if (!Number.isNaN(sy)) activeYearState.startYear = sy;
          if (!Number.isNaN(ey)) activeYearState.endYear = ey;

          if (activeData.active_year) {
            const parsedAy = parseInt(activeData.active_year, 10);
            if (!Number.isNaN(parsedAy)) ay = parsedAy;
          }
          if (ay === null) ay = sy;
          activeYearState.activeYear = ay;
        }

        if (schoolYearEl) schoolYearEl.textContent = activeData.school_year;
      } else if (schoolYearEl) {
        schoolYearEl.textContent =
          activeData?.warning || 'No active academic year';
      }

      // List of AYs
      let listData = null;
      try {
        listData = await window.fetchJSON(
          `${apiBase}get-academic-years.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error('[user-orgfees] get-academic-years error:', e);
      }

      // AY select
      if (aySelect) {
        let html = '';
        if (listData && listData.success && Array.isArray(listData.years)) {
          listData.years.forEach((row) => {
            const sy = parseInt(row.start_year, 10);
            const ey = parseInt(row.end_year, 10);
            const label =
              row.school_year ||
              (sy && ey ? `${sy}–${ey}` : String(row.school_year || '—'));
            const value = `${sy || ''}-${ey || ''}`;
            const isSelected =
              sy === activeYearState.startYear &&
              ey === activeYearState.endYear;

            html += `<option value="${window.escapeHtml(
              value
            )}" ${isSelected ? 'selected' : ''}>${window.escapeHtml(
              label
            )}</option>`;
          });
        }

        if (!html) {
          const sy = activeYearState.startYear;
          const ey = activeYearState.endYear;
          const label =
            sy && ey
              ? `${sy}–${ey}`
              : activeYearState.schoolYearText || '—';
          const val = `${sy || ''}-${ey || ''}`;
          html = `<option value="${window.escapeHtml(
            val
          )}">${window.escapeHtml(label)}</option>`;
        }

        aySelect.innerHTML = html;
      }

      // Semester select
      if (activeYearSelect) {
        const sy = activeYearState.startYear;
        const ey = activeYearState.endYear;
        let html = '';

        if (sy) {
          const txt = getSemesterDisplay(sy, sy, ey);
          html += `<option value="${sy}" ${
            activeYearState.activeYear === sy ? 'selected' : ''
          }>${txt}</option>`;
        }
        if (ey && ey !== sy) {
          const txt = getSemesterDisplay(ey, sy, ey);
          html += `<option value="${ey}" ${
            activeYearState.activeYear === ey ? 'selected' : ''
          }>${txt}</option>`;
        }
        activeYearSelect.innerHTML = html || `<option value="">—</option>`;
      }
    } catch (err) {
      console.error('[user-orgfees] loadActiveYear error:', err);
      if (schoolYearEl)
        schoolYearEl.textContent = 'Error loading school year';
      if (aySelect) aySelect.innerHTML = `<option value="">—</option>`;
      if (activeYearSelect)
        activeYearSelect.innerHTML = `<option value="">—</option>`;
    }
  }

  // === Fetch fees ===
  async function loadOrgFees(q = '') {
    const apiBase = 'php/';
    const params = new URLSearchParams();

    if (activeYearState.startYear)
      params.set('start_year', String(activeYearState.startYear));
    if (activeYearState.endYear)
      params.set('end_year', String(activeYearState.endYear));
    if (activeYearState.activeYear)
      params.set('active_year', String(activeYearState.activeYear));

    params.set('q', q);
    params.set('t', Date.now().toString());

    try {
      const data = await window.fetchJSON(
        `${apiBase}get-user-organization-fees.php?${params.toString()}`
      );

      const list = Array.isArray(data.fees) ? data.fees : [];

      state.allFees = list;
      applyFilterAndRender();
    } catch (err) {
      console.error('[user-orgfees] loadOrgFees error', err);
      const cards = getCardsContainer();
      const info = getPaginationInfo();
      const pag = getPaginationContainer();

      if (cards) {
        cards.innerHTML = `
          <div class="col-12">
            <div class="border rounded py-4 text-center text-danger">
              Failed to load organization fees.
            </div>
          </div>
        `;
      }
      if (info) info.textContent = '';
      if (pag) pag.innerHTML = '';
    }
  }

  // === Filtering + pagination ===
  function applyFilterAndRender() {
    let filtered = state.allFees || [];

    if (state.filter === 'paid') {
      filtered = filtered.filter((f) => !!f.is_paid);
    } else if (state.filter === 'unpaid') {
      filtered = filtered.filter((f) => !f.is_paid);
    }

    state.totalItems = filtered.length;

    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = startIndex + state.itemsPerPage;
    const pageItems = filtered.slice(startIndex, endIndex);

    renderCards(pageItems);
    renderPagination(filtered.length);
  }

  // === Card renderer ===
  function renderCards(list) {
    const cardsContainer = getCardsContainer();
    if (!cardsContainer) return;

    cardsContainer.innerHTML = '';

    if (!list || list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'col-12';
      empty.innerHTML = `
        <div class="border rounded py-4 text-center text-muted">
          No organization fees found for the selected filters.
        </div>
      `;
      cardsContainer.appendChild(empty);
      return;
    }

    list.forEach((f) => {
      const cardWrap = document.createElement('div');
      cardWrap.className = 'col-md-6 col-lg-4 mb-3';

      const isPaid = !!f.is_paid;
      const statusBadgeClass = isPaid
        ? 'badge bg-success'
        : 'badge bg-warning text-dark';
      const statusText = isPaid ? 'Paid' : 'Unpaid';

      const feeCategoryText =
        String(f.fee_category || '').toLowerCase() === 'department'
          ? 'Department Fee'
          : 'General Fee';

      const orgAbbr = f.org_abbr || '';
      const orgName = f.org_name || '';
      const amountNum = Number(f.amount || 0);
      const amountText = isNaN(amountNum)
        ? f.amount
        : amountNum.toLocaleString('en-PH', {
            style: 'currency',
            currency: f.currency || 'PHP',
          });

      const syText = f.school_year_text || `${f.start_year} - ${f.end_year}`;
      const semText = getSemesterDisplay(
        Number(f.active_year),
        Number(f.start_year),
        Number(f.end_year)
      );

      const paidOnText =
        isPaid && f.paid_on
          ? new Date(f.paid_on).toLocaleString()
          : null;

      const receiptText = isPaid && f.receipt_no ? f.receipt_no : null;

      cardWrap.innerHTML = `
        <div class="card h-100 shadow-sm border-0">
          <div
            class="card-header border-0 py-2 px-3"
            style="background: linear-gradient(90deg, #0d6efd11, #0d6efd08);"
          >
            <div class="d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <div
                  class="rounded-circle bg-white d-flex align-items-center justify-content-center border"
                  style="width: 36px; height: 36px; overflow:hidden;"
                >
                  ${
                    f.org_logo_path
                      ? `<img src="${window.escapeHtml(
                          f.org_logo_path
                        )}" alt="logo" style="width:100%;height:100%;object-fit:cover;">`
                      : `<span class="fw-bold small">${window.escapeHtml(
                          (orgAbbr || 'ORG').slice(0, 3).toUpperCase()
                        )}</span>`
                  }
                </div>
                <div>
                  <div class="fw-semibold small mb-0">
                    ${window.escapeHtml(orgName || 'Organization')}
                  </div>
                  <div class="text-muted small">
                    ${window.escapeHtml(feeCategoryText)} · ${window.escapeHtml(
        orgAbbr || ''
      )}
                  </div>
                </div>
              </div>
              <span class="${statusBadgeClass}">${statusText}</span>
            </div>
          </div>

          <div class="card-body d-flex flex-column gap-2">
            <div>
              <h6 class="mb-1 text-truncate" title="${window.escapeHtml(
                f.title || 'Untitled fee'
              )}">
                ${window.escapeHtml(f.title || 'Untitled fee')}
              </h6>
              <div class="d-flex justify-content-between align-items-center">
                <span class="fw-semibold">${window.escapeHtml(amountText)}</span>
                <small class="text-muted">
                  SY ${window.escapeHtml(syText)} · ${window.escapeHtml(
        semText
      )}
                </small>
              </div>
            </div>

            ${
              f.description
                ? `
              <p class="mb-0 small text-muted" style="max-height:4.2em;overflow:hidden;">
                ${window.escapeHtml(f.description)}
              </p>
            `
                : ''
            }

            <div class="mt-auto pt-2 border-top small">
              ${
                isPaid
                  ? `
                <div class="text-success d-flex flex-column">
                  <span><i class="bi bi-check-circle me-1"></i>Payment recorded.</span>
                  ${
                    paidOnText
                      ? `<span class="text-muted">Paid on ${window.escapeHtml(
                          paidOnText
                        )}</span>`
                      : ''
                  }
                  ${
                    receiptText
                      ? `<span class="text-muted">Receipt: ${window.escapeHtml(
                          receiptText
                        )}</span>`
                      : ''
                  }
                </div>
              `
                  : `
                <div class="text-muted">
                  <i class="bi bi-info-circle me-1"></i>
                  You have not paid this fee yet.
                </div>
              `
              }
            </div>
          </div>
        </div>
      `;

      cardsContainer.appendChild(cardWrap);
    });
  }

  // === Pagination renderer ===
  function renderPagination(totalItems) {
    const container = getPaginationContainer();
    const infoContainer = getPaginationInfo();
    if (!container) return;

    const itemsPerPage = state.itemsPerPage;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
      container.innerHTML = '';
      if (infoContainer) {
        infoContainer.textContent =
          totalItems > 0
            ? `Showing all ${totalItems} fee(s)`
            : 'No fees found';
      }
      return;
    }

    const currentPage = state.currentPage;
    let html = '<ul class="pagination pagination-sm mb-0">';

    html += `
      <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a>
      </li>
    `;

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }

    html += `
      <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
      </li>
    `;
    html += '</ul>';

    container.innerHTML = html;

    if (infoContainer) {
      const startItem = (currentPage - 1) * itemsPerPage + 1;
      const endItem = Math.min(currentPage * itemsPerPage, totalItems);
      infoContainer.textContent = `Showing ${startItem}-${endItem} of ${totalItems} fee(s)`;
    }

    container.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(link.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          state.currentPage = page;
          applyFilterAndRender();
        }
      });
    });
  }

  // === INIT ===
  document.addEventListener('DOMContentLoaded', () => {
    const runOnceOrAgain = () => {
      const el = document.querySelector('#user-organization-fees');
      if (!el) return;
      if (el !== currentSection) {
        currentSection = el;
        initUserOrgFees(el);
        console.log('User Organization Fees initialized ✅');
      }
    };

    const contentArea =
      document.getElementById('content-area') || document.body;
    const obs = new MutationObserver(runOnceOrAgain);
    obs.observe(contentArea, { childList: true, subtree: true });
    runOnceOrAgain();
  });

  function initUserOrgFees(section) {
    if (!section) return;

    const searchInput = document.getElementById('userOrgFeeSearch');
    const aySelect = document.getElementById('userOrgFeeAySelect');
    const activeYearSelect = document.getElementById(
      'userOrgFeeActiveYearSelect'
    );
    const filterTabs = document.getElementById('userOrgFeeFilterTabs');

    // Search
    searchInput?.addEventListener(
      'input',
      window.debounce((e) => {
        state.currentPage = 1;
        loadOrgFees(e.target.value);
      }, 150)
    );

    // AY change
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';
      const [syRaw, eyRaw] = val.split('-');
      const sy = parseInt(syRaw, 10);
      const ey = parseInt(eyRaw, 10);

      if (!Number.isNaN(sy)) activeYearState.startYear = sy;
      if (!Number.isNaN(ey)) activeYearState.endYear = ey;
      if (
        activeYearState.activeYear !== sy &&
        activeYearState.activeYear !== ey
      ) {
        activeYearState.activeYear = sy || activeYearState.activeYear;
      }

      // Rebuild semester select
      if (activeYearSelect) {
        let html = '';
        if (!Number.isNaN(sy)) {
          const txt = getSemesterDisplay(sy, sy, ey);
          html += `<option value="${sy}" ${
            activeYearState.activeYear === sy ? 'selected' : ''
          }>${txt}</option>`;
        }
        if (!Number.isNaN(ey) && ey !== sy) {
          const txt = getSemesterDisplay(ey, sy, ey);
          html += `<option value="${ey}" ${
            activeYearState.activeYear === ey ? 'selected' : ''
          }>${txt}</option>`;
        }
        activeYearSelect.innerHTML = html || `<option value="">—</option>`;
      }

      state.currentPage = 1;
      loadOrgFees(searchInput?.value || '');
    });

    // Semester change
    activeYearSelect?.addEventListener('change', () => {
      const yr = parseInt(activeYearSelect.value, 10);
      if (!Number.isNaN(yr)) {
        activeYearState.activeYear = yr;
        state.currentPage = 1;
        loadOrgFees(searchInput?.value || '');
      }
    });

    // Filter tabs
    if (filterTabs) {
      filterTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        const filter = btn.dataset.filter;
        if (!filter || filter === state.filter) return;

        filterTabs
          .querySelectorAll('button[data-filter]')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        state.filter = filter;
        state.currentPage = 1;
        applyFilterAndRender();
      });
    }

    // fetchFn for reuse / polling
    fetchFn = () => loadOrgFees(searchInput?.value || '');

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    loadActiveYear().then(() => {
      fetchFn();
      // If you want auto-refresh:
      // refreshTimer = setInterval(fetchFn, 10000);
    });
  }
})();
