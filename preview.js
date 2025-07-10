// Recording Preview Page Controller with Audio Download Support and Cloud Upload

class RecordingPreview {
  constructor() {
    this.recordingData = null;
    this.hasBeenSaved = false;
    this.hasAudioBeenSaved = false;
    this.hasBeenUploaded = false; // New: Track cloud upload
    this.authContext = null; // New: Store authentication context
    this.initializeElements();
    this.setupEventListeners();
    this.setupTabCloseWarning();
    this.loadRecordingData();
    this.loadAuthContext(); // New: Load authentication data
  }

  initializeElements() {
    this.videoContainer = document.getElementById('videoContainer');
    this.loadingState = document.getElementById('loadingState');
    this.recordingVideo = document.getElementById('recordingVideo');
    this.errorState = document.getElementById('errorState');
    
    this.durationValue = document.getElementById('durationValue');
    this.sizeValue = document.getElementById('sizeValue');
    this.audioSizeValue = document.getElementById('audioSizeValue');
    this.qualityValue = document.getElementById('qualityValue');
    this.formatValue = document.getElementById('formatValue');
    
    this.downloadBtn = document.getElementById('downloadBtn');
    this.downloadAudioBtn = document.getElementById('downloadAudioBtn');
    this.uploadCloudBtn = document.getElementById('uploadCloudBtn'); // New: Upload button
    this.closeBtn = document.getElementById('closeBtn');
    
    // New: Upload status elements
    this.uploadStatus = document.getElementById('uploadStatus');
    this.uploadStatusText = document.getElementById('uploadStatusText');
  }

  setupEventListeners() {
    this.downloadBtn.addEventListener('click', () => this.downloadRecording());
    this.downloadAudioBtn.addEventListener('click', () => this.downloadAudioRecording());
    this.uploadCloudBtn.addEventListener('click', () => this.uploadToCloud()); // New: Upload handler
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

  // New: Load authentication context
  async loadAuthContext() {
    try {
      console.log('Loading authentication context...');
      
      // Get authentication data from storage
      const result = await chrome.storage.local.get(['auth_token', 'user_id']);
      
      if (!result.auth_token || !result.user_id) {
        console.warn('No authentication context found');
        this.disableUploadButton('Authentication required');
        return;
      }

      // Parse token to get user info
      const tokenData = this.parseJwt(result.auth_token);
      if (!tokenData) {
        console.warn('Invalid token format');
        this.disableUploadButton('Invalid authentication');
        return;
      }

      // Store auth context
      this.authContext = {
        userId: result.user_id,
        authToken: result.auth_token,
        phone: tokenData.phone || 'unknown',
        userInfo: tokenData
      };

      console.log('Authentication context loaded:', {
        userId: this.authContext.userId,
        phone: this.authContext.phone
      });

      // Enable upload button if we have audio
      this.updateUploadAvailability();

    } catch (error) {
      console.error('Error loading authentication context:', error);
      this.disableUploadButton('Authentication error');
    }
  }

  // New: Parse JWT token
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

  // New: Update upload button availability
  updateUploadAvailability() {
    if (!this.authContext) {
      this.disableUploadButton('Authentication required');
      return;
    }

    if (!this.recordingData || !this.recordingData.audioUrl || this.recordingData.audioSize <= 0) {
      this.disableUploadButton('No audio to upload');
      return;
    }

    if (this.hasBeenUploaded) {
      this.disableUploadButton('Already uploaded');
      return;
    }

    // Enable upload button
    this.uploadCloudBtn.disabled = false;
    this.uploadCloudBtn.style.opacity = '1';
    this.uploadCloudBtn.style.cursor = 'pointer';
    this.uploadCloudBtn.title = 'Upload audio recording to cloud';
    
    console.log('Upload button enabled');
  }

  // New: Disable upload button with reason
  disableUploadButton(reason) {
    this.uploadCloudBtn.disabled = true;
    this.uploadCloudBtn.style.opacity = '0.5';
    this.uploadCloudBtn.style.cursor = 'not-allowed';
    this.uploadCloudBtn.title = reason;
    console.log('Upload button disabled:', reason);
  }

  // New: Upload to cloud functionality
  async uploadToCloud() {
    if (!this.authContext) {
      this.showUploadError('Authentication required. Please login first.');
      return;
    }

    if (!this.recordingData || !this.recordingData.audioUrl || this.recordingData.audioSize <= 0) {
      this.showUploadError('No audio recording available to upload.');
      return;
    }

    try {
      console.log('Starting cloud upload...');
      this.showUploadStatus('Preparing upload...', 'uploading');
      this.uploadCloudBtn.disabled = true;

      // Convert audio blob URL to actual blob
      const audioBlob = await this.fetchBlobFromUrl(this.recordingData.audioUrl);
      
      if (!audioBlob) {
        throw new Error('Failed to prepare audio data for upload');
      }

      console.log('Audio blob prepared:', {
        size: audioBlob.size,
        type: audioBlob.type
      });

      // Generate recording metadata
      const recordingMetadata = this.generateRecordingMetadata();
      
      console.log('Generated metadata:', recordingMetadata);

      // Show uploading status
      this.showUploadStatus('Uploading to cloud...', 'uploading');

      // Call n8n workflow
      const uploadResult = await this.callN8nWorkflow(audioBlob, recordingMetadata);

      if (uploadResult.success) {
        console.log('Upload successful:', uploadResult);
        this.hasBeenUploaded = true;
        this.showUploadStatus('✅ Upload successful!', 'success');
        this.disableUploadButton('Upload completed');
        
        // Hide status after delay
        setTimeout(() => {
          this.hideUploadStatus();
        }, 5000);
      } else {
        throw new Error(uploadResult.error || 'Upload failed');
      }

    } catch (error) {
      console.error('Upload error:', error);
      this.showUploadError(error.message);
      this.uploadCloudBtn.disabled = false; // Re-enable for retry
    }
  }

  // New: Fetch blob from blob URL
  async fetchBlobFromUrl(blobUrl) {
    try {
      const response = await fetch(blobUrl);
      return await response.blob();
    } catch (error) {
      console.error('Error fetching blob:', error);
      return null;
    }
  }

  // New: Generate recording metadata
  generateRecordingMetadata() {
    const now = new Date();
    const timestamp = now.toISOString();
    const recordingId = this.generateRecordingId();
    
    // Create timestamp for filename: 2024-07-07-14-30-15
    const fileTimestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .substring(0, 19);
    
    // Extract original filename without timestamp if it exists
    let originalName = this.recordingData.audioFilename || 'meeting-call.webm';
    
    // Remove any existing timestamp prefix from filename
    originalName = originalName.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}_/, '');
    
    // Create the final filename with timestamp prefix
    const finalFilename = `${fileTimestamp}_${recordingId}_${originalName}`;
    
    return {
      user_id: this.authContext.userId,
      phone_number: this.authContext.phone,
      recording_id: recordingId,
      original_filename: finalFilename,
      file_size: this.recordingData.audioSize,
      duration: Math.round(this.recordingData.duration || 0),
      recorded_at: timestamp,
      mime_type: this.recordingData.audioMimeType || 'audio/webm'
    };
  }

  // New: Generate unique recording ID
  generateRecordingId() {
    return 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // New: Call n8n workflow for upload
  async callN8nWorkflow(audioBlob, metadata) {
    try {
      // Create FormData for file upload
      const formData = new FormData();
      
      // Add audio file
      formData.append('audioFile', audioBlob, metadata.original_filename);
      // Add metadata as JSON
      formData.append('metadata', JSON.stringify(metadata));
      
      // Add authentication token
      formData.append('authToken', this.authContext.authToken);
      formData.append('userId', this.authContext.userId);

      console.log('Calling n8n workflow with metadata:', metadata);

      // Replace with your actual n8n webhook URL (matches your working webhook path)
      const n8nWebhookUrl = 'https://n8n.subspace.money/webhook/upload-audio-recording';
      
      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - browser will set it with boundary for FormData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('n8n workflow response:', result);

      if (result.success) {
        return {
          success: true,
          s3Key: result.s3Key,
          recordingId: metadata.recording_id,
          message: result.message || 'Upload completed successfully'
        };
      } else {
        throw new Error(result.error || 'Upload workflow failed');
      }

    } catch (error) {
      console.error('n8n workflow error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // New: Show upload status
  showUploadStatus(message, type = 'uploading') {
    this.uploadStatusText.textContent = message;
    this.uploadStatus.className = `upload-status show ${type}`;
    this.uploadStatus.style.display = 'block';
    
    // Animate in
    setTimeout(() => {
      this.uploadStatus.style.transform = 'translateX(0)';
    }, 100);
  }

  // New: Show upload error
  showUploadError(message) {
    this.showUploadStatus(`❌ ${message}`, 'error');
    
    // Hide after 8 seconds for errors
    setTimeout(() => {
      this.hideUploadStatus();
    }, 8000);
  }

  // New: Hide upload status
  hideUploadStatus() {
    this.uploadStatus.style.transform = 'translateX(100%)';
    setTimeout(() => {
      this.uploadStatus.style.display = 'none';
    }, 300);
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
      this.updateAudioAvailability(data);
      this.updateUploadAvailability(); // New: Update upload availability
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

    // Audio file size
    if (data.audioSize && data.audioSize > 0) {
      this.audioSizeValue.textContent = this.formatFileSize(data.audioSize);
    } else {
      this.audioSizeValue.textContent = 'N/A';
    }
    
    // Quality
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
    
    // Disable all buttons
    this.downloadBtn.disabled = true;
    this.downloadBtn.style.opacity = '0.5';
    this.downloadBtn.style.cursor = 'not-allowed';
    
    this.downloadAudioBtn.disabled = true;
    this.downloadAudioBtn.style.opacity = '0.5';
    this.downloadAudioBtn.style.cursor = 'not-allowed';
    
    this.disableUploadButton('No recording data');
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
      if ((!this.hasBeenSaved || !this.hasAudioBeenSaved || !this.hasBeenUploaded) && this.recordingData) {
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