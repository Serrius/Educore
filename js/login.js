document.addEventListener('DOMContentLoaded', () => {
    const usernameField = document.getElementById('username');
    const passwordField = document.getElementById('password');
    const rememberMeCheckbox = document.getElementById('rememberMe');

    // Load saved credentials if cookies exist
    if (document.cookie) {
        const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
            const [name, value] = cookie.split('=');
            acc[name] = decodeURIComponent(value);
            return acc;
        }, {});

        if (cookies.username && cookies.password) {
            usernameField.value = cookies.username;
            passwordField.value = cookies.password;
            rememberMeCheckbox.checked = true;
        }
    }

    // Save credentials if "Remember Me" is checked
    document.getElementById('loginForm').addEventListener('submit', () => {
        if (rememberMeCheckbox.checked) {
            document.cookie = `username=${encodeURIComponent(usernameField.value)}; path=/; max-age=2592000`; // 30 days
            document.cookie = `password=${encodeURIComponent(passwordField.value)}; path=/; max-age=2592000`; // 30 days
        } else {
            // Clear cookies if "Remember Me" is unchecked
            document.cookie = 'username=; path=/; max-age=0';
            document.cookie = 'password=; path=/; max-age=0';
        }
    });

    var modal = document.getElementById("intro");

            // Show the modal when the page loads
            modal.style.display = "block";
            console.log("Modal loaded successfully!");

            // Function to close the modal with a fade-out effect
            function closeModal() {
                modal.style.animation = "fadeOut 3s";
                setTimeout(function() {
                    modal.style.display = "none";
                }, 3000); // Match this to the duration of the fade-out animation
                console.log("Modal faded and closed!");
            }
            // Close the modal automatically after 2 seconds
            setTimeout(closeModal, 4000);
            
            //blurring the ustp logo before showing the hd on
            const blurDivs = document.querySelectorAll(".blur-load");
                blurDivs.forEach(div => {
                const img = div.querySelector("img");

                function loaded() {
                    div.classList.add("loaded");
                }

                if (img.complete) {
                    loaded();
                } else {
                    img.addEventListener("load", loaded);
                }
            });

            document.getElementById('loginForm').addEventListener('submit', function (e) {
                e.preventDefault();
              
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
              
                fetch('php/login.php', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ username, password })
                })
                  .then(response => response.json())
                  .then(data => {
                    if (data.success) {
                      // Debug log
                      console.log("Storing in localStorage:", data);
                    
                      localStorage.setItem('id', data.id);
                      localStorage.setItem('username', data.full_name); // not just the input username
                      localStorage.setItem('role', data.role);
                    
                      if (data.profile_picture) {
                        localStorage.setItem('profile_picture', data.profile_picture);
                      }
                    
                      switch (data.role) {
                        case 'super-admin':
                          window.location.href = 'super-admin.html';
                          break;
                        case 'admin':
                          window.location.href = 'admin.html';
                          break;
                        case 'non-admin':
                          window.location.href = 'user.html';
                          break;
                        default:
                          alert("Unknown role");
                      }                                      
                    } else {
                      alert(data.message || 'Login failed.');
                    }
                  })
                  .catch(error => {
                    console.error('Error:', error);
                  });
              });
              

});

