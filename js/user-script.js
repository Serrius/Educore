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

  // ================== QUICK LINKS HANDLING ==================
  // Add event listener for Quick Links (dashboard shortcut buttons)
  document.addEventListener('click', function(e) {
    // Check if clicked element is a Quick Link
    const quickLink = e.target.closest('a[href^="#"]');
    if (!quickLink) return;
    
    const href = quickLink.getAttribute('href');
    
    // Map of Quick Link hrefs to sections (from dashboard to actual pages)
    const quickLinkMap = {
      '#announcements': 'announcements',
      '#organizations': 'organization-fees',
      '#dues': 'transact-history',
      '#profile': 'dept-event-expenses'
    };
    
    const section = quickLinkMap[href];
    if (section) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('Quick Link clicked:', href, '->', section);
      
      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('selected');
      });
      
      // Try multiple ways to find the corresponding sidebar link
      let sidebarLink = null;
      
      // First try: Exact data-section match
      sidebarLink = document.querySelector(`.sidebar-link[data-section="${section}"]`);
      
      // Second try: Partial match in data-section
      if (!sidebarLink) {
        sidebarLink = document.querySelector(`.sidebar-link[data-section*="${section}"]`);
      }
      
      // Third try: Match by text content (case insensitive)
      if (!sidebarLink) {
        const allSidebarLinks = document.querySelectorAll('.sidebar-link');
        allSidebarLinks.forEach(link => {
          const linkText = link.textContent.trim().toLowerCase().replace(/\s+/g, '-');
          if (linkText === section || linkText.includes(section)) {
            sidebarLink = link;
          }
        });
      }
      
      // If we found a matching sidebar link, select it
      if (sidebarLink) {
        sidebarLink.classList.add('selected');
        console.log('Found and selected sidebar link:', sidebarLink);
      } else {
        console.log('Could not find matching sidebar link for section:', section);
      }
      
      // Show the section
      showSection(section);
    }
  });

  function showSection(section) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    // Map section keys to user HTML file paths
    const sectionMap = {
      // Top-level
      home: 'pages/user/home.html',
      announcements: 'pages/user/announcements.html',
      'organization-fees': 'pages/user/organization-fees.html',
      'transact-history': 'pages/user/transact-history.html',
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

  const usernameEl = document.querySelector('.username');
  const rankEl = document.querySelector('.rank');
  const departmentEl = document.querySelector('.department');
  const sidebarProfilePic = document.querySelector('.profile-picture');
  const navbarProfilePic = document.querySelector('.profile-icon');

  // Update role if it's "non-admin"
  let displayRole = role;
  if (role === "non-admin") {
    localStorage.setItem('role', 'student');
    displayRole = 'student';
  }

  if (usernameEl) usernameEl.textContent = fullName ?? 'Unknown';
  if (rankEl) rankEl.textContent = displayRole ? displayRole.charAt(0).toUpperCase() + displayRole.slice(1) : 'Unknown';
  if (departmentEl) departmentEl.textContent = department ? department.charAt(0).toUpperCase() + department.slice(1) : 'Unknown';
  console.log('User department:', department);

  if (profilePic) {
    const path = `${profilePic}`;
    if (sidebarProfilePic) sidebarProfilePic.src = path;
    if (navbarProfilePic) navbarProfilePic.src = path;
  }
});