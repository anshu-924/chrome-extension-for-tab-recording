// Google Meet Detection Content Script for Meet Recorder
// Enhanced with Extension Context Validation and Camera Button UI

class MeetDetector {
  constructor() {
    this.isMeetActive = false;
    this.meetInfo = null;
    this.recordingIndicator = null;
    this.isRecording = false;
    this.extensionContextValid = true;
    this.cleanupHandlers = [];
    this.isIndicatorHidden = false; // NEW: Track if user manually hid the indicator
    
    this.init();
  }

  // Check if extension context is valid
  isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (error) {
      console.warn('Extension context is invalid:', error);
      this.extensionContextValid = false;
      return false;
    }
  }

  // Safe message sending with context validation
  async safeMessageSend(message, options = {}) {
    try {
      if (!this.isExtensionContextValid()) {
        console.warn('Cannot send message - extension context invalid:', message.action);
        return null;
      }

      const response = await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Message timeout')), options.timeout || 5000)
        )
      ]);

      return response;

    } catch (error) {
      if (error.message.includes('Extension context invalidated') || 
          error.message.includes('Could not establish connection') ||
          error.message.includes('The message port closed')) {
        
        console.warn(`Extension context invalidated during ${message.action}:`, error.message);
        this.extensionContextValid = false;
        this.handleContextInvalidation();
        return null;
      }

      if (options.silent) {
        console.warn(`Silent message send failed for ${message.action}:`, error.message);
        return null;
      }

      throw error;
    }
  }

  // Handle extension context invalidation
  handleContextInvalidation() {
    console.log('Extension context invalidated - cleaning up meet detector');
    
    this.removeRecordingIndicator();
    
    this.cleanupHandlers.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('Cleanup handler error:', error);
      }
    });
    
    this.extensionContextValid = false;
  }

  init() {
    console.log('Google Meet Recorder: Initializing Meet detector');
    
    if (!this.isExtensionContextValid()) {
      console.warn('Extension context invalid during initialization');
      return;
    }
    
    this.detectMeetSession();
    this.setupMessageListener();
    this.monitorMeetChanges();
    this.setupUnloadHandler();
    this.setupContextMonitoring();
  }

  setupContextMonitoring() {
    const contextCheck = setInterval(() => {
      if (!this.isExtensionContextValid()) {
        clearInterval(contextCheck);
        this.handleContextInvalidation();
      }
    }, 10000);

    this.cleanupHandlers.push(() => clearInterval(contextCheck));
  }

  detectMeetSession() {
    if (!this.extensionContextValid) {
      return;
    }

    const meetSelectors = [
      '[data-meeting-title]',
      '[data-call-id]',
      '.uArJ5e',
      '[data-participant-id]',
      '[jsname="BOHaEe"]',
      '.VfPpkd-Bz112c-LgbsSe',
      'div[data-fps-request-screencast-cap]'
    ];
    
    const wasMeetActive = this.isMeetActive;
    this.isMeetActive = meetSelectors.some(selector => 
      document.querySelector(selector) !== null
    );
    
    this.isMeetActive = this.isMeetActive || 
      (window.location.href.includes('meet.google.com') && 
       window.location.pathname.length > 10);
    
    if (this.isMeetActive && !wasMeetActive) {
      console.log('Google Meet Recorder: Meet session detected');
      this.onMeetSessionStart();
    } else if (!this.isMeetActive && wasMeetActive) {
      console.log('Google Meet Recorder: Meet session ended');
      this.onMeetSessionEnd();
    }
  }

  async onMeetSessionStart() {
    this.meetInfo = {
      url: window.location.href,
      title: this.getMeetTitle(),
      timestamp: Date.now(),
      participants: this.getParticipantCount()
    };
    
    await this.safeMessageSend({
      action: 'meetSessionDetected',
      ...this.meetInfo
    }, { silent: true });
    
    // Only add indicator if not manually hidden by user
    if (!this.isIndicatorHidden) {
      this.addRecordingIndicator();
    }
  }

  onMeetSessionEnd() {
    this.removeRecordingIndicator();
    this.meetInfo = null;
    this.isIndicatorHidden = false; // Reset hidden state when session ends
  }

  getMeetTitle() {
    const titleSelectors = [
      '[data-meeting-title]',
      '.u6vdMe',
      '.VfPpkd-fmcmS-wGMbrd',
      'title'
    ];
    
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const title = element.textContent || element.getAttribute('data-meeting-title');
        if (title && title.trim() && !title.includes('Google Meet')) {
          return title.trim();
        }
      }
    }
    
    return 'Google Meet Session';
  }

  getParticipantCount() {
    const participantSelectors = [
      '[data-participant-id]',
      '.NZp2ef',
      '.KV1GEc'
    ];
    
    for (const selector of participantSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements.length;
      }
    }
    
    return 1;
  }

  // NEW: Enhanced recording indicator with camera button and close functionality
  addRecordingIndicator() {
    if (!this.extensionContextValid || this.isIndicatorHidden) {
      return;
    }

    this.removeRecordingIndicator();
    
    this.recordingIndicator = document.createElement('div');
    this.recordingIndicator.id = 'meet-recorder-indicator';
    this.recordingIndicator.innerHTML = `
      <div class="recorder-button-container">
        <button class="record-btn" title="Start Recording Meeting">
          🎥
        </button>
        <button class="close-btn" title="Hide Recorder">
          ✕
        </button>
        <div class="recorder-tooltip">Click to start recording</div>
      </div>
      <div class="recording-status">
        <div class="recording-dot"></div>
        <span>Recording...</span>
      </div>
    `;
    
    // Get button references
    const recordBtn = this.recordingIndicator.querySelector('.record-btn');
    const closeBtn = this.recordingIndicator.querySelector('.close-btn');
    
    // NEW: Record button click handler
    const handleRecordClick = async () => {
      if (!this.isExtensionContextValid()) {
        console.warn('Cannot interact with extension - context invalid');
        // this.showUserMessage('Extension context invalid. Please refresh the page.');
        return;
      }

      if (this.isRecording) {
        // Stop recording
        await this.safeMessageSend({ action: 'stopRecording' }, { silent: true });
      } else {
        // Start recording - open popup
        const result = await this.safeMessageSend({ action: 'openPopup' }, { silent: true });
        if (!result) {
          console.log('Please click the Google Meet Recorder extension icon to start recording');
          // this.showUserMessage('Click the extension icon to start recording');
        }
      }
    };

    // NEW: Close button click handler
    const handleCloseClick = () => {
      this.hideRecordingIndicator();
    };

    recordBtn.addEventListener('click', handleRecordClick);
    closeBtn.addEventListener('click', handleCloseClick);
    
    // Store cleanup handlers
    this.cleanupHandlers.push(
      () => recordBtn.removeEventListener('click', handleRecordClick),
      () => closeBtn.removeEventListener('click', handleCloseClick)
    );
    
    // Add to page
    document.body.appendChild(this.recordingIndicator);
    
    // Update display based on current recording state
    this.updateRecordingIndicator(this.isRecording);
    
    console.log('Google Meet Recorder: Camera recording button added with close option');
  }

  // NEW: Hide recording indicator (user action)
  hideRecordingIndicator() {
    this.isIndicatorHidden = true;
    this.removeRecordingIndicator();
    console.log('Recording indicator manually hidden by user');
    
    // // Show a small notification that it's hidden
    // this.showUserMessage('Recording button hidden. Refresh page to show again.', 3000);
  }


  removeRecordingIndicator() {
    if (this.recordingIndicator) {
      this.recordingIndicator.remove();
      this.recordingIndicator = null;
    }
  }

  // NEW: Enhanced recording indicator update
  updateRecordingIndicator(isRecording) {
    this.isRecording = isRecording;
    
    if (!this.recordingIndicator) return;
    
    const recordBtn = this.recordingIndicator.querySelector('.record-btn');
    const recordingStatus = this.recordingIndicator.querySelector('.recording-status');
    const buttonContainer = this.recordingIndicator.querySelector('.recorder-button-container');
    const tooltip = this.recordingIndicator.querySelector('.recorder-tooltip');
    
    if (isRecording) {
      // Hide the camera button and show recording status
      if (buttonContainer) buttonContainer.style.display = 'none';
      if (recordingStatus) recordingStatus.classList.add('active');
      
      console.log('Recording indicator switched to recording mode');
    } else {
      // Show the camera button and hide recording status
      if (buttonContainer) buttonContainer.style.display = 'block';
      if (recordingStatus) recordingStatus.classList.remove('active');
      
      // Update button appearance
      if (recordBtn) {
        recordBtn.textContent = '🎥';
        recordBtn.title = 'Start Recording Meeting';
      }
      if (tooltip) {
        tooltip.textContent = 'Click to start recording';
      }
      
      console.log('Recording indicator switched to ready mode');
    }
  }

  setupMessageListener() {
    try {
      const messageHandler = (message, sender, sendResponse) => {
        if (!this.isExtensionContextValid()) {
          return;
        }

        switch (message.action) {
          case 'recordingStateChanged':
            if (message.state) {
              this.updateRecordingIndicator(message.state.isRecording);
            }
            break;
            
          case 'getMeetInfo':
            sendResponse({
              isMeetActive: this.isMeetActive,
              meetInfo: this.meetInfo
            });
            break;
        }
      };

      chrome.runtime.onMessage.addListener(messageHandler);
      
      this.cleanupHandlers.push(() => {
        try {
          chrome.runtime.onMessage.removeListener(messageHandler);
        } catch (error) {
          // Context might already be invalid
        }
      });

    } catch (error) {
      console.warn('Failed to setup message listener:', error);
      this.handleContextInvalidation();
    }
  }

  monitorMeetChanges() {
    let currentURL = window.location.href;
    
    const urlObserver = new MutationObserver(() => {
      if (!this.extensionContextValid) {
        urlObserver.disconnect();
        return;
      }

      if (window.location.href !== currentURL) {
        currentURL = window.location.href;
        setTimeout(() => this.detectMeetSession(), 1000);
      }
    });
    
    urlObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    const meetObserver = new MutationObserver(() => {
      if (!this.extensionContextValid) {
        meetObserver.disconnect();
        return;
      }
      this.detectMeetSession();
    });
    
    meetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-meeting-title', 'data-call-id']
    });
    
    const periodicCheck = setInterval(() => {
      if (!this.extensionContextValid) {
        clearInterval(periodicCheck);
        return;
      }
      this.detectMeetSession();
    }, 5000);
    
    this.cleanupHandlers.push(
      () => urlObserver.disconnect(),
      () => meetObserver.disconnect(),
      () => clearInterval(periodicCheck)
    );
  }

  setupUnloadHandler() {
    const handleUnload = async () => {
      if (this.isMeetActive && this.isExtensionContextValid()) {
        await this.safeMessageSend({
          action: 'tabClosing',
          tabId: null,
          inMeetSession: true
        }, { 
          silent: true, 
          timeout: 1000
        });
      }
      
      this.handleContextInvalidation();
    };
    
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    
    let isNavigatingAway = false;
    
    const handleNavigation = (event) => {
      const link = event.target.closest('a');
      if (link && link.href && !link.href.includes('meet.google.com')) {
        isNavigatingAway = true;
        setTimeout(() => {
          if (isNavigatingAway && this.isExtensionContextValid()) {
            this.safeMessageSend({
              action: 'tabClosing',
              tabId: null,
              inMeetSession: this.isMeetActive
            }, { silent: true });
          }
        }, 100);
      }
    };

    document.addEventListener('click', handleNavigation);
    
    const resetNavFlag = setInterval(() => {
      if (window.location.href.includes('meet.google.com')) {
        isNavigatingAway = false;
      }
    }, 1000);
    
    this.cleanupHandlers.push(
      () => window.removeEventListener('beforeunload', handleUnload),
      () => window.removeEventListener('pagehide', handleUnload),
      () => document.removeEventListener('click', handleNavigation),
      () => clearInterval(resetNavFlag)
    );
  }
}

// Initialize detector when DOM is ready with enhanced error handling
function initializeMeetDetector() {
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('Extension context invalid - skipping Meet detector initialization');
      return;
    }

    new MeetDetector();
    console.log('Meet detector initialized successfully with camera button UI');
  } catch (error) {
    console.error('Failed to initialize Meet detector:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMeetDetector);
} else {
  initializeMeetDetector();
}