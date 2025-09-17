    document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById('registrationForm');
    const steps = document.querySelectorAll('.form-step');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progressBar = document.querySelector('.progress-bar');
    let currentStep = 0;
    const emailInput = document.getElementById("email");
    const fullNameInput = document.getElementById("fullName");

  // --- Email: force lowercase + validate ---
  if (emailInput) {
    emailInput.addEventListener("input", () => {
      // always lowercase
      emailInput.value = emailInput.value.toLowerCase();

      // validate simple email regex
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value);
      if (!valid) {
        emailInput.classList.add("is-invalid");
      } else {
        emailInput.classList.remove("is-invalid");
      }
    });
  }

  // --- Full Name: auto-capitalize after spaces ---
  if (fullNameInput) {
    fullNameInput.addEventListener("input", () => {
      let value = fullNameInput.value;

      // Split by spaces and capitalize first letter of each word
      value = value.replace(/\b\w/g, char => char.toUpperCase());

      fullNameInput.value = value;
    });
  }

    // ----- ID Number: allow digits only -----
  const idInput = document.getElementById("idNumber");
  if (idInput) {
    // strip non-digits on each input
    idInput.addEventListener("input", () => {
      idInput.value = idInput.value.replace(/\D+/g, "");
    });

    // sanitize pasted content
    idInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text") || "";
      const digits = text.replace(/\D+/g, "");
      // insert sanitized paste
      if (document.execCommand) {
        document.execCommand("insertText", false, digits);
      } else {
        // fallback
        const start = idInput.selectionStart || idInput.value.length;
        const end = idInput.selectionEnd || idInput.value.length;
        idInput.value = idInput.value.slice(0, start) + digits + idInput.value.slice(end);
        idInput.selectionStart = idInput.selectionEnd = start + digits.length;
      }
    });
  }  

    let lastCoursesHash = '';
    let coursesIntervalId = null;

    function refreshCoursesSelect() {
      const courseSelect = document.getElementById("course");
      if (!courseSelect) return;

      // If the user is interacting, don't touch it to avoid flicker
      if (document.activeElement === courseSelect) return;

      fetch(`php/get-courses.php?t=${Date.now()}`)
        .then(res => res.json())
        .then(courses => {
          const list = Array.isArray(courses) ? courses : (courses.courses || []);
          const activeOnly = list.filter(c => (c.status || "Active") === "Active");

          // Hash the meaningful parts; if no change, bail
          const hash = JSON.stringify(
            activeOnly.map(c => ({
              a: c.abbreviation || '',
              n: c.course_name || '',
              s: c.status || 'Active'
            }))
          );
          if (hash === lastCoursesHash) return; // nothing changed

          lastCoursesHash = hash;

          // Preserve current selection (value is abbreviation or id)
          const prevValue = courseSelect.value;

          // Rebuild options (only set the abbreviation to show scrapped the whole Idea to put the whole course name)
          courseSelect.innerHTML = `<option value="" disabled>Select course</option>`;
          activeOnly.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.abbreviation;        // value = abbreviation
            opt.textContent = c.abbreviation;  // show only abbreviation
            courseSelect.appendChild(opt);
          });

          if (activeOnly.length === 0) {
            courseSelect.innerHTML = `<option value="" disabled selected>No active courses found</option>`;
            return;
          }

          // Restore selection if still available; otherwise keep placeholder unselected
          if (prevValue && [...courseSelect.options].some(o => o.value === prevValue)) {
            courseSelect.value = prevValue;
          } else {
            // Leave placeholder visible
            courseSelect.selectedIndex = 0;
          }
        })
        .catch(err => {
          console.error("Failed to load courses:", err);
          courseSelect.innerHTML = `<option value="" disabled selected>Unable to load courses</option>`;
        });
    }

    let lastYearHash = '';
    function refreshSchoolYear() {
      const schoolYearInput = document.getElementById("schoolYear");
      if (!schoolYearInput) return;

      fetch(`php/get-academic-years.php?t=${Date.now()}`)
        .then(res => res.json())
        .then(data => {
          const years = Array.isArray(data) ? data : (data.years || []);
          const active = years.find(y => y.status === "Active");
          if (!active) {
            if (schoolYearInput.value !== "Unavailable") {
              schoolYearInput.value = "Unavailable";
              schoolYearInput.classList.add("is-invalid");
            }
            return;
          }

          const start = Number(active.start_year);
          const end = active.end_year ? Number(active.end_year) : (isFinite(start) ? start + 1 : "");
          const display = `${start}-${end}`;

          // Only update if changed
          const hash = `${display}|${active.id ?? ''}`;
          if (hash === lastYearHash) return;
          lastYearHash = hash;

          schoolYearInput.classList.remove("is-invalid");
          schoolYearInput.value = display;
          schoolYearInput.dataset.yearId = active.id || "";
        })
        .catch(err => {
          console.error("Failed to load academic years:", err);
          schoolYearInput.value = "Unavailable";
          schoolYearInput.classList.add("is-invalid");
        });
    }

    // Initial load
    refreshCoursesSelect();
    refreshSchoolYear();

    // Poll every 5s (lightweight; skips rebuilds when nothing changed)
    coursesIntervalId = setInterval(() => {
      refreshCoursesSelect();
      refreshSchoolYear();
    }, 5000);

    let captchaAnswer;
    function generateCaptcha() {
      const num1 = Math.floor(Math.random() * 10) + 1;
      const num2 = Math.floor(Math.random() * 10) + 1;
      captchaAnswer = num1 + num2;
      document.getElementById('captchaQuestion').textContent = `${num1} + ${num2}`;
    }

    function showStep(stepIndex, direction = 'next') {
      const current = steps[currentStep];
      const next = steps[stepIndex];

      if (direction === 'next') {
        current.classList.add('slide-left');
        next.classList.add('slide-right');
      } else {
        current.classList.add('slide-right');
        next.classList.add('slide-left');
      }

      current.style.opacity = '0';
      setTimeout(() => {
        steps.forEach((step, index) => {
          step.classList.remove('active', 'slide-left', 'slide-right');
          step.style.display = 'none';
          step.style.opacity = '0';
        });
        next.style.display = 'block';
        setTimeout(() => {
          next.classList.add('active');
          next.style.opacity = '1';
        }, 10);
      }, 300);

      prevBtn.disabled = stepIndex === 0;
      nextBtn.textContent = stepIndex === steps.length - 1 ? 'Submit' : 'Next';
      progressBar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
      progressBar.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
      updateNextButton();
      if (stepIndex === steps.length - 1) generateCaptcha();
    }

    function validateStep(stepIndex) {
      const inputs = steps[stepIndex].querySelectorAll('input[required]');
      let isValid = true;
      inputs.forEach(input => {
        if (!input.value.trim()) {
          isValid = false;
          input.classList.add('is-invalid');
        } else {
          input.classList.remove('is-invalid');
        }
      });

      if (stepIndex === steps.length - 1) {
        const captchaInput = document.getElementById('captcha');
        if (parseInt(captchaInput.value) !== captchaAnswer) {
          isValid = false;
          captchaInput.classList.add('is-invalid');
        } else {
          captchaInput.classList.remove('is-invalid');
        }

        const pw = document.getElementById('password').value.trim();
        const confirm = document.getElementById('confirmPassword').value.trim();
        if (pw !== confirm) {
          isValid = false;
          document.getElementById('confirmPassword').classList.add('is-invalid');
        } else {
          document.getElementById('confirmPassword').classList.remove('is-invalid');
        }
      }

      return isValid;
    }

    function updateNextButton() {
      nextBtn.disabled = !validateStep(currentStep);
    }

    steps.forEach(step => {
      step.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updateNextButton);
      });
    });

    prevBtn.addEventListener('click', () => {
      if (currentStep > 0) {
        currentStep--;
        showStep(currentStep, 'prev');
      }
    });

//Submit the form to php
nextBtn.addEventListener('click', () => {
  if (validateStep(currentStep)) {
    if (currentStep < steps.length - 1) {
      // Go to next step
      currentStep++;
      showStep(currentStep, 'next');
    } else {
      // === Final Step: submit the registration form ===
      const formData = new FormData(form);

      // 🔹 Added: Console log all registration inputs
      console.log("=== Registration Form Data ===");
      for (let [key, value] of formData.entries()) {
        console.log(`${key}: ${value}`);
      }
      console.log("================================");

      fetch("php/register.php", {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            // Hide form + progress bar
            const progressWrap = document.querySelector('.progress');
            const successCard = document.getElementById('registerSuccess');
            const fullName = document.getElementById('fullName')?.value?.trim() || '';

            if (progressWrap) progressWrap.classList.add('d-none');
            form.classList.add('d-none');

            // Personalize the success text
            const successText = document.getElementById('successText');
            if (successText) {
              successText.textContent = fullName
                ? `Welcome aboard, ${fullName}! Your account has been created.`
                : `Your account has been created.`;
            }

            // Show success card
            if (successCard) {
              successCard.classList.remove('d-none');
              successCard.classList.add('fade-in');
            }

            // Reset form in background
            form.reset();
            currentStep = 0;
          } else {
            // Show inline error if backend failed
            alert(data.message || "Registration failed. Please try again.");
          }
        })
        .catch(err => {
          console.error("Registration error:", err);
          alert("A server error occurred. Please try again later.");
        });
    }
  }
});


    showStep(currentStep);

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

console.log("this script is running in background");
});            