// User Profile Page Controller with Recordings

class UserProfileController {
  constructor() {
    this.currentUser = null;
    this.isLoading = false;
    this.recordings = [];
    this.recordingsLoading = false;

    console.log("UserProfileController initialized");

    this.initializeElements();
    this.setupEventListeners();
    this.loadUserProfile();
  }

  initializeElements() {
    // Profile elements
    this.userName = document.getElementById("userName");
    this.profileContent = document.getElementById("profileContent");

    // User information fields (compact)
    this.phoneValue = document.getElementById("phoneValue");
    this.emailValue = document.getElementById("emailValue");
    this.countryValue = document.getElementById("countryValue");
    this.joinDateValue = document.getElementById("joinDateValue");

    // Info containers
    this.phoneInfo = document.getElementById("phoneInfo");
    this.emailInfo = document.getElementById("emailInfo");
    this.countryInfo = document.getElementById("countryInfo");
    this.joinDateInfo = document.getElementById("joinDateInfo");

    // Recordings elements
    this.recordingsContainer = document.getElementById("recordingsContainer");
    this.refreshRecordings = document.getElementById("refreshRecordings");

    // Actions
    this.logoutBtn = document.getElementById("logoutBtn");

    // Overlays
    this.loadingOverlay = document.getElementById("loadingOverlay");
    this.loadingText = document.getElementById("loadingText");
    this.successMessage = document.getElementById("successMessage");

    console.log("Profile elements initialized");
  }

  setupEventListeners() {
    // Logout button
    if (this.logoutBtn) {
      this.logoutBtn.addEventListener("click", () => this.handleLogout());
    }

    // Refresh recordings button
    if (this.refreshRecordings) {
      this.refreshRecordings.addEventListener("click", () =>
        this.loadUserRecordings()
      );
    }

    // Handle page visibility changes
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.refreshUserData();
      }
    });

    console.log("Event listeners setup complete");
  }

  // Load user profile data
  async loadUserProfile() {
    try {
      this.showLoading("Loading profile...");

      console.log("Loading user profile data...");

      // Check authentication first
      const isAuthenticated = await this.checkAuthentication();
      if (!isAuthenticated) {
        console.log("User not authenticated, redirecting to login");
        this.redirectToLogin();
        return;
      }

      // Get user data from storage
      const userData = await this.getUserData();
      if (!userData) {
        throw new Error("Failed to load user data");
      }

      this.currentUser = userData;
      this.displayUserProfile(userData);

      this.hideLoading();

      // Load recordings after profile is loaded
      this.loadUserRecordings();

      console.log("User profile loaded successfully");
    } catch (error) {
      console.error("Error loading user profile:", error);
      this.hideLoading();
      this.showError("Failed to load profile. Please try again.");
    }
  }

  // Load user recordings via background script
  async loadUserRecordings() {
    try {
      if (this.recordingsLoading) return;

      this.recordingsLoading = true;
      this.showRecordingsLoading();

      console.log("Loading user recordings...");

      // Call background script to fetch recordings (avoids CORS issues)
      const response = await chrome.runtime.sendMessage({
        action: "getUserRecordings",
      });

      console.log("Raw response from background:", response); // Debug log

      if (!response.success) {
        throw new Error(response.error || "Failed to fetch recordings");
      }

      // Store recordings for later use
      this.recordings = response.recordings || [];

      // Pass the full response object to displayRecordings
      this.displayRecordings(response);

      console.log(`Loaded ${this.recordings.length} recordings`);
    } catch (error) {
      console.error("Error loading recordings:", error);
      this.showRecordingsError(error.message);
    } finally {
      this.recordingsLoading = false;
    }
  }

  // Display recordings in the UI
  displayRecordings(responseData) {
    try {
      console.log("Raw response data:", responseData); // Debug log

      // Handle response being an array or object
      let response;
      if (Array.isArray(responseData)) {
        response = responseData[0]; // Take first element if it's an array
      } else {
        response = responseData;
      }

      console.log("Processed response:", response); // Debug log

      // Extract recordings from response object
      const recordings = response?.recordings || [];

      console.log("Extracted recordings:", recordings); // Debug log

      if (!recordings || recordings.length === 0) {
        this.recordingsContainer.innerHTML = `
        <div class="no-recordings">
          <div style="font-size: 48px; margin-bottom: 15px;">🎤</div>
          <div style="font-weight: 600; margin-bottom: 5px;">No recordings yet</div>
          <div style="font-size: 12px; color: #666;">Your Meet recordings will appear here</div>
        </div>
      `;
        return;
      }

      // Sort recordings by date (newest first) - handle your specific date format
      const sortedRecordings = recordings.sort((a, b) => {
        const dateA = new Date(a.created_at || 0);
        const dateB = new Date(b.created_at || 0);
        return dateB - dateA;
      });

      const recordingsHTML = sortedRecordings
        .map((recording, index) => {
          // Extract filename from recording_url
          const fileNameRaw =
            this.extractFileName(recording.recording_url) ||
            `Recording ${index + 1}`;

          // Extract date and time from filename
          const date = fileNameRaw.substring(0, 10);
          const time = fileNameRaw.substring(11, 19);

          // Build display name
          const fileName = `audio-Date-${date}-Time-${time}-UTC`;

          const uploadDate = this.formatDate(recording.created_at);

          const fileSize = recording.recording_size
            ? `${recording.recording_size} KB`
            : "Unknown size";

          // NEW: Convert raw seconds to mm:ss
          const durationInSec = parseInt(recording.recording_duration, 10);
          const duration = isNaN(durationInSec)
            ? "Unknown duration"
            : `${Math.floor(durationInSec / 60)}:${(durationInSec % 60)
                .toString()
                .padStart(2, "0")}`;
          // Get recording URL from your specific property
          const recordingUrl = recording.recording_url;

          return `
          <div class="recording-item" data-index="${index}">
            <div class="recording-header">
              <div class="recording-name">${fileName}</div>
              <div class="recording-date">${uploadDate}</div>
            </div>
            <div class="recording-details">
              <div class="recording-detail">
                <span>📁</span>
                <span>${fileSize}</span>
              </div>
              ${
                duration
                  ? `
                <div class="recording-detail">
                  <span>⏱️</span>
                  <span>${duration}</span>
                </div>
              `
                  : ""
              }
              <div class="recording-detail">
                <span>🏷️</span>
                <span>WebM Audio</span>
              </div>
            </div>
            <div class="recording-actions">
              <button class="recording-btn download" data-recording-url="${recordingUrl}" data-recording-index="${index}">
                View & Download
              </button>
            </div>
          </div>
        `;
        })
        .join("");

      this.recordingsContainer.innerHTML = recordingsHTML;

      // Add event listeners for download buttons (AFTER HTML is set)
      const downloadButtons = this.recordingsContainer.querySelectorAll(
        ".recording-btn.download"
      );
      downloadButtons.forEach((button) => {
        button.addEventListener("click", (e) => {
          const recordingUrl = e.target.getAttribute("data-recording-url");
          const recordingIndex = e.target.getAttribute("data-recording-index");

          console.log("Clicked download button with URL:", recordingUrl); // Debug log

          if (
            recordingUrl &&
            recordingUrl !== "undefined" &&
            recordingUrl !== "null" &&
            recordingUrl !== ""
          ) {
            // Open recording URL in new tab
            window.open(recordingUrl, "_blank", "noopener,noreferrer");
          } else {
            console.error(
              "No valid recording URL found for index:",
              recordingIndex
            );
            // Fallback: try to get URL directly from recordings array
            const fallbackUrl = recordings[recordingIndex]?.recording_url;
            if (fallbackUrl && fallbackUrl.startsWith("http")) {
              window.open(fallbackUrl, "_blank", "noopener,noreferrer");
            } else {
              alert("Recording URL not available");
            }
          }
        });
      });

      // Log recording count for debugging
      console.log(
        `Displayed ${recordings.length} recordings from user ${response.userId}`
      );
    } catch (error) {
      console.error("Error displaying recordings:", error);
      this.showRecordingsError("Error displaying recordings");
    }
  }
  // Show recordings loading state
  showRecordingsLoading() {
    this.recordingsContainer.innerHTML = `
      <div class="loading-recordings">
        <div class="loading-spinner-small"></div>
        <div>Loading your recordings...</div>
      </div>
    `;
  }

  // Show recordings error
  // Show recordings error
  showRecordingsError(message) {
    this.recordingsContainer.innerHTML = `
    <div class="recordings-error">
      <div style="margin-bottom: 10px;">❌ ${message}</div>
      <button class="retry-btn" data-action="retry-recordings">
        Try Again
      </button>
    </div>
  `;

    // ADD: Event listener for retry button (AFTER HTML is set)
    const retryButton = this.recordingsContainer.querySelector(".retry-btn");
    if (retryButton) {
      retryButton.addEventListener("click", () => {
        this.loadUserRecordings();
      });
    }
  }

  // View recording details
  viewRecordingDetails(recordingKey) {
    const recording = this.recordings.find((r) => r.key === recordingKey);
    if (!recording) return;

    const fileName = this.extractFileName(recording.key);
    const details = `
Recording Details:

File: ${fileName}
Size: ${this.formatFileSize(recording.size)}
Uploaded: ${this.formatDate(recording.lastModified)}
Storage: ${recording.storageClass || "Standard"}
ETag: ${recording.etag || "N/A"}

Full Path: ${recording.key}
    `;

    alert(details);
  }

  // Utility functions for formatting
  extractFileName(key) {
    const parts = key.split("/");
    return parts[parts.length - 1] || key;
  }

  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  extractDuration(fileName) {
    // Try to extract duration from filename if it contains timing info
    const timeMatch = fileName.match(/(\d{2})-(\d{2})-(\d{2})/g);
    if (timeMatch && timeMatch.length >= 2) {
      // Calculate approximate duration based on start/end times in filename
      return "Variable"; // Could implement more sophisticated parsing
    }
    return null;
  }

  // Check if user is authenticated
  async checkAuthentication() {
    try {
      // Get tokens from storage
      const result = await chrome.storage.local.get([
        "auth_token",
        "refresh_token",
        "user_id",
      ]);

      if (!result.auth_token || !result.refresh_token) {
        console.log("No authentication tokens found");
        return false;
      }

      // Validate token
      const tokenData = this.parseJwt(result.auth_token);
      if (!tokenData || !tokenData.exp) {
        console.log("Invalid token format");
        await this.clearAuthTokens();
        return false;
      }

      const currentTime = Date.now() / 1000;
      const timeUntilExpiry = tokenData.exp - currentTime;

      // If token expires in less than 5 minutes, try to refresh
      if (timeUntilExpiry < 300) {
        // 5 minutes
        console.log("Token expiring soon, attempting refresh...");
        const refreshResult = await this.refreshAuthToken(
          result.refresh_token,
          result.user_id
        );

        if (!refreshResult.success) {
          console.log("Token refresh failed");
          await this.clearAuthTokens();
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Error checking authentication:", error);
      await this.clearAuthTokens();
      return false;
    }
  }

  // Get user data from storage and token
  async getUserData() {
    try {
      const result = await chrome.storage.local.get(["auth_token", "user_id"]);

      if (!result.auth_token) {
        throw new Error("No auth token found");
      }

      // Parse JWT to get user info
      const tokenData = this.parseJwt(result.auth_token);
      if (!tokenData) {
        throw new Error("Invalid token format");
      }

      // Extract user information
      const userData = {
        id: result.user_id || tokenData.id,
        phone: tokenData.phone,
        email: tokenData.email,
        fullname: tokenData.fullname || "User",
        phone_verified: tokenData.phone_verified,
        email_verified: tokenData.email_verified,
        created_at: tokenData.created_at,
        updated_at: tokenData.updated_at,
        exp: tokenData.exp,
      };

      // Get country from phone number
      if (userData.phone) {
        userData.country = this.getCountryFromPhone(userData.phone);
      }

      return userData;
    } catch (error) {
      console.error("Error getting user data:", error);
      throw error;
    }
  }

  // Display user profile information (compact version)
  displayUserProfile(userData) {
    try {
      console.log("Displaying user profile:", userData);

      // Set user name
      if (this.userName) {
        this.userName.textContent = userData.fullname || "User";
      }

      // Phone number
      if (this.phoneValue && userData.phone) {
        this.phoneValue.textContent = this.formatPhoneNumber(userData.phone);
      } else {
        this.phoneInfo.style.display = "none";
      }

      // Email
      if (userData.email) {
        this.emailInfo.style.display = "block";
        this.emailValue.textContent = userData.email;
      } else {
        this.emailInfo.style.display = "none";
      }

      // Country
      if (this.countryValue && userData.country) {
        this.countryValue.textContent = userData.country;
      } else {
        this.countryInfo.style.display = "none";
      }

      // Join date
      if (this.joinDateValue && userData.created_at) {
        const joinDate = new Date(userData.created_at).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "short",
            day: "numeric",
          }
        );
        this.joinDateValue.textContent = joinDate;
      } else {
        this.joinDateInfo.style.display = "none";
      }

      console.log("User profile displayed successfully");
    } catch (error) {
      console.error("Error displaying user profile:", error);
      this.showError("Error displaying profile information");
    }
  }

  // Handle logout
  async handleLogout() {
    try {
      console.log("Logout button clicked...");

      // Prevent multiple logout attempts
      if (this.isLoading) {
        return;
      }

      this.isLoading = true;

      // Update logout button state
      this.logoutBtn.classList.add("loading");
      this.logoutBtn.disabled = true;

      // Show loading overlay
      this.showLoading("Logging out...");

      // Use LogoutManager if available, otherwise fallback
      let logoutResult;
      if (window.logoutManager) {
        console.log("Using LogoutManager for logout...");
        logoutResult = await window.logoutManager.logout();
      } else {
        console.log("LogoutManager not available, using fallback logout...");
        logoutResult = await this.fallbackLogout();
      }

      // Hide loading
      this.hideLoading();

      if (logoutResult.success) {
        console.log("Logout successful");

        // Show success message
        this.showSuccessMessage();

        // Close the tab after a short delay
        setTimeout(() => {
          this.closeTab();
        }, 2000);
      } else {
        console.error("Logout failed:", logoutResult.error);
        this.showError(
          "Logout failed: " + (logoutResult.error || "Unknown error")
        );
        this.resetLogoutButton();
      }
    } catch (error) {
      console.error("Error during logout:", error);
      this.hideLoading();
      this.showError("Logout failed. Please try again.");
      this.resetLogoutButton();
    }
  }

  // Fallback logout implementation
  async fallbackLogout() {
    try {
      console.log("Executing fallback logout...");

      // Get refresh token for logout API
      const result = await chrome.storage.local.get(["refresh_token"]);

      // Call logout API if we have a refresh token
      if (result.refresh_token) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: "logoutAPI",
            refreshToken: result.refresh_token,
          });

          if (response.warning) {
            console.warn("Logout API warning:", response.warning);
          }
        } catch (error) {
          console.warn(
            "Logout API call failed, continuing with local logout:",
            error
          );
        }
      }

      // Clear all authentication data
      await this.clearAuthTokens();

      return { success: true };
    } catch (error) {
      console.error("Error in fallback logout:", error);
      return { success: false, error: error.message };
    }
  }

  // Reset logout button state
  resetLogoutButton() {
    this.isLoading = false;
    this.logoutBtn.classList.remove("loading");
    this.logoutBtn.disabled = false;
  }

  // Refresh user data
  async refreshUserData() {
    try {
      console.log("Refreshing user data...");
      const userData = await this.getUserData();
      if (userData) {
        this.currentUser = userData;
        this.displayUserProfile(userData);
      }
    } catch (error) {
      console.error("Error refreshing user data:", error);
    }
  }

  // Parse JWT token
  parseJwt(token) {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error("Failed to parse JWT:", error);
      return null;
    }
  }

  // Refresh auth token
  async refreshAuthToken(refreshToken, userId) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "refreshToken",
        refreshToken: refreshToken,
        userId: userId,
      });

      if (!response.success) {
        throw new Error(response.error || "Token refresh failed");
      }

      console.log("Auth tokens refreshed successfully");
      return { success: true };
    } catch (error) {
      console.error("Failed to refresh token:", error);
      return { success: false, error: error.message };
    }
  }

  // Clear auth tokens
  async clearAuthTokens() {
    try {
      await chrome.storage.local.remove([
        "auth_token",
        "refresh_token",
        "user_id",
      ]);
      console.log("Auth tokens cleared");
    } catch (error) {
      console.error("Error clearing auth tokens:", error);
    }
  }

  // Get country from phone number
  getCountryFromPhone(phoneNumber) {
    if (!phoneNumber) return "Unknown";

    // Basic country detection based on phone code
    const countryMap = {
      "+1": "United States",
      "+91": "India",
      "+44": "United Kingdom",
      "+49": "Germany",
      "+33": "France",
      "+81": "Japan",
      "+86": "China",
      "+7": "Russia",
      "+61": "Australia",
      "+55": "Brazil",
      "+52": "Mexico",
      "+39": "Italy",
      "+34": "Spain",
      "+82": "South Korea",
      "+65": "Singapore",
      "+60": "Malaysia",
      "+62": "Indonesia",
      "+66": "Thailand",
      "+84": "Vietnam",
      "+63": "Philippines",
    };

    // Find matching country code
    for (const [code, country] of Object.entries(countryMap)) {
      if (phoneNumber.startsWith(code)) {
        return country;
      }
    }

    return "Unknown";
  }

  // Format phone number for display
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return "";

    // For Indian numbers
    if (phoneNumber.startsWith("+91")) {
      const number = phoneNumber.substring(3);
      if (number.length === 10) {
        return `+91 ${number.substring(0, 5)} ${number.substring(5)}`;
      }
    }

    // For US numbers
    if (phoneNumber.startsWith("+1")) {
      const number = phoneNumber.substring(2);
      if (number.length === 10) {
        return `+1 (${number.substring(0, 3)}) ${number.substring(
          3,
          6
        )}-${number.substring(6)}`;
      }
    }

    // Default formatting
    return phoneNumber;
  }

  // Redirect to login
  redirectToLogin() {
    const loginUrl = chrome.runtime.getURL("auth/login.html");
    chrome.tabs.create({ url: loginUrl });
    this.closeTab();
  }

  // Close current tab
  closeTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.remove(tabs[0].id);
      }
    });
  }

  // Show loading overlay
  showLoading(message) {
    if (this.loadingText) {
      this.loadingText.textContent = message;
    }
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = "flex";
    }
  }

  // Hide loading overlay
  hideLoading() {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = "none";
    }
  }

  // Show success message
  showSuccessMessage() {
    if (this.successMessage) {
      this.successMessage.classList.add("show");

      setTimeout(() => {
        this.successMessage.classList.remove("show");
      }, 3000);
    }
  }

  // Show error message
  showError(message) {
    // Simple error display for now
    alert(message);
  }
}

// Initialize profile controller when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing user profile controller");
  window.userProfileController = new UserProfileController();
});

// Handle page visibility changes
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && window.userProfileController) {
    console.log("Profile page became visible");
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  console.log("Profile page unloading");
});
