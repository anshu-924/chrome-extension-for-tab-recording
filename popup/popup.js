// Google Meet Recorder Popup Controller

class MeetRecorderPopup {
  constructor() {
    this.currentMode = 'setup'; // setup, recording, complete
    this.recordingState = null;
    this.recordingTimer = null;
    
    console.log('Initializing MeetRecorderPopup...');
    
    this.initializeElements();
    this.setupEventListeners();
    this.loadInitialState();
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
    });
    
    // Save settings on change
    if (this.deviceAudioToggle) {
      this.deviceAudioToggle.addEventListener('change', () => this.saveSettings());
    }
    
    if (this.microphoneToggle) {
      this.microphoneToggle.addEventListener('change', (e) => this.handleMicrophoneToggle(e));
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
    
    // Load tabs if not already loaded
    if (this.tabSelector && this.tabSelector.children.length <= 1) {
      this.loadTabs();
    }
    
    this.saveSettings();
  }

  async loadTabs() {
    if (!this.tabSelector) {
      console.error('Tab selector element not found');
      return;
    }
    
    try {
      console.log('Loading tabs...');
      this.tabSelector.innerHTML = '<option value="">Loading tabs...</option>';
      
      const tabs = await chrome.tabs.query({});
      this.tabSelector.innerHTML = '';
      
      // Get current tab first
      const currentTab = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (currentTab.length > 0) {
        const option = document.createElement('option');
        option.value = currentTab[0].id;
        option.textContent = `● ${this.truncateText(currentTab[0].title, 40)}`;
        option.selected = true;
        this.tabSelector.appendChild(option);
        console.log('Added current tab:', currentTab[0].title);
      }
      
      // Add other tabs
      tabs.forEach(tab => {
        if (!currentTab.length || tab.id !== currentTab[0].id) {
          const option = document.createElement('option');
          option.value = tab.id;
          let title = this.truncateText(tab.title || 'Untitled Tab', 40);
          
          // Add special indicators
          if (tab.url && tab.url.includes('meet.google.com')) {
            title = `🎥 ${title}`;
          } else if (tab.url && tab.url.includes('youtube.com')) {
            title = `📺 ${title}`;
          }
          
          option.textContent = title;
          this.tabSelector.appendChild(option);
        }
      });
      
      console.log(`Loaded ${tabs.length} tabs successfully`);
      
    } catch (error) {
      console.error('Error loading tabs:', error);
      if (this.tabSelector) {
        this.tabSelector.innerHTML = '<option value="">Error loading tabs</option>';
      }
    }
  }

async startRecording() { 
  try {
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
    this.switchToSetupMode();
  }

  async saveSettings() {
    try {
      const settings = {
        recordingType: 'tab', // Always tab recording
        videoQuality: '720p', // Always 720p
        includeDeviceAudio: this.deviceAudioToggle ? this.deviceAudioToggle.checked : true,
        includeMicrophone: this.microphoneToggle ? this.microphoneToggle.checked : false
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
        includeMicrophone: false
      });
      
      // Apply settings to UI - tab recording is always selected (no UI change needed)
      // Video quality is always 720p (no UI change needed)
      
      if (this.deviceAudioToggle) {
        this.deviceAudioToggle.checked = settings.includeDeviceAudio;
      }
      
      if (this.microphoneToggle) {
        this.microphoneToggle.checked = settings.includeMicrophone;
        
        // Check microphone permission status if it was previously enabled
        if (settings.includeMicrophone) {
          await this.checkMicrophonePermissionStatus();
        }
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async checkMicrophonePermissionStatus() {
    try {
      // Check permission via iframe approach
      const response = await chrome.runtime.sendMessage({ 
        action: 'checkMicrophoneStatus' 
      });
      
      if (response && response.hasPermission) {
        this.updateMicrophoneToggleState('granted');
      } else if (response && response.hasPermission === false) {
        this.microphoneToggle.checked = false;
        this.updateMicrophoneToggleState('denied');
      } else {
        // Permission status unknown - will be requested when needed
        this.updateMicrophoneToggleState('default');
      }
      
    } catch (error) {
      console.log('Could not check microphone permission status:', error);
      // Fallback to default state
      this.updateMicrophoneToggleState('default');
    }
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