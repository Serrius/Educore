// js/upload-profile.js - Profile Modal Functionality

class ProfileManager {
    constructor() {
        this.modalElement = document.getElementById('profileModal');
        this.modal = null;
        this.currentData = null;
        this.init();
    }
    
    init() {
        // Event listeners
        this.setupEventListeners();
        
        // Initialize modal instance
        if (this.modalElement) {
            this.modal = new bootstrap.Modal(this.modalElement);
        }
    }
    
    setupEventListeners() {
        // Profile link click
        document.querySelector('.profile-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openProfileModal();
        });
        
        // Profile picture upload
        const profilePictureInput = document.getElementById('profilePicture');
        const changePhotoBtn = document.getElementById('changePhotoBtn');
        
        if (changePhotoBtn) {
            changePhotoBtn.addEventListener('click', () => profilePictureInput?.click());
        }
        
        if (profilePictureInput) {
            profilePictureInput.addEventListener('change', (e) => this.handleProfilePictureChange(e));
        }
        
        // Save button
        document.getElementById('saveProfileBtn')?.addEventListener('click', () => this.saveProfile());
        
        // Refresh button
        document.getElementById('refreshProfileBtn')?.addEventListener('click', () => this.loadProfileData());
        
        // Email validation on blur
        const emailInput = document.getElementById('email');
        if (emailInput) {
            emailInput.addEventListener('blur', () => this.validateEmail(emailInput.value));
        }
        
        // Modal events
        if (this.modalElement) {
            this.modalElement.addEventListener('shown.bs.modal', () => this.loadProfileData());
        }
    }
    
    async openProfileModal() {
        // Show modal immediately for better UX
        if (this.modal) {
            this.modal.show();
        }
        
        // Load data
        await this.loadProfileData();
    }
    
    async loadProfileData() {
        try {
            // Show loading state
            this.showLoading(true);
            
            const response = await fetch('php/get-profile.php');
            const data = await response.json();
            
            if (data.success && data.user) {
                this.currentData = data.user;
                this.populateProfileData(data.user);
                this.updateNavbarProfile(data.user);
                this.storeInLocalStorage(data.user);
            } else {
                this.showAlert('danger', data.message || 'Failed to load profile data');
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            this.showAlert('danger', 'Failed to load profile data. Please try again.');
            
            // Try to load from localStorage as fallback
            const cachedData = this.getFromLocalStorage();
            if (cachedData) {
                this.populateProfileData(cachedData);
            }
        } finally {
            this.showLoading(false);
        }
    }
    
    populateProfileData(userData) {
        // Basic information
        document.getElementById('id_number').value = userData.id_number || '';
        document.getElementById('first_name').value = userData.first_name || '';
        document.getElementById('middle_name').value = userData.middle_name || '';
        document.getElementById('last_name').value = userData.last_name || '';
        document.getElementById('suffix').value = userData.suffix || '';
        document.getElementById('department').value = userData.department || '';
        document.getElementById('school_year').value = userData.school_year || '';
        document.getElementById('email').value = userData.email || '';
        
        // Profile picture
        const profilePic = userData.profile_picture || 'assets/images/profile.png';
        document.getElementById('profilePreview').src = profilePic + '?t=' + Date.now();
        
        // User type and role badges
        const userTypeElement = document.getElementById('userTypeBadge');
        const roleElement = document.getElementById('roleBadge');
        
        if (userTypeElement) {
            userTypeElement.textContent = this.formatUserType(userData.user_type);
        }
        
        if (roleElement) {
            roleElement.textContent = this.formatRole(userData.role);
        }
        
        // Account status
        const statusElement = document.getElementById('statusBadge');
        if (statusElement) {
            const status = userData.status || 'Active';
            statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            statusElement.className = `badge bg-${this.getStatusColor(status)}`;
        }
        
        // Account age
        const ageElement = document.getElementById('accountAge');
        if (ageElement && userData.account_age) {
            const age = userData.account_age;
            let ageText = 'Account age: ';
            
            if (age.years > 0) {
                ageText += `${age.years} year${age.years > 1 ? 's' : ''}`;
                if (age.months > 0) {
                    ageText += `, ${age.months} month${age.months > 1 ? 's' : ''}`;
                }
            } else if (age.months > 0) {
                ageText += `${age.months} month${age.months > 1 ? 's' : ''}`;
                if (age.days > 0) {
                    ageText += `, ${age.days} day${age.days > 1 ? 's' : ''}`;
                }
            } else {
                ageText += `${age.days} day${age.days > 1 ? 's' : ''}`;
            }
            
            ageElement.textContent = ageText;
        }
    }
    
    formatUserType(userType) {
        if (!userType) return 'Student';
        return userType.charAt(0).toUpperCase() + userType.slice(1);
    }
    
    formatRole(role) {
        if (!role) return 'Non-Admin';
        return role.replace('-', ' ')
                  .split(' ')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ');
    }
    
    getStatusColor(status) {
        const statusMap = {
            'Active': 'success',
            'Inactive': 'warning',
            'Archived': 'secondary',
            'Pending': 'info'
        };
        return statusMap[status] || 'secondary';
    }
    
    handleProfilePictureChange(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validation
        if (!this.validateProfilePicture(file)) {
            event.target.value = '';
            return;
        }
        
        // Preview
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('profilePreview').src = e.target.result;
            this.showUploadStatus('New photo selected. Click "Save Changes" to update.', 'info');
        };
        reader.readAsDataURL(file);
    }
    
    validateProfilePicture(file) {
        const maxSize = 2 * 1024 * 1024; // 2MB
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        
        if (!allowedTypes.includes(file.type)) {
            this.showAlert('danger', 'Only JPG, PNG, GIF, and WebP images are allowed');
            return false;
        }
        
        if (file.size > maxSize) {
            this.showAlert('danger', 'File size must be less than 2MB');
            return false;
        }
        
        return true;
    }
    
    validateEmail(email) {
        if (!email) return true;
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            this.showAlert('warning', 'Please enter a valid email address');
            return false;
        }
        return true;
    }
    
    async saveProfile() {
        const email = document.getElementById('email').value;
        
        // Validate email
        if (email && !this.validateEmail(email)) {
            return;
        }
        
        const form = document.getElementById('profileForm');
        const formData = new FormData(form);
        const saveBtn = document.getElementById('saveProfileBtn');
        
        // Show loading state
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
        
        try {
            const response = await fetch('php/update-profile.php', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showAlert('success', data.message);
                
                // Update profile picture if changed
                if (data.profile_picture) {
                    this.updateProfilePicture(data.profile_picture);
                }
                
                // Refresh profile data
                setTimeout(() => {
                    this.loadProfileData();
                }, 1000);
            } else {
                this.showAlert('danger', data.message || 'Failed to update profile.');
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            this.showAlert('danger', 'An error occurred. Please try again.');
        } finally {
            // Reset button state
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText;
        }
    }
    
    updateProfilePicture(newPath) {
        // Add timestamp to prevent caching
        const timestamp = Date.now();
        const newSrc = newPath + '?t=' + timestamp;
        
        // Update all profile pictures on the page
        const profilePictures = document.querySelectorAll(
            '.profile-picture, .profile-icon, .nav-profile-pic, .user-avatar, #profilePreview'
        );
        
        profilePictures.forEach(img => {
            img.src = newSrc;
        });
        
        // Update in current data
        if (this.currentData) {
            this.currentData.profile_picture = newPath;
            this.storeInLocalStorage(this.currentData);
        }
    }
    
    updateNavbarProfile(userData) {
        // Update navbar profile picture
        const navProfilePics = document.querySelectorAll('.nav-profile-pic, .profile-icon');
        navProfilePics.forEach(img => {
            if (userData.profile_picture) {
                img.src = userData.profile_picture + '?t=' + Date.now();
            }
        });
        
        // Update navbar name
        const navNameElements = document.querySelectorAll('.nav-user-name, #navFirstName');
        navNameElements.forEach(element => {
            if (userData.first_name) {
                element.textContent = userData.first_name;
            }
        });
    }
    
    storeInLocalStorage(userData) {
        try {
            localStorage.setItem('userProfile', JSON.stringify(userData));
            localStorage.setItem('userProfileTimestamp', Date.now());
        } catch (e) {
            console.warn('Could not store profile in localStorage:', e);
        }
    }
    
    getFromLocalStorage() {
        try {
            const timestamp = localStorage.getItem('userProfileTimestamp');
            const now = Date.now();
            
            // Only use cached data if it's less than 1 hour old
            if (timestamp && (now - parseInt(timestamp)) < 3600000) {
                return JSON.parse(localStorage.getItem('userProfile'));
            }
        } catch (e) {
            console.warn('Could not get profile from localStorage:', e);
        }
        return null;
    }
    
    showLoading(show) {
        const loadingElements = document.querySelectorAll('.profile-loading');
        
        if (show) {
            // Create loading overlay if it doesn't exist
            if (!document.getElementById('profileLoadingOverlay')) {
                const overlay = document.createElement('div');
                overlay.id = 'profileLoadingOverlay';
                overlay.className = 'profile-loading-overlay';
                overlay.innerHTML = `
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-2">Loading profile...</p>
                `;
                document.querySelector('.modal-body').prepend(overlay);
            }
        } else {
            // Remove loading overlay
            const overlay = document.getElementById('profileLoadingOverlay');
            if (overlay) {
                overlay.remove();
            }
        }
    }
    
    showUploadStatus(message, type = 'info') {
        const statusDiv = document.getElementById('profileUploadStatus');
        statusDiv.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
    }
    
    showAlert(type, message) {
        // Remove existing alerts
        const existingAlerts = document.querySelectorAll('.global-alert');
        existingAlerts.forEach(alert => alert.remove());
        
        // Create new alert
        const alertDiv = document.createElement('div');
        alertDiv.className = `global-alert alert alert-${type} alert-dismissible fade show position-fixed`;
        alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 1060; max-width: 400px;';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alertDiv);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.profileManager = new ProfileManager();
}); //assets/