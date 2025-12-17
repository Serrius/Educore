// notification-student.js
document.addEventListener('DOMContentLoaded', function () {
  (function () {
    console.log('[Notif] Script starting...');
    
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
      GENERAL:        'general',
      ANNOUNCEMENT:   'announcement',
      PAYMENT:        'payment'
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
      console.log('[Fetch] Requesting:', url);
      return fetch(url, {
        credentials: 'same-origin',
        ...options
      }).then(r => {
        console.log('[Fetch] Response status:', r.status, 'for', url);
        if (!r.ok) {
          throw new Error(`HTTP ${r.status} for ${url}`);
        }
        return r.json();
      }).then(data => {
        console.log('[Fetch] Response data:', data);
        return data;
      });
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

      // Default: check if status exists
      if (n.status === 'unread') return true;
      
      return false;
    }

    function updateBellDot(items){
      const count = (items || []).filter(isUnread).length;
      notifDot.style.display = count > 0 ? 'block' : 'none';
      bellButton.setAttribute('aria-label', count > 0 ? `Notifications (${count} unread)` : 'Notifications');
    }

    function renderNotifications(items){
      console.log('[Notif] renderNotifications called with:', items);
      
      if (!Array.isArray(items) || items.length === 0){
        console.log('[Notif] No notifications to render');
        list.innerHTML = `<div class="text-center text-muted py-4">No new notifications</div>`;
        notifDot.style.display = 'none';
        return;
      }

      console.log('[Notif] Rendering', items.length, 'notifications');
      
      list.innerHTML = items.map(n => {
        const unread = isUnread(n);
        const nid    = n.id ?? '';
        const notifType  = (n.notif_type || '').toLowerCase();
        
        // Use payload_id for announcements and payments
        const payloadId = n.payload_id || nid;
        
        console.log('[Notif] Rendering item:', n.id, n.title, 'type:', notifType, 'unread:', unread);
        
        return `
          <button type="button"
            class="card border-0 border-bottom rounded-0 py-2 px-2 text-start notif-item ${unread ? 'unread' : ''}"
            data-notif-id="${escapeAttr(nid)}"
            data-payload-id="${escapeAttr(payloadId)}"
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
      console.log('[Notif] DOM unread count:', domUnread);
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

    // ---------- CHECK FOR UNPAID DUES ----------
    async function checkForUnpaidDues() {
      console.log('[Payment Dues] Starting check...');
      
      try {
        const response = await fetchJSON('php/check-unpaid-fees.php?t=' + Date.now());
        console.log('[Payment Dues] Full response:', response);
        
        if (response.success && response.unpaid_fees && response.unpaid_fees.length > 0) {
          console.log(`[Payment Dues] Found ${response.unpaid_fees.length} unpaid fees:`, response.unpaid_fees);
          
          // Check if we already have a payment due notification
          const existingDueNotif = await fetchJSON('php/check-payment-due-notif.php?t=' + Date.now());
          console.log('[Payment Dues] Existing notification check:', existingDueNotif);
          
          if (!existingDueNotif.exists) {
            console.log('[Payment Dues] Creating new notification...');
            // Create new payment due notification
            const createResult = await fetchJSON('php/create-payment-due-notif.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                unpaid_count: response.unpaid_fees.length,
                total_amount: response.total_amount,
                fees: response.unpaid_fees
              })
            });
            
            console.log(`[Payment Dues] Create result:`, createResult);
            console.log(`[Payment Dues] Created notification for ${response.unpaid_fees.length} unpaid fees`);
            
            // CRITICAL FIX: Force refresh ALL notifications, not just new ones
            // This ensures the new payment notification shows up immediately
            console.log('[Payment Dues] Forcing full refresh of notifications...');
            forceRefreshAllNotifications();
          } else {
            console.log('[Payment Dues] Notification already exists today');
          }
        } else {
          console.log('[Payment Dues] No unpaid fees found. Response:', response);
        }
      } catch (error) {
        console.error('[Payment Dues] Error checking unpaid fees:', error);
      }
    }

    // ---------- Auto-refresh functionality ----------
    let refreshInterval = null;
    let latestNotificationId = 0;
    let isPanelOpen = false;

    // NEW FUNCTION: Force refresh all notifications
    function forceRefreshAllNotifications() {
      console.log('[Notif] Force refreshing all notifications...');
      // Reset latestNotificationId to 0 to force getting all notifications
      const previousLatestId = latestNotificationId;
      latestNotificationId = 0;
      
      fetchNotifications(0).then(items => {
        console.log('[Notif] Force refreshed items:', items.length);
        if (items.length > 0) {
          // Update latestNotificationId
          const maxId = Math.max(...items.map(n => n.id || 0));
          if (maxId > latestNotificationId) {
            latestNotificationId = maxId;
          }
          
          // Update UI
          if (isPanelOpen) {
            renderNotifications(items);
          }
          updateBellDot(items);
          
          // Show desktop notification if there are unread items
          const unreadCount = items.filter(isUnread).length;
          if (unreadCount > 0 && !isPanelOpen) {
            showDesktopNotification(unreadCount);
          }
        }
        console.log('[Notif] Latest notification ID updated from', previousLatestId, 'to', latestNotificationId);
      });
    }

    function fetchNotifications(sinceId = 0) {
      let url = 'php/get-notifications.php?t=' + Date.now();
      if (sinceId > 0) {
        url += '&after_id=' + sinceId;
      }
      
      console.log('[Notif] Fetching notifications from:', url);
      
      return fetch(url, { credentials: 'same-origin' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(json => {
          console.log('[Notif] Raw response:', json);
          
          // Check if response has notifications array
          let items = [];
          if (Array.isArray(json)) {
            items = json; // Direct array response
          } else if (json && Array.isArray(json.notifications)) {
            items = json.notifications; // Wrapped response
          } else if (json && json.notifications === undefined) {
            // Some endpoints return just the array directly
            items = Array.isArray(json) ? json : [];
          } else {
            console.warn('[Notif] Unexpected response format:', json);
            items = [];
          }
          
          // Update latest ID for polling (but only if we got a valid response)
          if (json && json.latest_id && json.latest_id > latestNotificationId) {
            latestNotificationId = json.latest_id;
          } else if (items.length > 0) {
            // Calculate latest ID from the items
            const maxId = Math.max(...items.map(n => n.id || 0));
            if (maxId > latestNotificationId) {
              latestNotificationId = maxId;
            }
          }
          
          console.log('[Notif] Parsed items:', items.length, 'latestId:', latestNotificationId);
          return items;
        })
        .catch(err => {
          console.error('[Notif] fetch error:', err);
          return [];
        });
    }

    function refreshNotifications(forceUpdate = false) {
      console.log('[Notif] refreshNotifications called, forceUpdate:', forceUpdate);
      
      fetchNotifications(latestNotificationId).then(items => {
        console.log('[Notif] New items found:', items.length);
        
        if (items.length > 0) {
          // If panel is open, refresh the list
          if (isPanelOpen) {
            console.log('[Notif] Panel is open, refreshing full list...');
            // Get ALL notifications, not just new ones
            fetchNotifications(0).then(allItems => {
              console.log('[Notif] Refreshing panel with:', allItems.length, 'items');
              renderNotifications(allItems);
              updateBellDot(allItems);
            });
          } else {
            console.log('[Notif] Panel is closed, just updating dot...');
            // Get ALL notifications to update dot correctly
            fetchNotifications(0).then(allItems => {
              console.log('[Notif] Updating dot with:', allItems.length, 'total items');
              updateBellDot(allItems);
            });
          }
          
          // Show subtle desktop notification if new items
          if (forceUpdate && items.length > 0 && !isPanelOpen) {
            showDesktopNotification(items.length);
          }
        } else {
          console.log('[Notif] No new items found');
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
      console.log('[Notif] Opening panel...');
      
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

      console.log('[Notif] Fetching notifications for panel...');
      
      // fetch & render ALL notifications
      fetchNotifications(0).then(items => {
        console.log('[Notif] Received items for panel:', items);
        renderNotifications(items);
        updateBellDot(items);
      }).catch(err => {
        console.error('[Notif] Error fetching in openPanel:', err);
      });
    }

    function closePanel(){
      console.log('[Notif] Closing panel...');
      
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
      console.log('[Notif] Bell button clicked');
      panel.classList.contains('open') ? closePanel() : openPanel();
    });
    closeBtn?.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // ---------- MODAL FUNCTIONS FOR EACH NOTIFICATION TYPE ----------

    // 1. General Notification Modal
    function showGeneralNotificationModal(title, message) {
      // Create or get modal
      let modalEl = document.getElementById('generalNotifModal');
      if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'generalNotifModal';
        modalEl.className = 'modal fade';
        modalEl.innerHTML = `
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header border-0">
                <h5 class="modal-title">Notification</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                <h6 id="generalNotifTitle"></h6>
                <p id="generalNotifMessage" class="mb-0"></p>
              </div>
              <div class="modal-footer border-0">
                <button type="button" class="btn btn-primary btn-sm" data-bs-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modalEl);
      }

      // Set content
      document.getElementById('generalNotifTitle').textContent = title;
      document.getElementById('generalNotifMessage').textContent = message;

      // Show modal
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }

    // 2. Payment Details Modal
    async function showPaymentModal(paymentId) {
      try {
        console.log('[Payment Modal] Fetching payment details for:', paymentId);
        
        // Fetch payment details
        const paymentData = await fetchJSON(`php/get-payment-details.php?id=${encodeURIComponent(paymentId)}&t=${Date.now()}`);
        
        if (!paymentData.success) {
          showErrorModal('Failed to load payment details.');
          return;
        }

        const payment = paymentData.payment || {};
        const fees = paymentData.unpaid_fees || [];
        
        console.log('[Payment Modal] Payment data:', payment);
        console.log('[Payment Modal] Unpaid fees:', fees);
        
        // Create or get modal
        let modalEl = document.getElementById('paymentDetailsModal');
        if (!modalEl) {
          modalEl = document.createElement('div');
          modalEl.id = 'paymentDetailsModal';
          modalEl.className = 'modal fade';
          modalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header border-0">
                  <h5 class="modal-title">Payment Details</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                  <div id="paymentDetailsContent"></div>
                  <div id="unpaidFeesSection" class="mt-3"></div>
                </div>
                <div class="modal-footer border-0">
                  <button type="button" class="btn btn-primary btn-sm" data-bs-dismiss="modal">Close</button>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modalEl);
        }

        let paymentContent = '';
        
        if (payment.id) {
          // Show specific payment details
          paymentContent = `
            <div class="border rounded p-3 mb-3">
              <h6>Payment Receipt #${escapeHtml(payment.receipt_no || '')}</h6>
              <div class="row small">
                <div class="col-6">
                  <strong>Amount:</strong><br>
                  <span class="text-success">₱${parseFloat(payment.paid_amount || 0).toFixed(2)}</span>
                </div>
                <div class="col-6">
                  <strong>Date:</strong><br>
                  ${escapeHtml(payment.paid_on || '')}
                </div>
              </div>
              <div class="row small mt-2">
                <div class="col-12">
                  <strong>Organization:</strong><br>
                  ${escapeHtml(payment.org_name || '')}
                </div>
              </div>
              <div class="row small mt-2">
                <div class="col-12">
                  <strong>Status:</strong><br>
                  <span class="badge ${payment.status === 'confirmed' ? 'bg-success' : 'bg-warning'}">
                    ${escapeHtml(payment.status || '')}
                  </span>
                </div>
              </div>
            </div>
          `;
        } else {
          // Show payment due notification
          paymentContent = `
            <div class="alert alert-warning">
              <h6><i class="bi bi-exclamation-triangle me-2"></i>Payment Due Reminder</h6>
              <p class="mb-2">You have unpaid organization fees.</p>
            </div>
          `;
        }

        // Add unpaid fees section if any
        let unpaidFeesContent = '';
        if (fees.length > 0) {
          unpaidFeesContent = `
            <div class="card border-warning">
              <div class="card-header bg-warning text-dark py-2">
                <h6 class="mb-0"><i class="bi bi-currency-dollar me-2"></i>Unpaid Fees (${fees.length})</h6>
              </div>
              <div class="card-body p-0">
                <div class="list-group list-group-flush">
                  ${fees.map(fee => `
                    <div class="list-group-item">
                      <div class="d-flex justify-content-between align-items-center">
                        <div>
                          <strong>${escapeHtml(fee.title || 'Organization Fee')}</strong><br>
                          <small class="text-muted">${escapeHtml(fee.org_name || '')}</small>
                        </div>
                        <div class="text-end">
                          <span class="text-danger">₱${parseFloat(fee.amount || 0).toFixed(2)}</span><br>
                          <small class="text-muted">Due</small>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <div class="card-footer text-end">
                  <strong>Total Due: ₱${fees.reduce((sum, fee) => sum + parseFloat(fee.amount || 0), 0).toFixed(2)}</strong>
                </div>
              </div>
            </div>
          `;
        }

        // Set content
        document.getElementById('paymentDetailsContent').innerHTML = paymentContent;
        document.getElementById('unpaidFeesSection').innerHTML = unpaidFeesContent;

        // Show modal
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

      } catch (error) {
        console.error('[Payment Modal] Error:', error);
        showErrorModal('Failed to load payment information.');
      }
    }

    // 3. Announcement Modal (existing function)
    async function showAnnouncementModal(announcementId) {
      const bodyEl  = document.getElementById('userViewAnnouncementBody');
      const modalEl = document.getElementById('userViewAnnouncementModal');

      if (bodyEl) {
        bodyEl.innerHTML = '<div class="text-center text-muted py-4">Loading...</div>';
      }

      try {
        const data = await fetchJSON('php/get-announcement.php?id=' + encodeURIComponent(announcementId) + '&t=' + Date.now());
        
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

        // Render the body for students (no action buttons)
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
          `;
        }

        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
          const m = bootstrap.Modal.getOrCreateInstance(modalEl);
          m.show();
        }
      } catch (err) {
        console.error('[Announcement] fetch error:', err);
        const bodyEl2 = document.getElementById('userViewAnnouncementBody');
        const modalEl2 = document.getElementById('userViewAnnouncementModal');

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
      }
    }

    // ---------- click a notification -> action depends on type ----------
    list.addEventListener('click', async (e) => {
      const card = e.target.closest('.notif-item');
      if (!card) return;

      const rawId     = card.dataset.notifId || '';
      const payloadId = card.dataset.payloadId || '';
      const notifId   = Number(rawId);
      const notifType = (card.dataset.notifType || '').toLowerCase();

      // Get notification title and message
      const notificationTitle = card.querySelector('.fw-semibold')?.textContent || 'Notification';
      const notificationMessage = card.querySelector('.small.text-muted')?.textContent || '';

      console.log('[Notif] Clicked notification:', notifId, 'type:', notifType, 'payload:', payloadId);

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

      // 3) Open appropriate modal based on notification type
      if (notifType === NOTIF_TYPES.ANNOUNCEMENT) {
        const announcementId = payloadId || rawId;
        await showAnnouncementModal(announcementId);
        
      } else if (notifType === NOTIF_TYPES.PAYMENT) {
        const paymentId = payloadId || rawId;
        await showPaymentModal(paymentId);
        
      } else if (notifType === NOTIF_TYPES.GENERAL) {
        showGeneralNotificationModal(notificationTitle, notificationMessage);
        
      } else {
        // Fallback for unknown types
        showGeneralNotificationModal(notificationTitle, notificationMessage);
      }

      // 4) Close panel
      closePanel();
    });

    // ---------- initial dot state ----------
    console.log('[Notif] Setting initial dot state...');
    // Use forceRefreshAllNotifications for initial load too
    forceRefreshAllNotifications();

    // ---------- auto-refresh every 30 seconds ----------
    refreshInterval = setInterval(() => {
      console.log('[Notif] Auto-refresh triggered');
      refreshNotifications();
    }, 30000);

    // ---------- Check for unpaid dues on page load ----------
    console.log('[Payment Dues] Setting up initial check in 5 seconds...');
    setTimeout(() => {
      console.log('[Payment Dues] Running initial check...');
      checkForUnpaidDues();
    }, 5000);

    // ---------- Check for unpaid dues every 5 minutes ----------
    console.log('[Payment Dues] Setting up recurring check every 5 minutes...');
    setInterval(() => {
      console.log('[Payment Dues] Running scheduled check...', new Date().toLocaleTimeString());
      checkForUnpaidDues();
    }, 300000); // 5 minutes

    // Clean up interval when page is hidden (optional)
    document.addEventListener('visibilitychange', () => {
      console.log('[Notif] Visibility change, hidden:', document.hidden);
      if (document.hidden) {
        if (refreshInterval) {
          clearInterval(refreshInterval);
          refreshInterval = null;
          console.log('[Notif] Cleared refresh interval');
        }
      } else {
        if (!refreshInterval) {
          refreshInterval = setInterval(() => {
            refreshNotifications();
          }, 30000);
          console.log('[Notif] Restarted refresh interval');
        }
        // Refresh immediately when tab becomes visible
        console.log('[Notif] Tab visible, refreshing notifications...');
        forceRefreshAllNotifications();
        // Also check for unpaid dues
        checkForUnpaidDues();
      }
    });

    // Also refresh when window gains focus
    window.addEventListener('focus', () => {
      console.log('[Notif] Window focused, refreshing...');
      forceRefreshAllNotifications();
    });

  })();
});