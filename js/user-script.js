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

    // Map sidebar text to HTML file names
    const sectionMap = {
        'home': 'home.html',
        'announcements': 'announcements.html',
        'events': 'events.html',
        'e-voting': 'e-voting.html',
        'organization-fees': 'organization-fees.html',
        'transact-history': 'transact-history.html'
    };

    const fileName = sectionMap[section];
    if (!fileName) return;

    // Fetch the HTML file and inject it
    fetch(fileName)
        .then(response => response.text())
        .then(html => {
            contentArea.innerHTML = html;
            contentArea.classList.add('fade-in');
            setTimeout(() => contentArea.classList.remove('fade-in'), 300);
        })
        .catch(err => {
            contentArea.innerHTML = `<p class="text-danger">Error loading ${section}.</p>`;
            console.error(err);
        });
}


    //trigger the popover
    var popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
    var popoverList = [...popoverTriggerList].map(el => new bootstrap.Popover(el));

    //bell button shenanigans
    let bellButton = document.getElementById("bellButton");
    let bellIcon = document.getElementById("bellIcon");

    // Initialize the Bootstrap Popover
    let popover = new bootstrap.Popover(bellButton);

    // Change icon when clicked
    bellButton.addEventListener("click", function() {
        bellIcon.classList.replace("bi-bell", "bi-bell-fill");
    });

    // Reset icon when popover is hidden (clicked outside)
    bellButton.addEventListener("hidden.bs.popover", function() {
        bellIcon.classList.replace("bi-bell-fill", "bi-bell");
    });


});



