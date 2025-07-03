// Google Meet Detection Content Script for Meet Recorder

class MeetDetector {
  constructor() {
    this.isMeetActive = false;
    this.meetInfo = null;
    this.recordingIndicator = null;
    this.isRecording = false;
    
    this.init();
  }

  init() {
    console.log('Google Meet Recorder: Initializing Meet detector');
    
    // Check if we're in a Meet session
    this.detectMeetSession();
    
    // Listen for recording state changes
    this.setupMessageListener();
    
    // Monitor for Meet session changes
    this.monitorMeetChanges();
    
    // Handle page unload (tab closing)
    this.setupUnloadHandler();
  }

  detectMeetSession() {
    // Check various Meet indicators
    const meetSelectors = [
      '[data-meeting-title]',
      '[data-call-id]',
      '.uArJ5e', // Meet video container
      '[data-participant-id]',
      '[jsname="BOHaEe"]', // Meet UI container
      '.VfPpkd-Bz112c-LgbsSe', // Meet join/leave buttons
      'div[data-fps-request-screencast-cap]'
    ];
    
    const wasMeetActive = this.isMeetActive;
    this.isMeetActive = meetSelectors.some(selector => 
      document.querySelector(selector) !== null
    );
    
    // Also check URL to be sure
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

  onMeetSessionStart() {
    // Extract meet information
    this.meetInfo = {
      url: window.location.href,
      title: this.getMeetTitle(),
      timestamp: Date.now(),
      participants: this.getParticipantCount()
    };
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'meetSessionDetected',
      ...this.meetInfo
    }).catch(console.error);
    
    // Add recording indicator
    this.addRecordingIndicator();
  }

  onMeetSessionEnd() {
    this.removeRecordingIndicator();
    this.meetInfo = null;
  }

  getMeetTitle() {
    // Try different selectors for meet title
    const titleSelectors = [
      '[data-meeting-title]',
      '.u6vdMe', // Meeting title in UI
      '.VfPpkd-fmcmS-wGMbrd', // Another title selector
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
    // Try to count participants
    const participantSelectors = [
      '[data-participant-id]',
      '.NZp2ef', // Participant video elements
      '.KV1GEc' // Participant list items
    ];
    
    for (const selector of participantSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements.length;
      }
    }
    
    return 1; // At least the current user
  }

  addRecordingIndicator() {
    // Remove existing indicator
    this.removeRecordingIndicator();
    
    this.recordingIndicator = document.createElement('div');
    this.recordingIndicator.id = 'meet-recorder-indicator';
    this.recordingIndicator.innerHTML = `
      <div class="recorder-indicator ${this.isRecording ? 'recording' : 'ready'}">
        <div class="indicator-dot"></div>
        <span class="indicator-text">${this.isRecording ? 'Recording' : 'Recorder Ready'}</span>
        <button class="indicator-btn" title="Open Google Meet Recorder">
          ${this.isRecording ? '⏹️' : '🎥'}
        </button>
        <button class="close-btn" title="Close">✕</button>
      </div>
    `;
    
    // Add click handlers
    const btn = this.recordingIndicator.querySelector('.indicator-btn');
    btn.addEventListener('click', () => {
      if (this.isRecording) {
        // Stop recording
        chrome.runtime.sendMessage({ action: 'stopRecording' });
      } else {
        // Open recorder popup
        chrome.runtime.sendMessage({ action: 'openPopup' }).catch(() => {
          // Fallback - just log that user should click extension icon
          console.log('Please click the Google Meet Recorder extension icon to start recording');
        });
      }
    });
    
    const closeBtn = this.recordingIndicator.querySelector('.close-btn');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeRecordingIndicator();
    });
    
    // Add to page
    document.body.appendChild(this.recordingIndicator);
    
    console.log('Google Meet Recorder: Recording indicator added');
  }

  removeRecordingIndicator() {
    if (this.recordingIndicator) {
      this.recordingIndicator.remove();
      this.recordingIndicator = null;
    }
  }

  updateRecordingIndicator(isRecording) {
    this.isRecording = isRecording;
    
    if (!this.recordingIndicator) return;
    
    const indicator = this.recordingIndicator.querySelector('.recorder-indicator');
    const dot = this.recordingIndicator.querySelector('.indicator-dot');
    const text = this.recordingIndicator.querySelector('.indicator-text');
    const btn = this.recordingIndicator.querySelector('.indicator-btn');
    
    if (isRecording) {
      indicator.classList.add('recording');
      indicator.classList.remove('ready');
      text.textContent = 'Recording';
      btn.textContent = '⏹️';
      btn.title = 'Stop Recording';
    } else {
      indicator.classList.add('ready');
      indicator.classList.remove('recording');
      text.textContent = 'Recorder Ready';
      btn.textContent = '🎥';
      btn.title = 'Open Google Meet Recorder';
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    });
  }

  monitorMeetChanges() {
    // Watch for URL changes (Meet navigation)
    let currentURL = window.location.href;
    
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== currentURL) {
        currentURL = window.location.href;
        setTimeout(() => this.detectMeetSession(), 1000);
      }
    });
    
    urlObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Watch for Meet UI changes
    const meetObserver = new MutationObserver(() => {
      this.detectMeetSession();
    });
    
    meetObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-meeting-title', 'data-call-id']
    });
    
    // Periodic check as backup
    setInterval(() => this.detectMeetSession(), 5000);
  }

  setupUnloadHandler() {
    // Handle page unload/refresh/navigation
    const handleUnload = () => {
      if (this.isMeetActive) {
        // Notify background about tab closing during Meet session
        chrome.runtime.sendMessage({
          action: 'tabClosing',
          tabId: null, // Will be filled by background
          inMeetSession: true
        }).catch(() => {
          // Ignore errors if extension context is already invalidated
        });
      }
    };
    
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    
    // Also handle navigation away from Meet
    let isNavigatingAway = false;
    
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (link && link.href && !link.href.includes('meet.google.com')) {
        isNavigatingAway = true;
        setTimeout(() => {
          if (isNavigatingAway) {
            handleUnload();
          }
        }, 100);
      }
    });
    
    // Reset navigation flag if still on Meet
    setInterval(() => {
      if (window.location.href.includes('meet.google.com')) {
        isNavigatingAway = false;
      }
    }, 1000);
  }
}

// Initialize detector when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new MeetDetector();
  });
} else {
  new MeetDetector();
}