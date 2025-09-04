// manage-courses.js

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

let lastActiveCourses = '';

function initManageCourses() {
    const container = document.querySelector(".courses-grid"); 
    if (!container) return; // Exit if not on manage-courses page

    function fetchCourses() {
        fetch(`php/get-courses.php?t=${Date.now()}`)
            .then(res => res.json())
            .then(courses => {
                const currentData = JSON.stringify(courses);
                if (currentData === lastActiveCourses) return; // No change
                lastActiveCourses = currentData;

                container.innerHTML = '';

                // Add Course card (super-admin only)
                const currentRole = localStorage.getItem('role');
                if (currentRole === 'super-admin') {
                    container.innerHTML += `
                        <div class="add-course-card">
                            <i class="bi bi-plus-circle add-course-icon"></i>
                            <span class="add-course-text">Add Course</span>
                        </div>`;
                }

                // Loop courses
                courses.forEach(course => {
                    container.innerHTML += `
                        <div class="course-card" data-id="${course.id}">
                            <img src="${course.image_path || 'assets/images/image-placeholder.svg'}" 
                                 class="course-image">
                            <div class="course-card-body">
                                <h5 class="course-name" title="${course.course_name}">
                                    ${course.course_name}
                                </h5>
                                <p class="text-muted mb-1">${course.abbreviation}</p>
                                <span style="width: 70px" class="badge bg-${course.status === 'Active' ? 'success' : course.status === 'Pending' ? 'warning' : 'danger'}">
                                    ${course.status}
                                </span>
                                <div class="course-actions">
                                    <button class="edit"><i class="bi bi-pencil-square"></i></button>
                                    <button class="delete"><i class="bi bi-trash"></i></button>
                                </div>
                            </div>
                        </div>`;
                });

                attachCourseEvents();
            });
    }

    function attachCourseEvents() {
        // Show Add Modal
        document.querySelectorAll(".add-course-card").forEach(btn => {
            btn.addEventListener("click", () => {
                document.getElementById("addCourseForm").reset();
                new bootstrap.Modal(document.getElementById("addCourseModal")).show();
            });
        });

        // ========== Add Course ==========

        document.getElementById('addCourseImgInput').addEventListener('change', function (e) {
        const file = e.target.files[0];
        const preview = document.getElementById('addCourseImage');
    
        const defaultImg = "assets/images/image-placeholder.svg";
    
        if (!file) {
            preview.src = defaultImg;
            return;
        }
    
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    
        if (!allowedTypes.includes(file.type)) {
            alert('Only JPG, JPEG, and PNG files are allowed. GIFs are not supported.');
            e.target.value = ''; // Clear the file input
            preview.src = defaultImg;
            return;
        }
    
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
    });

        const addCourseForm = document.getElementById("addCourseForm");
        if (addCourseForm) {
            addCourseForm.addEventListener("submit", function (e) {
                e.preventDefault();
                const formData = new FormData(addCourseForm);

                fetch("php/add-course.php", {
                    method: "POST",
                    body: formData
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        bootstrap.Modal.getInstance(document.getElementById("addCourseModal")).hide();
                        addCourseForm.reset();
                        fetchCourses();
                        showSuccessModal("Course added successfully ✅");
                    } else {
                        showErrorModal("Failed to add course: " + (data.message || "Unknown error"));
                    }
                })
                .catch(err => {
                    console.error("Error adding course:", err);
                    showErrorModal("An error occurred while adding the course.");
                });
            });
        }

        // ========== Edit Course (open modal) ==========
        document.querySelectorAll(".edit").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const courseId = e.target.closest(".course-card").dataset.id;

                fetch(`php/get-course.php?id=${courseId}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            document.getElementById("editCourseImage").src = data.course.image_path || "assets/images/image-placeholder.svg";
                            document.getElementById("editCourseId").value = data.course.id;
                            document.getElementById("editCourseName").value = data.course.course_name;
                            document.getElementById("editAbbreviation").value = data.course.abbreviation;
                            new bootstrap.Modal(document.getElementById("editCourseModal")).show();
                        }
                    });
            });
        });

        // ========== Edit Course (submit) ==========
        const editCourseForm = document.getElementById("editCourseForm");
        if (editCourseForm) {
            editCourseForm.addEventListener("submit", function (e) {
                e.preventDefault();
                const formData = new FormData(editCourseForm);

                fetch("php/edit-course.php", {
                    method: "POST",
                    body: formData
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        bootstrap.Modal.getInstance(document.getElementById("editCourseModal")).hide();
                        fetchCourses();
                        showSuccessModal("Course updated successfully ✏️");
                    } else {
                        showErrorModal("Failed to update course: " + (data.message || "Unknown error"));
                    }
                })
                .catch(err => {
                    console.error("Error updating course:", err);
                    showErrorModal("An error occurred while updating the course.");
                });
            });
        }

        // ========== Delete Course ==========
        document.querySelectorAll(".delete").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const courseId = e.target.closest(".course-card").dataset.id;
                document.getElementById("confirmDeleteCourse").onclick = () => {
                    fetch("php/delete-course.php", {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: "id=" + courseId
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            bootstrap.Modal.getInstance(document.getElementById("deleteCourseModal")).hide();
                            fetchCourses();
                            showSuccessModal("Course deleted 🗑️");
                        } else {
                            showErrorModal("Failed to delete course");
                        }
                    });
                };
                new bootstrap.Modal(document.getElementById("deleteCourseModal")).show();
            });
        });

        // ========== View Course ==========
        document.querySelectorAll(".course-card").forEach(card => {
            card.addEventListener("click", e => {
                if (e.target.closest(".course-actions")) return; 
                const courseId = card.dataset.id;

                fetch(`php/get-course.php?id=${courseId}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            document.getElementById("viewCourseTitle").textContent = data.course.course_name;
                            document.getElementById("viewCourseAbbreviation").textContent = data.course.abbreviation;
                            document.getElementById("viewCourseImage").src = data.course.image_path || "assets/images/course-placeholder.svg";
                            document.getElementById("viewCourseStatus").textContent = data.course.status;
                            document.getElementById("viewCourseCreatedAt").textContent = data.course.created_at;
                            new bootstrap.Modal(document.getElementById("viewCourseModal")).show();
                        }
                    });
            });
        });
    }

    // Search Courses
    const searchInput = document.getElementById("searchCourse");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const term = searchInput.value.toLowerCase();

            document.querySelectorAll(".course-card").forEach(card => {
                const name = card.querySelector(".course-name").textContent.toLowerCase();
                const abbr = card.querySelector("p").textContent.toLowerCase();

                if (name.includes(term) || abbr.includes(term)) {
                    card.style.display = "flex"; // keep visible
                } else {
                    card.style.display = "none"; // hide if no match
                }
            });
        });
    }


    // Run now + auto-refresh
    fetchCourses();
    setInterval(fetchCourses, 5000);
}

// Detect when manage-courses page is loaded into content-area
document.addEventListener("DOMContentLoaded", () => {
    const observer = new MutationObserver(() => {
        const grid = document.querySelector(".courses-grid");
        if (grid && !grid.dataset.init) {
            grid.dataset.init = "true";

            // Reset cache so fetchCourses will always render fresh
            lastActiveCourses = '';

            initManageCourses();
            console.log("Manage Courses initialized ✅");
        }
    });

    const contentArea = document.getElementById("content-area");
    if (contentArea) {
        observer.observe(contentArea, { childList: true, subtree: true });
    }
});

