// manage-courses.js
// Updated version with tabs, archive functionality, and card design like manage-announcement.js
(function () {
  // ===== Isolated scope for courses =====
  const COURSE_CONFIG = {
    isInitialized: false,
    refreshTimer: null,
    
    // Pagination settings
    pagination: {
      itemsPerPage: 6, // For cards view
      tableItemsPerPage: 10, // For table view
      currentPage: {
        active: 1,
        archived: 1
      },
      totalItems: {
        active: 0,
        archived: 0
      },
      viewMode: {
        active: 'cards',
        archived: 'cards'
      }
    }
  };

  // ===== Global helpers (reuse from manage-announcement.js if available) =====
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

  // ===== Course-specific status modals =====
  function showCourseSuccessModal(msg) {
    const el = document.getElementById('successDialogue');
    const modalEl = document.getElementById('statusSuccessModal');
    if (!el || !modalEl) {
      console.log('SUCCESS:', msg);
      return;
    }
    el.textContent = msg;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }

  function showCourseErrorModal(msg) {
    const el = document.getElementById('errorDialogue');
    const modalEl = document.getElementById('statusErrorsModal');
    if (!el || !modalEl) {
      console.error('ERROR:', msg);
      return;
    }
    el.textContent = msg;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }

  // Course status mapping - map 'Unlisted' to 'Archived'
  function mapCourseStatus(status) {
    return (status === 'Unlisted' || status === 'Archived') ? 'Archived' : status;
  }

  // Helper function to truncate text with ellipsis
  function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // Role detection
  function getUserRole() {
    const lsRole = (localStorage.getItem('currentUserRole') || '').toString();
    const bodyRole = (document.body?.dataset?.role || '').toString();
    const g1 = (window.currentUserRole || '').toString();
    const g2 = (window.USER_ROLE || '').toString();
    const raw = (lsRole || bodyRole || g1 || g2 || '').toLowerCase();
    return raw.replace(/[\s_]+/g, '-');
  }

  function detectIsSuperAdmin() {
    return getUserRole() === 'super-admin';
  }

  // ======== PAGINATION FUNCTIONS ========
  function renderPagination(tab, totalItems, currentPage) {
    const containerId = `${tab}CoursePagination`;
    const infoContainerId = `${tab}CoursePaginationInfo`;
    const container = document.getElementById(containerId);
    const infoContainer = document.getElementById(infoContainerId);

    if (!container) {
      if (infoContainer) {
        infoContainer.innerHTML =
          totalItems > 0
            ? `Showing all ${totalItems} course(s)`
            : 'No courses found';
      }
      return;
    }

    const itemsPerPage = COURSE_CONFIG.pagination.viewMode[tab] === 'table' 
      ? COURSE_CONFIG.pagination.tableItemsPerPage 
      : COURSE_CONFIG.pagination.itemsPerPage;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
      container.innerHTML = '';
      if (infoContainer) {
        infoContainer.innerHTML =
          totalItems > 0
            ? `Showing all ${totalItems} course(s)`
            : 'No courses found';
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
      infoContainer.innerHTML = `Showing ${startItem}-${endItem} of ${totalItems} course(s)`;
    }

    // Add click handlers
    container.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(link.dataset.page, 10);
        if (!isNaN(page) && page >= 1 && page <= totalPages) {
          COURSE_CONFIG.pagination.currentPage[tab] = page;
          loadCourses(tab);
        }
      });
    });
  }

  function getPaginatedItems(items, tab) {
    const itemsPerPage = COURSE_CONFIG.pagination.viewMode[tab] === 'table' 
      ? COURSE_CONFIG.pagination.tableItemsPerPage 
      : COURSE_CONFIG.pagination.itemsPerPage;
    const currentPage = COURSE_CONFIG.pagination.currentPage[tab] || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;

    return items.slice(startIndex, endIndex);
  }

  // ======== VIEW TOGGLE FUNCTIONS ========
  function setupViewToggle(tab) {
    const tabId = `#${tab}-courses`;
    const toggleGroup = document.querySelector(`${tabId} .view-toggle-group`);
    if (!toggleGroup) return;

    const tableView = document.getElementById(`${tab}CourseTableView`);
    const cardsView = document.getElementById(`${tab}CourseCardsView`);

    // Initial state
    const defaultView = COURSE_CONFIG.pagination.viewMode[tab] || 'cards';
    
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
        if (COURSE_CONFIG.pagination.viewMode[tab] === viewType) return;

        // Update active state
        toggleGroup
          .querySelectorAll('.view-toggle-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Update view mode
        COURSE_CONFIG.pagination.viewMode[tab] = viewType;
        COURSE_CONFIG.pagination.currentPage[tab] = 1; // Reset to first page

        // Show/hide appropriate containers
        const tblView = document.getElementById(`${tab}CourseTableView`);
        const crdView = document.getElementById(`${tab}CourseCardsView`);

        if (viewType === 'table') {
          if (tblView) tblView.classList.remove('d-none');
          if (crdView) crdView.classList.add('d-none');
        } else {
          if (tblView) tblView.classList.add('d-none');
          if (crdView) crdView.classList.remove('d-none');
        }

        // Show/hide Add Course button for Active tab in table view
        if (tab === 'active') {
            const addCourseBtn = document.getElementById('addCourseBtnTable');
            if (addCourseBtn) {
            if (viewType === 'table') {
                addCourseBtn.classList.remove('d-none');
            } else {
                addCourseBtn.classList.add('d-none');
            }
            }
        }

        // Reload courses with new view mode
        loadCourses(tab);
      });
    });
  }

  // ======== RENDER FUNCTIONS ========
  function renderCourses(list, tab, isSuperAdminFlag) {
    const viewMode = COURSE_CONFIG.pagination.viewMode[tab];
    const isSuperAdmin = isSuperAdminFlag;

    const tableBody = document.getElementById(`${tab}CourseTableBody`);
    const cardsContainer = document.getElementById(`${tab}CourseCardsView`);

    // Clear existing content
    if (tableBody) tableBody.innerHTML = '';
    if (cardsContainer) cardsContainer.innerHTML = '';

    // Show "Add Course" card for super-admin in active tab (cards view only)
    if (tab === 'active' && viewMode === 'cards' && isSuperAdmin && cardsContainer) {
      const addCard = document.createElement('div');
      addCard.className = 'add-course-card';
      addCard.innerHTML = `
        <i class="bi bi-plus-circle add-course-icon"></i>
        <span class="add-course-text">Add Course</span>
      `;
      addCard.addEventListener('click', () => {
        document.getElementById("course-addCourseForm").reset();
        document.getElementById("course-addCourseImage").src = "assets/images/image-placeholder.svg";
        new bootstrap.Modal(document.getElementById("course-addCourseModal")).show();
      });
      cardsContainer.appendChild(addCard);
    }

    // If no items
    if (!list || list.length === 0) {
      const label = tab === 'active' ? 'active' : 'archived';
      
      if (viewMode === 'table' && tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-3">
              No ${label} courses found.
            </td>
          </tr>
        `;
      } else if (cardsContainer) {
        // Don't show empty message if we have the "Add Course" card
        if (!(tab === 'active' && isSuperAdmin && viewMode === 'cards')) {
          const empty = document.createElement('div');
          empty.className = 'col-12';
          empty.innerHTML = `
            <div class="border rounded py-4 text-center text-muted">
              No ${label} courses found.
            </div>
          `;
          cardsContainer.appendChild(empty);
        }
      }
      return;
    }

    // Render items
    list.forEach((course) => {
      // Map 'Unlisted' to 'Archived' for display
      const displayStatus = mapCourseStatus(course.status);
      const img = course.image_path || 'assets/images/image-placeholder.svg';
      const statusBadge = displayStatus === 'Active' ? 'bg-success' : 
                         displayStatus === 'Pending' ? 'bg-warning text-dark' : 
                         'bg-secondary';

      if (viewMode === 'table') {
        renderTableView(course, tab, isSuperAdmin, img, displayStatus, statusBadge);
      } else {
        renderCardsView(course, tab, isSuperAdmin, img, displayStatus, statusBadge);
      }
    });
  }

  function renderTableView(course, tab, isSuperAdmin, img, displayStatus, statusBadge) {
    const tableBody = document.getElementById(`${tab}CourseTableBody`);
    if (!tableBody) return;

    // UPDATED: Truncate name for table view
    const truncatedName = truncateText(course.course_name || '', 30);

    let actionsHtml = '';
    if (tab === 'active') {
      actionsHtml = `
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary viewBtn" data-id="${course.id}" title="View">
            <i class="bi bi-eye"></i>
          </button>
          ${isSuperAdmin ? `
            <button class="btn btn-outline-primary editBtn" data-id="${course.id}" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-warning archiveBtn" data-id="${course.id}" title="Archive">
              <i class="bi bi-archive"></i>
            </button>
          ` : ''}
        </div>
      `;
    } else {
      // Archived tab - show restore button
      actionsHtml = `
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary viewBtn" data-id="${course.id}" title="View">
            <i class="bi bi-eye"></i>
          </button>
          ${isSuperAdmin ? `
            <button class="btn btn-outline-success restoreBtn" data-id="${course.id}" title="Restore">
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
          ` : ''}
        </div>
      `;
    }

    const tr = document.createElement('tr');
    tr.dataset.id = course.id;
    tr.innerHTML = `
      <td>${course.id}</td>
      <td>
        <span class="d-block text-truncate" style="max-width:200px;" title="${window.escapeHtml(course.course_name)}">
          ${window.escapeHtml(truncatedName)}
        </span>
      </td>
      <td>${window.escapeHtml(course.abbreviation || '—')}</td>
      <td>
        <img src="${window.escapeHtml(img)}" class="rounded" style="width:50px;height:50px;object-fit:cover;">
      </td>
      <td>
        <span class="badge ${statusBadge}">${window.escapeHtml(displayStatus)}</span>
      </td>
      <td>${window.escapeHtml(course.created_at || '—')}</td>
      <td class="text-end">${actionsHtml}</td>
    `;
    tableBody.appendChild(tr);
    
    // Add event listeners directly to these buttons
    addTableButtonListeners(tr, course, isSuperAdmin);
  }

  function addTableButtonListeners(row, course, isSuperAdmin) {
    // View button
    const viewBtn = row.querySelector('.viewBtn');
    if (viewBtn) {
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCourseView(course.id);
      });
    }
    
    // Edit button
    const editBtn = row.querySelector('.editBtn');
    if (editBtn && isSuperAdmin) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditCourse(course.id);
      });
    }
    
    // Archive button
    const archiveBtn = row.querySelector('.archiveBtn');
    if (archiveBtn && isSuperAdmin) {
      archiveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        archiveCourse(course.id, course.course_name);
      });
    }
    
    // Restore button
    const restoreBtn = row.querySelector('.restoreBtn');
    if (restoreBtn && isSuperAdmin) {
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreCourse(course.id, course.course_name);
      });
    }
  }

  function renderCardsView(course, tab, isSuperAdmin, img, displayStatus, statusBadge) {
    const cardsContainer = document.getElementById(`${tab}CourseCardsView`);
    if (!cardsContainer) return;

    // UPDATED: Truncate name for cards view (20 characters max)
    const truncatedName = truncateText(course.course_name || '', 20);

    let actionHtml = '';
    if (tab === 'active') {
      actionHtml = isSuperAdmin ? `
        <div class="course-actions">
          <button class="edit" data-id="${course.id}" title="Edit">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="archive" data-id="${course.id}" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
        </div>
      ` : '';
    } else {
      // Archived tab - show restore button
      actionHtml = isSuperAdmin ? `
        <div class="course-actions">
          <button class="restore" data-id="${course.id}" title="Restore">
            <i class="bi bi-arrow-counterclockwise"></i>
          </button>
        </div>
      ` : '';
    }

    const cardWrap = document.createElement('div');
    cardWrap.className = 'course-card';
    cardWrap.dataset.id = course.id;
    
    cardWrap.innerHTML = `
      <img src="${window.escapeHtml(img)}" class="course-image" alt="${window.escapeHtml(course.course_name)}">
      <div class="course-card-body">
        <div>
          <h5 class="course-name" title="${window.escapeHtml(course.course_name)}">
            ${window.escapeHtml(truncatedName)}
          </h5>
          <p class="text-muted mb-1">${window.escapeHtml(course.abbreviation || '')}</p>
          <span class="badge ${statusBadge}">${window.escapeHtml(displayStatus)}</span>
        </div>
        ${actionHtml}
      </div>
    `;
    
    // Add click handler for viewing (except when clicking action buttons)
    cardWrap.addEventListener('click', (e) => {
      if (!e.target.closest('.course-actions')) {
        openCourseView(course.id);
      }
    });
    
    // Add click handlers for action buttons
    if (isSuperAdmin) {
      const editBtn = cardWrap.querySelector('.edit');
      const archiveBtn = cardWrap.querySelector('.archive');
      const restoreBtn = cardWrap.querySelector('.restore');
      
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditCourse(course.id);
        });
      }
      
      if (archiveBtn) {
        archiveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          archiveCourse(course.id, course.course_name);
        });
      }
      
      if (restoreBtn) {
        restoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          restoreCourse(course.id, course.course_name);
        });
      }
    }
    
    cardsContainer.appendChild(cardWrap);
  }

  // ======== LOAD COURSES ========
  async function loadCourses(tab = 'active') {
    try {
      const data = await window.fetchJSON(
        `php/get-courses.php?t=${Date.now()}`
      );
      
      let list = Array.isArray(data) ? data : [];
      
      // Filter courses based on tab
      if (tab === 'active') {
        list = list.filter(course => {
          const status = mapCourseStatus(course.status);
          return status === 'Active' || status === 'Pending';
        });
      } else if (tab === 'archived') {
        list = list.filter(course => {
          const status = mapCourseStatus(course.status);
          return status === 'Archived';
        });
      }
      
      // Always render (no snapshot short-circuit so pagination works)
      COURSE_CONFIG.pagination.totalItems[tab] = list.length;
      const paginatedList = getPaginatedItems(list, tab);
      const isSuperAdmin = detectIsSuperAdmin();
      
      renderCourses(paginatedList, tab, isSuperAdmin);
      renderPagination(tab, list.length, COURSE_CONFIG.pagination.currentPage[tab]);
    } catch (e) {
      console.error('[courses] loadCourses error:', e);
      const tableBody = document.getElementById(`${tab}CourseTableBody`);
      const cardsContainer = document.getElementById(`${tab}CourseCardsView`);
      
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load courses.</td></tr>`;
      }
      if (cardsContainer) {
        cardsContainer.innerHTML = `<div class="col-12"><div class="border rounded py-4 text-center text-danger">Failed to load courses.</div></div>`;
      }
    }
  }

  // ======== COURSE OPERATIONS ========
  async function openCourseView(id) {
    try {
      const data = await window.fetchJSON(
        `php/get-course.php?id=${encodeURIComponent(id)}&t=${Date.now()}`
      );
      
      if (!data || data.success === false) {
        showCourseErrorModal(data?.message || 'Failed to load course.');
        return;
      }
      
      const course = data.course || data;
      const displayStatus = mapCourseStatus(course.status);
      const img = course.image_path || 'assets/images/image-placeholder.svg';
      
      document.getElementById("course-viewCourseTitle").textContent = course.course_name || '—';
      document.getElementById("course-viewCourseAbbreviation").textContent = course.abbreviation || '—';
      document.getElementById("course-viewCourseImage").src = img;
      document.getElementById("course-viewCourseStatus").textContent = displayStatus;
      document.getElementById("course-viewCourseCreatedAt").textContent = course.created_at || '—';
      
      new bootstrap.Modal(document.getElementById("course-viewCourseModal")).show();
    } catch (err) {
      console.error('[courses] open view error', err);
      showCourseErrorModal('Failed to load course details.');
    }
  }
  
  async function openEditCourse(id) {
    try {
      const data = await window.fetchJSON(
        `php/get-course.php?id=${encodeURIComponent(id)}&t=${Date.now()}`
      );
      
      if (!data || data.success === false) {
        showCourseErrorModal(data?.message || 'Failed to load course.');
        return;
      }
      
      const course = data.course || data;
      const displayStatus = mapCourseStatus(course.status);
      const img = course.image_path || 'assets/images/image-placeholder.svg';
      
      document.getElementById("course-editCourseImage").src = img;
      document.getElementById("course-editCourseId").value = course.id;
      document.getElementById("course-editCourseName").value = course.course_name;
      document.getElementById("course-editAbbreviation").value = course.abbreviation;
      document.getElementById("course-editCourseStatus").value = displayStatus;
      
      new bootstrap.Modal(document.getElementById("course-editCourseModal")).show();
    } catch (err) {
      console.error('[courses] open edit error', err);
      showCourseErrorModal('Failed to load course for editing.');
    }
  }
  
  async function archiveCourse(id, name) {
    const confirmModal = new bootstrap.Modal(document.getElementById("course-confirmArchiveModal"));
    const confirmBtn = document.getElementById("course-confirmArchiveBtn");
    const dialogue = document.getElementById("course-archiveConfirmDialogue");
    
    if (!dialogue || !confirmBtn) {
      // Fallback to simple confirm
      if (!confirm(`Archive course "${name}"? It will be marked as Archived.`)) return;
      await updateCourseStatus(id, 'Archived');
      return;
    }
    
    dialogue.textContent = `Archive course "${name}"? It will be marked as Archived.`;
    
    const handleConfirm = async () => {
      try {
        await updateCourseStatus(id, 'Archived');
        confirmModal.hide();
        confirmBtn.removeEventListener('click', handleConfirm);
      } catch (err) {
        console.error('[courses] Archive failed:', err);
      }
    };
    
    confirmBtn.addEventListener('click', handleConfirm, { once: true });
    confirmModal.show();
  }
  
  async function restoreCourse(id, name) {
    const confirmModal = new bootstrap.Modal(document.getElementById("course-confirmRestoreModal"));
    const confirmBtn = document.getElementById("course-confirmRestoreBtn");
    const dialogue = document.getElementById("course-restoreConfirmDialogue");
    
    if (!dialogue || !confirmBtn) {
      // Fallback to simple confirm
      if (!confirm(`Restore course "${name}" to Active status?`)) return;
      await updateCourseStatus(id, 'Active');
      return;
    }
    
    dialogue.textContent = `Restore course "${name}" to Active status?`;
    
    const handleConfirm = async () => {
      try {
        await updateCourseStatus(id, 'Active');
        confirmModal.hide();
        confirmBtn.removeEventListener('click', handleConfirm);
      } catch (err) {
        console.error('[courses] Restore failed:', err);
      }
    };
    
    confirmBtn.addEventListener('click', handleConfirm, { once: true });
    confirmModal.show();
  }
  
  async function updateCourseStatus(id, status) {
    try {
      const form = new FormData();
      form.append('id', id);
      form.append('status', status);
      
      const res = await window.fetchJSON(
        `php/update-course-status.php`,
        {
          method: 'POST',
          body: form,
        }
      );
      
      if (res && res.success === false) {
        throw new Error(res.message || 'Status update failed');
      }
      
      let msg;
      if (status === 'Archived') {
        msg = 'Course archived 🗃️';
      } else {
        msg = `Course ${status} ✅`;
      }
      
      showCourseSuccessModal(msg);
      
      // Reload both tabs
      loadCourses('active');
      loadCourses('archived');
    } catch (err) {
      console.error('[courses] status update error', err);
      showCourseErrorModal(err.message || 'Failed to update course status.');
    }
  }

  // ======== INITIALIZATION ========
  function initManageCourses() {
    const section = document.querySelector('#manage-courses-page');
    if (!section) {
      console.warn('[courses] #manage-courses-page not found');
      return;
    }
    
    // Prevent multiple initializations
    if (COURSE_CONFIG.isInitialized) {
      return;
    }
    
    COURSE_CONFIG.isInitialized = true;
    
    // Clear any existing interval
    if (COURSE_CONFIG.refreshTimer) {
      clearInterval(COURSE_CONFIG.refreshTimer);
      COURSE_CONFIG.refreshTimer = null;
    }
    
    const isSuperAdmin = detectIsSuperAdmin();
    
    // Setup view toggles
    setupViewToggle('active');
    setupViewToggle('archived');
    
    // Setup search functionality (basic implementation)
    const searchActive = document.getElementById('activeCourseSearch');
    const searchArchived = document.getElementById('archivedCourseSearch');
    
    if (searchActive) {
      searchActive.addEventListener('input', window.debounce((e) => {
        // Search functionality would go here
        // For now, just reload
        COURSE_CONFIG.pagination.currentPage['active'] = 1;
        loadCourses('active');
      }, 300));
    }
    
    if (searchArchived) {
      searchArchived.addEventListener('input', window.debounce((e) => {
        COURSE_CONFIG.pagination.currentPage['archived'] = 1;
        loadCourses('archived');
      }, 300));
    }
    
    // Setup modal events
    setupModalEvents(isSuperAdmin);
    
    // Initial load
    loadCourses('active');
    loadCourses('archived');
    
    // Set up auto-refresh
    COURSE_CONFIG.refreshTimer = setInterval(() => {
      loadCourses('active');
      loadCourses('archived');
    }, 5000);
    
    console.log('Manage Courses initialized ✅');
  }
  
  function setupModalEvents(isSuperAdmin) {
    // Add Course Modal
    const addCourseForm = document.getElementById("course-addCourseForm");
    const addCourseImgInput = document.getElementById("course-addCourseImgInput");
    const addCourseImage = document.getElementById("course-addCourseImage");
    
    if (addCourseImgInput && addCourseImage) {
      addCourseImgInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        const defaultImg = "assets/images/image-placeholder.svg";
        
        if (!file) {
          addCourseImage.src = defaultImg;
          return;
        }
        
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        
        if (!allowedTypes.includes(file.type)) {
          showCourseErrorModal('Only JPG, JPEG, and PNG files are allowed. GIFs are not supported.');
          e.target.value = '';
          addCourseImage.src = defaultImg;
          return;
        }
        
        addCourseImage.src = URL.createObjectURL(file);
      });
    }
    
    if (addCourseForm) {
      const saveAddCourseBtn = document.getElementById('course-saveAddCourseBtn');
      if (saveAddCourseBtn) {
        saveAddCourseBtn.addEventListener('click', async function (e) {
          e.preventDefault();
          
          if (!isSuperAdmin) {
            showCourseErrorModal('Only super-admin can add courses.');
            return;
          }
          
          const formData = new FormData(addCourseForm);
          
          try {
            const res = await window.fetchJSON("php/add-course.php", {
              method: "POST",
              body: formData
            });
            
            if (res && res.success) {
              bootstrap.Modal.getInstance(document.getElementById("course-addCourseModal")).hide();
              addCourseForm.reset();
              addCourseImage.src = "assets/images/image-placeholder.svg";
              
              loadCourses('active');
              loadCourses('archived');
              showCourseSuccessModal("Course added successfully ✅");
            } else {
              showCourseErrorModal("Failed to add course: " + (res?.message || "Unknown error"));
            }
          } catch (err) {
            console.error("Error adding course:", err);
            showCourseErrorModal("An error occurred while adding the course.");
          }
        });
      }
    }
    
    // Edit Course Modal
    const editCourseForm = document.getElementById("course-editCourseForm");
    const editCourseImgInput = document.getElementById("course-editCourseImgInput");
    const editCourseImage = document.getElementById("course-editCourseImage");
    
    if (editCourseImgInput && editCourseImage) {
      editCourseImgInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        
        if (!file) {
          return; // Keep current image
        }
        
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
        
        if (!allowedTypes.includes(file.type)) {
          showCourseErrorModal('Only JPG, JPEG, and PNG files are allowed. GIFs are not supported.');
          e.target.value = '';
          return;
        }
        
        editCourseImage.src = URL.createObjectURL(file);
      });
    }
    
    if (editCourseForm) {
      const saveEditCourseBtn = document.getElementById('course-saveEditCourseBtn');
      if (saveEditCourseBtn) {
        saveEditCourseBtn.addEventListener('click', async function (e) {
          e.preventDefault();
          
          if (!isSuperAdmin) {
            showCourseErrorModal('Only super-admin can edit courses.');
            return;
          }
          
          const formData = new FormData(editCourseForm);
          
          try {
            const res = await window.fetchJSON("php/edit-course.php", {
              method: "POST",
              body: formData
            });
            
            if (res && res.success) {
              bootstrap.Modal.getInstance(document.getElementById("course-editCourseModal")).hide();
              
              loadCourses('active');
              loadCourses('archived');
              showCourseSuccessModal("Course updated successfully ✏️");
            } else {
              showCourseErrorModal("Failed to update course: " + (res?.message || "Unknown error"));
            }
          } catch (err) {
            console.error("Error updating course:", err);
            showCourseErrorModal("An error occurred while updating the course.");
          }
        });
      }
    }
  }

  // ======== CLEANUP FUNCTION ========
  function cleanupCourses() {
    if (COURSE_CONFIG.refreshTimer) {
      clearInterval(COURSE_CONFIG.refreshTimer);
      COURSE_CONFIG.refreshTimer = null;
    }
    
    // Reset initialization state
    COURSE_CONFIG.isInitialized = false;
    
    console.log('Manage Courses cleaned up');
  }

  // ======== AUTO-DETECT PAGE LOAD ========
  function checkAndInit() {
    const section = document.querySelector('#manage-courses-page');
    if (section && !COURSE_CONFIG.isInitialized) {
      initManageCourses();
    } else if (!section && COURSE_CONFIG.isInitialized) {
      // If courses page is no longer visible, cleanup
      cleanupCourses();
    }
  }

  // Run on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    checkAndInit();
    
    // Also check when content changes (for SPA)
    const contentArea = document.getElementById('content-area') || document.body;
    if (contentArea) {
      const observer = new MutationObserver(() => {
        checkAndInit();
      });
      observer.observe(contentArea, { childList: true, subtree: true });
    }
  });

  // Also run on page load (in case DOMContentLoaded already fired)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndInit);
  } else {
    // DOM already loaded
    setTimeout(checkAndInit, 100);
  }

})();
// end manage-courses.js