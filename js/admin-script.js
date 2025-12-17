
window.addEventListener('load', () => {
    const intro = document.getElementById('intro');

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
  const toggler = document.querySelector(".toggler-btn");
    if (toggler) {
        toggler.addEventListener("click", function () {
            document.querySelector("#sidebar").classList.toggle("collapsed");
        });
}

    // Set the default section to be visible
    showSection('home');

    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', function (event) {
            // Skip dropdown toggle links
            if (this.classList.contains('has-dropdown')) {
                return;
            }
    
            event.preventDefault();
    
            // Remove 'selected' class from all sidebar links
            document.querySelectorAll('.sidebar-link').forEach(link => {
                link.classList.remove('selected');
            });
    
            // Add 'selected' class to the clicked link
            this.classList.add('selected');
    
            // Get the text of the span inside the clicked link
            const section = this.textContent.trim().toLowerCase().replace(/\s+/g, '-');
            console.log(section);
    
            // Show the corresponding section
            showSection(section);
        });
    });    

   function showSection(section) {
    const contentArea = document.getElementById('content-area');

    // Map section keys to HTML file paths
    const sectionMap = {
        'home': 'pages/super-admin/home.html',

        // Content Management
        'manage-announcement': 'pages/admin/manage-announcement.html',
        'manage-accreditation': 'pages/admin/manage-accreditation.html',
        'event-expenses': 'pages/admin/event-expenses.html',

        // Organization
        'dept-org-fee': 'pages/admin/dept-org-fee.html',
        'general-org-fee': 'pages/admin/general-org-fee.html',
        
        //'clubs': 'pages/admin/clubs.html', -- removed
        'records': 'pages/admin/records.html',

        //'e-voting': 'pages/super-admin/e-voting.html' --remove comment if you want to add this function
    };

    const fileName = sectionMap[section];
    if (!fileName) {
        console.warn(`No mapping found for section: ${section}`);
        return;
    }

    // Fetch and load HTML
    fetch(fileName)
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

document.addEventListener('click', function (e) {
    if (e.target.closest('.logout-link, .logout-link a')) {
        e.preventDefault();
        const logoutModal = new bootstrap.Modal(document.getElementById('logoutModal'));
        logoutModal.show();
        console.log('logout modal triggered');
    }
});

const logOutBtn = document.getElementById("logOutBtn");

  if (logOutBtn) {
    logOutBtn.addEventListener("click", () => {
      logoutUser(); // call your function
    });
  }

//logout clears user info
    function logoutUser() {
    fetch('php/logout.php', {
        method: 'GET',
        credentials: 'include'
    })
        .then(() => {
        // The PHP already redirected the session,
        // so we do the front-end redirect manually.
        
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        localStorage.removeItem('profile_picture');
        localStorage.removeItem('user_id');
        localStorage.removeItem('id_number');
        localStorage.removeItem('department');  

        // Force navigation to login page
        window.location.href = 'index.html';
        })
        .catch(err => console.error('Logout failed:', err));
    }

      const fullName = localStorage.getItem('username');
      const role = localStorage.getItem('role');
      const profilePic = localStorage.getItem('profile_picture');
      const department = localStorage.getItem('currentUserDepartment');
  
      document.querySelector('.username').textContent = fullName ?? 'Unknown';
      document.querySelector('.rank').textContent = role ?? 'Unknown';
      document.querySelector('.department').textContent = department ?? 'Unknown';
  
      if (profilePic) {
        document.querySelector('.profile-picture').src = `${profilePic}` ?? 'assets/images/profile.png';
        document.querySelector('.profile-icon').src = `${profilePic}` ?? 'assets/images/profile.png'; 
      }

});
