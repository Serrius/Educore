// Intro fade on load
window.addEventListener('load', () => {
  const intro = document.getElementById('intro');

  if (!intro) return;

  // Apply fade-out transition
  intro.style.transition = 'opacity 0.5s ease-out';
  intro.style.opacity = '0';

  // After transition, remove it completely from the DOM
  setTimeout(() => {
    if (intro && intro.parentNode) {
      intro.parentNode.removeChild(intro);
    }
  }, 500); // Match transition time
});

document.addEventListener('DOMContentLoaded', function () {
  // Toggle sidebar visibility
  const toggler = document.querySelector('.toggler-btn');
  if (toggler) {
    toggler.addEventListener('click', function () {
      document.querySelector('#sidebar')?.classList.toggle('collapsed');
    });
  }

  // Set the default section to be visible
  showSection('home');

  // Sidebar navigation
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', function (event) {
      // Skip dropdown toggle links
      if (this.classList.contains('has-dropdown')) {
        return;
      }

      event.preventDefault();

      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach((link) => {
        link.classList.remove('selected');
      });

      // Add 'selected' class to the clicked link
      this.classList.add('selected');

      // Get the text of the span inside the clicked link
      const section = this.textContent
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
      console.log(section);

      // Show the corresponding section
      showSection(section);
    });
  });

  // ---- Section loader (special-admin scope) ----
  function showSection(section) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    // Map sidebar text to HTML file names (SPECIAL ADMIN ONLY)
    const sectionMap = {
        home: 'pages/special-admin/home.html',
              // Content Management
        'manage-announcement': 'pages/special-admin/manage-announcement.html',
        'manage-accreditation': 'pages/special-admin/manage-accreditation.html',
        'event-expenses': 'pages/special-admin/event-expenses.html',

        // Organization
        'dept-org-fee': 'pages/special-admin/dept-org-fee.html',
        'general-org-fee': 'pages/special-admin/general-org-fee.html',
        
        //'clubs': 'pages/admin/clubs.html', -- removed
        'records': 'pages/special-admin/records.html',
    };

    const fileName = sectionMap[section];
    if (!fileName) {
      console.warn(`No mapping found for section: ${section}`);
      return;
    }

    // Fetch the HTML file and inject it
    fetch(fileName)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        contentArea.innerHTML = html;
        contentArea.classList.add('fade-in');
        setTimeout(() => contentArea.classList.remove('fade-in'), 300);
      })
      .catch((err) => {
        console.error(`Error loading section ${section}:`, err);
        // Pretty "Under Maintenance" card like super-admin
        contentArea.innerHTML = `
          <div style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              background-color: #fff;
              box-shadow: 0 4px 10px rgba(0,0,0,0.15);
              padding-left: 50px;
              border-radius: 8px;
              min-height: 250px;
          ">
              <div style="flex: 1; padding-right: 20px;">
                  <h2 class="text-warning">Page Under Maintenance</h2>
                  <p class="text-muted mb-0">
                      This section is currently being updated. Please check back later.
                  </p>
                  <small class="text-danger">[Error loading: ${section}]</small>
              </div>
              <div style="flex: 1; display: flex; justify-content: flex-end;">
                  <img src="assets/images/maintenance.gif" alt="Maintenance" style="height: 100%; object-fit: contain;">
              </div>
          </div>
        `;
      });
  }

  // ===== Notifications popover / bell =====
  // trigger the popover
  const popoverTriggerList = document.querySelectorAll(
    '[data-bs-toggle="popover"]',
  );
  const popoverList = [...popoverTriggerList].map(
    (el) => new bootstrap.Popover(el),
  );

  // bell button shenanigans
  const bellButton = document.getElementById('bellButton');
  const bellIcon = document.getElementById('bellIcon');

  // Initialize the Bootstrap Popover for the bell (if it exists)
  let popover = null;
  if (bellButton) {
    popover = new bootstrap.Popover(bellButton);

    // Change icon when clicked
    bellButton.addEventListener('click', function () {
      if (bellIcon) {
        bellIcon.classList.replace('bi-bell', 'bi-bell-fill');
      }
    });

    // Reset icon when popover is hidden (clicked outside)
    bellButton.addEventListener('hidden.bs.popover', function () {
      if (bellIcon) {
        bellIcon.classList.replace('bi-bell-fill', 'bi-bell');
      }
    });
  }

  // ===== Logout flow (copied pattern from super-admin) =====
  // Fix for backdrop staying: Use event delegation and handle modal properly
  document.addEventListener('click', function (e) {
    if (e.target.closest('.logout-link, .logout-link a')) {
      e.preventDefault();
      const logoutModalEl = document.getElementById('logoutModal');
      if (!logoutModalEl) {
        console.warn('logoutModal not found in DOM');
        return;
      }
      
      // Dispose of any existing modal instance
      const existingModal = bootstrap.Modal.getInstance(logoutModalEl);
      if (existingModal) {
        existingModal.dispose();
      }
      
      const logoutModal = new bootstrap.Modal(logoutModalEl, {
        backdrop: true,
        keyboard: true
      });
      logoutModal.show();
      console.log('logout modal triggered (special-admin)');
    }
  });

  const logOutBtn = document.getElementById('logOutBtn');
  if (logOutBtn) {
    logOutBtn.addEventListener('click', () => {
      logoutUser();
    });
  }

  // logout clears user info - FIXED to handle non-JSON responses
  function logoutUser() {
    // First hide the modal properly
    const logoutModalEl = document.getElementById('logoutModal');
    if (logoutModalEl) {
      const logoutModal = bootstrap.Modal.getInstance(logoutModalEl);
      if (logoutModal) {
        logoutModal.hide();
      }
    }
    
    fetch('php/logout.php', {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
      .then((res) => {
        // Try to parse as JSON first
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return res.json();
        } else {
          // If not JSON, assume logout was successful
          return { success: true };
        }
      })
      .then((data) => {
        if (data.success) {
          // Clear all localStorage keys related to user
          localStorage.removeItem('username');
          localStorage.removeItem('role');
          localStorage.removeItem('profile_picture');
          localStorage.removeItem('user_id');
          localStorage.removeItem('id_number');
          localStorage.removeItem('department');

          window.location.href = 'index.html'; // Redirect to login page
        } else {
          console.error('Logout failed:', data.message || 'Unknown error');
          // Still redirect to login page on failure
          window.location.href = 'index.html';
        }
      })
      .catch((err) => {
        console.error('Logout fetch error:', err);
        // On any error, still clear local storage and redirect
        localStorage.clear();
        window.location.href = 'index.html';
      });
  }

  // ===== Header user info bindings (username / role / profile picture) =====
  const fullName = localStorage.getItem('username');
  const role = localStorage.getItem('role');
  const profilePic = localStorage.getItem('profile_picture');

  const usernameEl = document.querySelector('.username');
  const rankEl = document.querySelector('.rank');
  const profilePictureEl = document.querySelector('.profile-picture');
  const profileIconEl = document.querySelector('.profile-icon');

  if (usernameEl) usernameEl.textContent = fullName ?? 'Unknown';
  if (rankEl) rankEl.textContent = role ?? 'Unknown';

  if (profilePic) {
    const src = `${profilePic}`;
    if (profilePictureEl) {
      profilePictureEl.src = src;
    }
    if (profileIconEl) {
      profileIconEl.src = src;
    }
  }

  // Optional: debug department for special-admin scoping
  console.log('special-admin department:', localStorage.getItem('department'));
});