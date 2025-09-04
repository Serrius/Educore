    const form = document.getElementById('registrationForm');
    const steps = document.querySelectorAll('.form-step');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progressBar = document.querySelector('.progress-bar');
    let currentStep = 0;

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

    nextBtn.addEventListener('click', () => {
      if (validateStep(currentStep)) {
        if (currentStep < steps.length - 1) {
          currentStep++;
          showStep(currentStep, 'next');
        } else {
          alert('Form submitted successfully!');
          form.reset();
          currentStep = 0;
          showStep(currentStep);
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