//notification.js
document.addEventListener('DOMContentLoaded', function () {
  (function () {
    const bellButton = document.getElementById('bellButton');
    const bellIcon   = document.getElementById('bellIcon');
    const panel      = document.getElementById('notifPanel');
    const overlay    = document.getElementById('notifOverlay');
    const closeBtn   = document.getElementById('notifCloseBtn');
    const list       = document.getElementById('notifList');
    const notifDot   = document.getElementById('notifDot');

    const missing = [];
    if (!bellButton) missing.push('#bellButton');
    if (!bellIcon)   missing.push('#bellIcon');
    if (!panel)      missing.push('#notifPanel');
    if (!overlay)    missing.push('#notifOverlay');
    if (!list)       missing.push('#notifList');
    if (!notifDot)   missing.push('#notifDot');
    if (missing.length) {
      console.warn('[Notif] Missing elements:', missing.join(', '));
      return;
    }

    // ---------- NOTIF TYPE CONSTANTS ----------
    const NOTIF_TYPES = {
      REGISTRATION:   'registration',
      ACADEMIC_YEAR:  'academic-year',
      GENERAL:        'general',
      ANNOUNCEMENT:   'announcement',
      ACCREDITATION:  'accreditation'
    };

    // ---------- Shared Modals ----------
    function showSuccessModal(message) {
      const msgEl = document.getElementById('successDialogue');
      const modalEl = document.getElementById('statusSuccessModal');
      if (!msgEl || !modalEl) { console.warn('[users] Success modal missing'); return; }
      msgEl.textContent = message;
      const modal = new bootstrap.Modal(modalEl);
      modalEl.addEventListener("hidden.bs.modal", () => {
        document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
      }, { once: true });
      modal.show();
    }

    function showErrorModal(message) {
      const msgEl = document.getElementById('errorDialogue');
      const modalEl = document.getElementById('statusErrorsModal');
      if (!msgEl || !modalEl) { console.warn('[users] Error modal missing'); return; }
      msgEl.textContent = message;
      const modal = new bootstrap.Modal(modalEl);
      modalEl.addEventListener("hidden.bs.modal", () => {
        document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
        document.body.classList.remove("modal-open");
        document.body.style.overflow = "";
      }, { once: true });
      modal.show();
    }

    // ---------- helpers ----------
    function escapeHtml(s){
      return String(s || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
    }
    function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;'); }

    // Helper to fetch JSON
    function fetchJSON(url, options = {}) {
      return fetch(url, {
        credentials: 'same-origin',
        ...options
      }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    }

    // Get current user role
    function getCurrentUserRole() {
      const rawRole = localStorage.getItem('role') || '';
      return rawRole.trim().toLowerCase().replace(/[\s_]+/g, '-');
    }

    // Time formatting
    function formatTimeAgoFromEpoch(sec) {
      const now = Date.now();
      const diffMs = now - (sec * 1000);
      const secAbs = Math.max(0, Math.floor(diffMs / 1000));
      const m = Math.floor(secAbs / 60);
      const h = Math.floor(secAbs / 3600);
      const d = Math.floor(secAbs / 86400);
      const w = Math.floor(secAbs / 604800);

      if (secAbs < 30) return 'just now';
      if (secAbs < 60) return `${secAbs}s`;
      if (m < 60)      return `${m}m`;
      if (h < 24)      return `${h}h`;
      if (d < 7)       return `${d}d`;
      return `${w}w`;
    }
    
    function parseMySqlTimestampToEpoch(ts) {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(ts);
      if (!m) return null;
      const [_, Y, Mo, D, H, Mi, S] = m;
      const dt = new Date(
        Number(Y),
        Number(Mo) - 1,
        Number(D),
        Number(H),
        Number(Mi),
        Number(S || 0),
        0
      );
      return Math.floor(dt.getTime() / 1000);
    }
    
    function displayTime(n) {
      if (typeof n.created_ts === 'number') return formatTimeAgoFromEpoch(n.created_ts);
      if (n.created_at) {
        const epoch = parseMySqlTimestampToEpoch(n.created_at);
        if (epoch) return formatTimeAgoFromEpoch(epoch);
      }
      return n.time_ago || n.created_at || '';
    }

    function pickUserLocators(n) {
      const userId =
        n.user_id ?? n.userId ?? n.meta?.user_id ?? n.payload?.user_id ?? '';
      const idNumber =
        n.user_id_number ?? n.id_number ?? n.meta?.id_number ?? n.payload?.id_number ?? '';
      return { userId, idNumber };
    }

    function isUnread(n) {
      if (n == null || typeof n !== 'object') return false;

      if ('read_at' in n) {
        if (n.read_at === null || n.read_at === '' || typeof n.read_at === 'undefined') return true;
        return false;
      }

      if ('is_read' in n) {
        const v = n.is_read;
        if (v === 0 || v === '0' || v === false) return true;
        if (v === 1 || v === '1' || v === true)  return false;
      }

      if (typeof n.status === 'string') {
        const s = n.status.toLowerCase();
        if (s === 'unread') return true;
        if (s === 'read')   return false;
      }

      return false;
    }

    function updateBellDot(items){
      const count = (items || []).filter(isUnread).length;
      notifDot.style.display = count > 0 ? 'block' : 'none';
      bellButton.setAttribute('aria-label', count > 0 ? `Notifications (${count} unread)` : 'Notifications');
    }

    function renderNotifications(items){
      if (!Array.isArray(items) || items.length === 0){
        list.innerHTML = `<div class="text-center text-muted py-4">No new notifications</div>`;
        notifDot.style.display = 'none';
        return;
      }

      list.innerHTML = items.map(n => {
        const unread = isUnread(n);
        const nid    = n.id ?? '';
        const { userId, idNumber } = pickUserLocators(n);
        const notifType  = (n.notif_type || '').toLowerCase();
        
        // FIX: Use payload_id for announcement notifications
        const payloadId = n.payload_id || nid;

        return `
          <button type="button"
            class="card border-0 border-bottom rounded-0 py-2 px-2 text-start notif-item ${unread ? 'unread' : ''}"
            data-notif-id="${escapeAttr(nid)}"
            data-payload-id="${escapeAttr(payloadId)}"
            data-user-id="${escapeAttr(userId)}"
            data-id-number="${escapeAttr(idNumber)}"
            data-notif-type="${escapeAttr(notifType)}">
            <div class="d-flex">
              <div class="flex-grow-1 pe-2">
                <div class="fw-semibold">${escapeHtml(n.title ?? 'Notification')}</div>
                <div class="small text-muted">${escapeHtml(n.body ?? n.message ?? '')}</div>
              </div>
              <span class="small text-nowrap text-muted">${escapeHtml(displayTime(n))}</span>
            </div>
          </button>`;
      }).join('');

      const domUnread = list.querySelectorAll('.notif-item.unread').length;
      notifDot.style.display = domUnread > 0 ? 'block' : 'none';
    }

    // --- helper: POST mark-as-read (DB) ---
    function markNotificationRead(notifId){
      const idNum = Number(notifId);
      if (!Number.isInteger(idNum) || idNum <= 0) return Promise.resolve(false);

      return fetch('php/mark-notification-read.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: 'id=' + encodeURIComponent(String(idNum))
      })
      .then(r => r.json())
      .then(j => !!(j && j.success))
      .catch(() => false);
    }

    // --- helper: UPDATE announcement status (Active / Rejected / etc.) ---
    function updateAnnouncementStatus(id, status, reason = '') {
      const idNum = Number(id);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        return Promise.resolve(false);
      }

      const params = new URLSearchParams();
      params.append('id', String(idNum));
      params.append('status', status);
      if (typeof reason === 'string') {
        params.append('reason', reason);
      }

      return fetch('php/update-announcement-status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body: params.toString()
      })
        .then(r => r.json())
        .then(j => !!(j && j.success))
        .catch(() => false);
    }

    // --- helper: UPDATE user status (Active / Inactive / Archived) ---
    function updateUserStatus(userId, status, idNumber = '') {
      const idNum = Number(userId);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        return Promise.resolve(false);
      }

      const params = new URLSearchParams();
      params.append('id', String(idNum));
      params.append('status', status);
      if (idNumber) {
        params.append('id_number', idNumber);
      }

      return fetch('php/update-user-status.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body: params.toString()
      })
        .then(r => r.json())
        .then(j => !!(j && j.success))
        .catch(() => false);
    }

    // ---------- Auto-refresh functionality ----------
    let refreshInterval = null;
    let latestNotificationId = 0;
    let isPanelOpen = false;

    function fetchNotifications(sinceId = 0) {
      let url = 'php/get-notifications.php?t=' + Date.now();
      if (sinceId > 0) {
        url += '&after_id=' + sinceId;
      }
      
      return fetch(url, { credentials: 'same-origin' })
        .then(r => r.json())
        .then(json => {
          const items = Array.isArray(json) ? json : (json.notifications || []);
          // Update latest ID for polling
          if (json.latest_id && json.latest_id > latestNotificationId) {
            latestNotificationId = json.latest_id;
          }
          return items;
        })
        .catch(err => {
          console.error('[Notif] fetch error:', err);
          return [];
        });
    }

    function refreshNotifications(forceUpdate = false) {
      fetchNotifications(latestNotificationId).then(items => {
        if (items.length > 0) {
          // If panel is open, refresh the list
          if (isPanelOpen) {
            // Get current items and merge with new ones
            fetchNotifications(0).then(allItems => {
              renderNotifications(allItems);
              updateBellDot(allItems);
            });
          } else {
            // Just update the dot
            fetchNotifications(0).then(allItems => {
              updateBellDot(allItems);
            });
          }
          
          // Show subtle desktop notification if new items
          if (forceUpdate && items.length > 0 && !isPanelOpen) {
            showDesktopNotification(items.length);
          }
        }
      });
    }

    function showDesktopNotification(count) {
      if (!("Notification" in window)) return;
      
      if (Notification.permission === "granted") {
        new Notification(`You have ${count} new notification${count > 1 ? 's' : ''}`);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
          if (permission === "granted") {
            new Notification(`You have ${count} new notification${count > 1 ? 's' : ''}`);
          }
        });
      }
    }

    // ---------- open/close panel ----------
    function openPanel(){
      panel.classList.add('open');
      overlay.hidden = false;
      overlay.getBoundingClientRect();
      overlay.classList.add('show');

      bellButton.setAttribute('aria-expanded', 'true');
      panel.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      panel.focus();

      // icon -> filled when open
      bellIcon.classList.remove('bi-bell');
      bellIcon.classList.add('bi-bell-fill');

      isPanelOpen = true;

      // fetch & render notifications
      fetchNotifications(0).then(items => {
        renderNotifications(items);
        updateBellDot(items);
      });
    }

    function closePanel(){
      panel.classList.remove('open');
      overlay.classList.remove('show');
      bellButton.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      setTimeout(() => { overlay.hidden = true; }, 200);
      bellButton.focus();

      // icon -> outline when closed
      bellIcon.classList.remove('bi-bell-fill');
      bellIcon.classList.add('bi-bell');

      isPanelOpen = false;
    }

    bellButton.addEventListener('click', (e) => {
      e.preventDefault();
      panel.classList.contains('open') ? closePanel() : openPanel();
    });
    closeBtn?.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // ---------- Helper functions from manage-accreditation.js ----------
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

    const pretty = (s) => {
      const raw = String(s || '').trim();
      if (!raw) return '—';
      const low = raw.toLowerCase();
      const map = {
        reaccreditation: 'Reaccreditation',
        new: 'New Accreditation',
        submitted: 'Submitted',
        approved: 'Approved',
        declined: 'Returned',
        pending: 'Pending',
        accredited: 'Accredited',
        reaccredited: 'Reaccredited',
        reviewed: 'Reviewed',
        'for reaccreditation': 'For Reaccreditation',
        'for accreditation': 'For Accreditation',
        application_letter: 'Application Letter',
        bank_passbook: 'Bank Passbook',
        certificate: 'Certificate of Accreditation',
        certificate_accreditation: 'Certificate of Accreditation',
        cbl: 'CBL',
        officers_list: 'Officers List',
        updated_list: 'Updated Officers List',
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

    const normAY = ({ start, end, single } = {}) => {
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
    };

    const normalizeStatus = (st) => String(st || '').trim().toLowerCase();

    // Required sets for checking if all files are approved
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

    // Check if all reaccreditation documents are approved
    function isAllReaccrApprovedDOM() {
      const docsWrap = document.getElementById('accrDocsWrap');
      if (!docsWrap) return false;
      
      const drows = docsWrap.querySelectorAll('.accr-doc-row') || [];
      const byType = {};
      
      drows.forEach((r) => {
        if ((r.dataset.docGroup || '').toLowerCase() !== 'reaccreditation') return;
        const type = (r.dataset.docType || '').toLowerCase();
        const st = (r.querySelector('[data-doc-status]')?.textContent || '').toLowerCase().trim();
        
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
          : !!byType[t] && byType[t].approved
      );
    }

    // Check if all new accreditation documents are approved
    function isAllNewApprovedDOM() {
      const docsWrap = document.getElementById('accrDocsWrap');
      if (!docsWrap) return false;
      
      const drows = docsWrap.querySelectorAll('.accr-doc-row') || [];
      const byType = {};
      
      drows.forEach((r) => {
        if ((r.dataset.docGroup || '').toLowerCase() !== 'new') return;
        const type = (r.dataset.docType || '').toLowerCase();
        const st = (r.querySelector('[data-doc-status]')?.textContent || '').toLowerCase().trim();
        
        if (!byType[type]) byType[type] = { approved: false };
        if (st === 'approved') byType[type].approved = true;
      });
      
      return NEW_STATUS_REQUIRED_TYPES.every(
        (t) => !!byType[t] && byType[t].approved
      );
    }

    // Check if AY matches
    function ayEqual(a, b) {
      if (!a || !b) return false;
      if (a.start != null && a.end != null && b.start != null && b.end != null) {
        return Number(a.start) === Number(b.start) && Number(a.end) === Number(b.end);
      }
      if (a.single != null && b.single != null) return Number(a.single) === Number(b.single);
      return a.label === b.label && a.label !== '—';
    }

    // ---------- click a notification -> action depends on type ----------
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.notif-item');
      if (!card) return;

      const rawId     = card.dataset.notifId || '';
      const payloadId = card.dataset.payloadId || ''; // Use payload_id for announcements and accreditation
      const notifId   = Number(rawId);
      const userId    = card.dataset.userId || '';
      const idNum     = card.dataset.idNumber || '';
      const notifType = (card.dataset.notifType || '').toLowerCase();

      // Use payloadId if available (for announcements and accreditation)
      const targetId = (notifType === NOTIF_TYPES.ANNOUNCEMENT || notifType === NOTIF_TYPES.ACCREDITATION) && payloadId ? payloadId : rawId;

      if (!Number.isInteger(notifId) || notifId <= 0) {
        console.warn('[Notif] invalid notifId on click:', rawId);
        return;
      }

      // 1) Optimistic UI change
      card.classList.remove('unread');
      notifDot.style.display = list.querySelector('.notif-item.unread') ? 'block' : 'none';

      // 2) Persist to server
      markNotificationRead(notifId).then(ok => {
        if (!ok) {
          console.warn('[Notif] mark-as-read failed for id', notifId);
        }
      });

      // 3) Behavior based on notif type
      if (notifType === NOTIF_TYPES.REGISTRATION) {
        if (userId)      openUserViewById(userId);
        else if (idNum)  openUserViewByIdNumber(idNum);
        else             console.warn('[Notif click] Registration notif but no user locator in dataset.');

      } else if (notifType === NOTIF_TYPES.ANNOUNCEMENT) {
        // FIX: Use targetId (which is payload_id) for fetching announcement
        const announcementId = targetId;
        
        const bodyEl  = document.getElementById('viewAnnouncementBody');
        const modalEl = document.getElementById('viewAnnouncementModal');

        if (bodyEl) {
          bodyEl.innerHTML = '<div class="text-center text-muted py-4">Loading...</div>';
        }

        fetch(
          'php/get-announcement.php?id=' +
            encodeURIComponent(announcementId) +
            '&t=' + Date.now(),
          { credentials: 'include' }
        )
          .then(r => r.json())
          .then(data => {
            if (!data || data.success === false) {
              if (bodyEl) {
                bodyEl.innerHTML = `
                  <div class="alert alert-danger mb-0">
                    ${escapeHtml(data?.message || 'Failed to load announcement.')}
                  </div>
                `;
              }
              if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const m = bootstrap.Modal.getOrCreateInstance(modalEl);
                m.show();
              }
              return;
            }

            const a = data.announcement || data;
            // FIX: Verify we got the correct announcement
            console.log('Fetched announcement ID:', a.id, 'Requested ID:', announcementId);
            
            const imgSrc = a.image_path || 'assets/images/image-add.png';

            // Attachments
            const docsHtml =
              Array.isArray(a.documents) && a.documents.length
                ? a.documents
                    .map(
                      d => `
                        <li class="list-group-item py-1">
                          <a href="${escapeHtml(d.path)}" target="_blank">
                            <i class="bi bi-paperclip me-1"></i>
                            ${escapeHtml(d.name || d.path)}
                          </a>
                        </li>
                      `
                    )
                    .join('')
                : '<li class="list-group-item py-1 text-muted">No attachments</li>';

            // Status badge
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

            // SY text
            const syText =
              a.start_year && a.end_year
                ? `${a.start_year} - ${a.end_year}`
                : '—';

            // Active year
            const activeYearText = a.active_year || '—';

            // Audience badge (if helper exists)
            const audBadge =
              typeof window.audienceBadgeHtml === 'function'
                ? window.audienceBadgeHtml(a.audience_scope, a.course_abbr)
                : '';

            // Get current user role
            const currentUserRole = getCurrentUserRole();

            // Helper to render the body with optional action buttons HTML
            function renderAnnouncementBody(actionButtonsHtml) {
              if (bodyEl) {
                bodyEl.innerHTML = `
                  <div class="d-flex justify-content-between align-items-start mb-3">
                    <div class="d-flex gap-3">
                      <img src="${escapeHtml(imgSrc)}"
                          alt="announcement image"
                          class="rounded"
                          style="width:110px;height:110px;object-fit:cover;">
                      <div class="flex-grow-1">
                        <h4 class="mb-1">${escapeHtml(a.title || 'Untitled')}</h4>

                        <div class="d-flex flex-wrap gap-2 mb-2">
                          <span class="badge ${statusBadge}" data-role="announcement-status-badge">
                            ${escapeHtml(a.status || '—')}
                          </span>
                          <span class="badge bg-light text-dark">
                            <i class="bi bi-tag me-1"></i>${escapeHtml(a.category || '—')}
                          </span>
                          ${audBadge}
                        </div>

                        <p class="mb-1 small text-muted">
                          <i class="bi bi-person-circle me-1"></i>
                          ${escapeHtml(a.author_name || '—')}
                        </p>
                        <p class="mb-1 small text-muted">
                          <i class="bi bi-calendar3 me-1"></i>
                          ${escapeHtml(a.created_at || '—')}
                        </p>

                        <p class="mb-0 small text-muted">
                          <i class="bi bi-journal-bookmark me-1"></i>
                          <strong>SY:</strong> ${escapeHtml(syText)}<br>
                          <i class="bi bi-book-half me-1"></i>
                          <strong>Active Year:</strong> ${escapeHtml(activeYearText)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div class="mb-3">
                    <h6 class="mb-2">Description</h6>
                    <div class="border rounded p-2 bg-light small" style="white-space:pre-wrap;">
                      ${escapeHtml(a.description || 'No description')}
                    </div>
                  </div>

                  <div>
                    <h6 class="mb-2">Attachments</h6>
                    <ul class="list-group list-group-flush">
                      ${docsHtml}
                    </ul>
                  </div>

                  ${
                    a.edit_allowed === false
                      ? `
                        <div class="alert alert-warning mt-3 mb-0 py-2 small">
                          <i class="bi bi-lock-fill me-1"></i>
                          You can view this announcement but you are not allowed to edit it.
                        </div>`
                      : ''
                  }
                  ${
                    actionButtonsHtml
                      ? `
                        <div class="d-flex justify-content-end mt-3">
                          ${actionButtonsHtml}
                        </div>
                      `
                      : ''
                  }
                `;
              }

              if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const m = bootstrap.Modal.getOrCreateInstance(modalEl);
                m.show();
              }
            }

            // If not super-admin, no action buttons at all
            if (currentUserRole !== 'super-admin') {
              console.log('[Announcement] currentUserRole is not super-admin:', currentUserRole);
              renderAnnouncementBody('');
              return;
            }

            // Super-admin → check active academic year to enable/disable buttons
            fetch('php/get-active-academic-year-row.php?t=' + Date.now(), {
              credentials: 'include'
            })
              .then(r => r.json())
              .then(ayData => {
                let enabled = false;

                // Preferred: compare start_year, end_year, active_year directly
                if (
                  ayData &&
                  ayData.start_year &&
                  ayData.end_year &&
                  ayData.active_year &&
                  a.start_year &&
                  a.end_year &&
                  a.active_year
                ) {
                  enabled =
                    String(ayData.start_year)  === String(a.start_year) &&
                    String(ayData.end_year)    === String(a.end_year)   &&
                    String(ayData.active_year) === String(a.active_year);
                }
                // Fallback: if backend also returns school_year
                else if (
                  ayData &&
                  ayData.school_year &&
                  a.start_year &&
                  a.end_year
                ) {
                  const ayStr = String(ayData.school_year).replace(/\s+/g, '');
                  const annStr1 = `${a.start_year}-${a.end_year}`.replace(/\s+/g, '');
                  const annStr2 = `${a.start_year} - ${a.end_year}`.replace(/\s+/g, '');
                  if (ayStr === annStr1 || ayStr === annStr2) {
                    if (ayData.active_year && a.active_year) {
                      enabled = String(ayData.active_year) === String(a.active_year);
                    } else {
                      enabled = true;
                    }
                  }
                }

                console.log('[Announcement] Buttons enabled?', enabled);

                const idStr = escapeHtml(String(a.id ?? ''));

                let actionButtonsHtml;
                if (enabled) {
                  actionButtonsHtml = `
                    <div class="btn-group btn-group-sm">
                      <button class="btn btn-success acceptBtn" data-id="${idStr}">
                        <i class="bi bi-check-circle me-1"></i>Accept
                      </button>
                      <button class="btn btn-danger declineBtn" data-id="${idStr}">
                        <i class="bi bi-x-circle me-1"></i>Decline
                      </button>
                    </div>`;
                } else {
                  actionButtonsHtml = `
                    <div class="btn-group btn-group-sm" style="opacity:.5; pointer-events:none;">
                      <button class="btn btn-success acceptBtn" disabled data-id="${idStr}">
                        <i class="bi bi-check-circle me-1"></i>Accept
                      </button>
                      <button class="btn btn-danger declineBtn" disabled data-id="${idStr}">
                        <i class="bi bi-x-circle me-1"></i>Decline
                      </button>
                    </div>`;
                }

                renderAnnouncementBody(actionButtonsHtml);
              })
              .catch(err => {
                console.error('[Announcement] active AY fetch error:', err);
                // Fallback: show disabled buttons if we can't verify AY
                const idStr = escapeHtml(String(a.id ?? ''));
                const actionButtonsHtml = `
                  <div class="btn-group btn-group-sm" style="opacity:.5; pointer-events:none;">
                    <button class="btn btn-success acceptBtn" disabled data-id="${idStr}">
                      <i class="bi bi-check-circle me-1"></i>Accept
                    </button>
                    <button class="btn btn-danger declineBtn" disabled data-id="${idStr}">
                      <i class="bi bi-x-circle me-1"></i>Decline
                    </button>
                  </div>`;
                renderAnnouncementBody(actionButtonsHtml);
              });
          })
          .catch(err => {
            console.error('[Announcement] fetch error:', err);
            const bodyEl2 = document.getElementById('viewAnnouncementBody');
            const modalEl2 = document.getElementById('viewAnnouncementModal');

            if (bodyEl2) {
              bodyEl2.innerHTML = `
                <div class="alert alert-danger mb-0">
                  Failed to load announcement details.
                </div>`;
            }
            if (modalEl2 && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
              const m = bootstrap.Modal.getOrCreateInstance(modalEl2);
              m.show();
            }
          });

      } else if (notifType === NOTIF_TYPES.ACCREDITATION) {
        // ========== ACCREDITATION NOTIFICATION HANDLING ==========
        const orgId = payloadId || targetId;
        const currentUserRole = getCurrentUserRole();
        
        console.log('[Accr Notif] Opening accreditation details for org ID:', orgId, 'User role:', currentUserRole);
        
        // First, check if the accreditation management modal exists
        const accrModalEl = document.getElementById('accrDetailsModal');
        if (!accrModalEl) {
          console.warn('[Accr Notif] accrDetailsModal not found in DOM');
          showErrorModal('Accreditation management modal not available.');
          closePanel();
          return;
        }
        
        // Fetch organization details
        fetch(`php/get-organization.php?id=${encodeURIComponent(orgId)}&t=${Date.now()}`, {
          credentials: 'include'
        })
          .then(r => r.json())
          .then(data => {
            if (!data || !data.success) {
              showErrorModal('Failed to load organization details.');
              return;
            }
            
            const org = data.org || {};
            const files = data.files || [];
            const currentUserRole = getCurrentUserRole();
            
            console.log('[Accr Notif] Loaded organization:', org.name);
            
            // Get modal elements
            const orgNameEl = document.getElementById('accrOrgName');
            const scopeBadge = document.getElementById('accrScopeBadge');
            const courseAbbrEl = document.getElementById('accrCourseAbbr');
            const yearEl = document.getElementById('accrYear');
            const statusEl = document.getElementById('accrStatus');
            const orgLogoEl = document.getElementById('accrOrgLogo');
            const orgAbbrEl = document.getElementById('accrOrgAbbr');
            const docsWrap = document.getElementById('accrDocsWrap');
            const openReaccr = document.getElementById('openReaccrBtn');
            const accreditOrgBtn = document.getElementById('accreditOrgBtn');
            const reaccreditOrgBtn = document.getElementById('reaccreditOrgBtn');
            const bulkSelectAll = document.getElementById('accrBulkSelectAll');
            const bulkApproveBtn = document.getElementById('accrBulkApproveBtn');
            const bulkDeclineBtn = document.getElementById('accrBulkDeclineBtn');
            const bulkReturnBtn = document.getElementById('accrBulkReturnBtn');
            
            // ===== NEW: Modal references for review functionality =====
            let bulkReviewBtn = null;
            let reviewConfirmModal = null;
            let confirmReviewBtn = null;
            let reviewModalInstance = null;
            
            // Populate basic org info
            if (orgNameEl) orgNameEl.textContent = org.name || '—';
            if (scopeBadge) scopeBadge.textContent = org.scope || '—';
            if (courseAbbrEl) {
              courseAbbrEl.textContent = org.scope === 'exclusive' ? org.course_abbr || '—' : '—';
            }
            
            // Year display
            if (yearEl) {
              const ay = normAY({
                start: org.start_year,
                end: org.end_year,
                single: org.active_year
              });
              yearEl.textContent = ay.label || '—';
            }
            
            // Status badge
            if (statusEl) {
              statusEl.textContent = pretty(org.status || '—');
              statusEl.className = `badge ${statusBadgeClass(org.status)}`;
            }
            
            // Logo
            if (orgLogoEl) {
              if (org.logo_path) {
                orgLogoEl.src = org.logo_path;
                orgLogoEl.classList.remove('d-none');
              } else {
                orgLogoEl.src = '';
                orgLogoEl.classList.add('d-none');
              }
            }
            
            // Abbreviation
            if (orgAbbrEl) {
              orgAbbrEl.textContent = org.abbreviation ? `(${org.abbreviation})` : '';
            }
            
            // ===== Hide/show bulk buttons based on role =====
            if (currentUserRole === 'super-admin') {
              // Super-admin: show bulk approve button, hide bulk return button
              if (bulkApproveBtn) bulkApproveBtn.classList.remove('d-none');
              if (bulkDeclineBtn) bulkDeclineBtn.classList.remove('d-none');
              if (bulkReturnBtn) bulkReturnBtn.classList.add('d-none');
            } else if (currentUserRole === 'special-admin') {
              // Special-admin: hide bulk approve button, show bulk return button
              if (bulkApproveBtn) bulkApproveBtn.classList.add('d-none');
              if (bulkDeclineBtn) bulkDeclineBtn.classList.add('d-none');
              if (bulkReturnBtn) bulkReturnBtn.classList.remove('d-none');
              
              // ===== FIXED: Add Review button to bulk actions in the SAME POSITION as in accreditation JS =====
              const bulkActionsContainer = document.querySelector('.btn-group.btn-group-sm');
              if (bulkActionsContainer && !document.getElementById('accrBulkReviewBtn')) {
                // Create Review button EXACTLY like in the accreditation JS
                const reviewBtn = document.createElement('button');
                reviewBtn.type = 'button';
                reviewBtn.className = 'btn btn-outline-primary';
                reviewBtn.id = 'accrBulkReviewBtn';
                reviewBtn.disabled = true;
                reviewBtn.innerHTML = '<i class="bi bi-check-circle"></i> Review Selected';
                
                // ===== CRITICAL FIX: Insert in the SAME POSITION as in accreditation JS =====
                // In accreditation JS: Insert before Return button
                if (bulkReturnBtn) {
                  bulkActionsContainer.insertBefore(reviewBtn, bulkReturnBtn);
                } else {
                  bulkActionsContainer.appendChild(reviewBtn);
                }
                bulkReviewBtn = reviewBtn;
                
                // Attach click handler
                reviewBtn.addEventListener('click', handleBulkReviewClick);
              }
            }
            
            // Hide accreditation/reaccreditation buttons initially (will be shown based on conditions)
            if (accreditOrgBtn) {
              accreditOrgBtn.classList.add('d-none');
              accreditOrgBtn.disabled = true;
            }
            if (reaccreditOrgBtn) {
              reaccreditOrgBtn.classList.add('d-none');
              reaccreditOrgBtn.disabled = true;
            }
            
            // Special-admin cannot accredit or reaccredit
            if (currentUserRole === 'special-admin') {
              if (accreditOrgBtn) accreditOrgBtn.classList.add('d-none');
              if (reaccreditOrgBtn) reaccreditOrgBtn.classList.add('d-none');
              if (openReaccr) openReaccr.classList.add('d-none');
            }
            
            // ===== NEW: Ensure Review Modal is Available =====
            function ensureReviewModal() {
              if (!reviewConfirmModal) {
                reviewConfirmModal = document.getElementById('reviewConfirmModal');
              }
              if (!confirmReviewBtn) {
                confirmReviewBtn = document.getElementById('confirmReviewBtn');
              }
              
              // If modal doesn't exist in DOM, create it EXACTLY like in accreditation JS
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
            
            // ===== NEW: Handle Bulk Review Button Click =====
            function handleBulkReviewClick() {
              const rowsSel = getSelectedDocRows();
              if (!rowsSel.length) {
                showErrorModal('Select at least one document.');
                return;
              }
              openActionModal('review', { mode: 'bulk', rows: rowsSel });
            }
            
            // ===== NEW: Action modal handler =====
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
                // Existing decline modal logic
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
            
            // ===== NEW: Handle Confirm Review Button Click =====
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
            
            // ===== NEW: Handle single document action =====
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
                setDocRowUI(rowDiv, res.file_status || newStatus, reason, currentUserRole);

                showSuccessModal(action === 'review' ? 'Document marked as reviewed ✅' : 'Document returned ✅');
              } catch (err) {
                if (reviewBtn) reviewBtn.disabled = false;
                if (returnBtn) returnBtn.disabled = false;
                showErrorModal(err.message || `Failed to ${action} document.`);
              }
            }
            
            // ===== NEW: Handle bulk document action =====
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
                  setDocRowUI(row, res.file_status || newStatus, reason, currentUserRole);
                }

                showSuccessModal(action === 'review' ? 'Documents marked as reviewed ✅' : 'Documents returned ✅');
              } catch (err) {
                showErrorModal(err.message || `Failed to ${action} documents.`);
                if (bulkReviewBtn) bulkReviewBtn.disabled = false;
                if (bulkReturnBtn) bulkReturnBtn.disabled = false;
              }
            }
            
            // Load documents with role-specific functionality
            if (docsWrap) {
              docsWrap.innerHTML = '';
              
              if (files.length === 0) {
                docsWrap.innerHTML = '<div class="text-center text-muted py-4">No documents found</div>';
              } else {
                files.forEach((f) => {
                  const row = document.createElement('div');
                  row.className = 'accr-doc-row d-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2 mb-2';
                  row.dataset.fileId = f.id;
                  row.dataset.docType = (f.doc_type || '').toLowerCase();
                  row.dataset.docGroup = (f.doc_group || '').toLowerCase();
                  
                  const st = normalizeStatus(f.status);
                  const isLocked = st === 'approved' || st === 'declined';
                  const isReviewed = st === 'reviewed';
                  
                  const checkWrap = document.createElement('div');
                  checkWrap.className = 'form-check flex-shrink-0 mt-1';
                  const cbDisabledAttr = isLocked || isReviewed ? 'disabled aria-disabled="true"' : '';
                  checkWrap.innerHTML = `
                    <input class="form-check-input accr-doc-check" type="checkbox" data-file-id="${f.id}" ${cbDisabledAttr}>
                  `;
                  
                  const left = document.createElement('div');
                  left.className = 'flex-grow-1 min-w-0 me-2';
                  left.innerHTML = `
                    <div class="small text-muted">${escapeHtml(pretty(f.doc_group))}</div>
                    <div class="fw-semibold text-truncate" title="${escapeHtml(pretty(f.doc_type))}">
                      ${escapeHtml(pretty(f.doc_type))}
                    </div>
                    <div class="small">
                      Status: 
                      <span data-doc-status class="badge ${
                        st === 'approved' ? 'text-bg-success' :
                        st === 'declined' ? 'text-bg-danger' :
                        st === 'reviewed' ? 'text-bg-info' : 'text-bg-warning'
                      }">${escapeHtml(pretty(f.status))}</span>
                    </div>
                    <div class="small text-danger" data-doc-reason style="${f.reason ? '' : 'display:none;'}">
                      Reason: ${escapeHtml(f.reason || '')}
                    </div>
                  `;
                  
                  const right = document.createElement('div');
                  right.className = 'd-flex flex-wrap gap-2 flex-shrink-0';
                  
                  // View button always shows
                  const viewBtn = document.createElement('a');
                  viewBtn.className = 'btn btn-sm btn-outline-secondary';
                  viewBtn.href = f.file_path;
                  viewBtn.target = '_blank';
                  viewBtn.textContent = 'View';
                  right.appendChild(viewBtn);
                  
                  // Add action buttons based on user role
                  if (currentUserRole === 'super-admin' && !isLocked) {
                    // Super-admin: Approve button (visible), Return button (hidden by default)
                    const approveBtn = document.createElement('button');
                    approveBtn.className = 'btn btn-sm btn-success';
                    approveBtn.setAttribute('data-doc-action', 'approve');
                    approveBtn.setAttribute('data-file-id', f.id);
                    approveBtn.textContent = 'Approve';
                    right.appendChild(approveBtn);
                    
                    const declineBtn = document.createElement('button');
                    declineBtn.className = 'btn btn-sm btn-danger';
                    declineBtn.style.display = 'none'; // Hidden for super-admin
                    declineBtn.setAttribute('data-doc-action', 'decline');
                    declineBtn.setAttribute('data-file-id', f.id);
                    declineBtn.textContent = 'Return';
                    right.appendChild(declineBtn);
                  } else if (currentUserRole === 'special-admin' && !isLocked) {
                    // Special-admin: Review and Return buttons EXACTLY like in accreditation JS
                    if (!isReviewed) {
                      const reviewBtn = document.createElement('button');
                      reviewBtn.className = 'btn btn-sm btn-outline-primary';
                      reviewBtn.textContent = 'Review';
                      reviewBtn.dataset.docAction = 'review';
                      reviewBtn.dataset.fileId = f.id;
                      right.appendChild(reviewBtn);
                    }
                    
                    const returnBtn = document.createElement('button');
                    returnBtn.className = 'btn btn-sm btn-outline-danger';
                    returnBtn.textContent = 'Return';
                    returnBtn.dataset.docAction = 'decline';
                    returnBtn.dataset.fileId = f.id;
                    right.appendChild(returnBtn);
                  }
                  
                  // ===== Add resubmitting function for admin =====
                  if (currentUserRole === 'admin' && st === 'declined') {
                    // Admin can replace declined files
                    const replaceBtn = document.createElement('button');
                    replaceBtn.className = 'btn btn-sm btn-primary';
                    replaceBtn.setAttribute('data-doc-action', 'replace');
                    replaceBtn.setAttribute('data-file-id', f.id);
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
                  
                  // Assemble the row
                  row.appendChild(checkWrap);
                  row.appendChild(left);
                  row.appendChild(right);
                  
                  // Set initial UI state
                  setDocRowUI(row, f.status, f.reason || '', currentUserRole);
                  docsWrap.appendChild(row);
                });
              }
              
              // Initial sync of bulk selection state
              syncBulkCheckboxState();
              syncBulkButtonsState(currentUserRole);
            }
            
            // Wire up the Edit Organization button properly
            const openEditOrg = document.getElementById('openEditOrgBtn');
            if (openEditOrg) {
              // Remove any existing click handlers
              openEditOrg.onclick = null;
              
              // Add new click handler with proper closure
              openEditOrg.addEventListener('click', async function(e) {
                e.preventDefault();
                
                // Store the current org ID for the edit modal
                const editOrgIdEl = document.getElementById('editOrgId');
                const editOrgNameEl = document.getElementById('editOrgName');
                const editOrgAbbrEl = document.getElementById('editOrgAbbr');
                const editAdminSearchEl = document.getElementById('editAdminSearch');
                const editAdminIdHiddenEl = document.getElementById('editAdminIdHidden');
                
                if (editOrgIdEl) editOrgIdEl.value = org.id || '';
                if (editOrgNameEl) editOrgNameEl.value = org.name || '';
                if (editOrgAbbrEl) editOrgAbbrEl.value = org.abbreviation || '';
                
                // Set admin info - admin can't change, super/special-admin can
                const adminId = org.admin_id_number || '';
                const adminName = org.admin_full_name || '';
                const adminLabel = adminName && adminId ? `${adminName} (${adminId})` : adminId || '';
                
                if (editAdminSearchEl) {
                  editAdminSearchEl.value = adminLabel;
                  if (currentUserRole === 'admin') {
                    editAdminSearchEl.readOnly = true;
                    editAdminSearchEl.setAttribute('readonly', '');
                    editAdminSearchEl.classList.add('bg-light');
                    editAdminSearchEl.title = 'Admin assignment is fixed and cannot be changed.';
                  } else {
                    editAdminSearchEl.readOnly = false;
                    editAdminSearchEl.removeAttribute('readonly');
                    editAdminSearchEl.classList.remove('bg-light');
                    editAdminSearchEl.title = '';
                  }
                }
                if (editAdminIdHiddenEl) editAdminIdHiddenEl.value = adminId;
                
                // Set scope - admin can't change, super/special-admin can
                const isExclusive = String(org.scope || '').toLowerCase() === 'exclusive';
                const editScopeGeneralEl = document.getElementById('edit-scope-general');
                const editScopeExclusiveEl = document.getElementById('edit-scope-exclusive');
                
                if (editScopeGeneralEl) {
                  editScopeGeneralEl.checked = !isExclusive;
                  if (currentUserRole === 'admin') {
                    editScopeGeneralEl.disabled = true;
                    editScopeGeneralEl.setAttribute('disabled', '');
                    editScopeGeneralEl.title = 'Scope cannot be changed by admin.';
                  } else {
                    editScopeGeneralEl.disabled = false;
                    editScopeGeneralEl.removeAttribute('disabled');
                    editScopeGeneralEl.title = '';
                  }
                }
                if (editScopeExclusiveEl) {
                  editScopeExclusiveEl.checked = isExclusive;
                  if (currentUserRole === 'admin') {
                    editScopeExclusiveEl.disabled = true;
                    editScopeExclusiveEl.setAttribute('disabled', '');
                    editScopeExclusiveEl.title = 'Scope cannot be changed by admin.';
                  } else {
                    editScopeExclusiveEl.disabled = false;
                    editScopeExclusiveEl.removeAttribute('disabled');
                    editScopeExclusiveEl.title = '';
                  }
                }
                
                // Load course chips for exclusive scope
                if (isExclusive) {
                  const editExclusiveRowEl = document.getElementById('editExclusiveCourseRow');
                  if (editExclusiveRowEl) editExclusiveRowEl.classList.remove('d-none');
                  
                  const editCourseChipsEl = document.getElementById('editOrgCourseChips');
                  if (editCourseChipsEl) {
                    await loadEditCourseChips(editCourseChipsEl, org.course_abbr || '', currentUserRole);
                  }
                } else {
                  const editExclusiveRowEl = document.getElementById('editExclusiveCourseRow');
                  if (editExclusiveRowEl) editExclusiveRowEl.classList.add('d-none');
                }
                
                // Show the edit modal
                const editOrgModalEl = document.getElementById('editOrgModal');
                if (editOrgModalEl && window.bootstrap && window.bootstrap.Modal) {
                  const modal = new bootstrap.Modal(editOrgModalEl);
                  modal.show();
                }
              });
            }
            
            // Show the accreditation modal
            if (window.bootstrap && window.bootstrap.Modal) {
              const modal = new bootstrap.Modal(accrModalEl);
              modal.show();
              
              // Add backdrop cleanup
              accrModalEl.addEventListener('hidden.bs.modal', () => {
                document.querySelectorAll('.modal-backdrop').forEach(el => {
                  el.classList.remove('show');
                  el.classList.add('fade');
                  setTimeout(() => el.remove(), 200);
                });
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
              }, { once: true });
              
              // Set up document action handlers based on role
              setTimeout(() => {
                setupDocumentActionHandlers(currentUserRole, org, files);
                
                // Check and show accreditation buttons but keep them clickable
                // Even if all documents are approved, show the buttons but don't auto-accredit
                checkAndShowAccreditationButtons(org, files, true);
              }, 100);
            }
          })
          .catch(err => {
            console.error('[Accr Notif] Fetch error:', err);
            showErrorModal('Failed to load accreditation details.');
          });

      } else {
        // For now, other types do nothing special (future-proof)
        console.log('[Notif] Non-handled notification type:', notifType);
      }

      // 4) Close panel
      closePanel();
    });

    // ===== Load edit course chips function (similar to manage-accreditation-admin.js) =====
    async function loadEditCourseChips(containerEl, selectedAbbr = '', userRole) {
      if (!containerEl) return;
      containerEl.innerHTML = 'Loading courses...';
      try {
        const courses = await fetchJSON('php/get-active-courses.php?t=' + Date.now());
        containerEl.innerHTML = '';
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
            if (String(c.abbreviation || '').toUpperCase() === String(selectedAbbr || '').toUpperCase()) {
              input.checked = true;
            }

            // Admin can't change, super/special-admin can
            if (userRole === 'admin') {
              input.disabled = true;
              input.setAttribute('disabled', '');
              input.title = 'Department is fixed and cannot be changed by admin.';
            }

            const label = document.createElement('label');
            label.className = userRole === 'admin' 
              ? 'btn btn-sm btn-outline-secondary rounded-pill px-3 me-2 mb-2'
              : 'btn btn-sm btn-outline-primary rounded-pill px-3 me-2 mb-2';
            label.setAttribute('for', id);
            label.innerHTML = `<strong>${escapeHtml(c.abbreviation || '—')}</strong>`;
            if (userRole === 'admin') {
              label.title = 'Department is fixed and cannot be changed by admin.';
            }

            containerEl.appendChild(input);
            containerEl.appendChild(label);
          });
        } else {
          containerEl.innerHTML = '<div class="text-danger small">No active courses.</div>';
        }
      } catch {
        containerEl.innerHTML = '<div class="text-danger small">Failed to load courses.</div>';
      }
    }

    // ===== Replace declined file function for admin =====
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
        setDocRowUI(rowDiv, res.new_status || 'submitted', null, res.file_path, getCurrentUserRole());
        showSuccessModal('File replaced and resubmitted ✅');
      } catch (err) {
        console.error('[Notif] replace error', err);
        showErrorModal(err.message || 'Failed to replace file.');
      } finally {
        const btn = rowDiv.querySelector('[data-doc-action="replace"]');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Replace';
        }
      }
    }

    // Function to set up document action handlers (mirrors manage-accreditation.js behavior)
    function setupDocumentActionHandlers(userRole, org, files) {
      const docsWrap = document.getElementById('accrDocsWrap');
      if (!docsWrap) return;
      
      // Individual action button clicks
      docsWrap.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-doc-action]');
        if (!btn) return;
        
        const fileId = Number(btn.dataset.fileId);
        const action = btn.dataset.docAction; // "review", "approve", "decline", or "replace"
        if (!fileId || !action) return;
        
        // Handle replace action for admin
        if (action === 'replace') {
          const rowDiv = btn.closest('.accr-doc-row');
          if (rowDiv) {
            const fileInput = rowDiv.querySelector('input[type="file"]');
            if (fileInput) fileInput.click();
          }
          return;
        }
        
        // Handle review action for special-admin
        if (action === 'review') {
          const rowDiv = btn.closest('.accr-doc-row');
          openActionModal('review', { mode: 'single', fileId, rowDiv });
          return;
        }
        
        let reason = '';
        if (action === 'decline') {
          const rowDiv = btn.closest('.accr-doc-row');
          openAccrDeclineModal({
            mode: 'single',
            fileId,
            rowDiv,
            userRole
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
            setDocRowUI(rowDiv, res.file_status || (action === 'approve' ? 'approved' : 'declined'), reason, userRole);
          }
          
          // Check if we should show accreditation/reaccreditation buttons (super-admin only)
          if (userRole === 'super-admin') {
            checkAndShowAccreditationButtons(org, files, true);
          }
          
          showSuccessModal(action === 'approve' ? 'Document approved ✅' : 'Document returned ✅');
        } catch (err) {
          btn.disabled = prevDisabled;
          console.error('[Accr Notif] review error', err);
          showErrorModal(err.message || 'Failed to review document.');
        }
      });
      
      // Bulk selection handlers
      const bulkSelectAll = document.getElementById('accrBulkSelectAll');
      
      // Bulk "Select all" checkbox
      if (bulkSelectAll && docsWrap) {
        bulkSelectAll.addEventListener('change', () => {
          const checked = bulkSelectAll.checked;
          getDocCheckboxes().forEach((cb) => {
            cb.checked = checked;
          });
          syncBulkCheckboxState();
          syncBulkButtonsState(userRole);
        });
      }
      
      // Track checkbox changes for bulk UI
      docsWrap.addEventListener('change', (e) => {
        const cb = e.target.closest('.accr-doc-check');
        if (!cb) return;
        syncBulkCheckboxState();
        syncBulkButtonsState(userRole);
      });
      
      // Bulk Approve (super-admin only)
      const bulkApproveBtn = document.getElementById('accrBulkApproveBtn');
      if (bulkApproveBtn && userRole === 'super-admin') {
        bulkApproveBtn.addEventListener('click', async () => {
          const rowsSel = getSelectedDocRows();
          if (!rowsSel.length) {
            showErrorModal('Select at least one document.');
            return;
          }
          bulkApproveBtn.disabled = true;
          const bulkDeclineBtn = document.getElementById('accrBulkDeclineBtn');
          if (bulkDeclineBtn) bulkDeclineBtn.disabled = true;
          
          try {
            for (const row of rowsSel) {
              const fileId = Number(row.dataset.fileId || row.querySelector('.accr-doc-check')?.dataset.fileId);
              if (!fileId) continue;
              
              const res = await fetchJSON('php/review-accreditation-file.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_id: fileId, action: 'approve', reason: '' }),
              });
              
              setDocRowUI(row, res.file_status || 'approved', '', userRole);
            }
            
            // Check if we should show accreditation/reaccreditation buttons after bulk approve
            checkAndShowAccreditationButtons(org, files, true);
            
            syncBulkCheckboxState();
            syncBulkButtonsState(userRole);
            
            showSuccessModal('Selected documents approved ✅');
          } catch (err) {
            console.error('[Accr Notif] bulk approve error', err);
            showErrorModal(err.message || 'Failed to approve some documents.');
          } finally {
            bulkApproveBtn.disabled = false;
            syncBulkButtonsState(userRole);
          }
        });
      }
      
      // Bulk Return/Decline
      const bulkActionBtn = userRole === 'super-admin' ? 
        document.getElementById('accrBulkDeclineBtn') : 
        document.getElementById('accrBulkReturnBtn');
      
      if (bulkActionBtn) {
        bulkActionBtn.addEventListener('click', async () => {
          const rowsSel = getSelectedDocRows();
          if (!rowsSel.length) {
            showErrorModal('Select at least one document.');
            return;
          }
          
          openAccrDeclineModal({
            mode: 'bulk',
            rows: rowsSel,
            userRole
          });
        });
      }
    }
    
    // Check and show accreditation/reaccreditation buttons (super-admin only)
    // Modified to NOT auto-accredit even when all docs are approved
    function checkAndShowAccreditationButtons(org, files, forceShow = false) {
      const currentUserRole = getCurrentUserRole();
      if (currentUserRole !== 'super-admin') return;
      
      const accreditOrgBtn = document.getElementById('accreditOrgBtn');
      const reaccreditOrgBtn = document.getElementById('reaccreditOrgBtn');
      const openReaccr = document.getElementById('openReaccrBtn');
      
      // Get active academic year
      const sysAY = normAY({
        start: org.start_year,
        end: org.end_year,
        single: org.active_year
      });
      const orgAY = sysAY; // For notifications, we might not have full AY info
      
      // Check if all required documents are approved
      const allNewApproved = isAllNewApprovedDOM();
      const allReaccrApproved = isAllReaccrApprovedDOM();
      
      console.log('All new approved:', allNewApproved, 'All reaccr approved:', allReaccrApproved);
      
      // Show "Mark as Accredited" button if all NEW docs are approved
      // But NOT automatically accredit - button remains clickable
      const orgStatus = normalizeStatus(org.status);
      if (accreditOrgBtn && allNewApproved && orgStatus !== 'accredited' && orgStatus !== 'reaccredited') {
        accreditOrgBtn.classList.remove('d-none');
        accreditOrgBtn.disabled = false;
        // Add click handler for manual accreditation
        accreditOrgBtn.onclick = async () => {
          if (confirm('Are you sure you want to mark this organization as Accredited?')) {
            await markOrganizationAsAccredited(org.id, 'accredited');
          }
        };
      } else if (accreditOrgBtn) {
        accreditOrgBtn.classList.add('d-none');
        accreditOrgBtn.disabled = true;
      }
      
      // Show "Mark as Reaccredited" button if all REACCR docs approved
      if (reaccreditOrgBtn && allReaccrApproved && !ayEqual(orgAY, sysAY) && orgStatus !== 'reaccredited') {
        reaccreditOrgBtn.classList.remove('d-none');
        reaccreditOrgBtn.disabled = false;
        // Add click handler for manual reaccreditation
        reaccreditOrgBtn.onclick = async () => {
          if (confirm('Are you sure you want to mark this organization as Reaccredited?')) {
            await markOrganizationAsAccredited(org.id, 'reaccredited');
          }
        };
      } else if (reaccreditOrgBtn) {
        reaccreditOrgBtn.classList.add('d-none');
        reaccreditOrgBtn.disabled = true;
      }
      
      // Show reaccreditation button based on AY mismatch
      if (openReaccr) {
        const needsReaccr = !ayEqual(orgAY, sysAY);
        const reaccrFiles = (files || []).filter(
          (f) => String(f.doc_group).toLowerCase() === 'reaccreditation'
        );
        const hasPending = reaccrFiles.some(
          (f) => String(f.status).toLowerCase() === 'submitted'
        );
        const allApproved = allReaccrApproved;
        
        if (needsReaccr && !hasPending && !allApproved && reaccrFiles.length === 0) {
          openReaccr.classList.remove('d-none');
          openReaccr.dataset.orgId = org.id || '';
        } else {
          openReaccr.classList.add('d-none');
          openReaccr.dataset.orgId = '';
        }
      }
    }
    
    // Helper function to manually mark organization as accredited/reaccredited
    async function markOrganizationAsAccredited(orgId, status) {
      try {
        const response = await fetchJSON('php/update-organization-status.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org_id: orgId, status: status })
        });
        
        if (response.success) {
          showSuccessModal(`Organization marked as ${status} ✅`);
          // Refresh the modal or close it
          const accrModalEl = document.getElementById('accrDetailsModal');
          if (accrModalEl && window.bootstrap && window.bootstrap.Modal) {
            const modal = bootstrap.Modal.getInstance(accrModalEl);
            modal.hide();
          }
        } else {
          throw new Error(response.message || 'Failed to update status');
        }
      } catch (err) {
        console.error('[Accr Notif] accreditation error', err);
        showErrorModal(err.message || 'Failed to mark organization as accredited.');
      }
    }
    
    // Helper to get document checkboxes
    function getDocCheckboxes() {
      const docsWrap = document.getElementById('accrDocsWrap');
      return docsWrap
        ? Array.from(docsWrap.querySelectorAll('.accr-doc-check:not(:disabled)'))
        : [];
    }
    
    // Helper to get selected document rows
    function getSelectedDocRows() {
      const docsWrap = document.getElementById('accrDocsWrap');
      if (!docsWrap) return [];
      return Array.from(docsWrap.querySelectorAll('.accr-doc-row')).filter(
        (row) => {
          const cb = row.querySelector('.accr-doc-check');
          return cb && cb.checked && !cb.disabled;
        }
      );
    }
    
    // Sync bulk checkbox state
    function syncBulkCheckboxState() {
      const bulkSelectAll = document.getElementById('accrBulkSelectAll');
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
    }
    
    // Sync bulk buttons state
    function syncBulkButtonsState(userRole) {
      const cbs = getDocCheckboxes();
      const anyEnabled = cbs.length > 0;
      const anyChecked = cbs.some((cb) => cb.checked);
      
      if (!anyEnabled) {
        if (userRole === 'super-admin') {
          const bulkApproveBtn = document.getElementById('accrBulkApproveBtn');
          const bulkDeclineBtn = document.getElementById('accrBulkDeclineBtn');
          const bulkReviewBtn = document.getElementById('accrBulkReviewBtn');
          if (bulkApproveBtn) bulkApproveBtn.disabled = true;
          if (bulkDeclineBtn) bulkDeclineBtn.disabled = true;
          if (bulkReviewBtn) bulkReviewBtn.disabled = true;
        } else if (userRole === 'special-admin') {
          const bulkReturnBtn = document.getElementById('accrBulkReturnBtn');
          const bulkReviewBtn = document.getElementById('accrBulkReviewBtn');
          if (bulkReturnBtn) bulkReturnBtn.disabled = true;
          if (bulkReviewBtn) bulkReviewBtn.disabled = true;
        }
        return;
      }
      
      if (userRole === 'super-admin') {
        const bulkApproveBtn = document.getElementById('accrBulkApproveBtn');
        const bulkDeclineBtn = document.getElementById('accrBulkDeclineBtn');
        const bulkReviewBtn = document.getElementById('accrBulkReviewBtn');
        if (bulkApproveBtn) bulkApproveBtn.disabled = !anyChecked;
        if (bulkDeclineBtn) bulkDeclineBtn.disabled = !anyChecked;
        if (bulkReviewBtn) bulkReviewBtn.disabled = !anyChecked;
      } else if (userRole === 'special-admin') {
        const bulkReturnBtn = document.getElementById('accrBulkReturnBtn');
        const bulkReviewBtn = document.getElementById('accrBulkReviewBtn');
        if (bulkReturnBtn) bulkReturnBtn.disabled = !anyChecked;
        if (bulkReviewBtn) bulkReviewBtn.disabled = !anyChecked;
      }
    }
    
    // Set document row UI state (updated for review functionality)
    function setDocRowUI(rowDiv, fileStatus, reasonText, userRole) {
      const st = normalizeStatus(fileStatus);
      const statusSpan = rowDiv.querySelector('[data-doc-status]');
      const reasonEl = rowDiv.querySelector('[data-doc-reason]');
      const approveBtn = rowDiv.querySelector('[data-doc-action="approve"]');
      const declineBtn = rowDiv.querySelector('[data-doc-action="decline"]');
      const reviewBtn = rowDiv.querySelector('[data-doc-action="review"]');
      const replaceBtn = rowDiv.querySelector('[data-doc-action="replace"]');
      const cb = rowDiv.querySelector('.accr-doc-check');
      
      if (statusSpan) {
        statusSpan.textContent = pretty(st);
        statusSpan.className = 'badge ' +
          (st === 'approved' ? 'text-bg-success' :
           st === 'declined' ? 'text-bg-danger' :
           st === 'reviewed' ? 'text-bg-info' : 'text-bg-warning');
      }
      
      if (st === 'declined') {
        if (reasonEl) {
          reasonEl.style.display = '';
          reasonEl.textContent = `Reason: ${reasonText || ''}`;
        }
        if (approveBtn) approveBtn.disabled = false;
        if (declineBtn) declineBtn.disabled = true;
        if (reviewBtn) reviewBtn.disabled = true;
        if (replaceBtn) replaceBtn.disabled = false; // Admin can replace
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
        if (reviewBtn) reviewBtn.disabled = true;
        if (replaceBtn) replaceBtn.style.display = 'none'; // Hide replace button
        if (cb) {
          cb.checked = false;
          cb.disabled = true;
          cb.setAttribute('aria-disabled', 'true');
        }
      } else if (st === 'reviewed') {
        if (reasonEl) {
          reasonEl.style.display = 'none';
          reasonEl.textContent = '';
        }
        if (approveBtn) approveBtn.disabled = true;
        if (declineBtn) declineBtn.disabled = false; // Can still return even if reviewed
        if (reviewBtn) {
          reviewBtn.disabled = true;
          reviewBtn.textContent = 'Reviewed';
          reviewBtn.classList.remove('btn-outline-primary');
          reviewBtn.classList.add('btn-info');
        }
        if (replaceBtn) replaceBtn.style.display = 'none';
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
        if (reviewBtn) reviewBtn.disabled = false;
        if (replaceBtn) replaceBtn.style.display = 'none'; // Hide replace button for non-declined
        if (cb) {
          cb.disabled = false;
          cb.removeAttribute('aria-disabled');
        }
      }
      
      syncBulkCheckboxState();
      syncBulkButtonsState(userRole);
    }
    
    // Accreditation decline modal handling
    let accrDeclineModalInstance = null;
    let accrDeclineContext = null;
    
    function openAccrDeclineModal(ctx) {
      accrDeclineContext = ctx;
      
      // Create or reuse decline modal
      let declineModalEl = document.getElementById('accrDeclineReasonModal');
      if (!declineModalEl) {
        declineModalEl = document.createElement('div');
        declineModalEl.id = 'accrDeclineReasonModal';
        declineModalEl.className = 'modal fade';
        declineModalEl.innerHTML = `
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Return Document</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <p class="mb-2">Please provide a reason for returning the document:</p>
                <textarea class="form-control" rows="3" placeholder="Reason for returning..." id="accrDeclineReason"></textarea>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-danger" id="accrConfirmDeclineBtn">Submit</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(declineModalEl);
        
        // Set up modal instance
        if (window.bootstrap && window.bootstrap.Modal) {
          accrDeclineModalInstance = new bootstrap.Modal(declineModalEl);
        }
        
        // Set up confirm button
        const confirmBtn = document.getElementById('accrConfirmDeclineBtn');
        if (confirmBtn) {
          confirmBtn.addEventListener('click', handleAccrConfirmDecline);
        }
      }
      
      // Clear reason textarea
      const reasonInput = document.getElementById('accrDeclineReason');
      if (reasonInput) reasonInput.value = '';
      
      // Show modal
      if (accrDeclineModalInstance) {
        accrDeclineModalInstance.show();
      }
    }
    
    async function handleAccrConfirmDecline() {
      if (!accrDeclineContext) return;
      
      const reasonInput = document.getElementById('accrDeclineReason');
      const reason = (reasonInput?.value || '').trim();
      if (!reason) {
        showErrorModal('Please provide a reason.');
        return;
      }
      
      try {
        if (accrDeclineContext.mode === 'single') {
          await handleSingleAction(accrDeclineContext.fileId, accrDeclineContext.rowDiv, 'decline', reason);
        } else if (accrDeclineContext.mode === 'bulk') {
          await handleBulkAction(accrDeclineContext.rows, 'decline', reason);
        }
      } finally {
        accrDeclineContext = null;
        if (accrDeclineModalInstance) {
          accrDeclineModalInstance.hide();
        }
      }
    }

    // ========= Updated View User helpers =========
    const viewModal = {
      modal: null,
      id: null,
      status: null,
      origin: null,
      idNumber: null
    };

    function setupViewUserModalOnce() {
      if (viewModal.modal) return;
      const modalEl = document.getElementById('viewUserModal');
      if (!modalEl) return;
      viewModal.modal = new bootstrap.Modal(modalEl);
      
      // Add event listener for the primary button (Activate/Deactivate)
      const primaryBtn = document.getElementById('viewUserPrimaryBtn');
      if (primaryBtn) {
        primaryBtn.addEventListener('click', handleUserStatusToggle);
      }
      
      // Add event listener for the close button
      const closeBtn = modalEl.querySelector('.btn-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          viewModal.modal.hide();
        });
      }
    }

    // Handle user status toggle (Activate/Deactivate)
    function handleUserStatusToggle() {
      if (!viewModal.id || !viewModal.idNumber) {
        console.error('[ViewUser] Missing user ID or ID Number');
        showErrorModal('Cannot update user status: missing user information.');
        return;
      }

      const newStatus = viewModal.status === 'Active' ? 'Inactive' : 'Active';
      const action = viewModal.status === 'Active' ? 'Deactivate' : 'Activate';
      
      // Disable button during request
      const btn = document.getElementById('viewUserPrimaryBtn');
      if (btn) btn.disabled = true;

      updateUserStatus(viewModal.id, newStatus, viewModal.idNumber)
        .then(success => {
          if (success) {
            // Update local state
            viewModal.status = newStatus;
            
            // Update UI
            const badge = document.getElementById('viewUserStatusBadge');
            if (badge) {
              badge.textContent = newStatus;
              badge.classList.remove('bg-success', 'bg-secondary', 'bg-warning', 'bg-danger');
              if (newStatus === 'Active') {
                badge.classList.add('bg-success');
              } else if (newStatus === 'Inactive') {
                badge.classList.add('bg-secondary');
              } else {
                badge.classList.add('bg-warning');
              }
            }

            // Update button
            if (btn) {
              if (newStatus === 'Active') {
                btn.textContent = 'Deactivate';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-warning');
              } else {
                btn.textContent = 'Activate';
                btn.classList.remove('btn-warning');
                btn.classList.add('btn-primary');
              }
              btn.disabled = false;
            }

            showSuccessModal(`User ${action}d successfully!`);
            
            // Optionally refresh notifications to update status
            refreshNotifications(true);
          } else {
            showErrorModal(`Failed to ${action.toLowerCase()} user.`);
            if (btn) btn.disabled = false;
          }
        })
        .catch(err => {
          console.error('[ViewUser] Status toggle error:', err);
          showErrorModal(`Failed to ${action.toLowerCase()} user.`);
          if (btn) btn.disabled = false;
        });
    }

    // Fill the new modal and show it.
    function fillAndShowUserModalNew(payload, originTab = 'pending') {
      setupViewUserModalOnce();
      if (!viewModal.modal) {
        console.error('[ViewUser] modal not found in DOM.');
        return;
      }

      const u = (payload && payload.success && payload.user) ? payload.user : payload;
      if (!u || !u.id) {
        console.warn('[ViewUser] invalid user payload:', payload);
        showErrorModal('Failed to load user details.');
        return;
      }

      // Set modal state for dynamic buttons
      viewModal.id = u.id;
      viewModal.status = u.status || 'Inactive';
      viewModal.origin = originTab;
      viewModal.idNumber = u.id_number || '';

      // Populate (only if the element exists in your modal)
      const fallbackAvatar = 'assets/images/image-placeholder.svg';
      const setText = (id, val) => { 
        const el = document.getElementById(id); 
        if (el) el.textContent = val ?? '—'; 
      };
      const setSrc  = (id, val) => { 
        const el = document.getElementById(id); 
        if (el) el.src = val || fallbackAvatar; 
      };

      setSrc('viewUserAvatar', u.profile_picture);
      setText('viewUserName', u.full_name || `${u.first_name} ${u.last_name}`);
      setText('viewUserId', u.id);
      setText('viewUserIdNumber', u.id_number);
      setText('viewUserEmail', u.email);
      setText('viewUserUserType', u.user_type);
      setText('viewUserRole', u.role);
      setText('viewUserDepartment', u.department);
      setText('viewUserSchoolYear', u.school_year);
      setText('viewUserYear', u.year);
      setText('viewUserCreatedAt', u.created_at);

      const badge = document.getElementById('viewUserStatusBadge');
      if (badge) {
        badge.textContent = u.status || '—';
        badge.classList.remove('bg-success', 'bg-secondary', 'bg-warning', 'bg-danger');
        if (u.status === 'Active') badge.classList.add('bg-success');
        else if (u.status === 'Inactive') badge.classList.add('bg-secondary');
        else badge.classList.add('bg-warning'); // Unlisted/others
      }

      // Dynamic primary button (Activate/Deactivate)
      const primary = document.getElementById('viewUserPrimaryBtn');
      if (primary) {
        primary.disabled = false; // Ensure button is enabled
        
        if (u.status === 'Active') {
          primary.textContent = 'Deactivate';
          primary.classList.remove('btn-primary', 'btn-success');
          primary.classList.add('btn-warning');
        } else {
          primary.textContent = 'Activate';
          primary.classList.remove('btn-warning');
          primary.classList.add('btn-primary');
        }
      }

      viewModal.modal.show();
    }

    // Open by numeric ID
    async function openUserViewById(id, originTab = 'pending') {
      try {
        const data = await fetchJSON('php/get-user.php?id=' + encodeURIComponent(id));
        fillAndShowUserModalNew(data, originTab);
      } catch (err) {
        console.error('[ViewUser] fetch by id error:', err);
        showErrorModal('Failed to load user.');
      }
    }

    // Open by id_number
    async function openUserViewByIdNumber(idNumber, originTab = 'pending') {
      try {
        const data = await fetchJSON('php/get-user.php?id_number=' + encodeURIComponent(idNumber));
        fillAndShowUserModalNew(data, originTab);
      } catch (err) {
        console.error('[ViewUser] fetch by id_number error:', err);
        showErrorModal('Failed to load user.');
      }
    }

    // ---------- handle Accept / Decline clicks inside View Announcement Modal ----------
    const viewAnnouncementModal = document.getElementById('viewAnnouncementModal');

    // Decline reason modal pieces
    const declineModalEl      = document.getElementById('announcementDeclineModal');
    const declineReasonInput  = document.getElementById('announcementDeclineReason');
    const declineSaveBtn      = document.getElementById('announcementDeclineSaveBtn');
    const declineCancelBtns   = document.querySelectorAll('.announcementDeclineCancelBtn');

    let declineModalInstance = null;
    let pendingDecline = null; // { id, btn }

    if (declineModalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      declineModalInstance = new bootstrap.Modal(declineModalEl);
    }

    function resetDeclineModalState() {
      pendingDecline = null;
      if (declineReasonInput) declineReasonInput.value = '';
    }

    function openDeclineModal(id, btn) {
      if (!declineModalInstance || !declineReasonInput) {
        console.warn('[Announcement] Decline modal pieces missing.');
        // Fallback: if modal is not available, just do a blank reason
        handleAnnouncementStatusChange(id, 'Rejected', btn, '');
        return;
      }
      pendingDecline = { id, btn };
      declineReasonInput.value = '';
      declineModalInstance.show();
      setTimeout(() => declineReasonInput.focus(), 120);
    }

    function handleAnnouncementStatusChange(id, status, btn, reason) {
      if (!id || !btn) return;

      btn.disabled = true;

      updateAnnouncementStatus(id, status, reason)
        .then(ok => {
          if (!ok) {
            btn.disabled = false;
            showErrorModal('Failed to update announcement status.');
            return;
          }

          const bodyEl = document.getElementById('viewAnnouncementBody');
          if (bodyEl) {
            // Update status badge
            const badge = bodyEl.querySelector('[data-role="announcement-status-badge"]');
            if (badge) {
              badge.textContent = status;
              badge.classList.remove('bg-success', 'bg-warning', 'text-dark', 'bg-danger', 'bg-secondary');
              if (status === 'Active') {
                badge.classList.add('bg-success');
              } else if (status === 'Pending') {
                badge.classList.add('bg-warning', 'text-dark');
              } else if (status === 'Rejected') {
                badge.classList.add('bg-danger');
              } else if (status === 'Archived') {
                badge.classList.add('bg-secondary');
              }
            }

            // Disable the whole button group
            const group = btn.closest('.btn-group');
            if (group) {
              group.style.opacity = '.5';
              group.style.pointerEvents = 'none';
              group.querySelectorAll('button').forEach(b => { b.disabled = true; });
            }
          }

          showSuccessModal('Announcement status updated to ' + status + '.');
        })
        .catch(() => {
          btn.disabled = false;
          showErrorModal('Failed to update announcement status.');
        });
    }

    if (viewAnnouncementModal) {
      viewAnnouncementModal.addEventListener('click', function (e) {
        const acceptBtn = e.target.closest('.acceptBtn');
        const declineBtn = e.target.closest('.declineBtn');
        if (!acceptBtn && !declineBtn) return;

        const btn = acceptBtn || declineBtn;
        const id = btn.dataset.id;
        if (!id) return;

        const isAccept = !!acceptBtn;

        if (isAccept) {
          // Directly approve (no reason)
          handleAnnouncementStatusChange(id, 'Active', btn, '');
        } else {
          // Open decline reason modal
          openDeclineModal(id, btn);
        }
      });
    }

    // Decline modal Save button
    if (declineSaveBtn) {
      declineSaveBtn.addEventListener('click', function () {
        if (!pendingDecline) {
          if (declineModalInstance) declineModalInstance.hide();
          return;
        }
        const { id, btn } = pendingDecline;
        const reason = declineReasonInput ? (declineReasonInput.value || '').trim() : '';
        resetDeclineModalState();
        if (declineModalInstance) declineModalInstance.hide();
        handleAnnouncementStatusChange(id, 'Rejected', btn, reason);
      });
    }

    // Decline modal Cancel/Close buttons
    if (declineCancelBtns && declineCancelBtns.length) {
      declineCancelBtns.forEach(el => {
        el.addEventListener('click', function () {
          resetDeclineModalState();
          if (declineModalInstance) declineModalInstance.hide();
        });
      });
    }

    // Also reset on hidden (if user clicks X)
    if (declineModalEl) {
      declineModalEl.addEventListener('hidden.bs.modal', resetDeclineModalState);
    }

    // ---------- initial dot state ----------
    fetchNotifications(0).then(items => {
      updateBellDot(items);
    }).catch(err => {
      console.warn('[Notif] initial dot check failed:', err);
      updateBellDot([]);
    });

    // ---------- auto-refresh every 30 seconds ----------
    refreshInterval = setInterval(() => {
      refreshNotifications();
    }, 30000);

    // Clean up interval when page is hidden (optional)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (refreshInterval) {
          clearInterval(refreshInterval);
          refreshInterval = null;
        }
      } else {
        if (!refreshInterval) {
          refreshInterval = setInterval(() => {
            refreshNotifications();
          }, 30000);
        }
        // Refresh immediately when tab becomes visible
        refreshNotifications(true);
      }
    });

    // Also refresh when window gains focus
    window.addEventListener('focus', () => {
      refreshNotifications(true);
    });

  })();
});