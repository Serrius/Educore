// academic-year.js
"use strict";

//Success and Error Modals
function showSuccessModal(message) {
  document.getElementById('successDialogue').textContent = message;
  const modalEl = document.getElementById('statusSuccessModal');
  const modal = new bootstrap.Modal(modalEl);

  modalEl.addEventListener("hidden.bs.modal", () => {
    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
    document.body.classList.remove("modal-open");
    document.body.style.overflow = "";
  }, { once: true });

  modal.show();
}

function showErrorModal(message) {
  document.getElementById('errorDialogue').textContent = message;
  const modalEl = document.getElementById('statusErrorsModal');
  const modal = new bootstrap.Modal(modalEl);

  modalEl.addEventListener("hidden.bs.modal", () => {
    document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
    document.body.classList.remove("modal-open");
    document.body.style.overflow = "";
  }, { once: true });

  modal.show();
}

let lastAcademicYears = '';
let latestYears = [];          // store latest fetched years for display
let fetchIntervalId = null;    // avoid duplicate intervals

function updateCurrentAcademicYearDisplay(years) {
  const displayAcademicYear = document.getElementById("displayAcademicYear");
  const displayActiveYear = document.getElementById("displayActiveYear");
  const switchContainer = document.getElementById("switchYearContainer");
  const switchBtn = document.getElementById("switchYearBtn");

  if (!displayAcademicYear || !displayActiveYear) return;

  const activeYear = years.find(y => y.status === "Active");

  if (activeYear) {
    displayAcademicYear.textContent = `${activeYear.start_year} - ${activeYear.end_year}`;
    displayActiveYear.textContent = activeYear.active_year;
    displayActiveYear.className = "badge bg-success";

    // If switch UI exists, set it up
    if (switchContainer && switchBtn) {
      // Show button only for the current active record
      switchContainer.classList.remove("d-none");
      switchBtn.dataset.id = activeYear.id;
      // Decide the text depending on current active_year
      if (Number(activeYear.active_year) === Number(activeYear.start_year)) {
        switchBtn.textContent = "Switch to End Year";
      } else {
        switchBtn.textContent = "Switch to Start Year";
      }
    }
  } else {
    displayAcademicYear.textContent = "0000 - 0000";
    displayActiveYear.textContent = "----";
    displayActiveYear.className = "badge bg-secondary";
    if (switchContainer) switchContainer.classList.add("d-none");
  }
}

function initAcademicYear() {
  const tableBody = document.getElementById("academicYearTableBody");
  if (!tableBody) return;

  function fetchAcademicYears() {
    fetch(`php/get-academic-years.php?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (!data || !Array.isArray(data.years)) {
          console.error("Unexpected response from get-academic-years.php", data);
          return;
        }

        const currentData = JSON.stringify(data.years);
        // If identical, still update the current card (in case switch happened elsewhere)
        if (currentData === lastAcademicYears) {
          // still update the current card from latestYears (no DOM rebuild)
          updateCurrentAcademicYearDisplay(latestYears);
          return;
        }
        lastAcademicYears = currentData;
        latestYears = data.years;

        // Build rows
        tableBody.innerHTML = "";
        latestYears.forEach(year => {
          const isActive = year.status === "Active";
          const actionHTML = isActive
            ? `<button class="btn btn-sm btn-primary switch-year" data-id="${year.id}">
                 Switch to ${Number(year.active_year) === Number(year.start_year) ? "End" : "Start"} Year
               </button>`
            : `<button class="btn btn-sm btn-success activate-year" data-id="${year.id}">
                 <i class="bi bi-check2-circle"></i> Activate
               </button>`;

          tableBody.innerHTML += `
            <tr>
              <td>${year.id}</td>
              <td>${year.start_year} - ${year.end_year}</td>
              <td><span class="badge bg-success">${year.active_year}</span></td>
              <td><span class="badge bg-${isActive ? "primary" : "secondary"}">${year.status}</span></td>
              <td>${year.created_at}</td>
              <td class="academic-year-actions">${actionHTML}</td>
            </tr>
          `;
        });

        // Update the top card
        updateCurrentAcademicYearDisplay(latestYears);

        attachYearEvents();
      })
      .catch(err => {
        console.error("Failed to fetch academic years:", err);
      });
  }

  // Add year form
  const addAcademicYearForm = document.getElementById("addAcademicYearForm");
  if (addAcademicYearForm) {
      addAcademicYearForm.addEventListener("submit", e => {
          e.preventDefault();
          const formData = new FormData(addAcademicYearForm);

          fetch("php/add-academic-year.php", {
              method: "POST",
              body: formData
          })
          .then(res => res.json())
          .then(data => {
              if (data.success) {
                  bootstrap.Modal.getInstance(document.getElementById("addAcademicYearModal")).hide();
                  addAcademicYearForm.reset();
                  fetchAcademicYears(); // refresh the list/table
                  showSuccessModal("Academic year added!");
              } else {
                  showErrorModal(data.message || "Failed to add academic year");
              }
          })
          .catch(err => {
              console.error("Error adding academic year:", err);
              showErrorModal("Request failed.");
          });
      });
  }

  function attachYearEvents() {
    // Delegate: activate-year
    document.querySelectorAll(".activate-year").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (!id) return;
        fetch("php/activate-academic-year.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "id=" + encodeURIComponent(id)
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            showSuccessModal("Academic year activated!");
            fetchAcademicYears();
          } else {
            showErrorModal(res.message || "Failed to activate academic year");
          }
        })
        .catch(err => {
          console.error("activate error:", err);
          showErrorModal("Request failed.");
        });
      };
    });

    // Delegate: switch-year
    document.querySelectorAll(".switch-year").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (!id) return;
        fetch("php/switch-academic-year.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "id=" + encodeURIComponent(id)
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            showSuccessModal("Academic year switched!");
            fetchAcademicYears();
          } else {
            showErrorModal(res.message || "Failed to switch academic year");
          }
        })
        .catch(err => {
          console.error("switch error:", err);
          showErrorModal("Request failed.");
        });
      };
    });

    // Top card switch button (if present)
    const switchYearBtn = document.getElementById("switchYearBtn");
    if (switchYearBtn) {
      switchYearBtn.onclick = (e) => {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        // reuse switch endpoint
        fetch("php/switch-academic-year.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "id=" + encodeURIComponent(id)
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            showSuccessModal("Academic year switched!");
            fetchAcademicYears();
          } else {
            showErrorModal(res.message || "Failed to switch academic year");
          }
        })
        .catch(err => {
          console.error("top switch error:", err);
          showErrorModal("Request failed.");
        });
      };
    }
  }

  // If there's an existing interval, clear it before creating a new one
  if (fetchIntervalId) {
    clearInterval(fetchIntervalId);
    fetchIntervalId = null;
  }

  // initial fetch and set the interval to call the fetch function itself
  fetchAcademicYears();
  fetchIntervalId = setInterval(fetchAcademicYears, 5000);
}

// MutationObserver approach (runs when the partial is injected)
document.addEventListener("DOMContentLoaded", () => {
  const observer = new MutationObserver(() => {
    const tableBody = document.getElementById("academicYearTableBody");
    if (tableBody && !tableBody.dataset.init) {
      tableBody.dataset.init = "true";

      // reset cache so fetchAcademicYears will always render fresh
      lastAcademicYears = '';
      latestYears = [];

      initAcademicYear();
      console.log("Academic Year initialized ✅");
    }
  });

  const contentArea = document.getElementById("content-area");
  if (contentArea) {
    observer.observe(contentArea, { childList: true, subtree: true });
  }
});
