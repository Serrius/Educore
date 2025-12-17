// manage-users.js

// ===== Global helpers (used by all tabs) =====
async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, { cache: 'no-store', ...options });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave data = null */ }

  if (!resp.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    err.raw = text;
    throw err;
  }
  return data;
}

function debounce(fn, wait = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
const _esc = escapeHtml;

// Build display name from split fields or fallback to full_name
function composeName(obj) {
  if (!obj) return '';
  const hasSplit =
    obj.first_name || obj.middle_name || obj.last_name || obj.suffix;
  if (hasSplit) {
    const parts = [];
    if (obj.first_name)  parts.push(obj.first_name);
    if (obj.middle_name) parts.push(obj.middle_name);
    if (obj.last_name)   parts.push(obj.last_name);
    if (obj.suffix)      parts.push(obj.suffix);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  if (obj.full_name) return String(obj.full_name);
  return '';
}

// ===== Simple paginator factory (Prev / Next under each table) =====
function createPaginator(section, tableSelector, onPageChange) {
  const table = section.querySelector(tableSelector);
  if (!table || !table.parentElement) return null;

  const wrap = document.createElement('div');
  wrap.className = 'd-flex justify-content-between align-items-center mt-2';
  wrap.innerHTML = `
    <div class="small text-muted" data-role="page-info"></div>
    <ul class="pagination pagination-sm mb-0">
      <li class="page-item" data-role="prev-item">
        <button class="page-link" type="button" data-page="prev">&laquo; Prev</button>
      </li>
      <li class="page-item" data-role="next-item">
        <button class="page-link" type="button" data-page="next">Next &raquo;</button>
      </li>
    </ul>
  `;
  table.parentElement.appendChild(wrap);

  const infoEl = wrap.querySelector('[data-role="page-info"]');
  const prevItem = wrap.querySelector('[data-role="prev-item"]');
  const nextItem = wrap.querySelector('[data-role="next-item"]');

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn) return;
    const dir = btn.dataset.page;
    onPageChange(dir);
  });

  return { wrapper: wrap, infoEl, prevItem, nextItem };
}

function updatePaginator(pager, currentPage, totalPages, totalItems) {
  if (!pager) return;
  if (totalPages < 1) totalPages = 1;
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  if (pager.infoEl) {
    if (totalItems === 0) {
      pager.infoEl.textContent = 'No records to display';
    } else {
      pager.infoEl.textContent = `Page ${currentPage} of ${totalPages} • ${totalItems} record(s)`;
    }
  }

  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  if (pager.prevItem) {
    pager.prevItem.classList.toggle('disabled', prevDisabled);
  }
  if (pager.nextItem) {
    pager.nextItem.classList.toggle('disabled', nextDisabled);
  }
}

// ===== Unified backdrop cleanup function =====
function cleanupBackdrops() {
  // Remove all backdrops
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.remove();
  });
  
  // Remove modal-open class and restore scrolling
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

// ===== Setup cleanup for modals in the dynamically loaded content =====
function setupManageUsersModalCleanup() {
  // Only set up cleanup for modals specific to manage-users
  // The main modals (statusSuccessModal, statusErrorsModal, confirmModal) 
  // are already in the main HTML and have their own cleanup
  
  // List of modals that are in the manage-users.html content
  const manageUsersModalIds = [
    'addStudentModal', 'editStudentModal', 
    'addAdminModal', 'editAdminModal'
  ];
  
  manageUsersModalIds.forEach(id => {
    const modalEl = document.getElementById(id);
    if (modalEl) {
      // Remove any existing listeners to prevent duplicates
      if (modalEl._cleanupHandler) {
        modalEl.removeEventListener('hidden.bs.modal', modalEl._cleanupHandler);
      }
      
      // Create new cleanup handler
      const cleanupHandler = () => {
        cleanupBackdrops();
      };
      
      modalEl._cleanupHandler = cleanupHandler;
      modalEl.addEventListener('hidden.bs.modal', cleanupHandler);
    }
  });
}

// --- Unified Modal System (Success, Error, Confirm) ---
let currentResolveConfirm = null;
let currentRejectConfirm = null;

function showSuccessModal(message) {
  const msgEl = document.getElementById('successDialogue');
  const modalEl = document.getElementById('statusSuccessModal');
  if (!msgEl || !modalEl) { 
    console.warn('[users] Success modal missing, falling back to alert');
    alert(`Success: ${message}`);
    return; 
  }
  msgEl.textContent = message;
  const modal = new bootstrap.Modal(modalEl);
  
  // Ensure cleanup happens when this modal is hidden
  modalEl.removeEventListener('hidden.bs.modal', modalEl._successCleanup);
  modalEl._successCleanup = () => cleanupBackdrops();
  modalEl.addEventListener('hidden.bs.modal', modalEl._successCleanup, { once: true });
  
  modal.show();
}

function showErrorModal(message) {
  const msgEl = document.getElementById('errorDialogue');
  const modalEl = document.getElementById('statusErrorsModal');
  if (!msgEl || !modalEl) { 
    console.warn('[users] Error modal missing, falling back to alert');
    alert(`Error: ${message}`);
    return; 
  }
  msgEl.textContent = message;
  const modal = new bootstrap.Modal(modalEl);
  
  // Ensure cleanup happens when this modal is hidden
  modalEl.removeEventListener('hidden.bs.modal', modalEl._errorCleanup);
  modalEl._errorCleanup = () => cleanupBackdrops();
  modalEl.addEventListener('hidden.bs.modal', modalEl._errorCleanup, { once: true });
  
  modal.show();
}

function showConfirmModal(message, confirmText = 'Confirm', cancelText = 'Cancel') {
  return new Promise((resolve, reject) => {
    const msgEl = document.getElementById('confirmDialogue');
    const confirmBtn = document.getElementById('confirmBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const modalEl = document.getElementById('confirmModal');
    
    if (!msgEl || !confirmBtn || !cancelBtn || !modalEl) {
      console.warn('[users] Confirm modal missing, falling back to confirm');
      const result = confirm(message);
      resolve(result);
      return;
    }
    
    // Store callbacks
    currentResolveConfirm = resolve;
    currentRejectConfirm = reject;
    
    // Set content
    msgEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    
    const modal = new bootstrap.Modal(modalEl);
    
    // Set up event listeners (clean previous ones first)
    const onConfirm = () => {
      cleanupConfirmListeners();
      cleanupBackdrops();
      modal.hide();
      resolve(true);
    };
    
    const onCancel = () => {
      cleanupConfirmListeners();
      cleanupBackdrops();
      modal.hide();
      resolve(false);
    };
    
    const onHidden = () => {
      cleanupConfirmListeners();
      cleanupBackdrops();
      if (currentResolveConfirm) {
        currentResolveConfirm(false);
        currentResolveConfirm = null;
        currentRejectConfirm = null;
      }
    };
    
    // Store functions for cleanup
    modalEl._confirmHandler = onConfirm;
    modalEl._cancelHandler = onCancel;
    modalEl._hiddenHandler = onHidden;
    
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    
    // Ensure cleanup happens when modal is hidden
    modalEl.removeEventListener('hidden.bs.modal', modalEl._confirmCleanup);
    modalEl._confirmCleanup = onHidden;
    modalEl.addEventListener('hidden.bs.modal', modalEl._confirmCleanup);
    
    modal.show();
  });
}

function cleanupConfirmListeners() {
  const modalEl = document.getElementById('confirmModal');
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  
  if (!modalEl) return;
  
  if (modalEl._confirmHandler && confirmBtn) {
    confirmBtn.removeEventListener('click', modalEl._confirmHandler);
  }
  if (modalEl._cancelHandler && cancelBtn) {
    cancelBtn.removeEventListener('click', modalEl._cancelHandler);
  }
  if (modalEl._hiddenHandler) {
    modalEl.removeEventListener('hidden.bs.modal', modalEl._hiddenHandler);
  }
  
  delete modalEl._confirmHandler;
  delete modalEl._cancelHandler;
  delete modalEl._hiddenHandler;
}

// ====== View User Modal logic ======
const viewModal = {
  id: null,
  status: null,
  origin: 'pending',
  modal: null,
  els: {}
};

let archivedStudentsFetchFn = null;
let archivedAdminsFetchFn = null;
function refreshArchivedStudents() { if (typeof archivedStudentsFetchFn === 'function') archivedStudentsFetchFn(); }
function refreshArchivedAdmins()   { if (typeof archivedAdminsFetchFn === 'function')   archivedAdminsFetchFn(); }

function setupViewUserModalOnce() {
  if (viewModal.modal) return;
  const modalEl = document.getElementById('viewUserModal');
  if (!modalEl) return;

  viewModal.modal = new bootstrap.Modal(modalEl);
  viewModal.els = {
    info: document.getElementById('viewUserInfo'),
    avatar: document.getElementById('viewUserAvatar'),
    name: document.getElementById('viewUserName'),
    id: document.getElementById('viewUserId'),
    idNumber: document.getElementById('viewUserIdNumber'),
    email: document.getElementById('viewUserEmail'),
    userType: document.getElementById('viewUserUserType'),
    role: document.getElementById('viewUserRole'),
    dept: document.getElementById('viewUserDepartment'),
    sy: document.getElementById('viewUserSchoolYear'),
    year: document.getElementById('viewUserYear'),
    statusBadge: document.getElementById('viewUserStatusBadge'),
    createdAt: document.getElementById('viewUserCreatedAt'),
    primaryBtn: document.getElementById('viewUserPrimaryBtn'),
    deleteBtn: document.getElementById('viewUserDeleteBtn'),
    resetPasswordBtn: document.getElementById('viewUserResetPasswordBtn'), // New button
  };

  if (!viewModal.els.primaryBtn || !viewModal.els.deleteBtn) {
    console.warn('[users] Modal primary/delete buttons are missing. Add #viewUserPrimaryBtn and #viewUserDeleteBtn to the modal footer.');
    return;
  }

  function refreshOrigin() {
    if (viewModal.origin === 'pending')           refreshPending();
    else if (viewModal.origin === 'active')       refreshActive();
    else if (viewModal.origin === 'manage')       refreshManage();
    else if (viewModal.origin === 'admin')        refreshAdmins();
    else if (viewModal.origin === 'archived-students') refreshArchivedStudents();
    else if (viewModal.origin === 'archived-admins')   refreshArchivedAdmins();
  }

  // Primary action (Activate/Deactivate)
  viewModal.els.primaryBtn.addEventListener('click', async () => {
    if (!viewModal.id) return;
    const next = (viewModal.status === 'Active') ? 'Inactive' : 'Active';
    try {
      await fetchJSON('php/bulk-change-status.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids: [viewModal.id], status: next })
      });
      showSuccessModal(`${next === 'Active' ? 'Activated' : 'Deactivated'} user ✅`);
      viewModal.modal.hide();
      refreshOrigin();
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to update status.');
    }
  });

  // Archive (soft delete: Archived in DB)
  viewModal.els.deleteBtn.addEventListener('click', async () => {
    if (!viewModal.id) return;
    
    const confirmed = await showConfirmModal('Archive this user?', 'Archive', 'Cancel');
    if (!confirmed) return;
    
    try {
      await fetchJSON('php/bulk-delete-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids: [viewModal.id] })
      });
      showSuccessModal('User archived 📁');
      viewModal.modal.hide();
      refreshOrigin();
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to archive user.');
    }
  });

  // Reset Password
  if (viewModal.els.resetPasswordBtn) {
    viewModal.els.resetPasswordBtn.addEventListener('click', async () => {
      if (!viewModal.id) return;
      
      const confirmed = await showConfirmModal('Reset password for this user? The password will be set to their ID number.', 'Reset', 'Cancel');
      if (!confirmed) return;
      
      try {
        const result = await fetchJSON('php/reset-user-password.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ id: viewModal.id })
        });
        
        if (result.success) {
          showSuccessModal('Password reset successfully! The new password is their ID number.');
        } else {
          throw new Error(result.message || 'Failed to reset password');
        }
      } catch (e) {
        console.error(e);
        showErrorModal('Failed to reset password.');
      }
    });
  }
}

async function openUserModal(userId, originTab) {
  setupViewUserModalOnce();
  if (!viewModal.modal) return;
  if (!viewModal.els.primaryBtn || !viewModal.els.deleteBtn) {
    console.warn('[users] Modal action buttons are missing. The modal will open but actions are disabled.');
  }

  try {
    const resp = await fetchJSON(`php/get-user.php?id=${encodeURIComponent(userId)}&t=${Date.now()}`);
    const u = (resp && resp.success && resp.user) ? resp.user : resp;
    if (!u || !u.id) {
      console.warn('[view-modal] user payload missing/invalid:', resp);
      showErrorModal(resp?.message || 'Failed to load user details.');
      return;
    }

    viewModal.id = u.id;
    viewModal.status = u.status || 'Inactive';
    viewModal.origin = originTab;

    const fallback = 'assets/images/image-placeholder.svg';
    if (viewModal.els.avatar) viewModal.els.avatar.src = u.profile_picture || fallback;
    if (viewModal.els.name) viewModal.els.name.textContent = composeName(u) || '—';
    if (viewModal.els.id) viewModal.els.id.textContent = u.id ?? '—';
    if (viewModal.els.idNumber) viewModal.els.idNumber.textContent = u.id_number || '—';
    if (viewModal.els.email) viewModal.els.email.textContent = u.email || '—';
    if (viewModal.els.userType) viewModal.els.userType.textContent = u.user_type || '—';
    
    // Show "Student" instead of "non-admin" for students
    if (viewModal.els.role) {
      if (u.user_type === 'student') {
        viewModal.els.role.textContent = 'Student';
      } else {
        viewModal.els.role.textContent = u.role || '—';
      }
    }
    
    if (viewModal.els.dept) viewModal.els.dept.textContent = u.department || '—';
    if (viewModal.els.sy) viewModal.els.sy.textContent = u.school_year || '—';
    if (viewModal.els.year) viewModal.els.year.textContent = u.year || '—';
    if (viewModal.els.createdAt) viewModal.els.createdAt.textContent = u.created_at || '—';

    if (viewModal.els.statusBadge) {
      const badge = viewModal.els.statusBadge;
      badge.textContent = u.status || '—';
      badge.classList.remove('bg-success','bg-secondary','bg-warning','bg-danger');
      if (u.status === 'Active') badge.classList.add('bg-success');
      else if (u.status === 'Inactive') badge.classList.add('bg-secondary');
      else badge.classList.add('bg-warning'); // Archived or others
    }

    if (viewModal.els.primaryBtn) {
      const primary = viewModal.els.primaryBtn;
      if (u.status === 'Active') {
        primary.textContent = 'Deactivate';
        primary.classList.remove('btn-primary','btn-success');
        primary.classList.add('btn-warning');
      } else {
        primary.textContent = 'Activate';
        primary.classList.remove('btn-warning');
        primary.classList.add('btn-primary');
      }
    }

    // Show/hide reset password button based on user type
    if (viewModal.els.resetPasswordBtn) {
      viewModal.els.resetPasswordBtn.style.display = 'inline-block';
    }

    viewModal.modal.show();
  } catch (e) {
    console.error('[view-modal] load user error:', e);
    showErrorModal('Failed to load user details.');
  }
}

// =================== Pending Students Tab ===================
let lastPendingUsers = '';
let pendingRefreshTimer = null;
let pendingFetchFn = null;
function refreshPending() { if (typeof pendingFetchFn === 'function') pendingFetchFn(); }

function initManageUsers() {
  const section = document.querySelector('#pending-students');
  if (!section || section.dataset.usersInit === 'true') return;
  section.dataset.usersInit = 'true';

  const tableBody   = section.querySelector('#pendingStudentTable tbody');
  const searchInput = section.querySelector('#pendingStudentSearch');
  const selectAll   = section.querySelector('#selectAllPending');
  const bulkActions = section.querySelector('#pending-bulk-actions');
  const activateBtn = section.querySelector('#activateSelected');
  const deleteBtn   = section.querySelector('#deleteSelected');

  if (!tableBody || !searchInput || !selectAll || !bulkActions || !activateBtn || !deleteBtn) {
    console.warn('[users/pending] Missing required elements.');
    return;
  }

  // pagination state
  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#pendingStudentTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filteredData);
  });

  // ---- helpers/state
  // normalize id_number the SAME way for users + notifications
  const norm = (s) => String(s ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .trim();

  let rowsData = [];
  let filteredData = [];
  const selectedIds = new Set();

  // Map<normalized_actor_id_number, notif_id>
  let unreadRegByActor = new Map();

  const updateBulkUI = () => {
    if (selectedIds.size > 0) bulkActions.classList.remove('d-none');
    else bulkActions.classList.add('d-none');
  };

  const wireRowCheckboxes = () => {
    const checks = section.querySelectorAll('.row-check');
    checks.forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const allChecked = checks.length > 0 && Array.from(checks).every(c => c.checked);
        selectAll.checked = allChecked;
        updateBulkUI();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const rowKey   = norm(row.id_number);
      const notifId  = rowKey ? unreadRegByActor.get(rowKey) : undefined;
      const isUnread = !!notifId;

      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.dataset.idNumber = rowKey;          // store normalized key for later removal
      if (notifId) tr.dataset.notifId = String(notifId);
      if (isUnread) tr.classList.add('row-unread');

      tr.innerHTML = `
        <td class="text-center" style="width:36px;">
          <input type="checkbox" class="row-check" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>
          ${isUnread ? '<span class="unread-dot"></span>' : ''}
          ${escapeHtml(row.full_name)}
        </td>
        <td>${escapeHtml(row.course)}</td>
        <td>${escapeHtml(row.school_year)}</td>
        <td><span class="badge ${row.status === 'Active' ? 'bg-success' : 'bg-secondary'}">${escapeHtml(row.status)}</span></td>
        <td style="min-width:140px;">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary"
                    data-action="activate"
                    data-id="${row.id}"
                    ${notifId ? `data-notif-id="${notifId}"` : ''}>
              <i class="bi bi-check2-circle"></i> Activate
            </button>
            <button class="btn btn-outline-secondary"
                    data-action="delete"
                    data-id="${row.id}"
                    ${notifId ? `data-notif-id="${notifId}"` : ''}
                    title="Archive student">
              <i class="bi bi-archive"></i> Archive
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowCheckboxes();
    updateBulkUI();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filteredData = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.course || '').toLowerCase().includes(q) ||
      (r.school_year || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    selectedIds.clear();
    selectAll.checked = false;
    currentPage = 1;
    renderRows(filteredData);
  };

  async function fetchUnreadRegistrations() {
    try {
      const res = await fetchJSON(`php/get-unread-registrations.php?t=${Date.now()}`);
      const items = Array.isArray(res?.items) ? res.items : [];
      const map = new Map();
      for (const it of items) {
        const key = norm(it.actor_id_number);
        const nid = Number(it.notif_id);
        if (!key || !nid) continue;
        if (!map.has(key)) map.set(key, nid); // items are DESC; keep first (latest)
      }
      unreadRegByActor = map;
    } catch (e) {
      console.warn('[users/pending] unread registrations fetch failed:', e.message);
      unreadRegByActor = new Map();
    }
  }

  async function fetchPendingUsers() {
    try {
      const [json] = await Promise.all([
        fetchJSON(`php/get-users.php?scope=pending&user_type=student&limit=500&t=${Date.now()}`),
        fetchUnreadRegistrations()
      ]);

      const list = Array.isArray(json) ? json : (json.users || []);
      const mapped = (list || []).map(r => ({
        id: Number(r.id),
        id_number: r.id_number || '', // REQUIRED for highlight
        full_name: composeName(r),
        course: r.department || '',
        school_year: r.school_year || '',
        status: r.status || 'Inactive'
      }));

      // include unread map signature, but normalize keys for stability
      const sigUnread = JSON.stringify([...unreadRegByActor.entries()]);
      const signature = JSON.stringify(mapped) + '|' + sigUnread;
      
      // Only update if data actually changed
      if (signature === lastPendingUsers) return;
      lastPendingUsers = signature;

      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));
      
      applyFilter();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (err) {
      console.error('[users/pending] load error:', err);
      // Don't clear table on error, just show error row
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load pending students.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  pendingFetchFn = fetchPendingUsers;

  // mark one notification as read (your PHP expects form-urlencoded with "id")
  async function markRegistrationReadById(notifId) {
    if (!notifId) return;
    const body = new URLSearchParams({ id: String(notifId) });
    const resp = await fetch('php/mark-notification-read.php', { method: 'POST', body });
    const txt = await resp.text();
    let data = null; try { data = JSON.parse(txt); } catch {}
    if (!resp.ok || data?.success === false) {
      throw new Error(data?.message || `mark read failed (${resp.status})`);
    }
  }

  // row click → open modal + mark as read if needed
  section.addEventListener('click', async (e) => {
    const isCheckbox = e.target.closest('input[type="checkbox"]');
    const isActionBtn = e.target.closest('.btn-group button');
    if (isCheckbox || isActionBtn) return;

    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.id) return;

    const id = Number(tr.dataset.id);
    const notifId = tr.dataset.notifId ? Number(tr.dataset.notifId) : 0;

    if (notifId > 0) {
      try {
        await markRegistrationReadById(notifId);
        tr.classList.remove('row-unread');
        tr.querySelector('.unread-dot')?.remove();
        const key = tr.dataset.idNumber || '';
        if (key) unreadRegByActor.delete(key);
      } catch (err) {
        console.warn('[users/pending] mark read failed (continuing):', err.message);
      }
    }

    openUserModal(id, 'pending');
  });

  // action buttons
  section.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    const notifId = btn.dataset.notifId ? Number(btn.dataset.notifId) : 0;

    if (notifId > 0) {
      try { await markRegistrationReadById(notifId); } catch {}
    }

    if (action === 'activate') {
      await bulkChangeStatus([id], 'Active');
    } else if (action === 'delete') {
      const confirmed = await showConfirmModal('Archive this user?', 'Archive', 'Cancel');
      if (!confirmed) return;
      await bulkUnlist([id]);
    }
  });

  // select all
  selectAll.addEventListener('change', () => {
    selectedIds.clear();
    section.querySelectorAll('.row-check').forEach(chk => {
      chk.checked = selectAll.checked;
      if (chk.checked) selectedIds.add(Number(chk.dataset.id));
    });
    updateBulkUI();
  });

  searchInput.addEventListener('input', debounce(applyFilter, 120));

  activateBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    await bulkChangeStatus([...selectedIds], 'Active');
  });

  deleteBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    
    const confirmed = await showConfirmModal(`Archive ${selectedIds.size} user(s)?`, 'Archive', 'Cancel');
    if (!confirmed) return;
    
    await bulkUnlist([...selectedIds]);
  });

  async function bulkChangeStatus(ids, newStatus) {
    try {
      const res = await fetchJSON('php/bulk-change-status.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids, status: newStatus })
      });
      await fetchPendingUsers();
      showSuccessModal(`Updated ${res.updated ?? ids.length} user(s) ✅`);
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to update status.');
    }
  }

  async function bulkUnlist(ids) {
    try {
      const res = await fetchJSON('php/bulk-delete-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids })
      });
      await fetchPendingUsers();
      showSuccessModal(`Archived ${res.updated ?? ids.length} user(s) 📁`);
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to archive users.');
    }
  }

  // init + poll
  fetchPendingUsers();
  if (pendingRefreshTimer) clearInterval(pendingRefreshTimer);
  pendingRefreshTimer = setInterval(fetchPendingUsers, 5000);
}

// =================== Active Students Tab ===================
let lastActiveStudents = '';
let activeRefreshTimer = null;
let activeFetchFn = null;
function refreshActive() { if (typeof activeFetchFn === 'function') activeFetchFn(); }

function initActiveStudents() {
  const section = document.querySelector('#active-students');
  if (!section || section.dataset.usersActiveInit === 'true') return;
  section.dataset.usersActiveInit = 'true';

  const tableBody     = section.querySelector('#activeStudentTable tbody');
  const searchInput   = section.querySelector('#activeStudentSearch');
  const selectAll     = section.querySelector('#selectAllActive');
  const bulkActions   = section.querySelector('#active-bulk-actions');
  const deactivateBtn = section.querySelector('#deactivateSelected');
  const deleteBtn     = section.querySelector('#deleteActiveSelected');

  if (!tableBody || !searchInput || !selectAll || !bulkActions || !deactivateBtn || !deleteBtn) {
    console.warn('[users/active] Missing elements');
    return;
  }

  // pagination
  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#activeStudentTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filteredData);
  });

  let rowsData = [];
  let filteredData = [];
  const selectedIds = new Set();

  const updateBulkUI = () => {
    if (selectedIds.size > 0) bulkActions.classList.remove('d-none');
    else bulkActions.classList.add('d-none');
  };

  const wireRowChecks = () => {
    section.querySelectorAll('.row-check-active').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const allChecked = [...section.querySelectorAll('.row-check-active')].every(c => c.checked);
        selectAll.checked = allChecked;
        updateBulkUI();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td class="text-center" style="width:36px;">
          <input type="checkbox" class="row-check-active" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>${escapeHtml(row.full_name)}</td>
        <td>${escapeHtml(row.course)}</td>
        <td>${escapeHtml(row.school_year)}</td>
        <td><span class="badge ${row.status === 'Active' ? 'bg-success' : 'bg-secondary'}">${escapeHtml(row.status)}</span></td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-warning" data-action="deactivate" data-id="${row.id}">
              <i class="bi bi-slash-circle"></i> Deactivate
            </button>
            <button class="btn btn-outline-secondary" title="Archive student" data-action="delete" data-id="${row.id}">
              <i class="bi bi-archive"></i> Archive
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowChecks();
    updateBulkUI();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filteredData = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.course || '').toLowerCase().includes(q) ||
      (r.school_year || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    selectedIds.clear();
    selectAll.checked = false;
    currentPage = 1;
    renderRows(filteredData);
  };

  async function fetchActiveUsers() {
    try {
      const json = await fetchJSON(`php/get-users.php?scope=active&user_type=student&limit=500&t=${Date.now()}`);
      const list = Array.isArray(json) ? json : (json.users || []);
      const mapped = (list || []).map(r => ({
        id: Number(r.id),
        full_name: composeName(r),
        course: r.department || '',
        school_year: r.school_year || '',
        status: r.status || 'Active'
      }));
      const current = JSON.stringify(mapped);
      
      // Only update if data actually changed
      if (current === lastActiveStudents) return;
      lastActiveStudents = current;
      
      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));
      
      applyFilter();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (err) {
      console.error('[users/active] load error:', err);
      // Don't clear table on error
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load active students.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  activeFetchFn = fetchActiveUsers;

  section.addEventListener('click', (e) => {
    const isCheckbox = e.target.closest('input[type="checkbox"]');
    const isActionBtn = e.target.closest('.btn-group button');
    if (isCheckbox || isActionBtn) return;
    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.id) return;
    openUserModal(Number(tr.dataset.id), 'active');
  });

  section.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    if (action === 'deactivate') {
      await bulkChangeStatus([id], 'Inactive');
    } else if (action === 'delete') {
      const confirmed = await showConfirmModal('Archive this student?', 'Archive', 'Cancel');
      if (!confirmed) return;
      await bulkUnlist([id]);
    }
  });

  selectAll.addEventListener('change', () => {
    selectedIds.clear();
    section.querySelectorAll('.row-check-active').forEach(chk => {
      chk.checked = selectAll.checked;
      if (chk.checked) selectedIds.add(Number(chk.dataset.id));
    });
    updateBulkUI();
  });

  searchInput.addEventListener('input', debounce(applyFilter, 120));

  deactivateBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    await bulkChangeStatus([...selectedIds], 'Inactive');
  });

  deleteBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    
    const confirmed = await showConfirmModal(`Archive ${selectedIds.size} student(s)?`, 'Archive', 'Cancel');
    if (!confirmed) return;
    
    await bulkUnlist([...selectedIds]);
  });

  async function bulkChangeStatus(ids, status) {
    try {
      const res = await fetchJSON('php/bulk-change-status.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids, status })
      });
      await fetchActiveUsers();
      showSuccessModal(`Updated ${res.updated ?? ids.length} user(s) ✅`);
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to update status.');
    }
  }

  async function bulkUnlist(ids) {
    try {
      const res = await fetchJSON('php/bulk-delete-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids })
      });
      await fetchActiveUsers();
      showSuccessModal(`Archived ${res.updated ?? ids.length} user(s) 📁`);
    } catch (e) {
      console.error(e);
      showErrorModal('Failed to archive users.');
    }
  }

  fetchActiveUsers();
  if (activeRefreshTimer) clearInterval(activeRefreshTimer);
  activeRefreshTimer = setInterval(fetchActiveUsers, 5000);
}

// =================== Manage Students Tab ===================
let lastManageStudents = '';
let manageRefreshTimer = null;
let manageFetchFn = null;
function refreshManage() { if (typeof manageFetchFn === 'function') manageFetchFn(); }

function initManageStudents() {
  const section = document.querySelector('#manage-students');
  if (!section || section.dataset.usersManageInit === 'true') return;
  section.dataset.usersManageInit = 'true';

  // Elements
  const tableBody    = section.querySelector('#manageStudentTable tbody');
  const searchInput  = section.querySelector('#manageStudentSearch');

  const defaultGrp   = section.querySelector('#manage-default-actions'); // Add + Import + Export
  const bulkGrp      = section.querySelector('#manage-bulk-actions');    // Export + Delete(Archive)

  const addBtn       = section.querySelector('#add-student');
  const importInput  = section.querySelector('#importManageStudentsXML');

  // NOTE: two buttons share the same id in default+bulk; we handle both via querySelectorAll
  const exportBtns   = section.querySelectorAll('#exportManageStudentsXML');
  const deleteBtn    = section.querySelector('#deleteManageSelected');

  const selectAll    = section.querySelector('#selectAllManage');

  if (!tableBody || !searchInput || !defaultGrp || !bulkGrp || !selectAll) {
    console.warn('[users/manage] Missing required elements.');
    return;
  }

  // pagination
  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#manageStudentTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filteredData);
  });

  // State
  let rowsData = [];
  let filteredData = [];
  const selectedIds = new Set();

  const esc = _esc;

  const showBulkIfNeeded = () => {
    const hasSelection = selectedIds.size > 0;
    if (hasSelection) {
      bulkGrp.classList.remove('d-none');
      defaultGrp.classList.add('d-none');
    } else {
      bulkGrp.classList.add('d-none');
      defaultGrp.classList.remove('d-none');
    }

    // Hide Export XML buttons when no checkbox is used
    if (exportBtns && exportBtns.length) {
      exportBtns.forEach(btn => {
        btn.classList.toggle('d-none', !hasSelection);
      });
    }
  };

  const syncSelectAll = () => {
    const checks = section.querySelectorAll('.row-check-manage');
    const allChecked = checks.length > 0 && [...checks].every(c => c.checked);
    selectAll.checked = allChecked;
  };

  const wireRowChecks = () => {
    section.querySelectorAll('.row-check-manage').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        syncSelectAll();
        showBulkIfNeeded();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td class="text-center" style="width:36px;">
          <input type="checkbox" class="row-check-manage" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>${esc(row.full_name)}</td>
        <td>${esc(row.course)}</td>
        <td>${esc(row.school_year)}</td>
        <td>
          <span class="badge ${
            row.status === 'Active' ? 'bg-success' :
            row.status === 'Inactive' ? 'bg-secondary' : 'bg-warning'
          }">${esc(row.status || '—')}</span>
        </td>
        <td class="text-end" style="min-width: 72px;">
          <div class="btn-group">
            <button class="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
              <i class="bi bi-three-dots-vertical"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" data-action="view" data-id="${row.id}">
                <i class="bi bi-eye me-2"></i>View
              </a></li>
              <li><a class="dropdown-item" href="#" data-action="edit" data-id="${row.id}">
                <i class="bi bi-pencil-square me-2"></i>Edit
              </a></li>
              <li><a class="dropdown-item" href="#" data-action="reset-password" data-id="${row.id}">
                <i class="bi bi-key me-2"></i>Reset Password
              </a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item" href="#" data-action="delete" data-id="${row.id}">
                <i class="bi bi-archive me-2"></i>Archive
              </a></li>
            </ul>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowChecks();
    syncSelectAll();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filteredData = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.course || '').toLowerCase().includes(q) ||
      (r.school_year || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    currentPage = 1;
    renderRows(filteredData);
  };

  async function fetchManageStudents() {
    try {
      const json = await fetchJSON(`php/get-users.php?scope=manage&user_type=student&limit=500&t=${Date.now()}`);
      const list = Array.isArray(json) ? json : (json.users || []);
      let mapped = (list || []).map(r => ({
        id: Number(r.id),
        full_name: composeName(r),
        course: r.department || '',      // abbreviation stored
        school_year: r.school_year || '',
        status: r.status || 'Inactive'
      }));
      // 🔒 Hide archived users in Manage Students
      mapped = mapped.filter(r => (r.status || '').toLowerCase() !== 'archived');

      const snap = JSON.stringify(mapped);
      
      // Only update if data actually changed
      if (snap === lastManageStudents) return;
      lastManageStudents = snap;
      
      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));

      applyFilter();
      showBulkIfNeeded();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (e) {
      console.error('[users/manage] load error:', e);
      // Don't clear table on error
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load students.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  manageFetchFn = fetchManageStudents;

  // Header "select all"
  selectAll.addEventListener('change', () => {
    section.querySelectorAll('.row-check-manage').forEach(chk => {
      chk.checked = selectAll.checked;
      const id = Number(chk.dataset.id);
      if (chk.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    });
    showBulkIfNeeded();
  });

  // Search
  searchInput.addEventListener('input', debounce(applyFilter, 120));

  // Row dropdown actions (View / Edit / Archive)
  section.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    e.preventDefault();

    const id = Number(act.dataset.id);
    const action = act.dataset.action;

    if (action === 'view') {
      openUserModal(id, 'manage');

    } else if (action === 'edit') {
      const modalEl = document.getElementById('editStudentModal');
      if (!modalEl) {
        console.warn('[users/manage] #editStudentModal not found; opening view instead.');
        openUserModal(id, 'manage');
        return;
      }
      try {
        const [respUser, respCourses, syResp] = await Promise.all([
          fetchJSON(`php/get-user.php?id=${encodeURIComponent(id)}&t=${Date.now()}`),
          fetchJSON('php/get-active-courses.php?t=' + Date.now()),
          fetchJSON('php/get-active-academic-year.php?t=' + Date.now())
        ]);
        const u = respUser?.success && respUser.user ? respUser.user : respUser;
        const courses = Array.isArray(respCourses) ? respCourses : (respCourses?.courses || []);

        const setVal = (sel, val) => { const el = modalEl.querySelector(sel); if (el) el.value = val ?? ''; };

        setVal('[name="id"]', u.id);
        setVal('[name="first_name"]',  u.first_name || '');
        setVal('[name="middle_name"]', u.middle_name || '');
        setVal('[name="last_name"]',   u.last_name || '');
        setVal('[name="suffix"]',      u.suffix || '');
        setVal('[name="id_number"]',   u.id_number || '');
        setVal('[name="email"]',       u.email || '');

        // Course select (abbreviation)
        const deptSel = modalEl.querySelector('#editDepartment');
        if (deptSel) {
          deptSel.innerHTML = '';
          if (courses.length) {
            courses.forEach(c => {
              const opt = document.createElement('option');
              opt.value = c.abbreviation;
              opt.textContent = `${c.course_name} (${c.abbreviation || '—'})`;
              deptSel.appendChild(opt);
            });
            if (u.department) {
              const found = [...deptSel.options].find(o => o.value === u.department);
              deptSel.value = found ? u.department : deptSel.options[0].value;
            } else {
              deptSel.selectedIndex = 0;
            }
            deptSel.disabled = false;
          } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No active courses';
            deptSel.appendChild(opt);
            deptSel.disabled = true;
          }
        }

        // School Year (force active AY)
        const sySel = modalEl.querySelector('#editSchoolYear');
        if (sySel) {
          const currentSY = syResp?.school_year || '';
          sySel.innerHTML = '';
          if (currentSY) {
            const opt = document.createElement('option');
            opt.value = currentSY;
            opt.textContent = currentSY;
            sySel.appendChild(opt);
            sySel.value = currentSY;
            sySel.disabled = false;
          } else {
            const opt = document.createElement('option');
            opt.value = u.school_year || '';
            opt.textContent = u.school_year || 'No active academic year';
            sySel.appendChild(opt);
            sySel.disabled = true;
          }
        }

        // Year level
        const yearSel = modalEl.querySelector('#editYearLevel');
        if (yearSel) {
          const found = [...yearSel.options].some(o => o.value === (u.year || ''));
          yearSel.value = found ? u.year : 'First Year';
        }

        // Status & Role
        setVal('[name="status"]', u.status || 'Inactive');
        setVal('[name="role"]',   u.role || 'non-admin');

        const utEl = modalEl.querySelector('[name="user_type"]');
        if (utEl) utEl.value = u.user_type || 'student';

        new bootstrap.Modal(modalEl).show();
      } catch (err) {
        console.error('[users/manage] edit fetch error:', err);
        showErrorModal('Failed to load user for editing.');
      }

    } else if (action === 'reset-password') {
      const confirmed = await showConfirmModal('Reset password for this student? The password will be set to their ID number.', 'Reset', 'Cancel');
      if (!confirmed) return;
      
      try {
        const result = await fetchJSON('php/reset-user-password.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ id })
        });
        
        if (result.success) {
          showSuccessModal('Password reset successfully! The new password is their ID number.');
        } else {
          throw new Error(result.message || 'Failed to reset password');
        }
      } catch (err) {
        console.error('[users/manage] reset password error:', err);
        showErrorModal('Failed to reset password.');
      }
    } else if (action === 'delete') {
      const confirmed = await showConfirmModal('Archive this user?', 'Archive', 'Cancel');
      if (!confirmed) return;
      
      try {
        await fetchJSON('php/bulk-delete-users.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ ids: [id] })
        });
        showSuccessModal('User archived 📁');
        fetchManageStudents();
      } catch (err) {
        console.error('[users/manage] archive error:', err);
        showErrorModal('Failed to archive user.');
      }
    }
  });

  // ---------- EDIT STUDENT (save) ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#saveEditStudentBtn');
    if (!btn) return;

    const modalEl = document.getElementById('editStudentModal');
    const form    = document.getElementById('editStudentForm');
    if (!modalEl || !form) return;

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    // enforce numeric id
    if (payload.id) payload.id = Number(payload.id);

    // enforce student type
    payload.user_type = 'student';

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await fetchJSON('php/update-student.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.success) throw new Error(res.message || 'Update failed');

      bootstrap.Modal.getInstance(modalEl)?.hide();
      showSuccessModal('Student updated ✏️');

      // refresh relevant tabs
      if (typeof refreshManage === 'function') refreshManage();
      if (typeof refreshPending === 'function') refreshPending();
      if (typeof refreshActive === 'function') refreshActive();
      refreshArchivedStudents();
    } catch (err) {
      console.error('[users/manage] update error:', err);
      showErrorModal(err?.message || 'Failed to update student.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  // Bulk: Export XML (selected ONLY)
  if (exportBtns && exportBtns.length) {
    exportBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        // Require at least one selected checkbox
        if (selectedIds.size === 0) {
          showErrorModal('Select at least one student to export.');
          return;
        }

        const ids = [...selectedIds];

        try {
          const resp = await fetch('php/export-students-xml.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
          });
          if (!resp.ok) throw new Error('Export failed');
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `students_export_${Date.now()}.xml`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showSuccessModal('Exported XML ✅');
        } catch (e) {
          console.error('[users/manage] export error:', e);
          showErrorModal('Failed to export XML.');
        }
      });
    });
  }

  // Bulk: Archive selected
  deleteBtn?.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    
    const confirmed = await showConfirmModal(`Archive ${selectedIds.size} user(s)?`, 'Archive', 'Cancel');
    if (!confirmed) return;
    
    try {
      const res = await fetchJSON('php/bulk-delete-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids: [...selectedIds] })
      });
      showSuccessModal(`Archived ${res.updated ?? selectedIds.size} user(s) 📁`);
      selectedIds.clear();
      showBulkIfNeeded();
      fetchManageStudents();
      refreshArchivedStudents();
    } catch (e) {
      console.error('[users/manage] bulk archive error:', e);
      showErrorModal('Failed to archive selected users.');
    }
  });

  // Import XML
  importInput?.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const resp = await fetch('php/import-students-xml.php', { method: 'POST', body: fd });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!resp.ok || !data?.success) {
        console.error('[users/manage] import response:', text);
        throw new Error(data?.message || 'Import failed');
      }
      showSuccessModal(data.message || 'Students imported from XML ✅');
      if (typeof refreshManage === 'function') refreshManage();
      if (typeof refreshPending === 'function') refreshPending();
      if (typeof refreshActive === 'function') refreshActive();
      refreshArchivedStudents();
    } catch (e) {
      console.error('[users/manage] import error:', e);
      showErrorModal(e.message || 'Failed to import XML.');
    } finally {
      importInput.value = '';
    }
  });

  // ---------- ADD STUDENT (open + populate) ----------
  addBtn?.addEventListener('click', async () => {
    const modalEl = document.getElementById('addStudentModal');
    if (!modalEl) return;

    const form     = modalEl.querySelector('#addStudentForm');
    const deptSel  = modalEl.querySelector('#addDepartment');   // <select> – values = course abbreviation
    const sySel    = modalEl.querySelector('#addSchoolYear');   // <select> – current active AY
    const statusSel= modalEl.querySelector('#addStatus');       // <select> – Active/Inactive

    form?.reset();

    try {
      const [respCourses, syResp] = await Promise.all([
        fetchJSON('php/get-active-courses.php?t=' + Date.now()),
        fetchJSON('php/get-active-academic-year.php?t=' + Date.now())
      ]);
      const courses = Array.isArray(respCourses) ? respCourses : (respCourses?.courses || []);

      // Populate Course (abbreviation)
      if (deptSel) {
        deptSel.innerHTML = '';
        if (courses.length) {
          courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.abbreviation; // we store the ABBREVIATION in users.department
            opt.textContent = `${c.course_name} (${c.abbreviation || '—'})`;
            deptSel.appendChild(opt);
          });
          deptSel.disabled = false;
        } else {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No active courses';
          deptSel.appendChild(opt);
          deptSel.disabled = true;
        }
      }

      // Populate School Year (current active AY)
      if (sySel) {
        const currentSY = syResp?.school_year || '';
        sySel.innerHTML = '';
        if (currentSY) {
          const opt = document.createElement('option');
          opt.value = currentSY;
          opt.textContent = currentSY;
          sySel.appendChild(opt);
          sySel.disabled = false;
        } else {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No active academic year';
          sySel.appendChild(opt);
          sySel.disabled = true;
        }
      }

      // Default Status
      if (statusSel) statusSel.value = 'Inactive';

      new bootstrap.Modal(modalEl).show();
    } catch (err) {
      console.error('[users/manage] add open error:', err);
      showErrorModal('Failed to load courses or academic year.');
    }
  });

  // ---------- ADD STUDENT (save) ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#saveAddStudentBtn');
    if (!btn) return;

    const modalEl = document.getElementById('addStudentModal');
    const form = document.getElementById('addStudentForm');
    if (!modalEl || !form) return;

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.user_type = 'student'; // enforce

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await fetchJSON('php/add-student.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (res && res.success === false) throw new Error(res.message || 'Add failed');

      bootstrap.Modal.getInstance(modalEl)?.hide();
      showSuccessModal('Student added ✅');

      // refresh lists
      if (typeof refreshManage === 'function') refreshManage();
      if (typeof refreshPending === 'function') refreshPending();
      if (typeof refreshActive === 'function') refreshActive();
      refreshArchivedStudents();
    } catch (err) {
      console.error('[users/manage] add save error:', err);
      showErrorModal(err?.message || 'Failed to add student.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Student';
    }
  });

  // Setup cleanup for manage-users specific modals
  setupManageUsersModalCleanup();

  // Start + poll
  fetchManageStudents();
  if (manageRefreshTimer) clearInterval(manageRefreshTimer);
  manageRefreshTimer = setInterval(fetchManageStudents, 5000);
}

// =================== Manage Admin Tab (staff) ===================
let lastAdminsSnap = '';
let adminRefreshTimer = null;
let adminFetchFn = null;
function refreshAdmins() { if (typeof adminFetchFn === 'function') adminFetchFn(); }

function initManageAdmins() {
  const section = document.querySelector('#manage-admin');
  if (!section || section.dataset.usersAdminInit === 'true') return;
  section.dataset.usersAdminInit = 'true';

  const tableBody    = section.querySelector('#adminTable tbody');
  const searchInput  = section.querySelector('#manageAdminSearch');

  const selectAll    = section.querySelector('#selectAllAdmins');
  const defaultBar   = section.querySelector('#adminDefaultActions');
  const bulkBar      = section.querySelector('#adminBulkActions');

  const addBtn       = section.querySelector('#add-admin');
  const importInput  = section.querySelector('#importAdminsXML');
  const exportBtn    = section.querySelector('#exportAdminsXML');
  const delSelected  = section.querySelector('#deleteSelectedAdmins');

  if (!tableBody || !searchInput || !selectAll || !defaultBar || !bulkBar) {
    console.warn('[admins] Missing required elements.');
    return;
  }

  // pagination
  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#adminTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filtered);
  });

  let rowsData = [];
  let filtered = [];
  const selectedIds = new Set();

  const esc = _esc;

  const updateBars = () => {
    const hasSelection = selectedIds.size > 0;
    if (hasSelection) {
      defaultBar.classList.add('d-none');
      bulkBar.classList.remove('d-none');
    } else {
      bulkBar.classList.add('d-none');
      defaultBar.classList.remove('d-none');
    }

    // Hide Export XML when no checkbox is used
    if (exportBtn) {
      exportBtn.classList.toggle('d-none', !hasSelection);
    }
  };

  const wireRowChecks = () => {
    section.querySelectorAll('.row-check-admin').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        const allChecked = [...section.querySelectorAll('.row-check-admin')].every(c => c.checked);
        selectAll.checked = allChecked;
        updateBars();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td class="text-center">
          <input type="checkbox" class="row-check-admin" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>${esc(row.full_name)}</td>
        <td>${esc(row.email)}</td>
        <td><span class="badge ${row.role === 'super-admin' ? 'bg-dark' : 'bg-info-subtle text-dark'}">${esc(row.role || '—')}</span></td>
        <td>
          <span class="badge ${
            row.status === 'Active' ? 'bg-success' :
            row.status === 'Inactive' ? 'bg-secondary' : 'bg-warning'
          }">${esc(row.status || '—')}</span>
        </td>
        <td class="text-end" style="min-width: 72px;">
          <div class="btn-group">
            <button class="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
              <i class="bi bi-three-dots-vertical"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" data-action="view" data-id="${row.id}">
                <i class="bi bi-eye me-2"></i>View
              </a></li>
              <li><a class="dropdown-item" href="#" data-action="edit" data-id="${row.id}">
                <i class="bi bi-pencil-square me-2"></i>Edit
              </a></li>
              <li><a class="dropdown-item" href="#" data-action="reset-password" data-id="${row.id}">
                <i class="bi bi-key me-2"></i>Reset Password
              </a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item" href="#" data-action="delete" data-id="${row.id}">
                <i class="bi bi-archive me-2"></i>Archive
              </a></li>
            </ul>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowChecks();
    updateBars();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filtered = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.role || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    currentPage = 1;
    renderRows(filtered);
  };

  async function fetchAdmins() {
    try {
      const json = await fetchJSON(`php/get-users.php?scope=admin&user_type=staff&limit=500&t=${Date.now()}`);
      const list = Array.isArray(json) ? json : (json.users || []);
      let mapped = (list || []).map(r => ({
        id: Number(r.id),
        full_name: composeName(r),
        email: r.email || '',
        role: r.role || 'admin',
        status: r.status || 'Inactive'
      }));
      // 🔒 Hide archived admins from Manage Admin 
      //mapped = mapped.filter(r => (r.status || '').toLowerCase() !== 'archived');

      const snap = JSON.stringify(mapped);
      
      // Only update if data actually changed
      if (snap === lastAdminsSnap) return;
      lastAdminsSnap = snap;
      
      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));
      
      selectAll.checked = false;
      applyFilter();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (e) {
      console.error('[admins] load error:', e);
      // Don't clear table on error
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load admins.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  adminFetchFn = fetchAdmins;

  // Row click -> open modal (ignore checkbox / dropdown clicks)
  section.addEventListener('click', (e) => {
    const isCheckbox = e.target.closest('input[type="checkbox"]');
    const isActionBtn = e.target.closest('.btn-group button, .dropdown-item');
    if (isCheckbox || isActionBtn) return;
    const tr = e.target.closest('tr');
    if (!tr || !tr.dataset.id) return;
    openUserModal(Number(tr.dataset.id), 'admin');
  });

  // Row action menu
  section.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    e.preventDefault();
    const id = Number(act.dataset.id);
    const action = act.dataset.action;

    if (action === 'view') {
      openUserModal(id, 'admin');

    } else if (action === 'edit') {
      // Use the chips-enabled editor
      openEditAdminModal(id);

    } else if (action === 'reset-password') {
      const confirmed = await showConfirmModal('Reset password for this admin? The password will be set to their ID number.', 'Reset', 'Cancel');
      if (!confirmed) return;
      
      try {
        const result = await fetchJSON('php/reset-user-password.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ id })
        });
        
        if (result.success) {
          showSuccessModal('Password reset successfully! The new password is their ID number.');
        } else {
          throw new Error(result.message || 'Failed to reset password');
        }
      } catch (err) {
        console.error('[admins] reset password error:', err);
        showErrorModal('Failed to reset password.');
      }
    } else if (action === 'delete') {
      const confirmed = await showConfirmModal('Archive this admin?', 'Archive', 'Cancel');
      if (!confirmed) return;
      
      try {
        await fetchJSON('php/bulk-delete-users.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ ids: [id] })
        });
        showSuccessModal('Admin archived 📁');
        fetchAdmins();
        refreshArchivedAdmins();
      } catch (err) {
        console.error('[admins] archive error:', err);
        showErrorModal('Failed to archive admin.');
      }
    }
  });

  // Select all
  selectAll.addEventListener('change', () => {
    selectedIds.clear();
    section.querySelectorAll('.row-check-admin').forEach(chk => {
      chk.checked = selectAll.checked;
      if (chk.checked) selectedIds.add(Number(chk.dataset.id));
    });
    updateBars();
  });

  // Search
  searchInput.addEventListener('input', debounce(applyFilter, 120));

  // Export XML (selected only – same pattern as students now)
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (selectedIds.size === 0) {
        showErrorModal('Select at least one admin to export.');
        return;
      }
      try {
        const ids = [...selectedIds];
        const resp = await fetch('php/export-admins-xml.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        const blob = await resp.blob();
        if (!resp.ok) throw new Error('Export failed');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `admins_export_${Date.now()}.xml`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showSuccessModal('Exported XML ✅');
      } catch (err) {
        console.error('[admins] export error:', err);
        showErrorModal('Failed to export admins.');
      }
    });
  }

  // Import XML
  if (importInput) {
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('php/import-admins-xml.php', { method: 'POST', body: fd });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.success === false) {
          throw new Error(data?.message || 'Import failed');
        }
        showSuccessModal(`Import complete. Inserted ${data.inserted}, Updated ${data.updated}, Skipped ${data.skipped}.`);
        refreshAdmins();
        refreshArchivedAdmins();
      } catch (err) {
        console.error('[admins] import error:', err);
        showErrorModal(err.message || 'Failed to import admins.');
      } finally {
        importInput.value = '';
      }
    });
  }

  // Open Add Admin: render course chips (values = abbreviation), NO "No course"
  document.addEventListener('click', async (e) => {
      const openBtn = e.target.closest('#add-admin');
      if (!openBtn) return;
    
      const modalEl = document.getElementById('addAdminModal');
      if (!modalEl) return;
    
      const form = modalEl.querySelector('#addAdminForm');
      form?.reset();
    
      const chipsWrap = modalEl.querySelector('#adminCourseChips');
      const saveBtn   = modalEl.querySelector('#saveAddAdminBtn');
      if (!chipsWrap) return;
    
      try {
        const respCourses = await fetchJSON('php/get-active-courses.php?t=' + Date.now());
        const courses = Array.isArray(respCourses) ? respCourses : (respCourses?.courses || []);
        chipsWrap.innerHTML = '';
    
        if (courses.length) {
          const frag = document.createDocumentFragment();
          
          // ADD "None" option first
          const noneId = 'adm-course-none';
          const noneInput = document.createElement('input');
          noneInput.type = 'radio';
          noneInput.className = 'btn-check';
          noneInput.name = 'department';
          noneInput.id = noneId;
          noneInput.value = ''; // Empty value for "None"
          noneInput.checked = true; // Default to "None"
          
          const noneLabel = document.createElement('label');
          noneLabel.className = 'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2';
          noneLabel.setAttribute('for', noneId);
          noneLabel.innerHTML = `<strong>None</strong>`;
          
          frag.appendChild(noneInput);
          frag.appendChild(noneLabel);
    
          courses.forEach(c => {
            const id = `adm-course-${c.id}`;
            const input = document.createElement('input');
            input.type = 'radio';
            input.className = 'btn-check';
            input.name = 'department';
            input.id = id;
            input.value = _esc(c.abbreviation);
            input.required = false; // Not required since we have "None" option
    
            const label = document.createElement('label');
            label.className = 'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;
    
            frag.appendChild(input);
            frag.appendChild(label);
          });
          chipsWrap.appendChild(frag);
          if (saveBtn) saveBtn.disabled = false;
        } else {
          // Even if no courses, add "None" option
          const noneId = 'adm-course-none';
          const noneInput = document.createElement('input');
          noneInput.type = 'radio';
          noneInput.className = 'btn-check';
          noneInput.name = 'department';
          noneInput.id = noneId;
          noneInput.value = '';
          noneInput.checked = true;
          noneInput.required = false;
          
          const noneLabel = document.createElement('label');
          noneLabel.className = 'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2';
          noneLabel.setAttribute('for', noneId);
          noneLabel.innerHTML = `<strong>None</strong>`;
          
          chipsWrap.appendChild(noneInput);
          chipsWrap.appendChild(noneLabel);
          
          if (saveBtn) saveBtn.disabled = false;
        }
      } catch (err) {
        console.error('[admins] load courses error:', err);
        chipsWrap.innerHTML = `<div class="small text-danger">Failed to load courses.</div>`;
        if (saveBtn) saveBtn.disabled = true;
      }
    
      new bootstrap.Modal(modalEl).show();
    });

  // Save Add Admin
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#saveAddAdminBtn');
    if (!btn) return;

    const modalEl = document.getElementById('addAdminModal');
    const form = document.getElementById('addAdminForm');
    if (!modalEl || !form) return;

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    // payload.department = selected course abbreviation (required by radio)

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await fetchJSON('php/add-admin.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });

      if (res && res.success === false) throw new Error(res.message || 'Add failed');

      bootstrap.Modal.getInstance(modalEl)?.hide();
      showSuccessModal('Admin added ✅');
      if (typeof refreshAdmins === 'function') refreshAdmins();
      refreshArchivedAdmins();
    } catch (err) {
      console.error('[admins] add error:', err);
      showErrorModal(err?.message || 'Failed to add admin.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Admin';
    }
  });

  // Bulk archive
  if (delSelected) {
    delSelected.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      
      const confirmed = await showConfirmModal(`Archive ${selectedIds.size} admin(s)?`, 'Archive', 'Cancel');
      if (!confirmed) return;
      
      try {
        await fetchJSON('php/bulk-delete-users.php', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ ids: [...selectedIds] })
        });
        selectedIds.clear();
        selectAll.checked = false;
        updateBars();
        showSuccessModal('Selected admin(s) archived 📁');
        fetchAdmins();
        refreshArchivedAdmins();
      } catch (e) {
        console.error(e);
        showErrorModal('Failed to archive selected admin(s).');
      }
    });
  }

  // Setup cleanup for manage-users specific modals
  setupManageUsersModalCleanup();

  fetchAdmins();
  if (adminRefreshTimer) clearInterval(adminRefreshTimer);
  adminRefreshTimer = setInterval(fetchAdmins, 5000);
}

// ====== Edit Admin modal opener (chips-enabled) ======
async function openEditAdminModal(adminId) {
  const modalEl = document.getElementById('editAdminModal');
  const form    = document.getElementById('editAdminForm');
  const chips   = document.getElementById('editAdminCourseChips');
  const saveBtn = document.getElementById('saveEditAdminBtn');

  if (!modalEl || !form || !chips || !saveBtn) {
    console.warn('[edit-admin] Missing modal pieces');
    return;
  }

  form.reset();
  chips.innerHTML = '';
  saveBtn.disabled = true;

  try {
    const [respUser, respCourses] = await Promise.all([
      fetchJSON(`php/get-user.php?id=${encodeURIComponent(adminId)}&t=${Date.now()}`),
      fetchJSON('php/get-active-courses.php?t=' + Date.now())
    ]);

    const u = (respUser && respUser.success && respUser.user) ? respUser.user : respUser;
    const courses = Array.isArray(respCourses) ? respCourses : (respCourses?.courses || []);

    form.querySelector('[name="id"]').value          = u.id ?? '';
    form.querySelector('[name="first_name"]').value  = u.first_name || '';
    form.querySelector('[name="middle_name"]').value = u.middle_name || '';
    form.querySelector('[name="last_name"]').value   = u.last_name || '';
    form.querySelector('[name="suffix"]').value      = u.suffix || '';
    form.querySelector('[name="id_number"]').value   = u.id_number || '';
    form.querySelector('[name="email"]').value       = u.email || '';
    const stSel = form.querySelector('#editAdminStatus');
    if (stSel) stSel.value = u.status || 'Inactive';

    const roleRO = document.getElementById('editAdminRoleReadonly');
    if (roleRO) roleRO.value = (u.role === 'super-admin') ? 'super-admin' : 'admin';

    // FIXED: Check if admin has no department (null, undefined, or empty string)
    const hasDepartment = u.department && u.department.trim() !== '';
    
    if (courses.length) {
      const frag = document.createDocumentFragment();

      // Add "None" option first
      const noneId = 'edit-adm-course-none';
      const noneInput = document.createElement('input');
      noneInput.type = 'radio';
      noneInput.className = 'btn-check';
      noneInput.name = 'department';
      noneInput.id = noneId;
      noneInput.value = '';
      
      // Check "None" if admin has no department (null, undefined, or empty)
      if (!hasDepartment) {
        noneInput.checked = true;
      }

      const noneLabel = document.createElement('label');
      noneLabel.className = 'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2';
      noneLabel.setAttribute('for', noneId);
      noneLabel.innerHTML = `<strong>None</strong>`;

      frag.appendChild(noneInput);
      frag.appendChild(noneLabel);

      // Only check course options if admin has a department
      if (hasDepartment) {
        const currentRaw = (u.department ?? '').trim().toUpperCase();
        let resolvedAbbr = null;
        
        for (const c of courses) {
          const abbrUp = String(c.abbreviation ?? '').trim().toUpperCase();
          const nameUp = String(c.course_name ?? '').trim().toUpperCase();
          if (currentRaw && (currentRaw === abbrUp || currentRaw === nameUp)) {
            resolvedAbbr = c.abbreviation;
            break;
          }
        }

        for (const c of courses) {
          const id = `edit-adm-course-${c.id}`;
          const abbr = (c.abbreviation ?? '').trim();

          const input = document.createElement('input');
          input.type = 'radio';
          input.className = 'btn-check';
          input.name = 'department';
          input.id = id;
          input.value = abbr;
          input.required = false; // Not required since we have "None"

          const shouldCheck = (
            (resolvedAbbr && resolvedAbbr.trim().toUpperCase() === abbr.toUpperCase()) ||
            (u.department && u.department.trim().toUpperCase() === abbr.toUpperCase())
          );
          if (shouldCheck) input.checked = true;

          const label = document.createElement('label');
          label.className = 'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
          label.setAttribute('for', id);
          label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;

          frag.appendChild(input);
          frag.appendChild(label);
        }
      } else {
        // If no department, still add course options (unchecked)
        courses.forEach(c => {
          const id = `edit-adm-course-${c.id}`;
          const abbr = (c.abbreviation ?? '').trim();

          const input = document.createElement('input');
          input.type = 'radio';
          input.className = 'btn-check';
          input.name = 'department';
          input.id = id;
          input.value = abbr;
          input.required = false;

          const label = document.createElement('label');
          label.className = 'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
          label.setAttribute('for', id);
          label.innerHTML = `<strong>${_esc(c.abbreviation || '—')}</strong>`;

          frag.appendChild(input);
          frag.appendChild(label);
        });
      }

      chips.appendChild(frag);

      // Double-check: If no radio is checked (shouldn't happen), check "None"
      if (!chips.querySelector('input[name="department"]:checked')) {
        noneInput.checked = true;
      }

      saveBtn.disabled = false;
    } else {
      // Even if no courses, add "None" option
      const noneId = 'edit-adm-course-none';
      const noneInput = document.createElement('input');
      noneInput.type = 'radio';
      noneInput.className = 'btn-check';
      noneInput.name = 'department';
      noneInput.id = noneId;
      noneInput.value = '';
      noneInput.checked = true;
      noneInput.required = false;
      
      const noneLabel = document.createElement('label');
      noneLabel.className = 'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2';
      noneLabel.setAttribute('for', noneId);
      noneLabel.innerHTML = `<strong>None</strong>`;
      
      chips.appendChild(noneInput);
      chips.appendChild(noneLabel);
      
      saveBtn.disabled = false;
    }

    new bootstrap.Modal(modalEl).show();
  } catch (err) {
    console.error('[edit-admin] load error:', err);
    showErrorModal('Failed to load admin or courses.');
  }
}

// Save Edit Admin
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#saveEditAdminBtn');
  if (!btn) return;

  const modalEl = document.getElementById('editAdminModal');
  const form = document.getElementById('editAdminForm');
  if (!modalEl || !form) return;

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  payload.user_type = 'staff';
  payload.role = 'admin';
  if (payload.id) payload.id = Number(payload.id);

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await fetchJSON('php/update-admin.php', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    if (res && res.success === false) throw new Error(res.message || 'Update failed');

    bootstrap.Modal.getInstance(modalEl)?.hide();
    showSuccessModal('Admin updated ✏️');

    if (typeof refreshAdmins === 'function') refreshAdmins();
    refreshArchivedAdmins();
  } catch (err) {
    console.error('[edit-admin] save error:', err);
    showErrorModal(err?.message || 'Failed to update admin.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

// =================== Archived Students Tab ===================
let lastArchivedStudentsSnap = '';
let archivedStudentsTimer = null;
function initArchivedStudents() {
  const section = document.querySelector('#archived-students');
  if (!section || section.dataset.usersArchivedInit === 'true') return;
  section.dataset.usersArchivedInit = 'true';

  const tableBody   = section.querySelector('#archivedStudentTable tbody');
  const searchInput = section.querySelector('#archivedStudentSearch');
  const selectAll   = section.querySelector('#selectAllArchivedStudents');
  const bulkBar     = section.querySelector('#archivedStudentBulkActions');
  const restoreBtn  = section.querySelector('#restoreArchivedStudents');

  if (!tableBody || !searchInput || !selectAll || !bulkBar || !restoreBtn) {
    console.warn('[archived-students] Missing required elements.');
    return;
  }

  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#archivedStudentTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filteredData);
  });

  let rowsData = [];
  let filteredData = [];
  const selectedIds = new Set();
  const esc = _esc;

  const updateBulkUI = () => {
    if (selectedIds.size > 0) {
      bulkBar.classList.remove('d-none');
    } else {
      bulkBar.classList.add('d-none');
    }
  };

  const wireRowChecks = () => {
    section.querySelectorAll('.row-check-archived-student').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const allChecked = [...section.querySelectorAll('.row-check-archived-student')].every(c => c.checked);
        selectAll.checked = allChecked;
        updateBulkUI();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td class="text-center" style="width:36px;">
          <input type="checkbox" class="row-check-archived-student" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>${esc(row.full_name)}</td>
        <td>${esc(row.course)}</td>
        <td>${esc(row.school_year)}</td>
        <td>
          <span class="badge bg-warning">${esc(row.status || 'Archived')}</span>
        </td>
        <td class="text-end" style="min-width: 72px;">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="view" data-id="${row.id}">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-success" data-action="restore" data-id="${row.id}">
              <i class="bi bi-arrow-counterclockwise"></i> Restore
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowChecks();
    updateBulkUI();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filteredData = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.course || '').toLowerCase().includes(q) ||
      (r.school_year || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    selectedIds.clear();
    selectAll.checked = false;
    currentPage = 1;
    renderRows(filteredData);
  };

  async function fetchArchivedStudents() {
    try {
      const json = await fetchJSON(`php/get-users.php?scope=archived&user_type=student&limit=500&t=${Date.now()}`);
      const list = Array.isArray(json) ? json : (json.users || []);
      let mapped = (list || []).map(r => ({
        id: Number(r.id),
        full_name: composeName(r),
        course: r.department || '',
        school_year: r.school_year || '',
        status: r.status || 'Archived'
      }));
      // Keep only truly archived status if your backend uses it
      mapped = mapped.filter(r => (r.status || '').toLowerCase() === 'archived');

      const snap = JSON.stringify(mapped);
      
      // Only update if data actually changed
      if (snap === lastArchivedStudentsSnap) return;
      lastArchivedStudentsSnap = snap;
      
      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));
      
      applyFilter();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (e) {
      console.error('[archived-students] load error:', e);
      // Don't clear table on error
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load archived students.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  archivedStudentsFetchFn = fetchArchivedStudents;

  // header select all
  selectAll.addEventListener('change', () => {
    selectedIds.clear();
    section.querySelectorAll('.row-check-archived-student').forEach(chk => {
      chk.checked = selectAll.checked;
      if (chk.checked) selectedIds.add(Number(chk.dataset.id));
    });
    updateBulkUI();
  });

  // search
  searchInput.addEventListener('input', debounce(applyFilter, 120));

  // row click actions
  section.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'view') {
      openUserModal(id, 'archived-students');
    } else if (action === 'restore') {
      const confirmed = await showConfirmModal('Restore this archived student?', 'Restore', 'Cancel');
      if (!confirmed) return;
      await bulkRestore([id]);
    }
  });

  // bulk restore button
  restoreBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    
    const confirmed = await showConfirmModal(`Restore ${selectedIds.size} archived student(s)?`, 'Restore', 'Cancel');
    if (!confirmed) return;
    
    await bulkRestore([...selectedIds]);
  });

  async function bulkRestore(ids) {
    try {
      const res = await fetchJSON('php/bulk-restore-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids })
      });
      showSuccessModal(res.message || `Restored ${res.updated ?? ids.length} student(s) ✅`);
      selectedIds.clear();
      await fetchArchivedStudents();
      // also refresh other tabs
      refreshManage();
      refreshPending();
      refreshActive();
    } catch (e) {
      console.error('[archived-students] restore error:', e);
      showErrorModal(e.message || 'Failed to restore students.');
    }
  }

  fetchArchivedStudents();
  if (archivedStudentsTimer) clearInterval(archivedStudentsTimer);
  archivedStudentsTimer = setInterval(fetchArchivedStudents, 10000);
}

// =================== Archived Admins Tab ===================
let lastArchivedAdminsSnap = '';
let archivedAdminsTimer = null;
function initArchivedAdmins() {
  const section = document.querySelector('#archived-admins');
  if (!section || section.dataset.usersArchivedAdminsInit === 'true') return;
  section.dataset.usersArchivedAdminsInit = 'true';

  const tableBody   = section.querySelector('#archivedAdminTable tbody');
  const searchInput = section.querySelector('#archivedAdminSearch');
  const selectAll   = section.querySelector('#selectAllArchivedAdmins');
  const bulkBar     = section.querySelector('#archivedAdminBulkActions');
  const restoreBtn  = section.querySelector('#restoreArchivedAdmins');

  if (!tableBody || !searchInput || !selectAll || !bulkBar || !restoreBtn) {
    console.warn('[archived-admins] Missing required elements.');
    return;
  }

  const pageSize = 10;
  let currentPage = 1;
  let totalPages = 1;
  const pager = createPaginator(section, '#archivedAdminTable', (dir) => {
    if (dir === 'prev' && currentPage > 1) currentPage--;
    else if (dir === 'next' && currentPage < totalPages) currentPage++;
    renderRows(filtered);
  });

  let rowsData = [];
  let filtered = [];
  const selectedIds = new Set();
  const esc = _esc;

  const updateBulkUI = () => {
    if (selectedIds.size > 0) {
      bulkBar.classList.remove('d-none');
    } else {
      bulkBar.classList.add('d-none');
    }
  };

  const wireRowChecks = () => {
    section.querySelectorAll('.row-check-archived-admin').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const allChecked = [...section.querySelectorAll('.row-check-archived-admin')].every(c => c.checked);
        selectAll.checked = allChecked;
        updateBulkUI();
      });
    });
  };

  const renderRows = (data) => {
    const totalItems = data.length;
    totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * pageSize;
    const pageSlice = data.slice(start, start + pageSize);

    tableBody.innerHTML = '';
    pageSlice.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td class="text-center">
          <input type="checkbox" class="row-check-archived-admin" data-id="${row.id}" ${selectedIds.has(row.id) ? 'checked' : ''}>
        </td>
        <td>${row.id}</td>
        <td>${esc(row.full_name)}</td>
        <td>${esc(row.email)}</td>
        <td><span class="badge ${row.role === 'super-admin' ? 'bg-dark' : 'bg-info-subtle text-dark'}">${esc(row.role || '—')}</span></td>
        <td><span class="badge bg-warning">${esc(row.status || 'Archived')}</span></td>
        <td class="text-end" style="min-width: 72px;">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="view" data-id="${row.id}">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-success" data-action="restore" data-id="${row.id}">
              <i class="bi bi-arrow-counterclockwise"></i> Restore
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
    wireRowChecks();
    updateBulkUI();
    updatePaginator(pager, currentPage, totalPages, totalItems);
  };

  const applyFilter = () => {
    const q = searchInput.value.trim().toLowerCase();
    filtered = rowsData.filter(r =>
      String(r.id).includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.role || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    );
    selectedIds.clear();
    selectAll.checked = false;
    currentPage = 1;
    renderRows(filtered);
  };

  async function fetchArchivedAdmins() {
    try {
      const json = await fetchJSON(`php/get-users.php?scope=archived&user_type=staff&limit=500&t=${Date.now()}`);
      const list = Array.isArray(json) ? json : (json.users || []);
      let mapped = (list || []).map(r => ({
        id: Number(r.id),
        full_name: composeName(r),
        email: r.email || '',
        role: r.role || 'admin',
        status: r.status || 'Archived'
      }));
      mapped = mapped.filter(r => (r.status || '').toLowerCase() === 'archived');

      const snap = JSON.stringify(mapped);
      
      // Only update if data actually changed
      if (snap === lastArchivedAdminsSnap) return;
      lastArchivedAdminsSnap = snap;
      
      // Store current scroll position
      const scrollY = window.scrollY;
      
      // Preserve selected IDs if they still exist in new data
      const newSelectedIds = new Set();
      rowsData = mapped;
      
      // Re-add selection if the user still exists
      selectedIds.forEach(id => {
        if (rowsData.find(r => r.id === id)) {
          newSelectedIds.add(id);
        }
      });
      selectedIds.clear();
      newSelectedIds.forEach(id => selectedIds.add(id));
      
      applyFilter();
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    } catch (e) {
      console.error('[archived-admins] load error:', e);
      // Don't clear table on error
      if (tableBody.children.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load archived admins.</td></tr>`;
      }
      updatePaginator(pager, 1, 1, 0);
    }
  }
  archivedAdminsFetchFn = fetchArchivedAdmins;

  // header select all
  selectAll.addEventListener('change', () => {
    selectedIds.clear();
    section.querySelectorAll('.row-check-archived-admin').forEach(chk => {
      chk.checked = selectAll.checked;
      if (chk.checked) selectedIds.add(Number(chk.dataset.id));
    });
    updateBulkUI();
  });

  // search
  searchInput.addEventListener('input', debounce(applyFilter, 120));

  // row actions
  section.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'view') {
      openUserModal(id, 'archived-admins');
    } else if (action === 'restore') {
      const confirmed = await showConfirmModal('Restore this archived admin?', 'Restore', 'Cancel');
      if (!confirmed) return;
      await bulkRestore([id]);
    }
  });

  // bulk restore button
  restoreBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    
    const confirmed = await showConfirmModal(`Restore ${selectedIds.size} archived admin(s)?`, 'Restore', 'Cancel');
    if (!confirmed) return;
    
    await bulkRestore([...selectedIds]);
  });

  async function bulkRestore(ids) {
    try {
      const res = await fetchJSON('php/bulk-restore-users.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ids })
      });
      showSuccessModal(res.message || `Restored ${res.updated ?? ids.length} admin(s) ✅`);
      selectedIds.clear();
      await fetchArchivedAdmins();
      refreshAdmins();
    } catch (e) {
      console.error('[archived-admins] restore error:', e);
      showErrorModal(e.message || 'Failed to restore admins.');
    }
  }

  fetchArchivedAdmins();
  if (archivedAdminsTimer) clearInterval(archivedAdminsTimer);
  archivedAdminsTimer = setInterval(fetchArchivedAdmins, 10000);
}

// =================== Single merged observer ===================
document.addEventListener('DOMContentLoaded', () => {
  // Don't call setupModalCleanup() here - it's already in the main HTML
  // Just set up the view user modal once
  setupViewUserModalOnce();

  const runInitsOnce = () => {
    const pendingTab = document.querySelector('#pending-students');
    if (pendingTab && pendingTab.dataset.usersInit !== 'true') {
      lastPendingUsers = '';
      initManageUsers();
      console.log('Manage Users (Pending) initialized ✅');
    }

    const activeTab = document.querySelector('#active-students');
    if (activeTab && activeTab.dataset.usersActiveInit !== 'true') {
      lastActiveStudents = '';
      initActiveStudents();
      console.log('Manage Users (Active) initialized ✅');
    }

    const manageTab = document.querySelector('#manage-students');
    if (manageTab && manageTab.dataset.usersManageInit !== 'true') {
      lastManageStudents = '';
      initManageStudents();
      console.log('Manage Users (Manage Students) initialized ✅');
    }

    const adminTab = document.querySelector('#manage-admin');
    if (adminTab && adminTab.dataset.usersAdminInit !== 'true') {
      lastAdminsSnap = '';
      initManageAdmins();
      console.log('Manage Users (Manage Admin) initialized ✅');
    }

    const archivedStudentsTab = document.querySelector('#archived-students');
    if (archivedStudentsTab && archivedStudentsTab.dataset.usersArchivedInit !== 'true') {
      lastArchivedStudentsSnap = '';
      initArchivedStudents();
      console.log('Manage Users (Archived Students) initialized ✅');
    }

    const archivedAdminsTab = document.querySelector('#archived-admins');
    if (archivedAdminsTab && archivedAdminsTab.dataset.usersArchivedAdminsInit !== 'true') {
      lastArchivedAdminsSnap = '';
      initArchivedAdmins();
      console.log('Manage Users (Archived Admins) initialized ✅');
    }
  };

  const contentArea = document.getElementById('content-area');
  if (contentArea) {
    const observer = new MutationObserver(runInitsOnce);
    observer.observe(contentArea, { childList: true, subtree: true });
    // Trigger once immediately (in case content is already present)
    runInitsOnce();
  } else {
    // Fallback for standalone pages
    runInitsOnce();
  }
});