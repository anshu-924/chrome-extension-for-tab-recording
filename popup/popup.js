// Google Meet Recorder Popup Controller with Authentication

class MeetRecorderPopup {
  constructor() {
    this.currentMode = 'setup'; // setup, recording, complete
    this.recordingState = null;
    this.recordingTimer = null;
    this.isAuthenticated = false;
    
    console.log('Initializing MeetRecorderPopup...');
    
    // Check authentication first before initializing UI
    this.checkAuthenticationAndInit();
  }

   async checkAuthenticationAndInit() {
    try {
      console.log('Checking authentication status...');
      
      // Check if user is authenticated
      this.isAuthenticated = await this.checkAuthentication();
      
      if (!this.isAuthenticated) {
        console.log('User not authenticated, redirecting to login...');
        this.redirectToLogin();
        return;
      }
      
      console.log('User authenticated, initializing recorder UI...');
      
      // Initialize LogoutManager if available
      if (window.logoutManager) {
        this.logoutManager = window.logoutManager;
      }
      
      // User is authenticated, proceed with normal initialization
      this.initializeElements();
      this.setupEventListeners();
      this.loadInitialState();
      
      // Show simple logout button instead of user info
      this.showSimpleLogoutButton();
      
    } catch (error) {
      console.error('Error during authentication check:', error);
      this.showAuthError('Authentication check failed. Please try again.');
    }
  }

  // Show simple logout button when authenticated
  showSimpleLogoutButton() {
    const simpleLogoutBtn = document.getElementById('simpleLogoutBtn');
    if (simpleLogoutBtn) {
      simpleLogoutBtn.style.display = 'block';
      console.log('Simple logout button displayed');
    }
  }

  // Hide simple logout button
  hideSimpleLogoutButton() {
    const simpleLogoutBtn = document.getElementById('simpleLogoutBtn');
    if (simpleLogoutBtn) {
      simpleLogoutBtn.style.display = 'none';
    }
  }

  // Handle simple logout button click
  async handleSimpleLogout() {
    try {
      console.log('Simple logout button clicked...');
      
      // Get logout button for loading state
      const simpleLogoutBtn = document.getElementById('simpleLogoutBtn');
      if (simpleLogoutBtn) {
        simpleLogoutBtn.classList.add('loading');
        simpleLogoutBtn.disabled = true;
        simpleLogoutBtn.textContent = 'Logging out...';
      }
      
      // Show loading overlay
      this.showLoading('Logging out...');
      
      // Use LogoutManager if available, otherwise fallback to direct implementation
      let logoutResult;
      if (this.logoutManager) {
        console.log('Using LogoutManager for logout...');
        logoutResult = await this.logoutManager.logout();
      } else {
        console.log('LogoutManager not available, using fallback logout...');
        logoutResult = await this.fallbackLogout();
      }
      
      // Hide loading
      this.hideLoading();
      
      if (logoutResult.success) {
        console.log('Logout successful, redirecting to login...');
        // Small delay to show success state
        setTimeout(() => {
          this.redirectToLogin();
        }, 500);
      } else {
        console.error('Logout failed:', logoutResult.error);
        this.showError('Logout failed: ' + (logoutResult.error || 'Unknown error'));
        
        // Reset logout button state
        if (simpleLogoutBtn) {
          simpleLogoutBtn.classList.remove('loading');
          simpleLogoutBtn.disabled = false;
          simpleLogoutBtn.textContent = 'Logout';
        }
      }
      
    } catch (error) {
      console.error('Error during logout:', error);
      this.hideLoading();
      this.showError('Logout failed. Please try again.');
      
      // Reset logout button state
      const simpleLogoutBtn = document.getElementById('simpleLogoutBtn');
      if (simpleLogoutBtn) {
        simpleLogoutBtn.classList.remove('loading');
        simpleLogoutBtn.disabled = false;
        simpleLogoutBtn.textContent = 'Logout';
      }
    }
  }

  async showUserInfo() {
    // Don't show user info section since user doesn't want user data displayed
    // Only the simple logout button will be shown
    console.log('User info display skipped - using simple logout button instead');
  }

  async handleLogout() {
    try {
      console.log('Logout button clicked...');
      
      // Get logout button for loading state
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.classList.add('loading');
        logoutBtn.disabled = true;
      }
      
      // Show loading overlay
      this.showLoading('Logging out...');
      
      // Use LogoutManager if available, otherwise fallback to direct implementation
      let logoutResult;
      if (this.logoutManager) {
        console.log('Using LogoutManager for logout...');
        logoutResult = await this.logoutManager.logout();
      } else {
        console.log('LogoutManager not available, using fallback logout...');
        logoutResult = await this.fallbackLogout();
      }
      
      // Hide loading
      this.hideLoading();
      
      if (logoutResult.success) {
        console.log('Logout successful, redirecting to login...');
        // Small delay to show success state
        setTimeout(() => {
          this.redirectToLogin();
        }, 500);
      } else {
        console.error('Logout failed:', logoutResult.error);
        this.showError('Logout failed: ' + (logoutResult.error || 'Unknown error'));
        
        // Reset logout button state
        if (logoutBtn) {
          logoutBtn.classList.remove('loading');
          logoutBtn.disabled = false;
        }
      }
      
    } catch (error) {
      console.error('Error during logout:', error);
      this.hideLoading();
      this.showError('Logout failed. Please try again.');
      
      // Reset logout button state
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.classList.remove('loading');
        logoutBtn.disabled = false;
      }
    }
  }

  async fallbackLogout() {
    try {
      console.log('Executing fallback logout...');
      
      // Get refresh token for logout API
      const result = await chrome.storage.local.get(['refresh_token']);
      
      // Call logout API if we have a refresh token
      if (result.refresh_token) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'logoutAPI',
            refreshToken: result.refresh_token
          });
          
          if (response.warning) {
            console.warn('Logout API warning:', response.warning);
          }
        } catch (error) {
          console.warn('Logout API call failed, continuing with local logout:', error);
        }
      }
      
      // Clear all authentication data
      await this.clearAuthTokens();
      
      return { success: true };
      
    } catch (error) {
      console.error('Error in fallback logout:', error);
      return { success: false, error: error.message };
    }
  }

  async checkAuthentication() {
    try {
      // Get tokens from storage
      const result = await chrome.storage.local.get(['auth_token', 'refresh_token', 'user_id']);
      
      if (!result.auth_token || !result.refresh_token) {
        console.log('No authentication tokens found');
        return false;
      }

      // Validate token
      const tokenData = this.parseJwt(result.auth_token);
      if (!tokenData || !tokenData.exp) {
        console.log('Invalid token format');
        await this.clearAuthTokens();
        return false;
      }

      const currentTime = Date.now() / 1000;
      const timeUntilExpiry = tokenData.exp - currentTime;

      // If token expires in less than 5 minutes, try to refresh
      if (timeUntilExpiry < 300) { // 5 minutes
        console.log('Token expiring soon, attempting refresh...');
        const refreshResult = await this.refreshAuthToken(result.refresh_token, result.user_id);
        
        if (!refreshResult.success) {
          console.log('Token refresh failed');
          await this.clearAuthTokens();
          return false;
        }
      }

      return true;

    } catch (error) {
      console.error('Error checking authentication:', error);
      await this.clearAuthTokens();
      return false;
    }
  }

  hideUserInfo() {
    const userInfoSection = document.getElementById('userInfoSection');
    if (userInfoSection) {
      userInfoSection.style.display = 'none';
      userInfoSection.innerHTML = '';
    }
    
    const container = document.querySelector('.container');
    if (container) {
      container.classList.remove('with-user-info');
    }
    
    // Also hide simple logout button
    this.hideSimpleLogoutButton();
  }

  // Update the redirectToLogin method to hide user info
  redirectToLogin() {
    this.hideUserInfo();
    const loginUrl = chrome.runtime.getURL('auth/login.html');
    chrome.tabs.create({ url: loginUrl });
    window.close();
  }

  // Update parseJwt method (keep existing implementation)
  parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Failed to parse JWT:', error);
      return null;
    }
  }

  async refreshAuthToken(refreshToken, userId) {
    try {
      // Call background script instead of direct fetch to avoid CSP issues
      const response = await chrome.runtime.sendMessage({
        action: 'refreshToken',
        refreshToken: refreshToken,
        userId: userId
      });

      if (!response.success) {
        throw new Error(response.error || 'Token refresh failed');
      }

      console.log('Auth tokens refreshed successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return { success: false, error: error.message };
    }
  }

  async clearAuthTokens() {
    try {
      await chrome.storage.local.remove(['auth_token', 'refresh_token', 'user_id']);
      console.log('Auth tokens cleared');
    } catch (error) {
      console.error('Error clearing auth tokens:', error);
    }
  }

  showAuthError(message) {
  // Create a simple error display for authentication issues
  document.body.innerHTML = `
    <div style="
      padding: 20px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div style="color: #ea4335; margin-bottom: 16px; font-size: 18px;">⚠️</div>
      <div style="color: #333; margin-bottom: 16px; font-size: 14px;">
        ${message}
      </div>
      <button id="retryAuthBtn" style="
        background: #4285f4;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      ">
        Retry
      </button>
    </div>
  `;
  
  // Add event listener for retry button (no inline handlers)
  const retryBtn = document.getElementById('retryAuthBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      location.reload();
    });
  }
}

  initializeElements() {
    // Mode panels
    this.setupMode = document.getElementById('setupMode');
    this.recordingMode = document.getElementById('recordingMode');
    this.completeMode = document.getElementById('completeMode');
    
    // Setup mode elements
    this.deviceAudioToggle = document.getElementById('deviceAudioToggle');
    this.microphoneToggle = document.getElementById('microphoneToggle');
    this.startRecordingBtn = document.getElementById('startRecordingBtn');
    
    // Recording mode elements
    this.recordingTimer = document.getElementById('recordingTimer');
    this.recordingTypeDisplay = document.getElementById('recordingTypeDisplay');
    this.recordingQualityDisplay = document.getElementById('recordingQualityDisplay');
    this.recordingSizeDisplay = document.getElementById('recordingSizeDisplay');
    this.stopRecordingBtn = document.getElementById('stopRecordingBtn');
    
    // Complete mode elements
    this.newRecordingBtn = document.getElementById('newRecordingBtn');
    
    // Overlays
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.errorOverlay = document.getElementById('errorOverlay');
    this.errorMessage = document.getElementById('errorMessage');
    this.dismissErrorBtn = document.getElementById('dismissErrorBtn');
    
    // Simple logout button
    this.simpleLogoutBtn = document.getElementById('simpleLogoutBtn');
  }

  setupEventListeners() {
    if (this.startRecordingBtn) {
      this.startRecordingBtn.addEventListener('click', () => this.startRecording());
    }
    
    // Recording mode events
    if (this.stopRecordingBtn) {
      this.stopRecordingBtn.addEventListener('click', () => this.stopRecording());
    }
    
    // Complete mode events
    if (this.newRecordingBtn) {
      this.newRecordingBtn.addEventListener('click', () => this.startNewRecording());
    }
    
    // Error handling
    if (this.dismissErrorBtn) {
      this.dismissErrorBtn.addEventListener('click', () => this.hideError());
    }
    
    // Simple logout button
    if (this.simpleLogoutBtn) {
      this.simpleLogoutBtn.addEventListener('click', () => this.handleSimpleLogout());
    }
    
    // Listen for recording state changes from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Popup received message:', message);
      
      if (message.action === 'recordingStateChanged') {
        console.log('Recording state changed:', message.state);
        this.recordingState = message.state;
        this.updateUIForState();
        
        // If recording completed (not by user action), switch to setup mode
        if (!this.recordingState.isRecording && this.currentMode === 'recording') {
          console.log('Recording completed, switching to setup mode');
          this.startNewRecording();
        }
      }

      if (message.action === 'microphoneAccessFailed') {
        console.warn('Microphone access failed during recording:', message.error);
        
        // Update microphone toggle state to reflect failure
        if (this.microphoneToggle) {
          this.microphoneToggle.checked = false;
          this.updateMicrophoneToggleState('denied');
        }
        
        // Show a warning but don't stop the recording
        this.showError('Warning: Microphone access failed. Recording will continue without microphone audio. ' + message.error);
        
        // Auto-hide the error after a few seconds since recording is still working
        setTimeout(() => {
          this.hideError();
        }, 5000);
      }

      if (message.action === 'microphonePermissionResult') {
        console.log('Microphone permission result:', message);
        this.handleMicrophonePermissionResult(message.success, message.error);
      }

      // Handle authentication events
      if (message.action === 'authEvent') {
        this.handleAuthEvent(message.eventType, message.data);
      }
    });
    
    // Save settings on change
    if (this.deviceAudioToggle) {
      this.deviceAudioToggle.addEventListener('change', () => this.saveSettings());
    }
    
    if (this.microphoneToggle) {
      this.microphoneToggle.addEventListener('change', (e) => this.handleMicrophoneToggle(e));
    }
  }

  handleAuthEvent(eventType, data) {
    switch (eventType) {
      case 'tokensCleared':
        console.log('Auth tokens were cleared, redirecting to login...');
        this.redirectToLogin();
        break;
        
      case 'tokensUpdated':
        console.log('Auth tokens were updated');
        // Could refresh UI or show success message
        break;
        
      default:
        console.log('Unknown auth event:', eventType);
    }
  }

  async loadInitialState() {
    try {
      // Get current recording state from background
      const response = await chrome.runtime.sendMessage({ action: 'getRecordingState' });
      this.recordingState = response;
      
      // Load saved settings
      await this.loadSettings();
      
      // Update UI based on current state
      this.updateUIForState();
      
    } catch (error) {
      console.error('Error loading initial state:', error);
      this.showError('Failed to load recorder state');
    }
  }

  updateUIForState() {
    console.log('Updating UI for state:', this.recordingState);
    
    if (!this.recordingState) {
      console.log('No recording state, staying in setup mode');
      this.switchToSetupMode();
      return;
    }
    
    if (this.recordingState.isRecording) {
      console.log('Recording is active, switching to recording mode');
      this.switchToRecordingMode();
    } else {
      console.log('No active recording, switching to setup mode');
      this.switchToSetupMode();
    }
  }

  switchToSetupMode() {
    this.currentMode = 'setup';
    this.setupMode.style.display = 'flex';
    this.recordingMode.style.display = 'none';
    this.completeMode.style.display = 'none';
    
    // Remove compact size
    document.body.classList.remove('recording-mode');
    document.querySelector('.container').classList.remove('recording-mode');
  }

  switchToRecordingMode() {
    console.log('Switching to recording mode');
    this.currentMode = 'recording';
    this.setupMode.style.display = 'none';
    this.recordingMode.style.display = 'flex';
    this.completeMode.style.display = 'none';
    
    // Shrink popup size
    document.body.classList.add('recording-mode');
    document.querySelector('.container').classList.add('recording-mode');
    
    // Wait a moment for DOM to update, then initialize recording controls
    setTimeout(() => {
      // Re-find recording mode elements after switching
      this.stopRecordingBtn = document.getElementById('stopRecordingBtn');
      
      console.log('Recording mode elements:', {
        stopRecordingBtn: !!this.stopRecordingBtn
      });
      
      // Re-attach event listeners for recording mode buttons
      if (this.stopRecordingBtn && !this.stopRecordingBtn.hasAttribute('data-listener-attached')) {
        this.stopRecordingBtn.addEventListener('click', () => this.stopRecording());
        this.stopRecordingBtn.setAttribute('data-listener-attached', 'true');
        console.log('Stop recording button listener attached');
      }
      
      // Update recording display info
      this.updateRecordingDisplay();
      this.startRecordingTimer();
    }, 100);
  }

  switchToCompleteMode() {
    this.currentMode = 'complete';
    this.setupMode.style.display = 'none';
    this.recordingMode.style.display = 'none';
    this.completeMode.style.display = 'flex';
    
    // Remove compact size
    document.body.classList.remove('recording-mode');
    document.querySelector('.container').classList.remove('recording-mode');
    
    this.stopRecordingTimer();
    
    // Wait a moment for DOM to update, then attach event listener
    setTimeout(() => {
      this.newRecordingBtn = document.getElementById('newRecordingBtn');
      if (this.newRecordingBtn && !this.newRecordingBtn.hasAttribute('data-listener-attached')) {
        this.newRecordingBtn.addEventListener('click', () => this.startNewRecording());
        this.newRecordingBtn.setAttribute('data-listener-attached', 'true');
        console.log('New recording button listener attached');
      }
    }, 100);
  }

  async handleMicrophoneToggle(event) {
    const isChecked = event.target.checked;
    
    if (isChecked) {
      // User wants to enable microphone - test permission via iframe injection
      this.updateMicrophoneToggleState('requesting');
      
      try {
        const hasPermission = await this.testMicrophonePermission();
        
        if (!hasPermission) {
          // Permission denied - revert toggle
          event.target.checked = false;
          this.updateMicrophoneToggleState('denied');
          return;
        } else {
          this.updateMicrophoneToggleState('granted');
        }
      } catch (error) {
        console.error('Error testing microphone permission:', error);
        event.target.checked = false;
        this.updateMicrophoneToggleState('denied');
        this.showError('Failed to test microphone: ' + error.message);
        return;
      }
    } else {
      // User disabled microphone
      this.updateMicrophoneToggleState('default');
    }
    
    this.saveSettings();
  }

  async testMicrophonePermission() {
    try {
      // Show requesting state
      this.updateMicrophoneToggleState('requesting');
      
      // Request microphone permission via iframe injection
      const response = await chrome.runtime.sendMessage({ 
        action: 'testMicrophonePermission' 
      });
      
      if (response && response.success) {
        console.log('Microphone permission granted');
        return true;
      } else {
        console.error('Microphone permission denied:', response?.error);
        this.showError(response?.error || 'Microphone access denied. Please allow microphone access and try again.');
        return false;
      }
      
    } catch (error) {
      console.error('Error testing microphone permission:', error);
      this.showError('Failed to test microphone access: ' + error.message);
      return false;
    }
  }

  handleMicrophonePermissionResult(success, error) {
    this.hideLoading();
    
    if (success) {
      this.updateMicrophoneToggleState('granted');
      this.saveSettings();
    } else {
      this.microphoneToggle.checked = false;
      this.updateMicrophoneToggleState('denied');
      this.showError(error || 'Microphone access denied. Please allow microphone access and try again.');
    }
  }

  updateMicrophoneToggleState(state) {
    const toggleOption = this.microphoneToggle?.closest('.toggle-option');
    if (!toggleOption) return;
    
    // Remove all state classes
    toggleOption.classList.remove('requesting-permission', 'permission-denied', 'permission-granted');
    
    // Disable/enable toggle during request
    this.microphoneToggle.disabled = false;
    
    switch (state) {
      case 'requesting':
        toggleOption.classList.add('requesting-permission');
        this.microphoneToggle.disabled = true;
        break;
        
      case 'denied':
        toggleOption.classList.add('permission-denied');
        break;
        
      case 'granted':
        toggleOption.classList.add('permission-granted');
        break;
        
      case 'default':
        // No special state
        break;
    }
  }

  onRecordingTypeChange() {
    // Always show tab selection since we only support tab recording
    if (this.tabSelectionSection) {
      this.tabSelectionSection.style.display = 'block';
    }
        
    this.saveSettings();
  }



async startRecording() { 
  try {
    // Verify authentication before starting recording
    if (!await this.checkAuthentication()) {
      console.log('Authentication check failed during recording start');
      this.redirectToLogin();
      return;
    }

    const recordingType = 'tab'; // Always tab recording
    const videoQuality = '720p'; // Always 720p

    const options = {
      recordingType: recordingType,
      videoQuality: videoQuality,
      includeDeviceAudio: this.deviceAudioToggle.checked,
      includeMicrophone: this.microphoneToggle.checked
    };

    // Get current active tab automatically
    try {
      const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!currentTab.length || !currentTab[0].id) {
        this.showError('No active tab found to record');
        return;
      }
      options.tabId = currentTab[0].id;
      console.log('Recording current active tab:', currentTab[0].title);
    } catch (tabError) {
      console.error('Error getting current tab:', tabError);
      this.showError('Failed to get current tab for recording');
      return;
    }

    // If microphone is enabled, test permission first
    if (options.includeMicrophone) {
      console.log('Testing microphone permission before recording...');
      this.showLoading('Testing microphone access...');
      
      try {
        const micResponse = await chrome.runtime.sendMessage({
          action: 'testMicrophonePermission'
        });
        
        if (!micResponse || !micResponse.success) {
          this.hideLoading();
          this.showError(micResponse?.error || 'Microphone access denied. Please allow microphone access and try again.');
          this.microphoneToggle.checked = false; // Uncheck the toggle
          this.updateMicrophoneToggleState('denied');
          return;
        }
        
        console.log('Microphone permission confirmed');
        this.updateMicrophoneToggleState('granted');
        
      } catch (micError) {
        this.hideLoading();
        console.error('Error testing microphone:', micError);
        this.showError('Error testing microphone: ' + micError.message);
        this.microphoneToggle.checked = false;
        this.updateMicrophoneToggleState('denied');
        return;
      }
    }

    this.showLoading('Starting recording...');

    const response = await chrome.runtime.sendMessage({
      action: 'startRecording',
      options: options
    });

    this.hideLoading();

    if (response.success) {
      // Background will send state change, which will update UI
      console.log('Recording started successfully');
    } else {
      this.showError(response.error || 'Failed to start recording');
    }

  } catch (error) {
    this.hideLoading();
    console.error('Error starting recording:', error);
    this.showError('Failed to start recording: ' + error.message);
  }
}

  async stopRecording() {
    try {
      this.showLoading('Stopping recording...');
        
      const response = await chrome.runtime.sendMessage({ action: 'stopRecording' });
      
      this.hideLoading();
      
      if (response.success) {
        // Switch to complete mode to show "New Recording" button
        this.switchToCompleteMode();
      } else {
        this.showError(response.error || 'Failed to stop recording');
      }
      
    } catch (error) {
      this.hideLoading();
      console.error('Error stopping recording:', error);
      this.showError('Failed to stop recording');
    }
  }

  updateRecordingDisplay() {
    if (!this.recordingState) return;
    
    // Update recording type display - always Browser Tab
    this.recordingTypeDisplay.textContent = 'Browser Tab';
    
    // Update quality display - always 720p
    this.recordingQualityDisplay.textContent = '720p';
  }

  startRecordingTimer() {
    this.stopRecordingTimer();
    
    if (!this.recordingState || !this.recordingState.recordingStartTime) return;
    
    this.recordingTimerInterval = setInterval(() => {
      if (this.recordingState && this.recordingState.recordingStartTime) {
        const elapsed = Date.now() - this.recordingState.recordingStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.recordingTimer.textContent = 
          `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        // Estimate file size (rough calculation)
        const estimatedMB = Math.floor(elapsed / 1000 * 0.8); // ~0.8MB per second
        this.recordingSizeDisplay.textContent = `~${estimatedMB} MB`;
      }
    }, 1000);
  }

  stopRecordingTimer() {
    if (this.recordingTimerInterval) {
      clearInterval(this.recordingTimerInterval);
      this.recordingTimerInterval = null;
    }
  }

  startNewRecording() {
    this.recordingState = {
      isRecording: false,
      recordingType: null,
      currentTabId: null,
      recordingStartTime: null
    };
    
    // Always reset microphone to false when starting new recording
    if (this.microphoneToggle) {
      this.microphoneToggle.checked = false;
      this.updateMicrophoneToggleState('default');
    }
    
    this.switchToSetupMode();
  }

  async saveSettings() {
    try {
      const settings = {
        recordingType: 'tab', // Always tab recording
        videoQuality: '720p', // Always 720p
        includeDeviceAudio: this.deviceAudioToggle ? this.deviceAudioToggle.checked : true,
        // Note: We don't save microphone setting to ensure it's always false on popup open
      };
      
      await chrome.storage.local.set(settings);
      console.log('Settings saved:', settings);
      
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.local.get({
        recordingType: 'tab',
        videoQuality: '720p',
        includeDeviceAudio: true,
        // Don't load microphone setting - always start with false
      });
      
      // Apply settings to UI - tab recording is always selected (no UI change needed)
      // Video quality is always 720p (no UI change needed)
      
      if (this.deviceAudioToggle) {
        this.deviceAudioToggle.checked = settings.includeDeviceAudio;
      }
      
      // Always set microphone to false on popup open
      if (this.microphoneToggle) {
        this.microphoneToggle.checked = false;
        this.updateMicrophoneToggleState('default');
        console.log('Microphone access set to false by default');
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async checkMicrophonePermissionStatus() {
    // This method is no longer needed since we always start with microphone disabled
    // Keeping it for compatibility but not doing anything
    console.log('Microphone permission check skipped - always starting with microphone disabled');
  }

  showLoading(message) {
    this.loadingOverlay.querySelector('.loading-text').textContent = message;
    this.loadingOverlay.style.display = 'flex';
  }

  hideLoading() {
    this.loadingOverlay.style.display = 'none';
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.errorOverlay.style.display = 'flex';
  }

  hideError() {
    this.errorOverlay.style.display = 'none';
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  formatFileSize(bytes) {
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`;
    return `${mb.toFixed(1)} MB`;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.meetRecorder = new MeetRecorderPopup();
});

// Handle popup closing
window.addEventListener('beforeunload', () => {
  if (window.meetRecorder && window.meetRecorder.recordingTimerInterval) {
    clearInterval(window.meetRecorder.recordingTimerInterval);
  }
});