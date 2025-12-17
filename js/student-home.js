// student-home.js
// Dashboard for student home: KPIs + recent announcements + pending dues + calendar

;(function () {
  'use strict';

  const PANEL_SEL   = '#studentHomePage, #homePage, [data-role="student-home"]';
  const ROUTE_MATCH = '[data-route="student-home"], [href="#student-home"]';

  const DASHBOARD_API = 'php/student-homestats.php';

  let currentRoot = null;
  let autoRefreshTimer = null;

  // ============ Helpers ============

  function selectInRoot(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function text(root, sel, value) {
    const el = selectInRoot(root, sel);
    if (el) el.textContent = value;
  }

  // ============ Calendar rendering ============

  function renderCalendar(root) {
    const body = selectInRoot(root, '#studentCalendarBody');
    const monthLabel = selectInRoot(root, '#studentCalendarMonthLabel');
    const todayLabel = selectInRoot(root, '#studentCalendarTodayLabel');
    if (!body) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    const firstWeekday = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ];

    if (monthLabel) {
      monthLabel.textContent = `${monthNames[month]} ${year}`;
    }
    if (todayLabel) {
      todayLabel.textContent = `${monthNames[month]} ${today}, ${year}`;
    }

    let html = '';
    let day = 1;

    for (let week = 0; week < 6; week++) {
      let row = '<tr>';

      for (let weekday = 0; weekday < 7; weekday++) {
        if (week === 0 && weekday < firstWeekday) {
          row += '<td></td>';
        } else if (day > totalDays) {
          row += '<td></td>';
        } else {
          const isToday = (day === today);
          row += `<td class="${isToday ? 'calendar-today' : ''}"><span>${day}</span></td>`;
          day++;
        }
      }

      row += '</tr>';
      html += row;

      if (day > totalDays) break;
    }

    body.innerHTML = html;
  }

  // ============ Render dashboard data ============

  function renderDashboard(root, payload) {
    if (!payload || !payload.success) {
      console.error('Dashboard data fetch failed:', payload);
      return;
    }

    const ay = payload.academic_year || {};
    const cards = payload.cards || {};
    const announcements = payload.recent_announcements || [];
    const pendingDues = payload.pending_dues_details || [];
    const studentOrgs = payload.student_organizations || [];
    const studentInfo = payload.student_info || {};

    const sy = ay.start_year;
    const ey = ay.end_year;
    const activeYear = ay.active_year;
    const semLabel = ay.semester_label;

    // Academic year display
    if (sy && ey) {
      text(root, '#displayStudentAcademicYear', `${sy} - ${ey}`);
    }
    if (typeof activeYear !== 'undefined' && activeYear !== null) {
      text(root, '#displayStudentActiveYear', String(activeYear));
    }
    if (semLabel) {
      text(root, '#displayStudentSemesterLabel', semLabel);
    } else {
      text(root, '#displayStudentSemesterLabel', '—');
    }

    // KPI cards
    text(root, '#kpiActiveAnnouncements', String(cards.active_announcements || 0));
    text(root, '#kpiPendingDues', String(cards.pending_dues || 0));
    text(root, '#kpiCompletedDues', String(cards.completed_dues || 0));

    // Welcome message
    const welcomeToday = document.getElementById('studentWelcomeToday');
    if (welcomeToday) {
      welcomeToday.textContent = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const welcomeUsername = document.getElementById('studentWelcomeUsername');
    if (welcomeUsername) {
      const firstName = localStorage.getItem('firstName') || 'Student';
      welcomeUsername.textContent = firstName;
    }

    // Student info display
    const studentCourse = document.getElementById('studentCourseDisplay');
    if (studentCourse && studentInfo.course) {
      studentCourse.textContent = studentInfo.course;
    }

    // Recent announcements list
    const annList = selectInRoot(root, '#studentRecentAnnouncements');
    const annNote = selectInRoot(root, '#studentAnnouncementsNote');
    if (annList) {
      if (!announcements.length) {
        annList.innerHTML =
          '<li class="list-group-item text-muted text-center py-4">No announcements available for your course.</li>';
        if (annNote) {
          annNote.textContent = 'No announcements for your course in the current academic year.';
        }
      } else {
        annList.innerHTML = announcements
          .map((ann) => {
            const categoryBadge = ann.category ? 
              `<span class="badge bg-secondary me-1">${ann.category}</span>` : '';
            const courseBadge = ann.audience_scope === 'course' && ann.course_abbr ?
              `<span class="badge bg-info">${ann.course_abbr}</span>` : '';
            
            return `
              <li class="list-group-item d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start mb-1">
                  <span class="fw-semibold text-truncate pe-2" title="${ann.title || ''}">
                    ${ann.title || ''}
                  </span>
                  <div class="d-flex gap-1 flex-shrink-0">
                    ${categoryBadge}
                    ${courseBadge}
                  </div>
                </div>
                <div class="small text-muted mb-2" style="min-height: 20px;">
                  ${ann.description ? ann.description.substring(0, 100) + (ann.description.length > 100 ? '...' : '') : ''}
                </div>
                <div class="d-flex justify-content-between small text-muted mt-auto">
                  <span class="text-truncate pe-2">
                    <i class="bi bi-person me-1"></i> ${ann.author_name || 'System'}
                  </span>
                  <span class="text-nowrap">
                    <i class="bi bi-clock me-1"></i> ${ann.formatted_date || ''}
                  </span>
                </div>
              </li>
            `;
          })
          .join('');
        if (annNote) {
          annNote.textContent = `Showing ${announcements.length} most recent announcements.`;
        }
      }
    }

    // Pending dues list - FIXED: Now correctly shows 'unpaid' status
    const duesList = selectInRoot(root, '#studentPendingDues');
    const duesNote = selectInRoot(root, '#studentDuesNote');
    if (duesList) {
      if (!pendingDues.length) {
        duesList.innerHTML =
          '<li class="list-group-item text-muted text-center py-4">No pending dues.</li>';
        if (duesNote) {
          duesNote.textContent = 'All dues are confirmed for the current academic year.';
        }
      } else {
        duesList.innerHTML = pendingDues
          .map((due) => {
            // Now correctly shows 'Unpaid' since PHP sends status as 'unpaid'
            const statusClass = due.status === 'unpaid' ? 'bg-danger' : 'bg-secondary';
            const statusText = due.status === 'unpaid' ? 'Unpaid' : due.status;
            
            return `
              <li class="list-group-item d-flex flex-column">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <span class="fw-semibold text-truncate pe-2" title="${due.fee_name || 'Organization Fee'}">
                    ${due.fee_name || 'Organization Fee'}
                  </span>
                  <span class="badge ${statusClass}">
                    ${statusText}
                  </span>
                </div>
                <div class="d-flex justify-content-between small text-muted mb-1">
                  <span class="text-truncate pe-2" title="${due.org_name || ''}">
                    <i class="bi bi-people me-1"></i> ${due.org_abbr || due.org_name || 'Organization'}
                  </span>
                  <span class="fw-bold text-nowrap">
                    ${due.formatted_amount || '₱0.00'}
                  </span>
                </div>
                <div class="small text-muted">
                  <i class="bi bi-receipt me-1"></i> ${due.receipt_no || 'Not applicable'}
                </div>
                <div class="small text-muted">
                  <i class="bi bi-calendar me-1"></i> ${due.formatted_due_date || 'No due date'}
                </div>
                ${due.academic_year ? `<div class="small text-muted">
                  <i class="bi bi-calendar-week me-1"></i> AY: ${due.academic_year}
                </div>` : ''}
              </li>
            `;
          })
          .join('');
        if (duesNote) {
          const dueWord = pendingDues.length === 1 ? 'due' : 'dues';
          duesNote.textContent = `You have ${pendingDues.length} unpaid organization fee${dueWord !== 'due' ? 's' : ''}.`;
        }
      }
    }
  }

  // ============ Fetch + auto-refresh ============

  async function fetchDashboardData(root) {
    if (!root) return;
    try {
      const resp = await fetch(`${DASHBOARD_API}?t=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const text = await resp.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        console.error('[student-dashboard] Failed to parse JSON:', text);
      }
      if (!resp.ok) {
        console.error('[student-dashboard] Request failed', resp.status, data);
        return;
      }
      renderDashboard(root, data);
    } catch (err) {
      console.error('[student-dashboard] fetch error', err);
    }
  }

  function startAutoRefresh(root) {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
      if (!document.querySelector(PANEL_SEL)) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        return;
      }
      fetchDashboardData(root);
    }, 15000); // every 15 seconds
  }

  // ============ Initializer ============

  function initStudentDashboard(root) {
    if (!root) return;

    if (root.dataset.studentHomeInit === '1') {
      currentRoot = root;
      fetchDashboardData(root);
      return;
    }

    root.dataset.studentHomeInit = '1';
    currentRoot = root;

    renderCalendar(root);
    fetchDashboardData(root);
    startAutoRefresh(root);
  }

  // ============ BOOT ============

  document.addEventListener('DOMContentLoaded', () => {
    const runInit = () => {
      const panel = document.querySelector(PANEL_SEL);
      if (panel) {
        initStudentDashboard(panel);
      }
    };

    runInit();

    const contentArea = document.getElementById('content-area') || document.body;
    const obs = new MutationObserver(runInit);
    obs.observe(contentArea, { childList: true, subtree: true });

    document.addEventListener('spa:navigated', runInit);

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest(ROUTE_MATCH);
      if (trigger) {
        setTimeout(runInit, 0);
      }
    });
  });
})();