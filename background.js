// Background Service Worker for Google Meet Recorder

let recordingState = {
  isRecording: false,
  isPaused: false,
  recordingType: null,
  currentTabId: null,
  recordingStartTime: null,
  recordingData: null
};

// Create offscreen document for MediaRecorder API
async function createOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Recording screen content using MediaRecorder API'
  });
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Google Meet Recorder Extension installed');
  
  // Initialize storage with default settings
  chrome.storage.local.set({
    videoQuality: '1080p',
    includeDeviceAudio: true,
    includeMicrophone: false,
    recordingFormat: 'webm'
  });
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  switch (message.action) {
    case 'getRecordingState':
      sendResponse(recordingState);
      break;
      
    case 'startRecording':
      handleStartRecording(message.options, sendResponse);
      return true;
      
    case 'stopRecording':
      handleStopRecording(sendResponse);
      return true;
      
    case 'createOffscreen':
      try {
        createOffscreenDocument().then(() => {
          sendResponse({ success: true });
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;

    case 'testMicrophonePermission':
      handleTestMicrophonePermission(sendResponse);
      return true;

    case 'checkMicrophoneStatus':
      handleCheckMicrophoneStatus(sendResponse);
      return true;

    case 'microphonePermissionResult':
      handleMicrophonePermissionResult(message, sendResponse);
      break;
      
    case 'recordingComplete':
      handleRecordingComplete(message, sender);
      break;
      
    case 'recordingError':
      handleRecordingError(message, sender);
      break;

    case 'microphoneAccessFailed':
      handleMicrophoneAccessFailed(message, sender);
      break;
      
    case 'memoryWarning':
      console.warn('Memory warning during recording:', message.message);
      // Could implement automatic quality reduction or chunked saving
      notifyPopupStateChange();
      break;
      
    case 'audioReleased':
      console.log('Audio streams released:', message.message);
      // Could notify user that audio playback should be restored
      break;
      
    case 'allStreamsReleased':
      console.log('ALL video and audio streams released:', message.message);
      // Normal video/audio playback should now be fully restored
      break;
      
    case 'meetSessionDetected':
      handleMeetDetection(message, sender);
      break;
      
    case 'tabClosing':
      handleTabClosing(message.tabId);
      break;
      
    case 'openPopup':
      // Handle request to open popup (from content script)
      try {
        chrome.action.openPopup();
      } catch (error) {
        console.log('Could not open popup programmatically:', error);
        // User will need to click the extension icon manually
      }
      break;
      
    default:
      console.warn('Unknown message action:', message.action);
  }
});

// Start recording based on options
async function handleStartRecording(options, sendResponse) {
  try {
    if (recordingState.isRecording) {
      sendResponse({ success: false, error: 'Recording already in progress' });
      return;
    }
    
    await createOffscreenDocument();
    
    // Update recording state first
    recordingState = {
      isRecording: false, // Will be set to true after successful start
      isPaused: false,
      recordingType: options.recordingType,
      currentTabId: options.tabId || null,
      recordingStartTime: null, // Will be set after start
      recordingData: null
    };
    
    // Store recording options
    await chrome.storage.session.set({ currentRecordingOptions: options });
    
    // Start appropriate recording type
    let result;
    if (options.recordingType === 'tab') {
      result = await startTabRecording(options);
    } else if (options.recordingType === 'window') {
      result = await startWindowRecording(options);
    }
    
    if (result.success) {
      recordingState.isRecording = true;
      recordingState.recordingStartTime = Date.now();
      updateBadge('REC');
      notifyPopupStateChange();
      sendResponse({ success: true, message: 'Recording started successfully' });
    } else {
      resetRecordingState();
      sendResponse({ success: false, error: result.error });
    }
    
  } catch (error) {
    console.error('Error starting recording:', error);
    resetRecordingState();
    sendResponse({ success: false, error: error.message });
  }
}

// Start tab recording
async function startTabRecording(options) {
  try {
    console.log('Starting tab recording for tab:', options.tabId);
    
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: options.tabId
    });
    
    if (!streamId) {
      throw new Error('Failed to get tab stream ID - make sure the tab has audio/video content');
    }
    
    console.log('Got tab stream ID:', streamId);
    
    // Send to offscreen document and wait for response
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'startTabRecording',
        streamId: streamId,
        options: options
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending to offscreen:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('Offscreen response:', response);
          resolve(response || { success: false, error: 'No response from offscreen' });
        }
      });
    });
    
  } catch (error) {
    console.error('Tab recording error:', error);
    return { success: false, error: error.message };
  }
}

// Start window recording  
async function startWindowRecording(options) {
  try {
    console.log('Starting window recording with options:', options);
    
    // Send to offscreen document and wait for response
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'startScreenRecording',
        options: options
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending to offscreen:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('Offscreen response:', response);
          resolve(response || { success: false, error: 'No response from offscreen' });
        }
      });
    });
    
  } catch (error) {
    console.error('Window recording error:', error);
    return { success: false, error: error.message };
  }
}

// Stop recording
async function handleStopRecording(sendResponse) {
  try {
    if (!recordingState.isRecording) {
      sendResponse({ success: false, error: 'No recording in progress' });
      return;
    }
    
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response from offscreen' });
        }
      });
    });
    
    if (response.success) {
      recordingState.recordingData = response.recordingData;
      resetRecordingState();
      updateBadge('');
      notifyPopupStateChange();
      sendResponse({ 
        success: true, 
        message: 'Recording stopped',
        recordingData: response.recordingData
      });
    } else {
      sendResponse({ success: false, error: response.error });
    }
    
  } catch (error) {
    console.error('Error stopping recording:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Test microphone permission via iframe injection
async function handleTestMicrophonePermission(sendResponse) {
  try {
    console.log('Testing microphone permission via iframe injection');
    
    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }
    
    const activeTabId = tabs[0].id;
    
    // Inject content script to handle microphone iframe
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: injectMicrophoneIframe,
    });
    
    sendResponse({ success: true, message: 'Microphone permission iframe injected' });
    
  } catch (error) {
    console.error('Error testing microphone permission:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Function to inject microphone iframe (will be executed in content script context)
function injectMicrophoneIframe() {
  // Remove any existing microphone iframe
  console.log('Injecting microphone permission iframe');
  const existingIframe = document.getElementById('meet-recorder-microphone-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }
  
  // Create new iframe
  const microphoneIframe = document.createElement('iframe');
  microphoneIframe.id = 'meet-recorder-microphone-iframe';
  microphoneIframe.setAttribute('allow', 'microphone');
  microphoneIframe.setAttribute('style', `
    all: initial;
    position: fixed;
    top: -1000px;
    left: -1000px;
    width: 1px;
    height: 1px;
    z-index: -1;
    opacity: 0;
    pointer-events: none;
  `);
  
  // Set source to extension microphone permission page
  microphoneIframe.src = chrome.runtime.getURL('microphone-permission.html');
  
  // Add to page
  document.body.appendChild(microphoneIframe);
  
  console.log('Microphone permission iframe injected');
  
  // Listen for messages from iframe
  window.addEventListener('message', function handleMicrophoneMessage(event) {
    if (event.data && event.data.action === 'microphonePermissionResult') {
      console.log('Received microphone permission result:', event.data);
      
      // Send result to background script
      chrome.runtime.sendMessage({
        action: 'microphonePermissionResult',
        success: event.data.success,
        error: event.data.error
      });
      
      // Remove iframe and listener
      setTimeout(() => {
        const iframe = document.getElementById('meet-recorder-microphone-iframe');
        if (iframe) {
          iframe.remove();
        }
      }, 100);
      
      window.removeEventListener('message', handleMicrophoneMessage);
    }
  });
  
  // Auto-remove after timeout
  setTimeout(() => {
    const iframe = document.getElementById('meet-recorder-microphone-iframe');
    if (iframe) {
      iframe.remove();
      chrome.runtime.sendMessage({
        action: 'microphonePermissionResult',
        success: false,
        error: 'Request timed out. Please try again.'
      });
    }
  }, 10000); // 10 second timeout
}

// Check microphone permission status via iframe injection
async function handleCheckMicrophoneStatus(sendResponse) {
  try {
    console.log('Checking microphone status via iframe injection');
    
    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      sendResponse({ hasPermission: null, error: 'No active tab found' });
      return;
    }
    
    const activeTabId = tabs[0].id;
    
    // Inject a quick check script
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: checkMicrophonePermissionStatus,
    });
    
    const result = results[0]?.result || { hasPermission: null };
    sendResponse(result);
    
  } catch (error) {
    console.error('Error checking microphone status:', error);
    sendResponse({ hasPermission: null, error: error.message });
  }
}

// Function to check microphone permission status (executed in content script context)
async function checkMicrophonePermissionStatus() {
  try {
    // Try to query microphone permission status
    const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
    
    console.log('Microphone permission status:', permissionStatus.state);
    
    switch (permissionStatus.state) {
      case 'granted':
        return { hasPermission: true };
      case 'denied':
        return { hasPermission: false };
      case 'prompt':
        return { hasPermission: null }; // Permission will be requested when needed
      default:
        return { hasPermission: null };
    }
    
  } catch (error) {
    console.log('Could not check microphone permission status:', error);
    return { hasPermission: null };
  }
}

// Handle microphone permission result from content script
function handleMicrophonePermissionResult(message, sendResponse) {
  console.log('Received microphone permission result:', message);
  
  // Forward the result to popup
  chrome.runtime.sendMessage({
    action: 'microphonePermissionResult',
    success: message.success,
    error: message.error
  }).catch(() => {
    // Popup might not be open, ignore error
  });
  
  if (sendResponse) {
    sendResponse({ received: true });
  }
}

// Handle microphone access failures during recording
function handleMicrophoneAccessFailed(message, sender) {
  console.warn('Microphone access failed during recording:', message.error);
  
  // Update any stored recording options to reflect microphone is not available
  chrome.storage.session.get(['currentRecordingOptions']).then(result => {
    if (result.currentRecordingOptions) {
      const updatedOptions = {
        ...result.currentRecordingOptions,
        includeMicrophone: false // Disable microphone in current recording
      };
      
      chrome.storage.session.set({ currentRecordingOptions: updatedOptions });
      console.log('Updated recording options to disable microphone');
    }
  }).catch(console.error);
  
  // Notify popup about the microphone failure
  chrome.runtime.sendMessage({
    action: 'microphoneAccessFailed',
    error: message.error
  }).catch(() => {
    // Popup might not be open, ignore error
  });
  
  // Optionally show a notification
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Microphone Access Failed',
    message: 'Recording will continue without microphone audio. ' + message.error
  }).catch(() => {
    // Notifications might not be available
  });
}

// Handle Meet session detection
function handleMeetDetection(message, sender) {
  console.log('Meet session detected:', message);
  
  // Store Meet info for UI
  chrome.storage.session.set({
    activeMeetSession: {
      tabId: sender.tab.id,
      url: message.url,
      title: message.title,
      timestamp: Date.now()
    }
  });
}

// Handle recording completion from offscreen document
function handleRecordingComplete(message, sender) {
  console.log('Recording completed:', message.recordingData);
  
  // Update recording state
  recordingState.recordingData = message.recordingData;
  recordingState.isRecording = false;
  recordingState.isPaused = false;
  
  // Clear badge
  updateBadge('');
  
  // Store recording data for preview tab
  chrome.storage.session.set({ 
    recordingData: message.recordingData 
  });
  
  // Open preview tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('preview.html')
  });
  
  // Notify popup about completion
  notifyPopupStateChange();
  
  console.log('Recording completion handled successfully');
}

// Handle recording errors from offscreen document
function handleRecordingError(message, sender) {
  console.error('Recording error from offscreen:', message.error);
  
  // Reset recording state
  resetRecordingState();
  updateBadge('');
  
  // Notify popup about error
  notifyPopupStateChange();
  
  // Could also show a notification to user
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Recording Error',
    message: message.error || 'An error occurred during recording'
  }).catch(() => {
    // Notifications might not be available
  });
}

// Handle tab closing during recording
function handleTabClosing(tabId) {
  if (recordingState.isRecording && recordingState.currentTabId === tabId) {
    console.log('Recording tab is closing, stopping recording...');
    
    // Stop recording automatically
    chrome.runtime.sendMessage({ action: 'stopRecording' })
      .then(() => {
        resetRecordingState();
        updateBadge('');
      })
      .catch(console.error);
  }
}

// Reset recording state
function resetRecordingState() {
  recordingState = {
    isRecording: false,
    isPaused: false,
    recordingType: null,
    currentTabId: null,
    recordingStartTime: null,
    recordingData: recordingState.recordingData // Keep recording data
  };
}

// Update extension badge
function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  
  let color = '#000000';
  if (text === 'REC') color = '#ff4444';
  else if (text === '⏸️') color = '#ff9500';
  
  chrome.action.setBadgeBackgroundColor({ color });
}

// Notify popup about state changes
function notifyPopupStateChange() {
  chrome.runtime.sendMessage({
    action: 'recordingStateChanged',
    state: recordingState
  }).catch(() => {
    // Popup might not be open, ignore error
  });
}

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabClosing(tabId);
});

// Handle tab navigation away from Meet
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && recordingState.isRecording && recordingState.currentTabId === tabId) {
    // Check if navigating away from a Meet session
    console.log(`Recording tab navigated to: ${changeInfo.url}`);
    // if (recordingState.recordingType === 'tab' && 
    //     !changeInfo.url.includes('meet.google.com')) {
    //   console.log('Navigating away from Meet, stopping recording...');
    //   handleTabClosing(tabId);
    // }
  }
}); 