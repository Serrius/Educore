// js/user-script.js

// Universal loader function (can be used by both user and treasurer)
function fadeOutIntroLoader() {
  const intro = document.getElementById('intro');

  if (!intro) return;

  intro.style.transition = 'opacity 0.5s ease-out';
  intro.style.opacity = '0';

  setTimeout(() => {
    if (intro && intro.parentNode) {
      intro.parentNode.removeChild(intro);
    }
  }, 500);
}

// Fade-out intro loader (same behavior as super-admin)
window.addEventListener('load', fadeOutIntroLoader);

document.addEventListener('DOMContentLoaded', function () {
  // ================== SIDEBAR TOGGLER ==================
  const toggler = document.querySelector('.toggler-btn');
  if (toggler) {
    toggler.addEventListener('click', function () {
      document.querySelector('#sidebar')?.classList.toggle('collapsed');
    });
  }

  // ================== SECTION NAVIGATION ==================
  // Default section
  showSection('home');

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', function (event) {
      // Skip dropdown toggle links (like ORGANIZATION parent)
      if (this.classList.contains('has-dropdown')) {
        return;
      }

      event.preventDefault();

      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('selected');
      });

      // Add 'selected' class to clicked link
      this.classList.add('selected');

      // Prefer data-section attribute; fallback to slug from text
      const attrSection = this.getAttribute('data-section');
      const section =
        attrSection ||
        this.textContent.trim().toLowerCase().replace(/\s+/g, '-');

      console.log('Switching section to:', section);

      showSection(section);
    });
  });

  function showSection(section) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    // Map section keys to user HTML file paths
    const sectionMap = {
      // Top-level
      home: 'pages/user/home-treasurer.html',
      announcements: 'pages/user/announcements.html',
      'organization-fees': 'pages/user/organization-fees.html',
      'transact-history': 'pages/user/transact-history.html',

      // Event Expenses module (for treasurer)
      'event-expenses': 'pages/user/event-expenses.html',

      // Organization dropdown pages (for treasurer)
      'dept-org-fee': 'pages/user/dept-org-fee.html',
      'general-org-fee': 'pages/user/general-org-fee.html',

      // Records (for treasurer)
       'records': 'pages/user/records.html',
      //clubs: 'pages/user/records.html', // uncomment if you want to use data-section="clubs"

      // Event Expenses
        'event-expenses': 'pages/user/event-expenses.html',
        'dept-event-expenses': 'pages/user/dept-event-expenses.html',
    };

    const fileName = sectionMap[section];
    if (!fileName) {
      console.warn(`No mapping found for section: ${section}`);
      return;
    }

    // Fetch and load HTML (same style as super-admin)
    fetch(fileName, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        contentArea.innerHTML = html;
        contentArea.classList.add('fade-in');
        setTimeout(() => contentArea.classList.remove('fade-in'), 300);
      })
      .catch(err => {
        console.error(`Error loading section ${section}:`, err);
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

  // ================== LOGOUT HANDLING (same as super-admin) ==================
  document.addEventListener('click', function (e) {
    if (e.target.closest('.logout-link, .logout-link a')) {
      e.preventDefault();
      const logoutModalEl = document.getElementById('logoutModal');
      if (!logoutModalEl) return;
      const logoutModal = new bootstrap.Modal(logoutModalEl);
      logoutModal.show();
      console.log('logout modal triggered');
    }
  });

  const logOutBtn = document.getElementById('logOutBtn');
  if (logOutBtn) {
    logOutBtn.addEventListener('click', () => {
      logoutUser();
    });
  }

  function logoutUser() {
    fetch('php/logout.php', {
      method: 'GET',
      credentials: 'include',
    })
      .then(() => {
        // Clear stored user info
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        localStorage.removeItem('profile_picture');
        localStorage.removeItem('user_id');
        localStorage.removeItem('id_number');
        localStorage.removeItem('department');

        // Redirect to login
        window.location.href = 'index.html';
      })
      .catch(err => console.error('Logout failed:', err));
  }

  // ================== USER INFO (NAME, ROLE, PROFILE PIC) ==================
  const fullName = localStorage.getItem('username');
  const role = localStorage.getItem('role');
  const profilePic = localStorage.getItem('profile_picture');
  const department = localStorage.getItem('currentUserDepartment');

  if (role === "non-admin") {
    localStorage.setItem('role', 'student');
    if (rankEl) rankEl.textContent = 'Student';
  }

  const usernameEl = document.querySelector('.username');
  const rankEl = document.querySelector('.rank');
  const departmentEl = document.querySelector('.department');
  const sidebarProfilePic = document.querySelector('.profile-picture');
  const navbarProfilePic = document.querySelector('.profile-icon');

  if (usernameEl) usernameEl.textContent = fullName ?? 'Unknown';
  if (rankEl) rankEl.textContent = role ?? 'Unknown';
  if (departmentEl) departmentEl.textContent = department ?? 'Unknown';
  console.log('User department:', department);

  if (profilePic) {
    const path = `${profilePic}`;
    if (sidebarProfilePic) sidebarProfilePic.src = path;
    if (navbarProfilePic) navbarProfilePic.src = path;
  }

  // Hide treasurer-specific elements for regular users
/*  const treasurerElements = document.querySelectorAll(
    '.sidebar-link[data-section="event-expenses"], ' +
    '.sidebar-link[data-section="dept-event-expenses"], ' +
    '.sidebar-link[data-section="records"], ' +
    '.sidebar-link[data-section="clubs"], ' +
    '.sidebar-link[data-section="dept-org-fee"], ' +
    '.sidebar-link[data-section="general-org-fee"]'
  );
  
  treasurerElements.forEach(el => {
    const parentItem = el.closest('.sidebar-item');
    if (parentItem) parentItem.style.display = 'none';
  });

  // Hide organization dropdown
  const organizationBlock = document
    .querySelector('.sidebar-link.has-dropdown[data-bs-target="#organization"]')
    ?.closest('.sidebar-item');
  if (organizationBlock) organizationBlock.style.display = 'none'; */
});