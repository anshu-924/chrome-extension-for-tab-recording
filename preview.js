// Recording Preview Page Controller with Audio Download Support

class RecordingPreview {
  constructor() {
    this.recordingData = null;
    this.hasBeenSaved = false;
    this.hasAudioBeenSaved = false; // New: Track audio download
    this.initializeElements();
    this.setupEventListeners();
    this.setupTabCloseWarning();
    this.loadRecordingData();
  }

  initializeElements() {
    this.videoContainer = document.getElementById('videoContainer');
    this.loadingState = document.getElementById('loadingState');
    this.recordingVideo = document.getElementById('recordingVideo');
    this.errorState = document.getElementById('errorState');
    
    this.durationValue = document.getElementById('durationValue');
    this.sizeValue = document.getElementById('sizeValue');
    this.audioSizeValue = document.getElementById('audioSizeValue'); // New: Audio size display
    this.qualityValue = document.getElementById('qualityValue');
    this.formatValue = document.getElementById('formatValue');
    
    this.downloadBtn = document.getElementById('downloadBtn');
    this.downloadAudioBtn = document.getElementById('downloadAudioBtn'); // New: Audio download button
    this.closeBtn = document.getElementById('closeBtn');
  }

  setupEventListeners() {
    this.downloadBtn.addEventListener('click', () => this.downloadRecording());
    this.downloadAudioBtn.addEventListener('click', () => this.downloadAudioRecording()); // New: Audio download handler
    this.closeBtn.addEventListener('click', () => this.closePreview());
    
    // Handle video load events
    this.recordingVideo.addEventListener('loadedmetadata', () => {
      console.log('Video metadata loaded');
      this.updateVideoDetails();
    });
    
    this.recordingVideo.addEventListener('error', (e) => {
      console.error('Video load error:', e);
      this.showError();
    });
    
    // Listen for messages from extension
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'setRecordingData') {
        this.setRecordingData(message.data);
      }
    });
  }

  async loadRecordingData() {
    try {
      // Try to get recording data from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const dataParam = urlParams.get('data');
      
      if (dataParam) {
        try {
          const recordingData = JSON.parse(decodeURIComponent(dataParam));
          this.setRecordingData(recordingData);
          return;
        } catch (e) {
          console.error('Error parsing URL data:', e);
        }
      }
      
      // Try to get from session storage
      const storedData = sessionStorage.getItem('recordingData');
      if (storedData) {
        try {
          const recordingData = JSON.parse(storedData);
          this.setRecordingData(recordingData);
          return;
        } catch (e) {
          console.error('Error parsing stored data:', e);
        }
      }
      
      // Try to get from extension storage
      const result = await chrome.storage.session.get(['recordingData']);
      if (result.recordingData) {
        this.setRecordingData(result.recordingData);
        return;
      }
      
      // No data found
      setTimeout(() => {
        if (!this.recordingData) {
          this.showError();
        }
      }, 5000);
      
    } catch (error) {
      console.error('Error loading recording data:', error);
      this.showError();
    }
  }

  setRecordingData(data) {
    console.log('Setting recording data:', data);
    this.recordingData = data;
    
    if (data && data.url) {
      this.loadVideo(data.url);
      this.updateDetails(data);
      this.updateAudioAvailability(data); // New: Check audio availability
    } else {
      this.showError();
    }
  }

  updateAudioAvailability(data) {
    // Check if audio data is available
    const hasAudio = data.audioUrl && data.audioSize > 0;
    
    if (hasAudio) {
      this.downloadAudioBtn.disabled = false;
      this.downloadAudioBtn.style.opacity = '1';
      this.downloadAudioBtn.style.cursor = 'pointer';
      console.log('Audio recording available for download');
    } else {
      this.downloadAudioBtn.disabled = true;
      this.downloadAudioBtn.style.opacity = '0.5';
      this.downloadAudioBtn.style.cursor = 'not-allowed';
      this.downloadAudioBtn.title = 'No audio was recorded';
      console.log('No audio recording available');
    }
  }

  loadVideo(url) {
    this.loadingState.style.display = 'flex';
    this.recordingVideo.style.display = 'none';
    this.errorState.style.display = 'none';
    
    this.recordingVideo.src = url;
    
    // Set up load success handler
    const handleLoadSuccess = () => {
      this.loadingState.style.display = 'none';
      this.recordingVideo.style.display = 'block';
      this.recordingVideo.removeEventListener('canplay', handleLoadSuccess);
    };
    
    this.recordingVideo.addEventListener('canplay', handleLoadSuccess);
    
    // Set up error handling with timeout
    setTimeout(() => {
      if (this.recordingVideo.readyState === 0) {
        console.error('Video failed to load within timeout');
        this.showError();
      }
    }, 10000);
  }

  updateDetails(data) {
    // Duration
    if (data.duration) {
      this.durationValue.textContent = this.formatDuration(data.duration);
    }
    
    // Video file size
    if (data.size) {
      this.sizeValue.textContent = this.formatFileSize(data.size);
    }

    // Audio file size (new)
    if (data.audioSize && data.audioSize > 0) {
      this.audioSizeValue.textContent = this.formatFileSize(data.audioSize);
    } else {
      this.audioSizeValue.textContent = 'N/A';
    }
    
    // Quality (try to get from stored settings)
    chrome.storage.local.get(['videoQuality'], (result) => {
      this.qualityValue.textContent = result.videoQuality || '1080p';
    });
    
    // Format
    if (data.mimeType) {
      if (data.mimeType.includes('webm')) {
        this.formatValue.textContent = 'WebM';
      } else if (data.mimeType.includes('mp4')) {
        this.formatValue.textContent = 'MP4';
      } else {
        this.formatValue.textContent = 'Video';
      }
    }
  }

  updateVideoDetails() {
    // Update duration from actual video if not provided
    if (this.recordingVideo.duration && !this.recordingData?.duration) {
      this.durationValue.textContent = this.formatDuration(this.recordingVideo.duration);
    }
  }

  showError() {
    this.loadingState.style.display = 'none';
    this.recordingVideo.style.display = 'none';
    this.errorState.style.display = 'flex';
    
    // Disable both download buttons
    this.downloadBtn.disabled = true;
    this.downloadBtn.style.opacity = '0.5';
    this.downloadBtn.style.cursor = 'not-allowed';
    
    this.downloadAudioBtn.disabled = true;
    this.downloadAudioBtn.style.opacity = '0.5';
    this.downloadAudioBtn.style.cursor = 'not-allowed';
  }

  downloadRecording() {
    if (!this.recordingData || !this.recordingData.url) {
      alert('No recording data available for download');
      return;
    }
    
    try {
      const a = document.createElement('a');
      a.href = this.recordingData.url;
      a.download = this.recordingData.filename || `recording-${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.webm`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Mark video as saved
      this.hasBeenSaved = true;
      
      console.log('Video download initiated:', a.download);
      
    } catch (error) {
      console.error('Video download error:', error);
      alert('Failed to download video recording. Please try again.');
    }
  }

  downloadAudioRecording() {
    if (!this.recordingData || !this.recordingData.audioUrl) {
      alert('No audio recording data available for download');
      return;
    }
    
    try {
      const a = document.createElement('a');
      a.href = this.recordingData.audioUrl;
      a.download = this.recordingData.audioFilename || `audio-recording-${new Date().toISOString().slice(0,19).replace(/[:.]/g, '-')}.webm`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Mark audio as saved
      this.hasAudioBeenSaved = true;
      
      console.log('Audio download initiated:', a.download);
      
      // Show success message
      this.showAudioDownloadSuccess();
      
    } catch (error) {
      console.error('Audio download error:', error);
      alert('Failed to download audio recording. Please try again.');
    }
  }

  showAudioDownloadSuccess() {
    // Create a temporary success notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.3s ease;
      transform: translateX(100%);
    `;
    notification.textContent = '🎵 Audio download started successfully!';
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  setupTabCloseWarning() {
    // Warn user before closing tab if recording hasn't been saved
    window.addEventListener('beforeunload', (e) => {
      if ((!this.hasBeenSaved || !this.hasAudioBeenSaved) && this.recordingData) {
        const message = 'Your recording will be deleted if you close this tab. Save it first!';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });
    
    // Clean up on page hide (tab close/navigation)
    window.addEventListener('pagehide', () => {
      this.cleanupRecording();
    });
  }

  cleanupRecording() {
    // Clean up blob URLs to free memory
    if (this.recordingData) {
      if (this.recordingData.url) {
        URL.revokeObjectURL(this.recordingData.url);
        console.log('Video recording blob URL cleaned up');
      }
      
      if (this.recordingData.audioUrl) {
        URL.revokeObjectURL(this.recordingData.audioUrl);
        console.log('Audio recording blob URL cleaned up');
      }
    }
    
    // Clear storage
    sessionStorage.removeItem('recordingData');
    chrome.storage.session.remove(['recordingData']);
  }

  startNewRecording() {
    // Clear the recording data
    sessionStorage.removeItem('recordingData');
    chrome.storage.session.remove(['recordingData']);
    
    // Open extension popup
    chrome.runtime.sendMessage({ action: 'openPopup' });
    
    // Close this tab
    this.closePreview();
  }

  closePreview() {
    // Clean up recording data
    this.cleanupRecording();
    
    // Close the tab
    window.close();
  }

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  formatFileSize(bytes) {
    const mb = bytes / (1024 * 1024);
    const gb = mb / 1024;
    
    if (gb >= 1) {
      return `${gb.toFixed(2)} GB`;
    } else if (mb >= 1) {
      return `${mb.toFixed(1)} MB`;
    } else {
      return `${(mb * 1024).toFixed(0)} KB`;
    }
  }
}
              
// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.recordingPreview = new RecordingPreview();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  // Clean up blob URLs
  const video = document.getElementById('recordingVideo');
  if (video && video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }
  
  // Clean up any remaining recording data
  if (window.recordingPreview && window.recordingPreview.recordingData) {
    window.recordingPreview.cleanupRecording();
  }
});