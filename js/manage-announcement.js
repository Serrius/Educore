// manage-announcement.js
// Safe version: SPA-aware, supports Academic Year + Active Year selectors,
// "delete" turned into "archive", and ONLY super-admin can accept/deny.
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

  // ===== shared status modals (success/error) =====
  function showSuccessModal(msg) {
    const el = document.getElementById('successDialogue');
    const modalEl = document.getElementById('statusSuccessModal');
    if (!el || !modalEl) return console.warn('[ann] success modal missing');
    el.textContent = msg;
    const modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener(
      'hidden.bs.modal',
      () => {
        document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
      },
      { once: true }
    );
    modal.show();
  }

  function showErrorModal(msg) {
    const el = document.getElementById('errorDialogue');
    const modalEl = document.getElementById('statusErrorsModal');
    if (!el || !modalEl) return console.warn('[ann] error modal missing');
    el.textContent = msg;
    const modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener(
      'hidden.bs.modal',
      () => {
        document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
      },
      { once: true }
    );
    modal.show();
  }

  // ===== Announcement manager state & inits =====
  let lastAnnouncementsSnapshot = {
    all: '',
    Pending: '',
    Rejected: '',
    Archived: '',
    Manage: '',
  };
  let refreshTimers = {
    all: null,
    pending: null,
    rejected: null,
    archived: null,
    manage: null,
  };
  let fetchFns = {
    all: null,
    Pending: null,
    Rejected: null,
    Archived: null,
    Manage: null,
  };

  // Polling configuration
  const POLLING_CONFIG = {
    enabled: true, // Enable auto-refresh
    interval: 3000, // Check every 3 seconds
    lastUpdated: {}, // Store last update timestamps per tab
  };

  // Academic year state
  const activeYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,
    // "Base" = real active year from backend; used to detect read-only mode
    baseStartYear: null,
    baseEndYear: null,
    baseActiveYear: null,
  };

  let currentAnnSection = null;
  let globalDocHandlersBound = false;

  // Pagination settings
  const PAGINATION_CONFIG = {
    itemsPerPage: 6, // For cards view
    tableItemsPerPage: 10, // For table view
    currentPage: {},
    totalItems: {},
    viewMode: {}, // Stores current view mode for each tab
  };

  // Initialize view modes (DEFAULT = TABLE for all)
  function initializeViewModes() {
    PAGINATION_CONFIG.viewMode = {
      all: 'table',
      Pending: 'table',
      Rejected: 'table',
      Archived: 'table',
      Manage: 'table',
    };

    PAGINATION_CONFIG.currentPage = {
      all: 1,
      Pending: 1,
      Rejected: 1,
      Archived: 1,
      Manage: 1,
    };

    PAGINATION_CONFIG.totalItems = {
      all: 0,
      Pending: 0,
      Rejected: 0,
      Archived: 0,
      Manage: 0,
    };

    // Initialize polling timestamps
    POLLING_CONFIG.lastUpdated = {
      all: null,
      Pending: null,
      Rejected: null,
      Archived: null,
      Manage: null,
    };
  }

  // ======== ROLE/COURSE HELPERS (now reading from localStorage) ========
  function getUserRole() {
    const lsRole = (localStorage.getItem('currentUserRole') || '').toString();
    const bodyRole = (document.body?.dataset?.role || '').toString();
    const g1 = (window.currentUserRole || '').toString();
    const g2 = (window.USER_ROLE || '').toString();

    const raw = (lsRole || bodyRole || g1 || g2 || '').toLowerCase();
    return raw.replace(/[\s_]+/g, '-');
  }

  function getUserCourseAbbr() {
    const lsDept = (localStorage.getItem('currentUserDepartment') || '').toString();
    const bodyDept =
      (document.body?.dataset?.department ||
        document.body?.dataset?.courseAbbr ||
        document.body?.dataset?.courseabbr ||
        '') + '';
    const g =
      (window.currentUserDepartment ||
        window.currentUserCourse ||
        window.USER_COURSE ||
        '') + '';

    const value = lsDept || bodyDept || g || '';
    return value.toUpperCase(); // e.g. "BSIT"
  }

  // detect role — only super-admin can accept/deny
  function detectIsSuperAdmin() {
    return getUserRole() === 'super-admin';
  }

  function detectIsSpecialAdmin() {
    return getUserRole() === 'special-admin';
  }

  // ======== SEMESTER HELPER ========
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

  // ======== PAGINATION FUNCTIONS ========
  function renderPagination(status, totalItems, currentPage) {
    const containerId = `${status}AnnouncementPagination`;
    const infoContainerId = `${status}AnnouncementPaginationInfo`;
    const container = document.getElementById(containerId);
    const infoContainer = document.getElementById(infoContainerId);

    if (!container) {
      if (infoContainer) {
        infoContainer.innerHTML =
          totalItems > 0
            ? `Showing all ${totalItems} announcement(s)`
            : 'No announcements found';
      }
      return;
    }

    const itemsPerPage =
      PAGINATION_CONFIG.viewMode[status] === 'table'
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
      container.innerHTML = '';
      if (infoContainer) {
        infoContainer.innerHTML =
          totalItems > 0
            ? `Showing all ${totalItems} announcement(s)`
            : 'No announcements found';
      }
      return;
    }

    let paginationHtml = '<ul class="pagination pagination-sm mb-0">';

    // Previous button
    paginationHtml += `
      <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a>
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
        <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
      </li>
    `;

    paginationHtml += '</ul>';
    container.innerHTML = paginationHtml;

    // Pagination info
    if (infoContainer) {
      const startItem = (currentPage - 1) * itemsPerPage + 1;
      const endItem = Math.min(currentPage * itemsPerPage, totalItems);
      infoContainer.innerHTML = `Showing ${startItem}-${endItem} of ${totalItems} announcement(s)`;
    }

    // Add click handlers
    container.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(link.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          PAGINATION_CONFIG.currentPage[status] = page;
          if (fetchFns[status]) {
            fetchFns[status]();
          }
        }
      });
    });
  }

  function getPaginatedItems(items, status) {
    const itemsPerPage =
      PAGINATION_CONFIG.viewMode[status] === 'table'
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;
    const currentPage = PAGINATION_CONFIG.currentPage[status] || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;

    return items.slice(startIndex, endIndex);
  }

  // ======== VIEW TOGGLE FUNCTIONS ========
  function setupViewToggle(status) {
    const tabId = `#tab${
      status.charAt(0).toUpperCase() + status.slice(1)
    }Announcement`;
    const toggleGroup = document.querySelector(`${tabId} .view-toggle-group`);
    if (!toggleGroup) return;

    const tableView = document.getElementById(
      `${status}AnnouncementTableView`
    );
    const cardsView = document.getElementById(
      `${status}AnnouncementCardsView`
    );

    // Initial state based on PAGINATION_CONFIG (default = table)
    const defaultView = PAGINATION_CONFIG.viewMode[status] || 'table';

    toggleGroup.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      const viewType = btn.dataset.view;
      if (viewType === defaultView) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (defaultView === 'table') {
      if (tableView) tableView.classList.remove('d-none');
      if (cardsView) cardsView.classList.add('d-none');
    } else {
      if (tableView) tableView.classList.add('d-none');
      if (cardsView) cardsView.classList.remove('d-none');
    }

    // Toggle handler
    toggleGroup.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const viewType = btn.dataset.view;
        if (PAGINATION_CONFIG.viewMode[status] === viewType) return;

        // Update active state
        toggleGroup
          .querySelectorAll('.view-toggle-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Update view mode
        PAGINATION_CONFIG.viewMode[status] = viewType;
        PAGINATION_CONFIG.currentPage[status] = 1; // Reset to first page

        // Show/hide appropriate containers
        const tblView = document.getElementById(
          `${status}AnnouncementTableView`
        );
        const crdView = document.getElementById(
          `${status}AnnouncementCardsView`
        );

        if (viewType === 'table') {
          if (tblView) tblView.classList.remove('d-none');
          if (crdView) crdView.classList.add('d-none');
        } else {
          if (tblView) tblView.classList.add('d-none');
          if (crdView) crdView.classList.remove('d-none');
        }

        // Reload announcements with new view mode
        if (fetchFns[status]) {
          fetchFns[status]();
        }
      });
    });
  }

  // ======== AUDIENCE helpers ========
  function audienceBadgeHtml(audience_scope, course_abbr) {
    const scope = String(audience_scope || '').toLowerCase();
    if (scope === 'course' && course_abbr) {
      return `<span class="badge bg-info text-dark">${window.escapeHtml(
        course_abbr
      )}</span>`;
    }
    return `<span class="badge bg-secondary">General</span>`;
  }

  // Helper function to truncate text with ellipsis
  function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // Load a course picker (select). Safe to call even if container missing.
  async function loadCourseSelect(intoEl, selectedAbbr, isSuperAdmin, myCourse) {
    if (!intoEl) return;
    intoEl.innerHTML = `<div class="text-muted small">Loading courses…</div>`;
    try {
      const rows = await window.fetchJSON(
        `php/get-active-courses.php?t=${Date.now()}`
      );
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        intoEl.innerHTML = `<div class="text-danger small">No active courses found.</div>`;
        return;
      }

      // If admin and no course resolved, show a locked warning
      if (!isSuperAdmin && !myCourse) {
        intoEl.innerHTML = `
          <div class="alert alert-warning py-2 small mb-2">
            Your course/department is not available to the client JS. You can still post <strong>General</strong>.
          </div>
        `;
        return;
      }

      const filtered = isSuperAdmin
        ? list
        : list.filter(
            (c) => String(c.abbreviation || '').toUpperCase() === myCourse
          );

      if (!isSuperAdmin && filtered.length === 0) {
        intoEl.innerHTML = `
          <div class="small">
            <span class="badge bg-info text-dark">${window.escapeHtml(
              myCourse || '—'
            )}</span>
            <input type="hidden" name="course_abbr" value="${window.escapeHtml(
              myCourse || ''
            )}">
          </div>`;
        return;
      }

      const selId = 'courseAbbrSelect_' + Math.random().toString(36).slice(2);
      const options = filtered
        .map((c) => {
          const abb = String(c.abbreviation || '').toUpperCase();
          const name = c.name || c.course_name || '';
          const sel =
            String(selectedAbbr || '').toUpperCase() === abb ? 'selected' : '';
          return `<option value="${window.escapeHtml(abb)}" ${sel}>${window.escapeHtml(
            abb
          )}${name ? ' — ' + window.escapeHtml(name) : ''}</option>`;
        })
        .join('');

      const disabled = isSuperAdmin ? '' : 'disabled';
      const hint = isSuperAdmin
        ? 'Choose the target course/department'
        : 'Locked to your own course';
      intoEl.innerHTML = `
        <label class="form-label small mb-1">Target Course/Department</label>
        <select class="form-select" id="${selId}" name="course_abbr" ${disabled} required>
          ${options}
        </select>
        <div class="form-text">${hint}</div>
        ${
          isSuperAdmin
            ? ''
            : `<input type="hidden" name="course_abbr" value="${window.escapeHtml(
                myCourse || ''
              )}">`
        }
      `;
    } catch (e) {
      intoEl.innerHTML = `<div class="text-danger small">Failed to load courses.</div>`;
    }
  }

  // Wire the audience radios to show/hide the course picker (safe if missing)
  function setupAudienceRadios(
    scopeGeneralEl,
    scopeCourseEl,
    rowEl,
    pickerEl,
    isSuperAdmin,
    myCourse,
    selectedAbbr
  ) {
    if (!scopeGeneralEl && !scopeCourseEl) return;
    const toggle = () => {
      const useCourse = !!scopeCourseEl?.checked;
      if (rowEl) rowEl.classList.toggle('d-none', !useCourse);
      if (useCourse)
        loadCourseSelect(pickerEl, selectedAbbr, isSuperAdmin, myCourse);
    };
    scopeGeneralEl?.addEventListener('change', toggle);
    scopeCourseEl?.addEventListener('change', toggle);
    // initial paint
    toggle();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const runOnceOrAgain = () => {
      const el = document.querySelector('#manage-announcement');
      if (!el) return;
      if (el !== currentAnnSection) {
        currentAnnSection = el;
        initManageAnnouncements(el);
        console.log('Manage Announcement initialized / reinitialized ✅');
      }
    };

    const contentArea =
      document.getElementById('content-area') || document.body;
    const obs = new MutationObserver(runOnceOrAgain);
    obs.observe(contentArea, { childList: true, subtree: true });
    runOnceOrAgain();
  });

  function clearAllAnnIntervals() {
    Object.keys(refreshTimers).forEach((k) => {
      if (refreshTimers[k]) {
        clearInterval(refreshTimers[k]);
        refreshTimers[k] = null;
      }
    });
  }

  function resetSnapshots() {
    lastAnnouncementsSnapshot = {
      all: '',
      Pending: '',
      Rejected: '',
      Archived: '',
      Manage: '',
    };
  }

  // ======== POLLING FUNCTIONS ========
  function startPolling(status) {
    if (refreshTimers[status]) {
      clearInterval(refreshTimers[status]);
    }
    
    if (POLLING_CONFIG.enabled) {
      refreshTimers[status] = setInterval(() => {
        console.log(`[ann] Polling for ${status} updates...`);
        if (fetchFns[status]) {
          fetchFns[status]();
        }
      }, POLLING_CONFIG.interval);
    }
  }

  async function checkForPendingUpdates(status) {
    try {
      const response = await window.fetchJSON(
        `php/check-pending-updates.php?type=announcements&status=${status}&t=${Date.now()}`
      );
      
      if (response && response.last_updated) {
        const lastUpdated = POLLING_CONFIG.lastUpdated[status];
        if (!lastUpdated || 
            new Date(response.last_updated) > new Date(lastUpdated)) {
          console.log(`[ann] New updates detected for ${status}, refreshing...`);
          if (fetchFns[status]) {
            fetchFns[status]();
          }
          POLLING_CONFIG.lastUpdated[status] = response.last_updated;
        }
      }
    } catch (error) {
      console.error(`[ann] Error checking for ${status} updates:`, error);
    }
  }

  // ======== SNAPSHOT COMPARISON ========
  function hasDataChanged(status, data) {
    const currentSnapshot = JSON.stringify(data);
    const lastSnapshot = lastAnnouncementsSnapshot[status];
    
    if (currentSnapshot === lastSnapshot) {
      console.log(`[ann] No data changes for ${status}, skipping render`);
      return false;
    }
    
    lastAnnouncementsSnapshot[status] = currentSnapshot;
    return true;
  }

  // Helper: are we currently looking at the REAL active AY + active year?
  function isReadOnlyView() {
    const baseSy = activeYearState.baseStartYear;
    const baseEy = activeYearState.baseEndYear;
    const baseAy = activeYearState.baseActiveYear;

    // If we don't know the base, don't force read-only
    if (baseSy == null && baseEy == null && baseAy == null) return false;

    const sameSY =
      activeYearState.startYear === baseSy &&
      activeYearState.endYear === baseEy;

    const sameAY = activeYearState.activeYear === baseAy;

    // if NOT same SY OR NOT same active year → read-only
    return !(sameSY && sameAY);
  }

  // Badge visibility (uses .invisible so layout stays)
  function updateReadOnlyBadge() {
    const badge = document.getElementById('ayReadOnlyBadge');
    const readOnly = isReadOnlyView();
    if (!badge) return;

    if (readOnly) {
      badge.classList.remove('invisible'); // show
    } else {
      badge.classList.add('invisible'); // hide but keep space
    }
  }

  // Add Announcement button: disable + fade when read-only
  function updateAddButtonState() {
    const btn = document.getElementById('openAddAnnouncementBtn');
    if (!btn) return;
    const readOnly = isReadOnlyView();

    // If we're in bulk mode and button is hidden via .d-none, don't fight that here.
    if (btn.classList.contains('d-none')) return;

    if (readOnly) {
      btn.disabled = true;
      btn.style.opacity = '0.45';
      btn.style.pointerEvents = 'none';
      btn.title =
        'You can only add announcements in the active academic year.';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.title = '';
    }
  }

  function initManageAnnouncements(section) {
    if (!section) return console.warn('[ann] #manage-announcement not found');

    section.dataset.annInit = 'true';

    clearAllAnnIntervals();
    resetSnapshots();
    initializeViewModes();

    const apiBase = 'php/';
    const isSuperAdmin = detectIsSuperAdmin();
    const myCourse = getUserCourseAbbr(); // from localStorage/body/globals

    // show "posting as" (optional badge)
    const whoAmI = document.getElementById('whoAmI');
    if (whoAmI) {
      const role = getUserRole() || 'unknown';
      const course = myCourse || '';
      whoAmI.textContent = course ? `${role} • ${course}` : role;
    }

    // DOM references
    const addForm = document.getElementById('addAnnouncementForm');
    const editForm = document.getElementById('editAnnouncementForm');
    const declineForm = document.getElementById('declineReasonForm');

    const allCardsContainer = document.getElementById(
      'activeAnnouncementCardsView'
    );
    const pendingCardsContainer = document.getElementById(
      'pendingAnnouncementCardsView'
    );
    const rejectedCardsContainer = document.getElementById(
      'rejectedAnnouncementCardsView'
    );
    const archivedCardsContainer = document.getElementById(
      'archivedAnnouncementCardsView'
    );
    const manageCardsContainer = document.getElementById(
      'manageAnnouncementCardsView'
    );

    const allTableBody = document.getElementById('activeAnnouncementTableBody');
    const pendingTableBody = document.getElementById(
      'pendingAnnouncementTableBody'
    );
    const rejectedTableBody = document.getElementById(
      'rejectedAnnouncementTableBody'
    );
    const archivedTableBody = document.getElementById(
      'archivedAnnouncementTableBody'
    );
    const manageTableBody = document.querySelector('#announcementTable tbody');

    const bulkBar = document.getElementById('announcementBulkActions');
    const defaultBar = document.getElementById('announcementDefaultActions');
    const bulkDeleteBtn =
      document.getElementById('bulkDeleteAnnouncements');

    const searchAll = document.getElementById('activeAnnouncementSearch');
    const searchPending = document.getElementById('pendingAnnouncementSearch');
    const searchRejected = document.getElementById('rejectedAnnouncementSearch');
    const searchArchived = document.getElementById('archivedAnnouncementSearch');
    const searchManage = document.getElementById('announcementSearch');

    const schoolYearEl = document.getElementById('currentSchoolYear');

    const aySelect = document.getElementById('announcementAySpanSelect');
    const activeYearSelect = document.getElementById(
      'announcementActiveYearSelect'
    );

    const viewModalBody = document.getElementById('viewAnnouncementBody');
    const viewModalEl = document.getElementById('viewAnnouncementModal');

    const editModalEl = document.getElementById('editAnnouncementModal');
    const declineModalEl = document.getElementById('declineReasonModal');
    const editModal = editModalEl ? new bootstrap.Modal(editModalEl) : null;
    const declineModal = declineModalEl
      ? new bootstrap.Modal(declineModalEl)
      : null;

    // === Generic confirm modal refs ===
    const confirmModalEl = document.getElementById('genericConfirmModal');
    const confirmTitleEl = document.getElementById('genericConfirmTitle');
    const confirmMessageEl = document.getElementById('genericConfirmMessage');
    const confirmOkBtn = document.getElementById('genericConfirmOkBtn');
    const confirmCancelBtn = document.getElementById(
      'genericConfirmCancelBtn'
    );
    const confirmModal = confirmModalEl
      ? new bootstrap.Modal(confirmModalEl)
      : null;

    // Reusable confirm dialog (returns Promise<boolean>)
    function showConfirmDialog(
      message,
      {
        title = 'Confirm Action',
        confirmText = 'Yes',
        cancelText = 'Cancel',
        variant = 'primary',
      } = {}
    ) {
      if (
        !confirmModal ||
        !confirmMessageEl ||
        !confirmOkBtn ||
        !confirmTitleEl ||
        !confirmCancelBtn
      ) {
        return Promise.resolve(window.confirm(message));
      }

      confirmTitleEl.textContent = title;
      confirmMessageEl.textContent = message;

      // Reset classes + apply variant
      confirmOkBtn.className = 'btn btn-sm';
      confirmCancelBtn.className = 'btn btn-outline-secondary btn-sm';
      confirmOkBtn.classList.add(`btn-${variant}`);

      confirmOkBtn.textContent = confirmText;
      confirmCancelBtn.textContent = cancelText;

      return new Promise((resolve) => {
        const handleOk = () => {
          cleanup();
          resolve(true);
          confirmModal.hide();
        };
        const handleCancel = () => {
          cleanup();
          resolve(false);
        };
        const handleHidden = () => {
          cleanup();
          resolve(false);
        };

        function cleanup() {
          confirmOkBtn.removeEventListener('click', handleOk);
          confirmCancelBtn.removeEventListener('click', handleCancel);
          confirmModalEl.removeEventListener('hidden.bs.modal', handleHidden);
        }

        confirmOkBtn.addEventListener('click', handleOk, { once: true });
        confirmCancelBtn.addEventListener('click', handleCancel, { once: true });
        confirmModalEl.addEventListener('hidden.bs.modal', handleHidden, {
          once: true,
        });

        confirmModal.show();
      });
    }

    // Setup view toggles for all tabs
    ['all', 'Pending', 'Rejected', 'Archived', 'Manage'].forEach((status) => {
      setupViewToggle(status);
    });

    const selectedAnnIds = new Set();

    function showBulkBarIfNeeded() {
      if (!bulkBar || !defaultBar) return;
      const addBtn = document.getElementById('openAddAnnouncementBtn');

      // In read-only mode, bulk actions are always hidden, Add button just follows read-only rules.
      if (isReadOnlyView()) {
        bulkBar.classList.add('d-none');
        defaultBar.classList.remove('d-none');
        if (addBtn) {
          addBtn.classList.remove('d-none');
        }
        updateAddButtonState();
        return;
      }

      // When we have selected rows → show bulk bar, hide default actions + Add button
      if (selectedAnnIds.size > 0) {
        bulkBar.classList.remove('d-none');
        defaultBar.classList.add('d-none');
        if (addBtn) {
          addBtn.classList.add('d-none');
        }
      } else {
        // No selection → show default bar, show Add button (then apply read-only state)
        bulkBar.classList.add('d-none');
        defaultBar.classList.remove('d-none');
        if (addBtn) {
          addBtn.classList.remove('d-none');
        }
        updateAddButtonState();
      }
    }

    function syncSelectAllCheckbox() {
      const tb = document.querySelector('#announcementTable tbody');
      const tableSelectAll = document.getElementById('selectAllAnnouncements');
      if (!tb || !tableSelectAll) return;

      if (isReadOnlyView()) {
        tableSelectAll.checked = false;
        tableSelectAll.disabled = true;
        return;
      }

      tableSelectAll.disabled = false;
      const checks = tb?.querySelectorAll('.ann-row-check') || [];
      if (!checks.length) {
        tableSelectAll.checked = false;
        return;
      }
      const allChecked = Array.from(checks).every((c) => c.checked);
      tableSelectAll.checked = allChecked;
    }

    function statusBadgeClass(s) {
      return s === 'Active'
        ? 'bg-success'
        : s === 'Pending'
        ? 'bg-warning text-dark'
        : s === 'Rejected'
        ? 'bg-danger'
        : s === 'Archived'
        ? 'bg-secondary'
        : 'bg-dark';
    }

    function ensureManageTableHeadHasSelectAll() {
      const table = document.getElementById('announcementTable');
      if (!table) return;
      const thead = table.querySelector('thead');
      if (!thead) return;
      const firstTh = thead.querySelector('th.ann-select-head');
      if (!firstTh) {
        const row = thead.querySelector('tr');
        if (row) {
          const th = document.createElement('th');
          th.className = 'ann-select-head text-center';
          th.style.width = '36px';
          th.innerHTML =
            '<input type="checkbox" id="selectAllAnnouncements" class="form-check-input">';
          row.prepend(th);

          const sel = row.querySelector('#selectAllAnnouncements');
          if (sel) {
            sel.addEventListener('change', () => {
              if (isReadOnlyView()) {
                sel.checked = false;
                return;
              }
              selectedAnnIds.clear();
              const tb = document.querySelector('#announcementTable tbody');
              const checks = tb?.querySelectorAll('.ann-row-check') || [];
              checks.forEach((chk) => {
                chk.checked = sel.checked;
                if (chk.checked) selectedAnnIds.add(Number(chk.dataset.id));
              });
              showBulkBarIfNeeded();
            });
          }
        }
      }
    }

    // ======= renderAnnouncements =======
    function renderAnnouncements(
      list,
      status,
      isSuperAdminFlag,
      myCourseFlag,
      isReadOnlyFlag
    ) {
      const viewMode = PAGINATION_CONFIG.viewMode[status];

      const tableBody = getTableBodyForStatus(status);
      const cardsContainer = getCardsContainerForStatus(status);

      // Clear existing content
      if (tableBody) tableBody.innerHTML = '';
      if (cardsContainer) cardsContainer.innerHTML = '';

      // Manage + table view → reset selection each render
      if (status === 'Manage' && viewMode === 'table') {
        selectedAnnIds.clear();
        showBulkBarIfNeeded();
      }

      // If no items → show nice "no announcements" message
      if (!list || list.length === 0) {
        const label =
          status === 'all'
            ? 'active'
            : status.toLowerCase();

        if (viewMode === 'table' && tableBody) {
          let colSpan = 7;
          if (status === 'Manage') {
            const table = document.getElementById('announcementTable');
            if (table) {
              const thCount = table.querySelectorAll('thead th').length;
              colSpan = thCount || 8;
            } else {
              colSpan = 8;
            }
          }

          tableBody.innerHTML = `
            <tr>
              <td colspan="${colSpan}" class="text-center text-muted py-3">
                No ${label} announcement(s) found for the selected academic year.
              </td>
            </tr>
          `;
        } else if (cardsContainer) {
          const empty = document.createElement('div');
          empty.className = 'col-12';
          empty.innerHTML = `
            <div class="border rounded py-4 text-center text-muted">
              No ${label} announcement(s) found for the selected academic year.
            </div>
          `;
          cardsContainer.appendChild(empty);
        }

        return;
      }

      // Render items
      list.forEach((a) => {
        const img = a.image_path || 'assets/images/image-add.png';
        const shortDesc = truncateText(a.description || '', 100);

        const audBadge = audienceBadgeHtml(a.audience_scope, a.course_abbr);

        // Don't show Archived rows in Manage table
        if (status === 'Manage' && a.status === 'Archived') {
          return;
        }

        const viewModeNow = PAGINATION_CONFIG.viewMode[status];

        if (viewModeNow === 'table') {
          renderTableView(
            a,
            status,
            isSuperAdminFlag,
            isReadOnlyFlag,
            audBadge,
            shortDesc
          );
        } else {
          renderCardsView(
            a,
            status,
            isSuperAdminFlag,
            isReadOnlyFlag,
            audBadge,
            shortDesc,
            img
          );
        }
      });

      // After rendering Manage table → wire checkbox listeners
      if (status === 'Manage' && PAGINATION_CONFIG.viewMode[status] === 'table') {
        const body = document.querySelector('#announcementTable tbody');
        const checks = body?.querySelectorAll('.ann-row-check') || [];
        checks.forEach((chk) => {
          chk.addEventListener('change', () => {
            const id = Number(chk.dataset.id);
            if (chk.checked) selectedAnnIds.add(id);
            else selectedAnnIds.delete(id);
            syncSelectAllCheckbox();
            showBulkBarIfNeeded();
          });
        });
      }
    }

    function getTableBodyForStatus(status) {
      switch (status) {
        case 'all':
          return document.getElementById('activeAnnouncementTableBody');
        case 'Pending':
          return document.getElementById('pendingAnnouncementTableBody');
        case 'Rejected':
          return document.getElementById('rejectedAnnouncementTableBody');
        case 'Archived':
          return document.getElementById('archivedAnnouncementTableBody');
        case 'Manage':
          return document.querySelector('#announcementTable tbody');
        default:
          return null;
      }
    }

    function getCardsContainerForStatus(status) {
      switch (status) {
        case 'all':
          return (
            document.getElementById('activeAnnouncementCardsView') ||
            document.getElementById('announcementContainer')
          );
        case 'Pending':
          return (
            document.getElementById('pendingAnnouncementCardsView') ||
            document.getElementById('pendingAnnouncementContainer')
          );
        case 'Rejected':
          return (
            document.getElementById('rejectedAnnouncementCardsView') ||
            document.getElementById('rejectedAnnouncementContainer')
          );
        case 'Archived':
          return (
            document.getElementById('archivedAnnouncementCardsView') ||
            document.getElementById('archivedAnnouncementContainer')
          );
        case 'Manage':
          return (
            document.getElementById('manageAnnouncementCardsView') ||
            document.getElementById('manageAnnouncementContainer')
          );
        default:
          return null;
      }
    }

    function renderTableView(
      a,
      status,
      isSuperAdminFlag,
      isReadOnlyFlag,
      audBadge,
      shortDesc
    ) {
      const tableBody = getTableBodyForStatus(status);
      if (!tableBody) return;

      const truncatedTitle = truncateText(a.title || '', 40);

      // ===== MANAGE TAB TABLE ROWS =====
      if (status === 'Manage') {
        ensureManageTableHeadHasSelectAll();

        let actionsHtml;
        if (isReadOnlyFlag) {
          // read-only → only View, styled like your snippet
          actionsHtml = `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary viewBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="View">
                <i class="bi bi-eye"></i>
              </button>
            </div>
          `;
        } else {
          // editable Manage row → View / Edit / Archive, styled like snippet
          actionsHtml = `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary viewBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="View">
                <i class="bi bi-eye"></i>
              </button>
              <button class="btn btn-outline-primary editBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="Edit">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-outline-secondary archiveBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="Archive">
                <i class="bi bi-archive"></i>
              </button>
            </div>
          `;
        }

        const tr = document.createElement('tr');
        tr.dataset.id = a.id;
        tr.innerHTML = `
          <td class="text-center" style="width:36px;">
            <input type="checkbox"
                  class="form-check-input ann-row-check"
                  data-id="${window.escapeHtml(a.id)}"
                  ${isReadOnlyFlag ? 'disabled' : ''}>
          </td>
          <td style="width:60px;">${window.escapeHtml(a.id)}</td>
          <td style="max-width:150px;">
            <span class="d-block text-truncate" style="max-width:150px;" title="${window.escapeHtml(a.title)}">
              ${window.escapeHtml(truncatedTitle)}
            </span>
          </td>
          <td style="max-width:200px;">
            <span class="d-block text-truncate" style="max-width:200px;" title="${window.escapeHtml(a.description || '')}">
              ${window.escapeHtml(shortDesc)}
            </span>
          </td>
          <td style="width:100px;">
            <span class="badge ${statusBadgeClass(a.status)}">
              ${window.escapeHtml(a.status)}
            </span>
          </td>
          <td style="width:100px;">
            ${audBadge}
          </td>
          <td style="max-width:120px;">
            <div class="d-flex align-items-center justify-content-between gap-2">
              <span class="d-block text-truncate" style="max-width:120px;" title="${window.escapeHtml(a.author_name || '—')}">${window.escapeHtml(a.author_name || '—')}</span>
            </div>
          </td>
          <td class="text-end" style="min-width: 120px;">
            ${actionsHtml}
          </td>
        `;
        tableBody.appendChild(tr);
        return;
      }

      // ===== OTHER TABS TABLE ROWS =====
      const showPendingDotRow =
        status === 'Pending' && a.status === 'Pending';

      let buttonsHtml = `
        <button class="btn btn-outline-secondary viewBtn"
                data-id="${window.escapeHtml(a.id)}"
                title="View">
          <i class="bi bi-eye"></i>
        </button>
      `;

      if (!isReadOnlyFlag) {
        if (a.status === 'Pending' && isSuperAdminFlag) {
          buttonsHtml += `
            <button class="btn btn-success acceptBtn"
                    data-id="${window.escapeHtml(a.id)}"
                    title="Accept">
              <i class="bi bi-check-circle"></i>
            </button>
            <button class="btn btn-danger declineBtn"
                    data-id="${window.escapeHtml(a.id)}"
                    title="Reject">
              <i class="bi bi-x-circle"></i>
            </button>
          `;
        } else if (a.status === 'Active') {
          buttonsHtml += `
            <button class="btn btn-outline-secondary archiveBtn"
                    data-id="${window.escapeHtml(
                      a.id
                    )}" title="Archive"><i class="bi bi-archive"></i></button>
          `;
        } else if (a.status === 'Archived') {
          buttonsHtml += `
            <button class="btn btn-success restoreBtn"
                    data-id="${window.escapeHtml(
                      a.id
                    )}" title="Restore"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>
          `;
        }
      }

      const tr = document.createElement('tr');
      tr.dataset.id = a.id;
      tr.innerHTML = `
        <td style="width:60px;">${window.escapeHtml(a.id)}</td>
        <td style="max-width:150px;">
          <div class="d-flex align-items-center gap-2">
            ${
              showPendingDotRow
                ? '<span class="rounded-circle flex-shrink-0" style="width:8px;height:8px;background-color:#dc3545;"></span>'
                : ''
            }
            <span class="d-block text-truncate" style="max-width:150px;" title="${window.escapeHtml(a.title)}">
              ${window.escapeHtml(truncatedTitle)}
            </span>
          </div>
        </td>
        <td style="max-width:200px;">
          <span class="d-block text-truncate" style="max-width:200px;" title="${window.escapeHtml(a.description || '')}">
            ${window.escapeHtml(shortDesc)}
          </span>
        </td>
        <td style="width:100px;">
          <span class="badge ${statusBadgeClass(a.status)}">
            ${window.escapeHtml(a.status)}
          </span>
        </td>
        <td style="width:100px;">
          ${audBadge}
        </td>
        <td style="max-width:120px;">
          <div class="d-flex align-items-center justify-content-between gap-2">
            <span class="d-block text-truncate" style="max-width:120px;" title="${window.escapeHtml(a.author_name || '—')}">${window.escapeHtml(a.author_name || '—')}</span>
          </div>
        </td>
        <td class="text-end" style="min-width: 120px;">
          <div class="btn-group btn-group-sm">
            ${buttonsHtml}
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    }

    function renderCardsView(
      a,
      status,
      isSuperAdminFlag,
      isReadOnlyFlag,
      audBadge,
      shortDesc,
      img
    ) {
      const cardsContainer = getCardsContainerForStatus(status);
      if (!cardsContainer) return;

      const cardWrap = document.createElement('div');
      cardWrap.className = 'col-md-6 col-lg-4 mb-3';

      const cardStyle = `cursor:pointer;`;

      let actionHtml = '';

      // ✅ SPECIAL HANDLING FOR MANAGE TAB CARDS
      if (status === 'Manage') {
        if (isReadOnlyFlag) {
          // Read-only → only View
          actionHtml = `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary viewBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="View">
                <i class="bi bi-eye"></i>
              </button>
            </div>
          `;
        } else {
          // Editable Manage card → View + Edit + Archive
          actionHtml = `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary viewBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="View">
                <i class="bi bi-eye"></i>
              </button>
              <button class="btn btn-outline-primary editBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="Edit">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-outline-secondary archiveBtn"
                      data-id="${window.escapeHtml(a.id)}"
                      title="Archive">
                <i class="bi bi-archive"></i>
              </button>
            </div>
          `;
        }
      } else {
        // 🔁 OTHER TABS: keep your existing logic
        if (!isReadOnlyFlag) {
          if (a.status === 'Pending' && isSuperAdminFlag) {
            actionHtml = `
              <div class="btn-group btn-group-sm">
                <button class="btn btn-success acceptBtn" data-id="${window.escapeHtml(
                  a.id
                )}" title="Accept">
                  <i class="bi bi-check-circle"></i>
                </button>
                <button class="btn btn-danger declineBtn" data-id="${window.escapeHtml(
                  a.id
                )}" title="Reject">
                  <i class="bi bi-x-circle"></i>
                </button>
              </div>
            `;
          } else if (a.status === 'Active') {
            actionHtml = `
              <button class="btn btn-sm btn-outline-secondary archiveBtn"
                      data-id="${window.escapeHtml(
                        a.id
                      )}" title="Archive"><i class="bi bi-archive"></i></button>
            `;
          } else if (a.status === 'Archived') {
            actionHtml = `
              <button class="btn btn-sm btn-outline-primary restoreBtn"
                      data-id="${window.escapeHtml(
                        a.id
                      )}" title="Restore"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>
            `;
          }
        }
      }

      const showPendingDot = status === 'Pending' && a.status === 'Pending';

      const truncatedTitle = truncateText(a.title || '', 30);

      cardWrap.innerHTML = `
        <div class="card shadow-sm h-100 border-0 ann-card"
            data-id="${window.escapeHtml(a.id)}"
            style="${cardStyle}">
          <div class="card-body d-flex flex-column gap-2">
            <div class="d-flex justify-content-between align-items-start">
              <div class="d-flex align-items-center gap-2">
                ${
                  showPendingDot
                    ? '<span class="rounded-circle flex-shrink-0" style="width:8px;height:8px;background-color:#dc3545;"></span>'
                    : ''
                }
                <span class="badge ${statusBadgeClass(
                  a.status
                )} text-uppercase">${window.escapeHtml(a.status)}</span>
              </div>
              <span>${audBadge}</span>
            </div>
            <div class="d-flex gap-2 align-items-center">
              <img src="${window.escapeHtml(
                img
              )}" class="rounded" style="width:46px;height:46px;object-fit:cover;">
              <div class="flex-grow-1">
                <h6 class="mb-0 text-truncate" title="${window.escapeHtml(
                  a.title
                )}" style="max-width: 200px;">${window.escapeHtml(truncatedTitle)}</h6>
                <small class="text-muted">${window.escapeHtml(
                  a.category || 'Announcement'
                )}</small>
              </div>
            </div>
            <p class="mb-0 small text-muted" style="min-height: 40px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${window.escapeHtml(shortDesc)}</p>
            <div class="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
              <small class="text-muted">
                <i class="bi bi-person-circle me-1"></i>${window.escapeHtml(
                  a.author_name || '—'
                )}
              </small>
              ${actionHtml}
            </div>
          </div>
        </div>
      `;
      cardsContainer.appendChild(cardWrap);
    }

    // ---------- LIST FETCH + RENDER ----------
    async function loadAnnouncements(status = 'all', q = '') {
      // Map our internal status keys to API filter:
      // - "Manage" → all statuses
      // - "all" (Active tab) → only Active announcements
      let apiStatus = status;
      if (status === 'Manage') apiStatus = 'all';
      if (status === 'all') apiStatus = 'Active';

      const params = new URLSearchParams();
      params.set('status', apiStatus);
      params.set('q', q);

      // Year filter:
      if (activeYearState.startYear)
        params.set('start_year', String(activeYearState.startYear));
      if (activeYearState.endYear)
        params.set('end_year', String(activeYearState.endYear));
      if (activeYearState.activeYear)
        params.set('active_year', String(activeYearState.activeYear));

      params.set('t', Date.now().toString());

      try {
        const data = await window.fetchJSON(
          `${apiBase}get-announcements.php?${params.toString()}`
        );

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.announcements)
          ? data.announcements
          : [];

        // Snapshot comparison to avoid unnecessary re-renders
        if (!hasDataChanged(status, { list, total: list.length, timestamp: Date.now() })) {
          return;
        }

        PAGINATION_CONFIG.totalItems[status] = list.length;
        const paginatedList = getPaginatedItems(list, status);
        const readOnlyNow = isReadOnlyView();
        renderAnnouncements(
          paginatedList,
          status,
          isSuperAdmin,
          myCourse,
          readOnlyNow
        );
        renderPagination(
          status,
          list.length,
          PAGINATION_CONFIG.currentPage[status]
        );
      } catch (e) {
        console.error('[ann] loadAnnouncements error:', e);
        if (status === 'Manage' && manageTableBody) {
          manageTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to load announcements.</td></tr>`;
        }
      }
    }

    // ---------- ACTIVE YEAR FETCH ----------
    async function loadActiveYear() {
      try {
        // 1) Get the CURRENT ACTIVE academic year
        let activeData = null;
        try {
          activeData = await window.fetchJSON(
            `${apiBase}get-active-academic-year.php?t=${Date.now()}`
          );
        } catch (e) {
          console.error('[ann] get-active-academic-year error:', e);
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

          if (schoolYearEl) schoolYearEl.textContent = activeData.school_year;
        } else {
          if (schoolYearEl) {
            schoolYearEl.textContent =
              activeData?.warning || 'No active academic year';
          }
        }

        // 2) Fetch ALL academic years
        let listData = null;
        try {
          listData = await window.fetchJSON(
            `${apiBase}get-academic-years.php?t=${Date.now()}`
          );
        } catch (e) {
          console.error('[ann] get-academic-years error:', e);
        }

        // Populate School Year dropdown (REMOVED "All School Years" option)
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

        // 3) Populate Active Year dropdown (REMOVED "All Semesters" option)
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

        updateReadOnlyBadge();
        updateAddButtonState();
      } catch (err) {
        console.error('[ann] loadActiveYear error:', err);
        if (schoolYearEl)
          schoolYearEl.textContent = 'Error loading school year';
        if (aySelect) aySelect.innerHTML = '<option value="">—</option>';
        if (activeYearSelect)
          activeYearSelect.innerHTML = '<option value="">—</option>';
        updateReadOnlyBadge();
        updateAddButtonState();
      }
    }

    // ---------- SEARCH wiring ----------
    searchAll?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage['all'] = 1;
        loadAnnouncements('all', e.target.value);
      }, 120)
    );
    searchPending?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage['Pending'] = 1;
        loadAnnouncements('Pending', e.target.value);
      }, 120)
    );
    searchRejected?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage['Rejected'] = 1;
        loadAnnouncements('Rejected', e.target.value);
      }, 120)
    );
    searchArchived?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage['Archived'] = 1;
        loadAnnouncements('Archived', e.target.value);
      }, 120)
    );
    searchManage?.addEventListener(
      'input',
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage['Manage'] = 1;
        loadAnnouncements('Manage', e.target.value);
      }, 120)
    );

    // ---------- AUDIENCE widgets (Add) ----------
    const addAudGeneral = document.getElementById('audGeneral');
    const addAudCourse = document.getElementById('audCourse');
    const addAudienceRow = document.getElementById('audienceCourseRow');
    const addAudiencePicker = document.getElementById('audienceCoursePicker');

    const openAddBtn = document.getElementById('openAddAnnouncementBtn');
    openAddBtn?.addEventListener('click', () => {
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only add announcements in the current active academic year.'
        );
        return;
      }

      if (addAudGeneral) addAudGeneral.checked = true;
      if (addAudienceRow) addAudienceRow.classList.add('d-none');
      const img = document.getElementById('announcementImage');
      const prev = document.getElementById('announcementImagePreview');
      if (img) img.value = '';
      if (prev) prev.setAttribute('src', 'assets/images/image-add.png');
    });

    setupAudienceRadios(
      addAudGeneral,
      addAudCourse,
      addAudienceRow,
      addAudiencePicker,
      isSuperAdmin,
      myCourse
    );

    // ---------- ADD announcement ----------
    addForm?.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (isReadOnlyView()) {
        showErrorModal(
          'You can only add announcements in the current active academic year.'
        );
        return;
      }

      const fd = new FormData(addForm);

      if (!fd.get('start_year') && activeYearState.startYear) {
        fd.append('start_year', String(activeYearState.startYear));
      }
      if (!fd.get('end_year') && activeYearState.endYear) {
        fd.append('end_year', String(activeYearState.endYear));
      }
      if (
        !fd.get('active_year') &&
        (activeYearState.activeYear || activeYearState.startYear)
      ) {
        fd.append(
          'active_year',
          String(activeYearState.activeYear || activeYearState.startYear)
        );
      }

      const scopeFieldPresent =
        addForm.querySelector('[name="audience_scope"]');
      if (scopeFieldPresent) {
        const scope = (fd.get('audience_scope') || 'general').toString();
        if (scope === 'course') {
          let abbr = (fd.get('course_abbr') || '').toString().trim();
          if (!abbr) {
            const maybe =
              addAudienceRow?.querySelector('[name="course_abbr"]');
            if (maybe) abbr = maybe.value || '';
          }
          if (!abbr)
            return showErrorModal(
              'Please choose a course/department for the audience.'
            );
          if (!isSuperAdmin) fd.set('course_abbr', myCourse);
        } else {
          fd.delete('course_abbr');
        }
      }

      try {
        const res = await window.fetchJSON(
          `${apiBase}add-announcement.php`,
          {
            method: 'POST',
            body: fd,
          }
        );
        if (res && res.success === false)
          throw new Error(res.message || 'Failed');
        showSuccessModal('Announcement created ✅');
        addForm.reset();

        const prev = document.getElementById('announcementImagePreview');
        if (prev) prev.src = 'assets/images/image-add.png';

        const addModalEl = document.getElementById('addAnnouncementModal');
        if (addModalEl && window.bootstrap?.Modal) {
          const m =
            bootstrap.Modal.getInstance(addModalEl) ||
            bootstrap.Modal.getOrCreateInstance(addModalEl);
          m.hide();
        }

        loadAnnouncements('all');
        loadAnnouncements('Pending');
        loadAnnouncements('Manage');
      } catch (err) {
        console.error('[ann] add failed', err);
        showErrorModal(err.message || 'Failed to create announcement.');
      }
    });

    // ---------- VIEW details ----------
    async function openAnnouncementView(id) {
      const bodyEl = viewModalBody;
      const modalEl = viewModalEl;

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
          const docsHtml =
            Array.isArray(a.documents) && a.documents.length
              ? a.documents
                  .map(
                    (d) => `
              <li class="list-group-item py-1">
                <a href="${window.escapeHtml(d.path)}" target="_blank">
                  <i class="bi bi-paperclip me-1"></i>${window.escapeHtml(
                    d.name || d.path
                  )}
                </a>
              </li>
            `
                  )
                  .join('')
              : '<li class="list-group-item py-1 text-muted">No attachments</li>';

          const statusBadge =
            a.status === 'Active'
              ? 'bg-success'
            : a.status === 'Pending'
            ? 'bg-warning text-dark'
            : a.status === 'Rejected'
            ? 'bg-danger'
            : a.status === 'Archived'
            ? 'bg-secondary'
            : 'bg-secondary';

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
                    <span class="badge ${statusBadge}">${window.escapeHtml(
              a.status || '—'
            )}</span>
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
                    <i class="bi bi-book-half me-1"></i><strong>Active Semester:</strong> ${window.escapeHtml(
                      activeYearText
                    )}
                  </p>
                </div>
              </div>

              <div class="mb-3">
                <h6 class="mb-2">Description</h6>
                <div class="border rounded p-2 bg-light small" style="white-space:pre-wrap;">${window.escapeHtml(
                  a.description || 'No description'
                )}</div>
              </div>

              <div>
                <h6 class="mb-2">Attachments</h6>
                <ul class="list-group list-group-flush">
                  ${docsHtml}
                </ul>
              </div>

              ${
                a.edit_allowed === false
                  ? `<div class="alert alert-warning mt-3 mb-0 py-2 small">
                      <i class="bi bi-lock-fill me-1"></i>
                      You can view this announcement but you are not allowed to edit it.
                    </div>`
                  : ''
              }
            `;
          }
        }

        if (modalEl) {
          const m = new bootstrap.Modal(modalEl);
          m.show();
        }
      } catch (err) {
        console.error('[ann] open view error', err);
        if (viewModalBody) {
          viewModalBody.innerHTML = `<div class="alert alert-danger mb-0">Failed to load announcement details.</div>`;
        }
        if (viewModalEl) {
          const m = new bootstrap.Modal(viewModalEl);
          m.show();
        }
      }
    }

    // ---------- EDIT open & save (global doc bind once) ----------
    if (!globalDocHandlersBound) {
      document.addEventListener('click', async (e) => {
        const apiBaseLocal = 'php/';
        const theEditModalEl = document.getElementById('editAnnouncementModal');
        const editFormLocal = document.getElementById('editAnnouncementForm');

        const openBtn = e.target.closest('.editBtn');
        if (openBtn) {
          if (isReadOnlyView()) {
            showErrorModal(
              'You can only edit announcements in the current active academic year.'
            );
            return;
          }

          const id = openBtn.dataset.id;
          if (!id || !theEditModalEl || !editFormLocal) return;

          try {
            const data = await window.fetchJSON(
              `${apiBaseLocal}get-announcement.php?id=${encodeURIComponent(
                id
              )}&t=${Date.now()}`
            );
            if (!data || data.success === false)
              return showErrorModal(
                data?.message || 'Failed to load announcement.'
              );
            const a = data.announcement || data;

            const idField = editFormLocal.querySelector('[name="id"]');
            const titleField = editFormLocal.querySelector('[name="title"]');
            const descField =
              editFormLocal.querySelector('[name="description"]');
            const catField = editFormLocal.querySelector('[name="category"]');
            const statusField = editFormLocal.querySelector('[name="status"]');

            if (idField) idField.value = a.id || '';
            if (titleField) titleField.value = a.title || '';
            if (descField) descField.value = a.description || '';
            if (catField) catField.value = a.category || '';
            if (statusField) statusField.value = a.status || '';

            const preview =
              editFormLocal.querySelector('#editAnnouncementPreview');
            if (preview)
              preview.src = a.image_path || 'assets/images/image-add.png';

            const editAudGeneral = document.getElementById('editAudGeneral');
            const editAudCourse = document.getElementById('editAudCourse');
            const editAudienceRow = document.getElementById(
              'editAudienceCourseRow'
            );
            const editAudiencePicker = document.getElementById(
              'editAudienceCoursePicker'
            );

            if (editAudGeneral || editAudCourse) {
              const scope = (a.audience_scope || 'general').toLowerCase();
              const course = (a.course_abbr || '').toUpperCase();
              if (editAudGeneral) editAudGeneral.checked = scope !== 'course';
              if (editAudCourse) editAudCourse.checked = scope === 'course';

              setupAudienceRadios(
                editAudGeneral,
                editAudCourse,
                editAudienceRow,
                editAudiencePicker,
                isSuperAdmin,
                myCourse,
                course
              );
            }

            const editModalLocal =
              bootstrap.Modal.getInstance(theEditModalEl) ||
              new bootstrap.Modal(theEditModalEl);
            editModalLocal.show();
          } catch (err) {
            console.error('[ann] open edit error', err);
            showErrorModal('Failed to load announcement for editing.');
          }
        }
      });

      globalDocHandlersBound = true;
    }

    editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only edit announcements in the current active academic year.'
        );
        return;
      }

      const fd = new FormData(editForm);

      if (!fd.get('start_year') && activeYearState.startYear) {
        fd.append('start_year', String(activeYearState.startYear));
      }
      if (!fd.get('end_year') && activeYearState.endYear) {
        fd.append('end_year', String(activeYearState.endYear));
      }
      if (
        !fd.get('active_year') &&
        (activeYearState.activeYear || activeYearState.startYear)
      ) {
        fd.append(
          'active_year',
          String(activeYearState.activeYear || activeYearState.startYear)
        );
      }

      const scopeFieldPresent = editForm.querySelector('[name="audience_scope"]');
      if (scopeFieldPresent) {
        const scope = (fd.get('audience_scope') || 'general').toString();
        if (scope === 'course') {
          let abbr = (fd.get('course_abbr') || '').toString().trim();
          if (!abbr) {
            const maybe = document
              .getElementById('editAudienceCourseRow')
              ?.querySelector('[name="course_abbr"]');
            if (maybe) abbr = maybe.value || '';
          }
          if (!abbr)
            return showErrorModal(
              'Please choose a course/department for the audience.'
            );
          if (!isSuperAdmin) fd.set('course_abbr', myCourse);
        } else {
          fd.delete('course_abbr');
        }
      }

      try {
        const res = await window.fetchJSON(
          `${apiBase}update-announcement.php`,
          {
            method: 'POST',
            body: fd,
          }
        );
        if (res && res.success === false)
          throw new Error(res.message || 'Update failed');
        showSuccessModal('Announcement updated ✅');

        const editModalEl2 = document.getElementById('editAnnouncementModal');
        if (editModalEl2 && window.bootstrap?.Modal) {
          const m2 =
            bootstrap.Modal.getInstance(editModalEl2) ||
            bootstrap.Modal.getOrCreateInstance(editModalEl2);
          m2.hide();
        }

        loadAnnouncements('Manage');
        loadAnnouncements('all');
        loadAnnouncements('Archived');
      } catch (err) {
        console.error('[ann] update error', err);
        showErrorModal(err.message || 'Failed to update announcement.');
      }
    });

    // ---------- STATUS UPDATE (includes archive/restore) ----------
    async function updateStatus(id, status, reason = '') {
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only update announcement status in the current active academic year.'
        );
        throw new Error('Read-only view');
      }

      try {
        const form = new FormData();
        form.append('id', id);
        form.append('status', status);
        if (reason) form.append('reason', reason);

        if (activeYearState.startYear)
          form.append('start_year', String(activeYearState.startYear));
        if (activeYearState.endYear)
          form.append('end_year', String(activeYearState.endYear));
        if (activeYearState.activeYear || activeYearState.startYear) {
          form.append(
            'active_year',
            String(activeYearState.activeYear || activeYearState.startYear)
          );
        }

        const res = await window.fetchJSON(
          `${apiBase}update-announcement-status.php`,
          {
            method: 'POST',
            body: form,
          }
        );
        if (res && res.success === false)
          throw new Error(res.message || 'Status update failed');

        let msg;
        if (status === 'Archived') {
          msg = 'Announcement archived 🗃️';
        } else if (status === 'Pending') {
          msg = 'Announcement restored to Pending ✅';
        } else {
          msg = `Announcement ${status} ✅`;
        }

        showSuccessModal(msg);

        loadAnnouncements('all');
        loadAnnouncements('Pending');
        loadAnnouncements('Rejected');
        loadAnnouncements('Archived');
        loadAnnouncements('Manage');
      } catch (err) {
        if (err.message !== 'Read-only view') {
          console.error('[ann] status update error', err);
          showErrorModal(err.message || 'Failed to update status.');
        }
      }
    }

    async function bulkArchive(ids) {
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only archive announcements in the current active academic year.'
        );
        return;
      }

      for (const id of ids) {
        try {
          await updateStatus(id, 'Archived');
        } catch (e) {
          console.warn(
            '[ann] bulk archive item failed:',
            id,
            e.message
          );
        }
      }
    }

    // ---------- CLICK HANDLERS (inside section) ----------
    section.addEventListener('click', async (e) => {
      const card = e.target.closest('.ann-card');
      if (card && !e.target.closest('.btn')) {
        const id = card.dataset.id;
        if (id) {
          openAnnouncementView(id);
          return;
        }
      }

      const viewBtn = e.target.closest('.viewBtn');
      if (viewBtn) {
        openAnnouncementView(viewBtn.dataset.id);
        return;
      }

      const acceptBtn = e.target.closest('.acceptBtn');
      if (acceptBtn) {
        if (isReadOnlyView()) {
          showErrorModal(
            'You can only accept announcements in the current active academic year.'
          );
          return;
        }
        if (!isSuperAdmin) {
          showErrorModal('Only the super-admin can accept announcements.');
          return;
        }
        const id = acceptBtn.dataset.id;

        const ok = await showConfirmDialog('Accept this announcement?', {
          title: 'Accept Announcement',
          confirmText: 'Accept',
          cancelText: 'Cancel',
          variant: 'success',
        });
        if (!ok) return;

        await updateStatus(id, 'Active');
        return;
      }

      const declineBtn = e.target.closest('.declineBtn');
      if (declineBtn) {
        if (isReadOnlyView()) {
          showErrorModal(
            'You can only reject announcements in the current active academic year.'
          );
          return;
        }
        if (!isSuperAdmin) {
          showErrorModal('Only the super-admin can reject announcements.');
          return;
        }
        const id = declineBtn.dataset.id;
        const input = document.querySelector('#declineAnnId');
        if (input) input.value = id;
        declineModal?.show();
        return;
      }

      const archiveBtn = e.target.closest('.archiveBtn');
      if (archiveBtn) {
        if (isReadOnlyView()) {
          showErrorModal(
            'You can only archive announcements in the current active academic year.'
          );
          return;
        }
        const id = archiveBtn.dataset.id;

        const ok = await showConfirmDialog(
          'Archive this announcement? It will be marked as Archived but not deleted.',
          {
            title: 'Archive Announcement',
            confirmText: 'Archive',
            cancelText: 'Cancel',
            variant: 'secondary',
          }
        );
        if (!ok) return;

        await updateStatus(id, 'Archived');
        return;
      }

      const restoreBtn = e.target.closest('.restoreBtn');
      if (restoreBtn) {
        if (isReadOnlyView()) {
          showErrorModal(
            'You can only restore announcements in the current active academic year.'
          );
          return;
        }
        const id = restoreBtn.dataset.id;

        const ok = await showConfirmDialog(
          'Restore this announcement back to Pending?',
          {
            title: 'Restore Announcement',
            confirmText: 'Restore',
            cancelText: 'Cancel',
            variant: 'primary',
          }
        );
        if (!ok) return;

        await updateStatus(id, 'Pending');
        return;
      }
    });

    // bulk bar archive clicked
    bulkDeleteBtn?.addEventListener('click', async () => {
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only use bulk actions in the current active academic year.'
        );
        return;
      }
      if (selectedAnnIds.size === 0) return;

      const ok = await showConfirmDialog(
        `Archive ${selectedAnnIds.size} announcement(s)? They will be marked as Archived.`,
        {
          title: 'Bulk Archive Announcements',
          confirmText: 'Archive',
          cancelText: 'Cancel',
          variant: 'secondary',
        }
      );
      if (!ok) return;

      await bulkArchive([...selectedAnnIds]);
      selectedAnnIds.clear();
      showBulkBarIfNeeded();
      loadAnnouncements('Manage');
    });

    const confirmDeclineBtn = document.getElementById('confirmDeclineBtn');
    confirmDeclineBtn?.addEventListener('click', async () => {
      if (isReadOnlyView()) {
        showErrorModal(
          'You can only reject announcements in the current active academic year.'
        );
        return;
      }
      if (!isSuperAdmin) {
        showErrorModal('Only the super-admin can reject announcements.');
        return;
      }
      const id = document.getElementById('declineAnnId')?.value;
      const reason =
        declineForm?.querySelector('[name="reason"]')?.value?.trim() || '';
      if (!reason)
        return showErrorModal('Please provide a reason for decline.');
      await updateStatus(id, 'Rejected', reason);
      declineForm?.reset();
      declineModal?.hide();
    });

    // ---------- AY change listeners ----------
    aySelect?.addEventListener('change', () => {
      const val = aySelect.value || '';
      const [syRaw, eyRaw] = val.split('-');
      const sy = parseInt(syRaw, 10);
      const ey = parseInt(eyRaw, 10);

      activeYearState.startYear = !Number.isNaN(sy) ? sy : null;
      activeYearState.endYear   = !Number.isNaN(ey) ? ey : null;

      // Reset active year to start year when SY changes
      activeYearState.activeYear = sy;

      if (activeYearSelect) {
        let html = '';

        if (sy && ey) {
          const firstSemText = getSemesterDisplay(sy, sy, ey);
          const secondSemText = getSemesterDisplay(ey, sy, ey);
          
          // Select first semester by default
          html += `<option value="${sy}" selected>${firstSemText}</option>`;
          html += `<option value="${ey}">${secondSemText}</option>`;
          
          activeYearSelect.disabled = false;
        } else {
          html = '<option value="">—</option>';
          activeYearSelect.disabled = true;
        }
        
        activeYearSelect.innerHTML = html;
      }

      updateReadOnlyBadge();
      updateAddButtonState();
      loadAnnouncements('all');
      loadAnnouncements('Pending');
      loadAnnouncements('Rejected');
      loadAnnouncements('Archived');
      loadAnnouncements('Manage');
    });

    activeYearSelect?.addEventListener('change', () => {
      if (activeYearSelect.disabled) return;
      const val = activeYearSelect.value;
      const yr = parseInt(val, 10);
      if (!Number.isNaN(yr)) {
        activeYearState.activeYear = yr;
      }

      updateReadOnlyBadge();
      updateAddButtonState();
      loadAnnouncements('all');
      loadAnnouncements('Pending');
      loadAnnouncements('Rejected');
      loadAnnouncements('Archived');
      loadAnnouncements('Manage');
    });

    // ---------- polling / initial load ----------
    fetchFns.all = () => loadAnnouncements('all');
    fetchFns.Pending = () => loadAnnouncements('Pending');
    fetchFns.Rejected = () => loadAnnouncements('Rejected');
    fetchFns.Archived = () => loadAnnouncements('Archived');
    fetchFns.Manage = () => loadAnnouncements('Manage');

    loadActiveYear().then(() => {
      loadAnnouncements('all');
      loadAnnouncements('Pending');
      loadAnnouncements('Rejected');
      loadAnnouncements('Archived');
      loadAnnouncements('Manage');
    });

    // Start polling for each tab
    ['all', 'Pending', 'Rejected', 'Archived', 'Manage'].forEach((status) => {
      startPolling(status);
      
      // Also check for updates using timestamp method
      if (POLLING_CONFIG.enabled) {
        setInterval(() => checkForPendingUpdates(status), 2000);
      }
    });

    // cleanup modal backdrops
    [editModalEl?.id, declineModalEl?.id, 'addAnnouncementModal'].forEach(
      (id) => {
        if (!id) return;
        const el = document.getElementById(id);
        el?.addEventListener('hidden.bs.modal', () => {
          document.querySelectorAll('.modal-backdrop').forEach((b) => {
            b.classList.remove('show');
            b.classList.add('fade');
            setTimeout(() => b.remove(), 200);
          });
          document.body.classList.remove('modal-open');
          document.body.style.overflow = '';
        });
      }
    );
  }
})();//super-admin