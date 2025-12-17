// user-announcements.js
// Simple viewer: Active announcements only, filtered by SY + Semester

(function () {
  // ===== Global helpers (guarded) =====
  if (typeof window.fetchJSON === 'undefined') {
    window.fetchJSON = async function fetchJSON(url, options = {}) {
      const resp = await fetch(url, {
        cache: 'no-store',
        credentials: 'include', // keep cookies/session
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

  // ===== SEMESTER HELPER =====
  function getSemesterLabelForYear(startYear, endYear, activeYear) {
    if (startYear == null || endYear == null || activeYear == null) return null;
    if (activeYear === startYear) return '1st Semester';
    if (activeYear === endYear) return '2nd Semester';
    return `AY Segment ${activeYear}`;
  }

  function getSemesterDisplay(year, startYear, endYear) {
    const sem = getSemesterLabelForYear(startYear, endYear, year);
    return sem || `${year}`;
  }

  // Helper function to truncate text with ellipsis
  function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // Academic year state
  const activeYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,
    baseStartYear: null,
    baseEndYear: null,
    baseActiveYear: null,
  };

  // Pagination config (single "active" feed)
  const PAGINATION_CONFIG = {
    itemsPerPage: 6, // cards
    tableItemsPerPage: 10, // table
    currentPage: {
      active: 1,
    },
    totalItems: {
      active: 0,
    },
    viewMode: {
      active: 'cards', // default view
    },
  };

  // Polling configuration
  const POLLING_CONFIG = {
    enabled: true, // Enable auto-refresh
    interval: 3000, // Check every 3 seconds
    lastSnapshot: '', // Store last data snapshot
    lastUpdated: null, // Store last update timestamp
  };

  let currentSection = null;
  let fetchFn = null;
  let refreshTimer = null;

  // Audience helper
  function audienceBadgeHtml(audience_scope, course_abbr) {
    const scope = String(audience_scope || '').toLowerCase();
    if (scope === 'course' && course_abbr) {
      return `<span class="badge bg-info text-dark">${window.escapeHtml(
        String(course_abbr).toUpperCase()
      )}</span>`;
    }
    return `<span class="badge bg-secondary">General</span>`;
  }

  // Cards/Table container helpers
  function getCardsContainer() {
    return document.getElementById('userAnnouncementCardsContainer');
  }
  function getTableBody() {
    return document.getElementById('userAnnouncementTableBody');
  }

  // View toggle (cards / table)
  function setupViewToggle() {
    const toggleGroup = document.querySelector(
      '#user-announcements .view-toggle-group'
    );
    if (!toggleGroup) return;

    const cardsView = document.getElementById('UserAnnouncementCardsView');
    const tableView = document.getElementById('UserAnnouncementTableView');

    const defaultView = PAGINATION_CONFIG.viewMode.active || 'cards';

    toggleGroup.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      const viewType = btn.dataset.view;
      if (viewType === defaultView) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (defaultView === 'cards') {
      cardsView?.classList.remove('d-none');
      tableView?.classList.add('d-none');
    } else {
      cardsView?.classList.add('d-none');
      tableView?.classList.remove('d-none');
    }

    toggleGroup.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const viewType = btn.dataset.view;
        if (PAGINATION_CONFIG.viewMode.active === viewType) return;

        toggleGroup
          .querySelectorAll('.view-toggle-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        PAGINATION_CONFIG.viewMode.active = viewType;
        PAGINATION_CONFIG.currentPage.active = 1;

        if (viewType === 'cards') {
          cardsView?.classList.remove('d-none');
          tableView?.classList.add('d-none');
        } else {
          cardsView?.classList.add('d-none');
          tableView?.classList.remove('d-none');
        }

        // Reload announcements with new mode
        fetchFn && fetchFn();
      });
    });
  }

  // Pagination
  function renderPagination(totalItems, currentPage) {
    const container = document.getElementById('UserAnnouncementPagination');
    const infoContainer = document.getElementById(
      'UserAnnouncementPaginationInfo'
    );
    if (!container) {
      if (infoContainer) {
        infoContainer.textContent =
          totalItems > 0
            ? `Showing all ${totalItems} announcement(s)`
            : 'No announcements found';
      }
      return;
    }

    const itemsPerPage =
      PAGINATION_CONFIG.viewMode.active === 'table'
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
      container.innerHTML = '';
      if (infoContainer) {
        infoContainer.textContent =
          totalItems > 0
            ? `Showing all ${totalItems} announcement(s)`
            : 'No announcements found';
      }
      return;
    }

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
      infoContainer.textContent = `Showing ${startItem}-${endItem} of ${totalItems} announcement(s)`;
    }

    container.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(link.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          PAGINATION_CONFIG.currentPage.active = page;
          fetchFn && fetchFn();
        }
      });
    });
  }

  function getPaginatedItems(items) {
    const itemsPerPage =
      PAGINATION_CONFIG.viewMode.active === 'table'
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;
    const currentPage = PAGINATION_CONFIG.currentPage.active || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return items.slice(startIndex, endIndex);
  }

  // Render
  function renderAnnouncements(list) {
    const viewMode = PAGINATION_CONFIG.viewMode.active;
    const cardsContainer = getCardsContainer();
    const tableBody = getTableBody();

    if (cardsContainer) cardsContainer.innerHTML = '';
    if (tableBody) tableBody.innerHTML = '';

    if (!list || list.length === 0) {
      if (viewMode === 'table' && tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-3">
              No announcements found for the selected academic year and filters.
            </td>
          </tr>
        `;
      } else if (cardsContainer) {
        const empty = document.createElement('div');
        empty.className = 'col-12';
        empty.innerHTML = `
          <div class="border rounded py-4 text-center text-muted">
            No announcements found for the selected academic year and filters.
          </div>
        `;
        cardsContainer.appendChild(empty);
      }
      return;
    }

    list.forEach((a) => {
      const img = a.image_path || 'assets/images/image-add.png';
      const shortDesc = truncateText(a.description || '', 100);
      const audBadge = audienceBadgeHtml(a.audience_scope, a.course_abbr);

      if (viewMode === 'table') {
        renderTableRow(a, shortDesc, audBadge);
      } else {
        renderCard(a, shortDesc, audBadge, img);
      }
    });
  }

  function renderTableRow(a, shortDesc, audBadge) {
    const body = getTableBody();
    if (!body) return;

    const truncatedTitle = truncateText(a.title || '', 40);

    const tr = document.createElement('tr');
    tr.dataset.id = a.id;
    tr.innerHTML = `
      <td style="width:60px;">${window.escapeHtml(a.id)}</td>
      <td style="max-width:150px;">
        <span class="d-block text-truncate" style="max-width:150px;" title="${window.escapeHtml(a.title || 'Untitled')}">
          ${window.escapeHtml(truncatedTitle)}
        </span>
      </td>
      <td style="max-width:200px;">
        <span class="d-block text-truncate" style="max-width:200px;" title="${window.escapeHtml(a.description || '')}">
          ${window.escapeHtml(shortDesc)}
        </span>
      </td>
      <td style="width:100px;">
        ${audBadge}
      </td>
      <td style="max-width:120px;">
        <span class="d-block text-truncate" style="max-width:120px;" title="${window.escapeHtml(a.author_name || '—')}">
          ${window.escapeHtml(a.author_name || '—')}
        </span>
      </td>
      <td style="width:120px;">
        ${window.escapeHtml(a.category || 'Announcement')}
      </td>
      <td class="text-end" style="min-width:80px;">
        <button class="btn btn-sm btn-outline-secondary userViewBtn" data-id="${window.escapeHtml(
          a.id
        )}">
          <i class="bi bi-eye"></i>
        </button>
      </td>
    `;
    body.appendChild(tr);
  }

  function renderCard(a, shortDesc, audBadge, img) {
    const cardsContainer = getCardsContainer();
    if (!cardsContainer) return;

    const cardWrap = document.createElement('div');
    cardWrap.className = 'col-md-6 col-lg-4 mb-3';

    const truncatedTitle = truncateText(a.title || '', 30);

    cardWrap.innerHTML = `
      <div class="card shadow-sm h-100 border-0 ann-card"
           data-id="${window.escapeHtml(a.id)}"
           style="cursor:pointer;">
        <div class="card-body d-flex flex-column gap-2">
          <div class="d-flex justify-content-between align-items-start">
            <span class="badge bg-success text-uppercase">Active</span>
            ${audBadge}
          </div>
          <div class="d-flex gap-2 align-items-center">
            <img src="${window.escapeHtml(
              img
            )}" class="rounded" style="width:46px;height:46px;object-fit:cover;" alt="Announcement image">
            <div class="flex-grow-1">
              <h6 class="mb-0 text-truncate" title="${window.escapeHtml(
                a.title || 'Untitled'
              )}" style="max-width: 200px;">
                ${window.escapeHtml(truncatedTitle)}
              </h6>
              <small class="text-muted">${window.escapeHtml(
                a.category || 'Announcement'
              )}</small>
            </div>
          </div>
          <p class="mb-0 small text-muted" style="min-height: 40px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
            ${window.escapeHtml(shortDesc)}
          </p>
          <div class="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
            <small class="text-muted">
              <i class="bi bi-person-circle me-1"></i>
              <span class="d-inline-block text-truncate" style="max-width:120px;" title="${window.escapeHtml(a.author_name || '—')}">
                ${window.escapeHtml(a.author_name || '—')}
              </span>
            </small>
            <button class="btn btn-sm btn-outline-secondary userViewBtn" data-id="${window.escapeHtml(
              a.id
            )}">
              <i class="bi bi-eye"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    cardsContainer.appendChild(cardWrap);
  }

  // === View modal ===
  async function openAnnouncementView(id) {
    const bodyEl = document.getElementById('userViewAnnouncementBody');
    const modalEl = document.getElementById('userViewAnnouncementModal');

    try {
      if (bodyEl) {
        bodyEl.innerHTML =
          '<div class="text-center text-muted py-4">Loading...</div>';
      }

      const data = await window.fetchJSON(
        `php/get-announcement.php?id=${encodeURIComponent(
          id
        )}&t=${Date.now()}`
      );

      if (!data || data.success === false) {
        if (bodyEl) {
          bodyEl.innerHTML = `<div class="alert alert-danger mb-0">${window.escapeHtml(
            data?.message || 'Failed to load announcement.'
          )}</div>`;
        }
      } else {
        const a = data.announcement || data;
        const imgSrc = a.image_path || 'assets/images/image-add.png';
        const syText =
          a.start_year && a.end_year
            ? `${a.start_year} - ${a.end_year}`
            : '—';
        const activeYearText = a.active_year
          ? getSemesterDisplay(a.active_year, a.start_year, a.end_year)
          : '—';
        const audBadge = audienceBadgeHtml(a.audience_scope, a.course_abbr);

        if (bodyEl) {
          bodyEl.innerHTML = `
            <div class="d-flex gap-3 mb-3">
              <img src="${window.escapeHtml(
                imgSrc
              )}" alt="announcement image" class="rounded"
                style="width:110px;height:110px;object-fit:cover;">
              <div class="flex-grow-1">
                <h4 class="mb-1">${window.escapeHtml(
                  a.title || 'Untitled'
                )}</h4>
                <div class="d-flex flex-wrap gap-2 mb-2">
                  <span class="badge bg-success">Active</span>
                  <span class="badge bg-light text-dark">
                    <i class="bi bi-tag me-1"></i>${window.escapeHtml(
                      a.category || '—'
                    )}
                  </span>
                  ${audBadge}
                </div>
                <p class="mb-1 small text-muted">
                  <i class="bi bi-person-circle me-1"></i>${window.escapeHtml(
                    a.author_name || '—'
                  )}
                </p>
                <p class="mb-1 small text-muted">
                  <i class="bi bi-calendar3 me-1"></i>${window.escapeHtml(
                    a.created_at || '—'
                  )}
                </p>
                <p class="mb-0 small text-muted">
                  <i class="bi bi-journal-bookmark me-1"></i><strong>SY:</strong> ${window.escapeHtml(
                    syText
                  )}<br>
                  <i class="bi bi-book-half me-1"></i><strong>Semester:</strong> ${window.escapeHtml(
                    activeYearText
                  )}
                </p>
              </div>
            </div>

            <div class="mb-2">
              <h6 class="mb-2">Description</h6>
              <div class="border rounded p-2 bg-light small" style="white-space:pre-wrap;">
                ${window.escapeHtml(a.description || 'No description')}
              </div>
            </div>
          `;
        }
      }

      if (modalEl) {
        const m =
          bootstrap.Modal.getInstance(modalEl) ||
          new bootstrap.Modal(modalEl);
        m.show();
      }
    } catch (err) {
      console.error('[user-ann] open view error', err);
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="alert alert-danger mb-0">Failed to load announcement details.</div>`;
      }
      if (modalEl) {
        const m =
          bootstrap.Modal.getInstance(modalEl) ||
          new bootstrap.Modal(modalEl);
        m.show();
      }
    }
  }

  // === Load Active Year (SY + Semester dropdowns) ===
  async function loadActiveYear() {
    const apiBase = 'php/';
    const schoolYearEl = document.getElementById('userCurrentSchoolYear');
    const aySelect = document.getElementById('userAnnouncementAySelect');
    const activeYearSelect = document.getElementById(
      'userAnnouncementActiveYearSelect'
    );

    try {
      // Get current active AY
      let activeData = null;
      try {
        activeData = await window.fetchJSON(
          `${apiBase}get-active-academic-year.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error('[user-ann] get-active-academic-year error:', e);
      }

      if (activeData && activeData.school_year) {
        activeYearState.schoolYearText = activeData.school_year;

        // Parse the school year to get start and end year
        const parts = String(activeData.school_year).split('-');
        if (parts.length === 2) {
          const sy = parseInt(parts[0], 10);
          const ey = parseInt(parts[1], 10);
          
          // Set base years
          activeYearState.baseStartYear = sy;
          activeYearState.baseEndYear = ey;
          
          // Set current filter years to base years
          activeYearState.startYear = sy;
          activeYearState.endYear = ey;
          
          // Get active year from response (if available)
          if (activeData.active_year !== undefined && activeData.active_year !== null) {
            const ay = parseInt(activeData.active_year, 10);
            activeYearState.baseActiveYear = !Number.isNaN(ay) ? ay : sy;
            activeYearState.activeYear = !Number.isNaN(ay) ? ay : sy;
          } else {
            // If no active_year in response, default to start year
            activeYearState.baseActiveYear = sy;
            activeYearState.activeYear = sy;
          }
        }

        if (schoolYearEl) {
          schoolYearEl.textContent = activeData.school_year;
        }
      } else if (schoolYearEl) {
        schoolYearEl.textContent =
          activeData?.warning || 'No active academic year';
      }

      // Get list of AYs
      let listData = null;
      try {
        listData = await window.fetchJSON(
          `${apiBase}get-academic-years.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error('[user-ann] get-academic-years error:', e);
      }

      // Fill school year select (REMOVED "All School Years" option)
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
              sy === activeYearState.baseStartYear &&
              ey === activeYearState.baseEndYear;

            html += `<option value="${window.escapeHtml(value)}" ${
              isSelected ? 'selected' : ''
            }>${window.escapeHtml(label)}</option>`;
          });
        }

        if (!html) {
          const sy = activeYearState.baseStartYear;
          const ey = activeYearState.baseEndYear;
          const label =
            sy && ey
              ? `${sy}–${ey}`
              : activeYearState.schoolYearText || '—';
          const val = `${sy || ''}-${ey || ''}`;
          html += `<option value="${window.escapeHtml(
            val
          )}" selected>${window.escapeHtml(label)}</option>`;
        }

        aySelect.innerHTML = html;
      }

      // Fill semester select (REMOVED "All Semesters" option)
      if (activeYearSelect) {
        const sy = activeYearState.baseStartYear;
        const ey = activeYearState.baseEndYear;
        const ay = activeYearState.baseActiveYear;
        let html = '';

        if (sy && ey) {
          // Always show both semester options
          const firstSemText = getSemesterDisplay(sy, sy, ey);
          const secondSemText = getSemesterDisplay(ey, sy, ey);
          
          // Select the active semester
          // If we have a specific active year, use it
          // Otherwise default to start year
          const activeSemester = ay || sy;
          const firstSelected = activeSemester === sy ? 'selected' : '';
          const secondSelected = activeSemester === ey ? 'selected' : '';
          
          html += `<option value="${sy}" ${firstSelected}>${firstSemText}</option>`;
          html += `<option value="${ey}" ${secondSelected}>${secondSemText}</option>`;
          
          activeYearSelect.disabled = false;
        } else {
          html = '<option value="">—</option>';
          activeYearSelect.disabled = true;
        }
        
        activeYearSelect.innerHTML = html;
      }
    } catch (err) {
      console.error('[user-ann] loadActiveYear error:', err);
      if (schoolYearEl)
        schoolYearEl.textContent = 'Error loading school year';
      if (aySelect) aySelect.innerHTML = '<option value="">—</option>';
      if (activeYearSelect)
        activeYearSelect.innerHTML = '<option value="">—</option>';
    }
  }

  // === Load announcements (Active only, trust backend for audience rules) ===
  async function loadAnnouncements(q = '') {
    const apiBase = 'php/';
    const params = new URLSearchParams();

    // Only Active announcements
    params.set('status', 'Active');
    params.set('q', q);

    // Year filters - use current filter state
    if (activeYearState.startYear)
      params.set('start_year', String(activeYearState.startYear));
    if (activeYearState.endYear)
      params.set('end_year', String(activeYearState.endYear));
    if (activeYearState.activeYear)
      params.set('active_year', String(activeYearState.activeYear));

    params.set('t', Date.now().toString());

    try {
      const data = await window.fetchJSON(
        `${apiBase}get-announcements-user.php?${params.toString()}`
      );

      let list = Array.isArray(data)
        ? data
        : Array.isArray(data.announcements)
        ? data.announcements
        : [];

      // Create current snapshot
      const currentSnapshot = JSON.stringify({
        list: list,
        total: list.length,
        timestamp: Date.now()
      });

      // Compare with previous snapshot
      if (currentSnapshot === POLLING_CONFIG.lastSnapshot) {
        // No changes, skip rendering
        console.log('[user-ann] No data changes, skipping render');
        return;
      }

      // Update snapshot
      POLLING_CONFIG.lastSnapshot = currentSnapshot;
      POLLING_CONFIG.lastUpdated = Date.now();

      PAGINATION_CONFIG.totalItems.active = list.length;
      const paginated = getPaginatedItems(list);
      renderAnnouncements(paginated);
      renderPagination(list.length, PAGINATION_CONFIG.currentPage.active);
    } catch (err) {
      console.error('[user-ann] loadAnnouncements error:', err);
      const body = getTableBody();
      const cards = getCardsContainer();
      if (body) {
        body.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-danger">Failed to load announcements.</td>
          </tr>
        `;
      }
      if (cards) {
        cards.innerHTML = `
          <div class="col-12">
            <div class="border rounded py-4 text-center text-danger">
              Failed to load announcements.
            </div>
          </div>
        `;
      }
    }
  }

  // === Polling function ===
  function startPolling() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    
    if (POLLING_CONFIG.enabled) {
      refreshTimer = setInterval(() => {
        console.log('[user-ann] Polling for updates...');
        if (fetchFn) {
          fetchFn();
        }
      }, POLLING_CONFIG.interval);
    }
  }

  // === Check for updates using timestamp comparison ===
  async function checkForPendingUpdates() {
    try {
      const response = await window.fetchJSON(
        `php/check-pending-updates.php?type=announcements&t=${Date.now()}`
      );
      
      if (response && response.last_updated) {
        if (!POLLING_CONFIG.lastUpdated || 
            new Date(response.last_updated) > new Date(POLLING_CONFIG.lastUpdated)) {
          console.log('[user-ann] New updates detected, refreshing...');
          if (fetchFn) {
            fetchFn();
          }
          POLLING_CONFIG.lastUpdated = response.last_updated;
        }
      }
    } catch (error) {
      console.error('[user-ann] Error checking for updates:', error);
    }
  }

  // === INIT ===
  document.addEventListener('DOMContentLoaded', () => {
    const runOnceOrAgain = () => {
      const el = document.querySelector('#user-announcements');
      if (!el) return;
      if (el !== currentSection) {
        currentSection = el;
        initUserAnnouncements(el);
        console.log('User Announcements initialized ✅');
      }
    };

    const contentArea =
      document.getElementById('content-area') || document.body;
    const obs = new MutationObserver(runOnceOrAgain);
    obs.observe(contentArea, { childList: true, subtree: true });
    runOnceOrAgain();
  });

  function initUserAnnouncements(section) {
    if (!section) return;

    // View toggle
    setupViewToggle();

    const searchInput = document.getElementById('userAnnouncementSearch');
    const aySelect = document.getElementById('userAnnouncementAySelect');
    const activeYearSelect = document.getElementById(
      'userAnnouncementActiveYearSelect'
    );

    // Search
    searchInput?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage.active = 1;
        loadAnnouncements(e.target.value);
      }, 120)
    );

    // SY change
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';
      const [syRaw, eyRaw] = val.split('-');
      const sy = parseInt(syRaw, 10);
      const ey = parseInt(eyRaw, 10);

      // Update filter state
      activeYearState.startYear = !Number.isNaN(sy) ? sy : null;
      activeYearState.endYear = !Number.isNaN(ey) ? ey : null;
      
      // When changing SY, reset active year to start year
      activeYearState.activeYear = sy;

      // Update semester dropdown
      if (activeYearSelect) {
        let html = '';

        if (sy && ey) {
          const firstSemText = getSemesterDisplay(sy, sy, ey);
          const secondSemText = getSemesterDisplay(ey, sy, ey);
          
          // Select first semester by default when SY changes
          html += `<option value="${sy}" selected>${firstSemText}</option>`;
          html += `<option value="${ey}">${secondSemText}</option>`;
          
          activeYearSelect.disabled = false;
        } else {
          html = '<option value="">—</option>';
          activeYearSelect.disabled = true;
        }
        
        activeYearSelect.innerHTML = html;
      }

      PAGINATION_CONFIG.currentPage.active = 1;
      loadAnnouncements(searchInput?.value || '');
    });

    // Semester change
    activeYearSelect?.addEventListener('change', () => {
      if (activeYearSelect.disabled) return;
      const val = activeYearSelect.value;
      const yr = parseInt(val, 10);
      if (!Number.isNaN(yr)) {
        activeYearState.activeYear = yr;
      }

      PAGINATION_CONFIG.currentPage.active = 1;
      loadAnnouncements(searchInput?.value || '');
    });

    // Click handlers (view)
    section.addEventListener('click', (e) => {
      const card = e.target.closest('.ann-card');
      if (card && !e.target.closest('.btn')) {
        const id = card.dataset.id;
        if (id) {
          openAnnouncementView(id);
          return;
        }
      }

      const viewBtn = e.target.closest('.userViewBtn');
      if (viewBtn) {
        const id = viewBtn.dataset.id;
        if (id) openAnnouncementView(id);
      }
    });

    // Fetch function
    fetchFn = () => loadAnnouncements(searchInput?.value || '');

    // Start polling
    startPolling();

    // Also check for updates using timestamp method
    if (POLLING_CONFIG.enabled) {
      setInterval(checkForPendingUpdates, 2000);
    }

    loadActiveYear().then(() => {
      fetchFn();
    });
  }
})();