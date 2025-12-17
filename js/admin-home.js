// super-admin-home.js
// Dashboard for super-admin home: KPIs + org fees chart + event funds chart + mini calendar

;(function () {
  'use strict';

  const PANEL_SEL   = '#homePage, #home-page, #superAdminHomePage';
  const ROUTE_MATCH = '[data-route="home"], [href="#home"]';

  const DASHBOARD_API = 'php/admin-homestats.php';

  let currentRoot = null;
  let autoRefreshTimer = null;
  let orgFeesChart = null;
  let eventFundsChart = null;

  // ============ Small helpers ============

  function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function semesterLabelFor(sy, ey, ay) {
    if (!sy || !ey || !ay) return null;
    if (Number(ay) === Number(sy)) return '1st Semester';
    if (Number(ay) === Number(ey)) return '2nd Semester';
    return null;
  }

  function selectInRoot(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function text(root, sel, value) {
    const el = selectInRoot(root, sel);
    if (el) el.textContent = value;
  }

  // ============ Calendar rendering ============

  function renderCalendar(root) {
    const body = selectInRoot(root, '#dashboardCalendarBody');
    const monthLabel = selectInRoot(root, '#calendarMonthLabel');
    const todayLabel = selectInRoot(root, '#calendarTodayLabel');
    if (!body) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11
    const today = now.getDate();

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    const firstWeekday = firstDay.getDay(); // 0=Sun
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

  // ============ Charts ============

  function getChartCanvas(chart) {
    if (!chart) return null;
    // Chart.js v3+: chart.canvas; older: chart.ctx.canvas
    return chart.canvas || (chart.ctx && chart.ctx.canvas) || null;
  }

  function ensureCharts(root) {
    if (typeof Chart === 'undefined') {
      console.warn('[dashboard] Chart.js not found; charts disabled.');
      return;
    }

    const orgCanvas = selectInRoot(root, '#orgFeesChart');
    const eventCanvas = selectInRoot(root, '#eventFundsChart');

    // ---- Org chart: destroy & recreate if canvas changed ----
    if (orgCanvas) {
      const existingOrgCanvas = getChartCanvas(orgFeesChart);
      if (orgFeesChart && existingOrgCanvas !== orgCanvas) {
        // DOM was replaced; rebuild chart on new canvas
        orgFeesChart.destroy();
        orgFeesChart = null;
      }

      if (!orgFeesChart) {
        orgFeesChart = new Chart(orgCanvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: [],
            datasets: [{
              label: 'Total Fees Collected (₱)',
              data: [],
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } },
              y: { beginAtZero: true },
            },
          },
        });
      }
    }

    // ---- Event chart: destroy & recreate if canvas changed ----
    if (eventCanvas) {
      const existingEventCanvas = getChartCanvas(eventFundsChart);
      if (eventFundsChart && existingEventCanvas !== eventCanvas) {
        eventFundsChart.destroy();
        eventFundsChart = null;
      }

      if (!eventFundsChart) {
        eventFundsChart = new Chart(eventCanvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels: [],
            datasets: [
              {
                label: 'Credits (₱)',
                data: [],
              },
              {
                label: 'Expenses (₱)',
                data: [],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } },
              y: { beginAtZero: true },
            },
          },
        });
      }
    }
  }

  function updateOrgChart(orgData, academicYear) {
    if (!orgFeesChart) return;

    const labels = [];
    const values = [];

    orgData.forEach((org) => {
      labels.push(org.abbreviation || org.name || 'Org');
      values.push(Number(org.total_collected || 0));
    });

    orgFeesChart.data.labels = labels;
    orgFeesChart.data.datasets[0].data = values;
    orgFeesChart.update('none');

    const sub = document.getElementById('orgChartSubtitle');
    if (sub && academicYear) {
      const { start_year, end_year } = academicYear;
      sub.textContent = `AY ${start_year}-${end_year}`;
    }
  }

  function updateEventChart(events, academicYear) {
    if (!eventFundsChart) return;

    const labels = [];
    const credits = [];
    const debits = [];

    events.forEach((ev) => {
      labels.push(ev.title || 'Event');
      credits.push(Number(ev.total_credits || 0));
      debits.push(Number(ev.total_debits || 0));
    });

    eventFundsChart.data.labels = labels;
    eventFundsChart.data.datasets[0].data = credits;
    eventFundsChart.data.datasets[1].data = debits;
    eventFundsChart.update('none');

    const sub = document.getElementById('eventChartSubtitle');
    if (sub && academicYear) {
      const { start_year, end_year } = academicYear;
      sub.textContent = `Credits vs Expenses · AY ${start_year}-${end_year}`;
    }
  }

  // ============ Render dashboard data ============

  function renderDashboard(root, payload) {
    if (!payload || !payload.success) return;

    const ay = payload.academic_year || {};
    const cards = payload.cards || {};
    const orgs = payload.org_fees || [];
    const events = payload.events || [];

    const sy = ay.start_year;
    const ey = ay.end_year;
    const activeYear = ay.active_year;
    const semLabel = ay.semester_label || semesterLabelFor(sy, ey, activeYear);

    // Academic year card
    if (sy && ey) {
      text(root, '#displayAcademicYear', `${sy} - ${ey}`);
    }
    if (typeof activeYear !== 'undefined' && activeYear !== null) {
      text(root, '#displayActiveYear', String(activeYear));
    }
    if (semLabel) {
      text(root, '#displaySemesterLabel', semLabel);
    } else {
      text(root, '#displaySemesterLabel', '—');
    }

    // KPI cards
    text(root, '#kpiActiveOrgs', String(cards.active_organizations || 0));
    text(root, '#kpiOrgFeesTotal', `₱${formatMoney(cards.total_org_fees || 0)}`);
    text(root, '#kpiEventCredits', `₱${formatMoney(cards.total_event_credits || 0)}`);
    text(root, '#kpiEventDebits', `₱${formatMoney(cards.total_event_debits || 0)}`);

    // Charts
    ensureCharts(root);
    updateOrgChart(orgs, ay);
    updateEventChart(events, ay);

    const welcomeToday = document.getElementById('welcomeToday');
    if (welcomeToday) {
      welcomeToday.textContent = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const welcomeUsername = document.getElementById('welcomeUsername');
    if (welcomeUsername) {
      const firstName = localStorage.getItem('firstName') || 'User';
      welcomeUsername.textContent = firstName;
    }

    // Top events list (right card)
    const list = selectInRoot(root, '#dashboardTopEvents');
    const note = selectInRoot(root, '#dashboardTopEventsNote');
    if (list) {
      if (!events.length) {
        list.innerHTML =
          '<li class="list-group-item text-muted">No events with funds for the current academic year.</li>';
        if (note) {
          note.textContent = 'No event credits or expenses recorded for the current academic year.';
        }
      } else {
        list.innerHTML = events
          .map((ev) => {
            const balance =
              Number(ev.total_credits || 0) - Number(ev.total_debits || 0);
            const orgLabel =
              ev.org_label ||
              (ev.scope === 'general'
                ? 'General (Campus-Wide)'
                : 'Organization');
            return `
              <li class="list-group-item d-flex flex-column">
                <div class="d-flex justify-content-between align-items-center">
                  <span class="fw-semibold text-truncate" title="${ev.title || ''}">
                    ${ev.title || ''}
                  </span>
                  <span class="badge bg-light text-dark border">
                    ₱${formatMoney(balance)}
                  </span>
                </div>
                <div class="d-flex justify-content-between small text-muted mt-1">
                  <span class="text-truncate" title="${orgLabel}">
                    ${orgLabel}
                  </span>
                  <span>
                    C: ₱${formatMoney(ev.total_credits || 0)} ·
                    E: ₱${formatMoney(ev.total_debits || 0)}
                  </span>
                </div>
              </li>
            `;
          })
          .join('');
        if (note) {
          note.textContent =
            'Showing events with recorded credits or expenses in the current academic year.';
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
        console.error('[dashboard] Failed to parse JSON:', text);
      }
      if (!resp.ok) {
        console.error('[dashboard] Request failed', resp.status, data);
        return;
      }
      renderDashboard(root, data);
    } catch (err) {
      console.error('[dashboard] fetch error', err);
    }
  }

  function startAutoRefresh(root) {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
      // If the panel is gone from DOM, stop refreshing
      if (!document.querySelector(PANEL_SEL)) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        return;
      }
      fetchDashboardData(root);
    }, 10000); // every 10 seconds
  }

  // ============ Initializer ============

  function initHomeDashboard(root) {
    if (!root) return;

    // If already initialized once, just refresh data when user comes back
    if (root.dataset.homeInit === '1') {
      currentRoot = root;
      fetchDashboardData(root); // force refresh latest data on re-click
      return;
    }

    // First-time init
    root.dataset.homeInit = '1';
    currentRoot = root;

    // Render calendar once
    renderCalendar(root);

    // Initial data load + polling
    fetchDashboardData(root);
    startAutoRefresh(root);
  }

  // ============ BOOT (SPA-safe) ============

  document.addEventListener('DOMContentLoaded', () => {
    const runInit = () => {
      const panel = document.querySelector(PANEL_SEL);
      if (panel) {
        initHomeDashboard(panel);
      }
    };

    // Initial attempt
    runInit();

    // Observe SPA content area
    const contentArea = document.getElementById('content-area') || document.body;
    const obs = new MutationObserver(runInit);
    obs.observe(contentArea, { childList: true, subtree: true });

    // Custom SPA hook (if you emit it)
    document.addEventListener('spa:navigated', runInit);

    // Route clicks (sidebar / nav)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest(ROUTE_MATCH);
      if (trigger) {
        setTimeout(runInit, 0);
      }
    });
  });
})();
