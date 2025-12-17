document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById('registrationForm');
  const steps = document.querySelectorAll('.form-step');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const progressBar = document.querySelector('.progress-bar');
  let currentStep = 0;

  const emailInput = document.getElementById("email");

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

  // --- Name fields: auto-capitalize each word ---
  ["firstName", "middleName", "lastName", "suffix"].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener("input", () => {
        let value = field.value;
        value = value.replace(/\b\w/g, char => char.toUpperCase());
        field.value = value;
      });
    }
  });

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

  // ===== Dynamic Course & School Year Loading =====
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

        // Preserve current selection
        const prevValue = courseSelect.value;

        // Rebuild options (abbreviation only)
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

        // Restore selection if still available; otherwise keep placeholder
        if (prevValue && [...courseSelect.options].some(o => o.value === prevValue)) {
          courseSelect.value = prevValue;
        } else {
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

  // ===== Multi-step logic (no CAPTCHA) =====
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
  }

  function validateStep(stepIndex) {
    const inputs = steps[stepIndex].querySelectorAll('input[required], select[required]');
    let isValid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        isValid = false;
        input.classList.add('is-invalid');
      } else {
        input.classList.remove('is-invalid');
      }
    });

    // Extra validation on last step: password match
    if (stepIndex === steps.length - 1) {
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
    step.querySelectorAll('input, select').forEach(input => {
      input.addEventListener('input', updateNextButton);
      input.addEventListener('change', updateNextButton);
    });
  });

  prevBtn.addEventListener('click', () => {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep, 'prev');
    }
  });

  // Submit / Next handler
  nextBtn.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;

    if (currentStep < steps.length - 1) {
      currentStep++;
      showStep(currentStep, 'next');
    } else {
      // === Final Step: submit the registration form ===
      const formData = new FormData(form);

      // Debug log
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

            if (progressWrap) progressWrap.classList.add('d-none');
            form.classList.add('d-none');

            // Build display name from first + last name
            const fn = document.getElementById('firstName')?.value?.trim() || '';
            const ln = document.getElementById('lastName')?.value?.trim() || '';
            const displayName = `${fn} ${ln}`.trim();

            // Personalize the success text
            const successText = document.getElementById('successText');
            if (successText) {
              successText.textContent = displayName
                ? `Welcome aboard, ${displayName}! Your account has been created.`
                : `Your account has been created.`;
            }

            // Show success "modal/card"
            if (successCard) {
              successCard.classList.remove('d-none');
              successCard.classList.add('fade-in');
            }

            // Reset form in background
            form.reset();
            currentStep = 0;
          } else {
            alert(data.message || "Registration failed. Please try again.");
          }
        })
        .catch(err => {
          console.error("Registration error:", err);
          alert("A server error occurred. Please try again later.");
        });
    }
  });

  // Initialize first step
  showStep(currentStep);

  // ===== Intro "Modal" Logic =====
  const modal = document.getElementById("intro");

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

  // Close the modal automatically after 4 seconds
  setTimeout(closeModal, 4000);

  // Blurring the ustp logo before showing the HD one
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
