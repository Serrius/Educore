// user-transact-history.js
// User transaction history: organization fee payments + print receipt

(function () {
  // ===== Helpers (reuse like user-announcements) =====
  if (typeof window.fetchJSON === "undefined") {
    window.fetchJSON = async function fetchJSON(url, options = {}) {
      const resp = await fetch(url, {
        cache: "no-store",
        credentials: "include",
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

  if (typeof window.debounce === "undefined") {
    window.debounce = function debounce(fn, wait = 150) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
      };
    };
  }

  if (typeof window.escapeHtml === "undefined") {
    window.escapeHtml = function escapeHtml(s) {
      return String(s ?? "").replace(/[&<>"']/g, (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
      );
    };
  }

  function getLoadingEl() {
    return document.getElementById("userTransLoading");
  }

  // ===== Academic Year state =====
  const activeYearState = {
    schoolYearText: null,
    startYear: null,
    endYear: null,
    activeYear: null,
  };

  // Pagination config
  const PAGINATION_CONFIG = {
    itemsPerPage: 10, // we're really only using the table here
    tableItemsPerPage: 10,
    currentPage: {
      active: 1,
    },
    totalItems: {
      active: 0,
    },
    viewMode: {
      active: "table", // force TABLE view as default
    },
  };

  let currentSection = null;
  let fetchFn = null;
  let refreshTimer = null;
  let currentStatusFilter = "all"; // all | paid | unpaid
  let lastPayments = []; // cache for print

  // ===== DOM helpers =====
  function getCardsContainer() {
    return document.getElementById("userTransCardsContainer");
  }
  function getTableBody() {
    return document.getElementById("userTransTableBody");
  }

  // ===== View toggle (cards / table) =====
  function setupViewToggle() {
    // Your current HTML does not have a view-toggle-group, but keep this safe
    const toggleGroup = document.querySelector(
      "#user-transaction-history .view-toggle-group"
    );
    if (!toggleGroup) return;

    const cardsView = document.getElementById("UserTransCardsView");
    const tableView = document.getElementById("UserTransTableView");

    const defaultView = PAGINATION_CONFIG.viewMode.active || "table";

    toggleGroup.querySelectorAll(".view-toggle-btn").forEach((btn) => {
      const viewType = btn.dataset.view;
      if (viewType === defaultView) btn.classList.add("active");
      else btn.classList.remove("active");
    });

    if (defaultView === "cards") {
      cardsView?.classList.remove("d-none");
      tableView?.classList.add("d-none");
    } else {
      cardsView?.classList.add("d-none");
      tableView?.classList.remove("d-none");
    }

    toggleGroup.querySelectorAll(".view-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const viewType = btn.dataset.view;
        if (PAGINATION_CONFIG.viewMode.active === viewType) return;

        toggleGroup
          .querySelectorAll(".view-toggle-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        PAGINATION_CONFIG.viewMode.active = viewType;
        PAGINATION_CONFIG.currentPage.active = 1;

        if (viewType === "cards") {
          cardsView?.classList.remove("d-none");
          tableView?.classList.add("d-none");
        } else {
          cardsView?.classList.add("d-none");
          tableView?.classList.remove("d-none");
        }

        fetchFn && fetchFn();
      });
    });
  }

  // ===== Tabs: All / Paid / Unpaid =====
  function setupStatusTabs() {
    const tabs = document.querySelectorAll(
      "#user-transaction-history [data-trans-status]"
    );
    if (!tabs.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        const status = String(tab.dataset.transStatus || "all").toLowerCase();

        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        currentStatusFilter = status; // all | paid | unpaid
        PAGINATION_CONFIG.currentPage.active = 1;
        fetchFn && fetchFn();
      });
    });
  }

  // ===== Pagination =====
  function renderPagination(totalItems, currentPage) {
    const container = document.getElementById("UserTransPagination");
    const infoContainer = document.getElementById("UserTransPaginationInfo");
    if (!container) {
      if (infoContainer) {
        infoContainer.textContent =
          totalItems > 0
            ? `Showing all ${totalItems} transaction(s)`
            : "No transactions found";
      }
      return;
    }

    const itemsPerPage =
      PAGINATION_CONFIG.viewMode.active === "table"
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (totalPages <= 1) {
      container.innerHTML = "";
      if (infoContainer) {
        infoContainer.textContent =
          totalItems > 0
            ? `Showing all ${totalItems} transaction(s)`
            : "No transactions found";
      }
      return;
    }

    let html = '<ul class="pagination pagination-sm mb-0">';

    html += `
      <li class="page-item ${currentPage === 1 ? "disabled" : ""}">
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
        <li class="page-item ${i === currentPage ? "active" : ""}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }

    html += `
      <li class="page-item ${currentPage === totalPages ? "disabled" : ""}">
        <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
      </li>
    `;
    html += "</ul>";

    container.innerHTML = html;

    if (infoContainer) {
      const startItem = (currentPage - 1) * itemsPerPage + 1;
      const endItem = Math.min(currentPage * itemsPerPage, totalItems);
      infoContainer.textContent = `Showing ${startItem}-${endItem} of ${totalItems} transaction(s)`;
    }

    container.querySelectorAll(".page-link").forEach((link) => {
      link.addEventListener("click", (e) => {
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
      PAGINATION_CONFIG.viewMode.active === "table"
        ? PAGINATION_CONFIG.tableItemsPerPage
        : PAGINATION_CONFIG.itemsPerPage;
    const currentPage = PAGINATION_CONFIG.currentPage.active || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return items.slice(startIndex, endIndex);
  }

  // ===== Render =====
  function renderPayments(list) {
    const viewMode = PAGINATION_CONFIG.viewMode.active;
    const cardsContainer = getCardsContainer();
    const tableBody = getTableBody();

    if (cardsContainer) cardsContainer.innerHTML = "";
    if (tableBody) tableBody.innerHTML = "";

    if (!list || list.length === 0) {
      if (viewMode === "table" && tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center text-muted py-3">
              No transactions found for the selected academic year and filters.
            </td>
          </tr>
        `;
      } else if (cardsContainer) {
        const empty = document.createElement("div");
        empty.className = "col-12";
        empty.innerHTML = `
          <div class="border rounded py-4 text-center text-muted">
            No transactions found for the selected academic year and filters.
          </div>
        `;
        cardsContainer.appendChild(empty);
      }
      return;
    }

    list.forEach((p) => {
      const dateStr = p.paid_on || p.created_at || "";
      const amount = Number(p.amount_paid || p.paid_amount || p.amount || 0);
      const amountText = window.money
        ? window.money(amount, p.currency || "PHP")
        : (p.currency || "PHP") + " " + amount.toFixed(2);

      const status = String(p.status || "").toLowerCase();
      let statusBadge = "";
      if (status === "confirmed") {
        statusBadge =
          '<span class="badge bg-success-subtle text-success border border-success-subtle">Paid</span>';
      } else if (status === "pending") {
        statusBadge =
          '<span class="badge bg-warning-subtle text-warning border border-warning-subtle">Pending</span>';
      } else if (status === "cancelled") {
        statusBadge =
          '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">Cancelled</span>';
      } else {
        statusBadge =
          '<span class="badge bg-secondary-subtle text-secondary">Unknown</span>';
      }

      if (viewMode === "table") {
        renderTableRow(p, amountText, dateStr, statusBadge);
      } else {
        renderCard(p, amountText, dateStr, statusBadge);
      }
    });
  }

  function renderTableRow(p, amountText, dateStr, statusBadge) {
    const body = getTableBody();
    if (!body) return;

    // Match HTML header:
    // 1: Receipt No.
    // 2: Date Paid
    // 3: Organization / Fee
    // 4: Amount
    // 5: Status
    // 6: Action
    const tr = document.createElement("tr");
    tr.dataset.id = p.id;
    tr.innerHTML = `
      <td>${window.escapeHtml(p.receipt_no || "—")}</td>
      <td>${window.escapeHtml(dateStr || "—")}</td>
      <td>
        <span class="d-block text-truncate" style="max-width:220px;">
          ${window.escapeHtml(p.org_name || "")}
        </span>
        <small class="text-muted d-block text-truncate" style="max-width:220px;">
          ${window.escapeHtml(p.fee_title || "Organization Fee")}
        </small>
      </td>
      <td class="text-end">${window.escapeHtml(amountText)}</td>
      <td>${statusBadge}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary userTransPrintBtn" data-id="${window.escapeHtml(
          p.id
        )}">
          <i class="bi bi-printer"></i>
        </button>
      </td>
    `;
    body.appendChild(tr);
  }

  function renderCard(p, amountText, dateStr, statusBadge) {
    const cardsContainer = getCardsContainer();
    if (!cardsContainer) return;

    const cardWrap = document.createElement("div");
    cardWrap.className = "col-md-6 col-lg-4 mb-3";

    const syText =
      p.school_year_start && p.school_year_end
        ? `${p.school_year_start}–${p.school_year_end}`
        : "—";

    cardWrap.innerHTML = `
      <div class="card shadow-sm h-100 border-0 trans-card"
           data-id="${window.escapeHtml(p.id)}"
           style="cursor:pointer;">
        <div class="card-body d-flex flex-column gap-2">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <div>
              <h6 class="mb-0 text-truncate" title="${window.escapeHtml(
                p.fee_title || "Organization Fee"
              )}">
                ${window.escapeHtml(p.fee_title || "Organization Fee")}
              </h6>
              <small class="text-muted">${window.escapeHtml(
                p.org_name || ""
              )}</small>
            </div>
            <div class="text-end">
              ${statusBadge}
              <div class="small text-muted mt-1">${window.escapeHtml(
                dateStr || "—"
              )}</div>
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center">
            <div class="small text-muted">
              <div><strong>SY:</strong> ${window.escapeHtml(syText)}</div>
            </div>
            <div class="fw-semibold">
              ${window.escapeHtml(amountText)}
            </div>
          </div>

          <div class="mt-auto pt-2 d-flex justify-content-between align-items-center border-top">
            <small class="text-muted">
              <i class="bi bi-person-circle me-1"></i>
              ${window.escapeHtml(p.full_name || "—")}
            </small>
            <button class="btn btn-sm btn-outline-secondary userTransPrintBtn" data-id="${window.escapeHtml(
              p.id
            )}">
              <i class="bi bi-printer"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    cardsContainer.appendChild(cardWrap);
  }

  // ===== Active Year (same pattern as user-announcements) =====
  function getSemesterDisplay(year, startYear, endYear) {
    if (year === startYear) return "1st Semester";
    if (year === endYear) return "2nd Semester";
    return String(year);
  }

  async function loadActiveYear() {
    const apiBase = "php/";
    const schoolYearEl = document.getElementById("userTransCurrentSchoolYear");
    const aySelect = document.getElementById("userTransAySelect");
    const activeYearSelect = document.getElementById(
      "userTransActiveYearSelect"
    );

    try {
      // Current active AY
      let activeData = null;
      try {
        activeData = await window.fetchJSON(
          `${apiBase}get-active-academic-year.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error("[user-trans] get-active-academic-year error:", e);
      }

      if (activeData && activeData.school_year) {
        activeYearState.schoolYearText = activeData.school_year;

        const parts = String(activeData.school_year).split("-");
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

        if (schoolYearEl) {
          schoolYearEl.textContent = activeData.school_year;
        }
      } else if (schoolYearEl) {
        schoolYearEl.textContent =
          activeData?.warning || "No active academic year";
      }

      // AY list
      let listData = null;
      try {
        listData = await window.fetchJSON(
          `${apiBase}get-academic-years.php?t=${Date.now()}`
        );
      } catch (e) {
        console.error("[user-trans] get-academic-years error:", e);
      }

      // Fill school year select
      if (aySelect) {
        let html = "";
        if (listData && listData.success && Array.isArray(listData.years)) {
          listData.years.forEach((row) => {
            const sy = parseInt(row.start_year, 10);
            const ey = parseInt(row.end_year, 10);
            const label =
              row.school_year ||
              (sy && ey ? `${sy}–${ey}` : String(row.school_year || "—"));
            const value = `${sy || ""}-${ey || ""}`;

            const isSelected =
              sy === activeYearState.startYear &&
              ey === activeYearState.endYear;

            html += `<option value="${window.escapeHtml(
              value
            )}" ${isSelected ? "selected" : ""}>${window.escapeHtml(
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
              : activeYearState.schoolYearText || "—";
          const val = `${sy || ""}-${ey || ""}`;
          html = `<option value="${window.escapeHtml(
            val
          )}">${window.escapeHtml(label)}</option>`;
        }

        aySelect.innerHTML = html;
      }

      // Fill semester select
      if (activeYearSelect) {
        const sy = activeYearState.startYear;
        const ey = activeYearState.endYear;
        let html = "";

        if (sy) {
          const txt = getSemesterDisplay(sy, sy, ey);
          html += `<option value="${sy}" ${
            activeYearState.activeYear === sy ? "selected" : ""
          }>${txt}</option>`;
        }
        if (ey && ey !== sy) {
          const txt = getSemesterDisplay(ey, sy, ey);
          html += `<option value="${ey}" ${
            activeYearState.activeYear === ey ? "selected" : ""
          }>${txt}</option>`;
        }
        activeYearSelect.innerHTML = html || `<option value="">—</option>`;
      }
    } catch (err) {
      console.error("[user-trans] loadActiveYear error:", err);
      if (schoolYearEl)
        schoolYearEl.textContent = "Error loading school year";
      if (aySelect) aySelect.innerHTML = `<option value="">—</option>`;
      if (activeYearSelect)
        activeYearSelect.innerHTML = `<option value="">—</option>`;
    }
  }

  // ===== Print helper (wrap your template) =====
  function buildDeptSelectedFromPayment(p) {
    // Build DEPT_SELECTED so your printSingleReceipt() template works
    window.DEPT_SELECTED = {
      fee: {
        title: p.fee_title || "Organization Fee",
        currency: p.currency || "PHP",
      },
      org: {
        name: p.org_name || "",
        abbreviation: p.org_abbreviation || "",
        course_abbr: p.course_abbr || "",
        logo_path: p.org_logo_path || "",
      },
    };
  }

  // ===== Global print function fallback =====
  if (typeof window.printSingleReceipt !== "function") {
    window.printSingleReceipt = function (payment) {
      if (!payment || !payment.id) {
        alert("Receipt not found or has no ID.");
        return;
      }

      // Use the same mPDF receipt (with letterhead) as records.js / org fees
      const url = `php/records-print-org-fee.php?payment_id=${encodeURIComponent(
        payment.id
      )}`;

      const w = window.open(url, "_blank");
      if (!w) {
        alert("Popup blocked. Please allow popups to print the receipt.");
      }
    };
  }

  function handlePrintById(id) {
    const payment = lastPayments.find((p) => String(p.id) === String(id));
    if (!payment) return;

    if (typeof window.printSingleReceipt !== "function") {
      console.error(
        "[user-trans] printSingleReceipt() is not defined globally."
      );
      alert("Print function not available.");
      return;
    }

    buildDeptSelectedFromPayment(payment);
    window.printSingleReceipt(payment);
  }

  // ===== Load payments =====
  async function loadPayments(q = "") {
    const apiBase = "php/";
    const params = new URLSearchParams();

    const loadingEl = getLoadingEl();
    if (loadingEl) loadingEl.classList.remove("d-none");

    // AY filters
    if (activeYearState.startYear)
      params.set("start_year", String(activeYearState.startYear));
    if (activeYearState.endYear)
      params.set("end_year", String(activeYearState.endYear));
    if (activeYearState.activeYear)
      params.set("active_year", String(activeYearState.activeYear));

    // Status: map tabs -> API
    if (currentStatusFilter && currentStatusFilter !== "all") {
      params.set("status", currentStatusFilter); // "paid" / "unpaid"
    }

    params.set("q", q);
    params.set("t", Date.now().toString());

    try {
      const data = await window.fetchJSON(
        `${apiBase}get-user-payment-history.php?${params.toString()}`
      );

      console.log("[user-trans] payload", data);

      let list = Array.isArray(data)
        ? data
        : Array.isArray(data.payments)
        ? data.payments
        : [];

      lastPayments = list.slice(); // keep a copy for print

      PAGINATION_CONFIG.totalItems.active = list.length;
      const paginated = getPaginatedItems(list);
      renderPayments(paginated);
      renderPagination(list.length, PAGINATION_CONFIG.currentPage.active);
    } catch (err) {
      console.error("[user-trans] loadPayments error", err);
      const body = getTableBody();
      const cards = getCardsContainer();
      if (body) {
        body.innerHTML = `
          <tr>
            <td colspan="6" class="text-center text-danger">Failed to load transactions.</td>
          </tr>
        `;
      }
      if (cards) {
        cards.innerHTML = `
          <div class="col-12">
            <div class="border rounded py-4 text-center text-danger">
              Failed to load transactions.
            </div>
          </div>
        `;
      }
    } finally {
      const loadingEl2 = getLoadingEl();
      if (loadingEl2) loadingEl2.classList.add("d-none");
    }
  }

  // ===== INIT =====
  document.addEventListener("DOMContentLoaded", () => {
    const runOnceOrAgain = () => {
      const el =
        document.querySelector("#user-transaction-history") || // your HTML id
        document.querySelector("#user-transact-history") || // fallback
        document.querySelector("#userTransactHistory") || // fallback
        document.querySelector("#user-transact-history-page"); // fallback

      if (!el) return;
      if (el !== currentSection) {
        currentSection = el;
        initUserTransactHistory(el);
        console.log("User Transaction History initialized ✅");
      }
    };

    const contentArea =
      document.getElementById("content-area") || document.body;
    const obs = new MutationObserver(runOnceOrAgain);
    obs.observe(contentArea, { childList: true, subtree: true });
    runOnceOrAgain();
  });

  function initUserTransactHistory(section) {
    if (!section) return;

    setupViewToggle();
    setupStatusTabs();

    const searchInput = document.getElementById("userTransSearch");
    const aySelect = document.getElementById("userTransAySelect");
    const activeYearSelect = document.getElementById(
      "userTransActiveYearSelect"
    );

    // Search
    searchInput?.addEventListener(
      "input",
      window.debounce((e) => {
        PAGINATION_CONFIG.currentPage.active = 1;
        loadPayments(e.target.value);
      }, 120)
    );

    // SY change
    aySelect?.addEventListener("change", () => {
      const val = aySelect.value || "";
      const [syRaw, eyRaw] = val.split("-");
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

      // Refresh semester dropdown
      if (activeYearSelect) {
        let html = "";
        if (!Number.isNaN(sy)) {
          const txt = getSemesterDisplay(sy, sy, ey);
          html += `<option value="${sy}" ${
            activeYearState.activeYear === sy ? "selected" : ""
          }>${txt}</option>`;
        }
        if (!Number.isNaN(ey) && ey !== sy) {
          const txt = getSemesterDisplay(ey, sy, ey);
          html += `<option value="${ey}" ${
            activeYearState.activeYear === ey ? "selected" : ""
          }>${txt}</option>`;
        }
        activeYearSelect.innerHTML = html || `<option value="">—</option>`;
      }

      PAGINATION_CONFIG.currentPage.active = 1;
      loadPayments(searchInput?.value || "");
    });

    // Semester change
    activeYearSelect?.addEventListener("change", () => {
      const yr = parseInt(activeYearSelect.value, 10);
      if (!Number.isNaN(yr)) {
        activeYearState.activeYear = yr;
        PAGINATION_CONFIG.currentPage.active = 1;
        loadPayments(searchInput?.value || "");
      }
    });

    // Click handlers (print: from button OR whole card)
    section.addEventListener("click", (e) => {
      const printBtn = e.target.closest(".userTransPrintBtn");
      if (printBtn) {
        const id = printBtn.dataset.id;
        if (id) handlePrintById(id);
        return;
      }

      const card = e.target.closest(".trans-card");
      if (card && !e.target.closest(".btn")) {
        const id = card.dataset.id;
        if (id) handlePrintById(id);
      }
    });

    // Fetch function + optional polling
    fetchFn = () => loadPayments(searchInput?.value || "");

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    loadActiveYear().then(() => {
      fetchFn();
      // If you want polling:
      // refreshTimer = setInterval(fetchFn, 10000);
    });
  }
})();
