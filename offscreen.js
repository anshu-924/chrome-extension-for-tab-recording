// Offscreen Document for Google Meet Recorder
// Handles MediaRecorder API with pause/resume and memory management

class MeetRecorderOffscreen {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.currentStream = null;
    this.audioContext = null;
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.totalPausedTime = 0;
    this.lastPauseTime = null;
    
    // Memory management
    this.maxChunkSize = 50 * 1024 * 1024; // 50MB chunks
    this.currentChunkSize = 0;
    this.chunkBlobs = [];
    
    this.setupMessageListener();
    console.log('Meet Recorder Offscreen document initialized');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Offscreen received message:', message);
      const validactions = [
        'startTabRecording', 
        'startScreenRecording', 
        'pauseRecording', 
        'resumeRecording', 
        'stopRecording', 
        'recordingStateChanged'
      ];
      
      if( !message || !message.action || !validactions.includes(message.action)) {
        // console.warn('Invalid message action in offscreen:', message.action);
        return;
      }
      
      switch (message.action) {
        case 'startTabRecording':
          this.startTabRecording(message.streamId, message.options)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'startScreenRecording':
          this.startScreenRecording(message.options)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'stopRecording':
          this.stopRecording()
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'recordingStateChanged':
          console.log('Offscreen: Recording state changed, ignoring');
          break;
          
        default:
          console.warn('Unknown message action in offscreen:', message.action);
      }
    });
  }

  async startTabRecording(streamId, options) {
    try {
      console.log('Starting tab recording with stream ID:', streamId);
      
      // Reset state
      this.recordedChunks = [];
      this.chunkBlobs = [];
      this.currentChunkSize = 0;
      this.totalPausedTime = 0;
      this.lastPauseTime = null;
      this.recordingStartTime = Date.now();
      
      // Use the proven method for tab capture
      const combinedStream = await this.createTabCombinedStream(streamId, options);
      this.currentStream = combinedStream;
      
      await this.initializeMediaRecorder(this.currentStream, options);
      
      this.isRecording = true;
      this.isPaused = false;
      
      return { success: true, message: 'Tab recording started successfully' };
      
    } catch (error) {
      console.error('Error starting tab recording:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

async createTabCombinedStream(streamId, options) {
  try {
    console.log('Creating combined tab stream with streamId:', streamId);
    
    // Use the tabCaptured streamId to get media
    this.originalTabStream = await navigator.mediaDevices.getUserMedia({
      audio: options.includeDeviceAudio ? {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          ...this.getVideoConstraints(options.videoQuality)
        },
      },
    });

    console.log('Tab stream acquired:', {
      video: this.originalTabStream.getVideoTracks().length,
      audio: this.originalTabStream.getAudioTracks().length
    });

    // Create AudioContext for mixing and passthrough
    this.audioContext = new AudioContext();
    this.destination = this.audioContext.createMediaStreamDestination();

    // Handle tab audio with passthrough
    if (options.includeDeviceAudio && this.originalTabStream.getAudioTracks().length > 0) {
      const tabAudioSource = this.audioContext.createMediaStreamSource(this.originalTabStream);
      
      // Create gain nodes for recording and passthrough
      const recordingGain = this.audioContext.createGain();
      const passthroughGain = this.audioContext.createGain();
      
      recordingGain.gain.value = 1.0; // Full volume for recording
      passthroughGain.gain.value = 1.0; // Full volume for speakers
      
      // Connect to both recording destination and speakers
      tabAudioSource.connect(recordingGain);
      tabAudioSource.connect(passthroughGain);
      
      recordingGain.connect(this.destination);
      passthroughGain.connect(this.audioContext.destination); // This enables audio passthrough!
      
      console.log('Tab audio passthrough enabled - audio will continue playing normally');
    }

    // If microphone is not needed, return the stream with passthrough
    if (!options.includeMicrophone) {
      const videoTracks = this.originalTabStream.getVideoTracks();
      const audioTracks = options.includeDeviceAudio && this.destination.stream.getAudioTracks().length > 0 
        ? this.destination.stream.getAudioTracks() 
        : [];
      
      return new MediaStream([...videoTracks, ...audioTracks]);
    }

    // Get microphone audio with proper error handling
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true 
        },
      });

      console.log('Microphone stream acquired');

      // Connect microphone to recording destination (but not to speakers to avoid feedback)
      const micAudioSource = this.audioContext.createMediaStreamSource(this.micStream);
      const micGain = this.audioContext.createGain();
      micGain.gain.value = 1.0;
      
      micAudioSource.connect(micGain);
      micGain.connect(this.destination);

    } catch (micError) {
      console.error('Failed to get microphone access:', micError);
      
      // Continue without microphone instead of failing completely
      console.warn('Continuing recording without microphone due to access error');
      
      // Notify about microphone failure
      chrome.runtime.sendMessage({
        action: 'microphoneAccessFailed',
        error: micError.message
      }).catch(() => {});
    }

    // Create combined stream with video from tab and mixed audio
    const combinedStream = new MediaStream([
      this.originalTabStream.getVideoTracks()[0],
      this.destination.stream.getTracks()[0],
    ]);

    console.log('Combined stream created successfully with audio passthrough');
    return combinedStream;

  } catch (error) {
    console.error('Error creating combined tab stream:', error);
    throw error;
  }
}

  async setupAudioPassthrough(videoStream, options) {
    try {
      // Set up audio passthrough for device audio only (no microphone)
      const videoAudioTracks = videoStream.getAudioTracks();
      
      if (videoAudioTracks.length > 0 && options.includeDeviceAudio) {
        this.audioContext = new AudioContext({ sampleRate: 48000 });
        this.destination = this.audioContext.createMediaStreamDestination();
        
        const videoAudioSource = this.audioContext.createMediaStreamSource(
          new MediaStream(videoAudioTracks)
        );
        
        // Create gain nodes
        const recordingGain = this.audioContext.createGain();
        const passthroughGain = this.audioContext.createGain();
        
        recordingGain.gain.value = 1.0; // Full volume for recording
        passthroughGain.gain.value = 1.0; // Full volume for listening
        
        // Connect to both recording and speakers
        videoAudioSource.connect(recordingGain);
        videoAudioSource.connect(passthroughGain);
        
        recordingGain.connect(this.destination);
        passthroughGain.connect(this.audioContext.destination);
        
        // Create final stream
        const videoTracks = videoStream.getVideoTracks();
        const audioTracks = this.destination.stream.getAudioTracks();
        
        const finalStream = new MediaStream([
          ...videoTracks,
          ...audioTracks
        ]);
        
        console.log('Audio passthrough enabled for device audio');
        return finalStream;
      } else {
        console.log('No audio tracks found or device audio disabled');
      }
      
      return videoStream;
      
    } catch (error) {
      console.error('Error setting up audio passthrough:', error);
      return videoStream;
    }
  }

  async startScreenRecording(options) {
    try {
      console.log('Starting screen recording with options:', options);
      
      // Reset state
      this.recordedChunks = [];
      this.chunkBlobs = [];
      this.currentChunkSize = 0;
      this.totalPausedTime = 0;
      this.lastPauseTime = null;
      this.recordingStartTime = Date.now();
      
      // Use the proven method for screen capture
      const combinedStream = await this.createScreenCombinedStream(options);
      this.currentStream = combinedStream;
      
      await this.initializeMediaRecorder(this.currentStream, options);
      
      this.isRecording = true;
      this.isPaused = false;
      
      return { success: true, message: 'Screen recording started successfully' };
      
    } catch (error) {
      console.error('Error starting screen recording:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  async createScreenCombinedStream(options) {
    try {
      console.log('Creating combined screen stream');
      
      // Get display media
      this.originalDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...this.getVideoConstraints(options.videoQuality),
          cursor: 'always'
        },
        audio: options.includeDeviceAudio
      });

      console.log('Display stream acquired:', {
        video: this.originalDisplayStream.getVideoTracks().length,
        audio: this.originalDisplayStream.getAudioTracks().length
      });

      // If microphone is not needed, return the display stream directly
      if (!options.includeMicrophone) {
        return this.originalDisplayStream;
      }

      // Get microphone audio with proper error handling
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { 
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true 
          },
        });

        console.log('Microphone stream acquired for screen recording');

        // Combine the streams using AudioContext
        this.audioContext = new AudioContext();
        this.destination = this.audioContext.createMediaStreamDestination();
        
        // Connect microphone to mixed destination
        this.audioContext.createMediaStreamSource(this.micStream).connect(this.destination);
        
        // Connect display audio to mixed destination (if available)
        if (options.includeDeviceAudio && this.originalDisplayStream.getAudioTracks().length > 0) {
          this.audioContext.createMediaStreamSource(this.originalDisplayStream).connect(this.destination);
        }

        // Create combined stream with video from display and mixed audio
        const combinedStream = new MediaStream([
          this.originalDisplayStream.getVideoTracks()[0],
          this.destination.stream.getTracks()[0],
        ]);

        console.log('Combined screen stream created successfully');
        return combinedStream;

      } catch (micError) {
        console.error('Failed to get microphone access for screen recording:', micError);
        
        // Continue with just display stream instead of failing
        console.warn('Continuing screen recording without microphone due to access error');
        
        // Notify about microphone failure
        chrome.runtime.sendMessage({
          action: 'microphoneAccessFailed',
          error: micError.message
        }).catch(() => {});
        
        return this.originalDisplayStream;
      }

    } catch (error) {
      console.error('Error creating combined screen stream:', error);
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen sharing permission denied. Please allow screen capture and try again.');
      }
      throw error;
    }
  }

  async getTabStream(streamId, options) {
    console.log('Getting tab stream with ID:', streamId);
    
    const constraints = {
      audio: options.includeDeviceAudio ? {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          ...this.getVideoConstraints(options.videoQuality)
        }
      }
    };
    
    console.log('Tab stream constraints:', constraints);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Store original tab stream for proper cleanup
      this.originalTabStream = stream;
      
      console.log('Tab stream acquired successfully:', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      });
      return stream;
    } catch (error) {
      console.error('Error getting tab stream:', error);
      throw new Error(`Failed to capture tab: ${error.message}`);
    }
  }

  async getDisplayStream(options) {
    console.log('Getting display stream with options:', options);
    
    const constraints = {
      video: {
        ...this.getVideoConstraints(options.videoQuality),
        cursor: 'always'
      },
      audio: options.includeDeviceAudio
    };
    
    console.log('Display stream constraints:', constraints);
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      
      // Store original display stream for proper cleanup
      this.originalDisplayStream = stream;
      
      console.log('Display stream acquired successfully:', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      });
      return stream;
    } catch (error) {
      console.error('Error getting display stream:', error);
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen sharing permission denied. Please allow screen capture and try again.');
      }
      throw new Error(`Failed to capture screen: ${error.message}`);
    }
  }

  async mixStreamWithMicrophone(videoStream, options) {
    try {
      // Get microphone stream
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      });
      
      // Create audio context for mixing
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      const destination = this.audioContext.createMediaStreamDestination();
      
      // Mix existing audio (if any)
      const videoAudioTracks = videoStream.getAudioTracks();
      if (videoAudioTracks.length > 0) {
        const videoAudioSource = this.audioContext.createMediaStreamSource(
          new MediaStream(videoAudioTracks)
        );
        
        // Create gain node for system audio
        const systemGain = this.audioContext.createGain();
        systemGain.gain.value = 0.8; // Slightly reduce system audio
        
        videoAudioSource.connect(systemGain);
        systemGain.connect(destination);
      }
      
      // Add microphone audio
      const micAudioSource = this.audioContext.createMediaStreamSource(micStream);
      
      // Create gain node for microphone
      const micGain = this.audioContext.createGain();
      micGain.gain.value = 1.0; // Full microphone volume
      
      micAudioSource.connect(micGain);
      micGain.connect(destination);
      
      // Create final stream
      const videoTracks = videoStream.getVideoTracks();
      const mixedAudioTracks = destination.stream.getAudioTracks();
      
      const finalStream = new MediaStream([
        ...videoTracks,
        ...mixedAudioTracks
      ]);
      
      console.log('Audio streams mixed successfully');
      return finalStream;
      
    } catch (error) {
      console.error('Error mixing audio:', error);
      // Fallback to original stream
      return videoStream;
    }
  }

  async initializeMediaRecorder(stream, options) {
    const mimeType = this.getSupportedMimeType();
    
    const mediaRecorderOptions = {
      mimeType: mimeType,
      videoBitsPerSecond: this.getVideoBitrate(options.videoQuality),
      audioBitsPerSecond: 128000
    };
    
    this.mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions);
    
    // Setup event handlers
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.handleDataAvailable(event.data);
      }
    };
    
    this.mediaRecorder.onstop = () => {
      this.handleRecordingStop();
    };
    
    this.mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      this.releaseAllStreams(); // Release ALL streams immediately on error
      this.notifyError('Recording error: ' + event.error.message);
    };
    
    this.mediaRecorder.onpause = () => {
      console.log('MediaRecorder paused');
    };
    
    this.mediaRecorder.onresume = () => {
      console.log('MediaRecorder resumed');
    };
    
    // Start recording
    this.mediaRecorder.start(1000); // Collect data every second
    console.log('MediaRecorder started');
    
    // Handle stream end
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      console.log('Video stream ended by user');
      this.releaseAllStreams(); // Release ALL streams when user stops sharing
      this.stopRecording();
    });
  }

  handleDataAvailable(data) {
    this.recordedChunks.push(data);
    this.currentChunkSize += data.size;
    
    // Check memory usage and create chunk if needed
    if (this.currentChunkSize >= this.maxChunkSize) {
      this.createChunkBlob();
    }
    
    // Memory warning if getting large
    if (this.currentChunkSize > 100 * 1024 * 1024) { // 100MB warning
      this.notifyMemoryWarning();
    }
  }

  createChunkBlob() {
    if (this.recordedChunks.length > 0) {
      const chunkBlob = new Blob(this.recordedChunks, {
        type: "video/webm"
      });
      
      this.chunkBlobs.push(chunkBlob);
      this.recordedChunks = [];
      this.currentChunkSize = 0;
      
      console.log(`Created chunk blob: ${(chunkBlob.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  async stopRecording() {
    try {
      console.log('Stop recording requested. Current state:', {
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        mediaRecorderState: this.mediaRecorder?.state
      });
      
      if (!this.isRecording || !this.mediaRecorder) {
        return { success: false, error: 'No recording in progress' };
      }
      
      // Calculate final paused time if currently paused
      if (this.isPaused && this.lastPauseTime) {
        this.totalPausedTime += Date.now() - this.lastPauseTime;
      }
      
      // Stop the MediaRecorder
      this.mediaRecorder.stop();
      
      // Important: Release ALL streams immediately to restore normal playback
      this.releaseAllStreams();
      
      console.log('Recording stop initiated with full stream release');
      
      // The handleRecordingStop will be called automatically
      // Return success immediately, actual processing happens in background
      return { success: true, message: 'Recording stopped' };
      
    } catch (error) {
      console.error('Error stopping recording:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  // Helper function to aggressively stop all tracks in a stream
  stopAllTracks(stream, streamName = 'Unknown') {
    if (!stream) return;
    
    console.log(`Stopping all tracks in ${streamName} stream...`);
    const tracks = stream.getTracks();
    
    for (const track of tracks) {
      try {
        console.log(`Stopping ${track.kind} track: ${track.label} (state: ${track.readyState})`);
        track.stop();
        
        // Verify track stopped
        if (track.readyState !== 'ended') {
          console.warn(`Track ${track.kind} did not end immediately, state: ${track.readyState}`);
          
          // Force track to end state
          setTimeout(() => {
            if (track.readyState !== 'ended') {
              console.warn(`Track ${track.kind} still not ended after timeout`);
            }
          }, 100);
        }
      } catch (e) {
        console.warn(`Track stop error for ${track.kind}:`, e);
      }
    }
  }

  // Helper function to detach video/audio elements (if any exist)
  detachMediaElements() {
    // Check for any video/audio elements that might be holding stream references
    const videoElements = document.querySelectorAll('video');
    const audioElements = document.querySelectorAll('audio');
    
    [...videoElements, ...audioElements].forEach(element => {
      if (element.srcObject) {
        console.log('Detaching media element srcObject');
        element.srcObject = null;
        element.load();
      }
    });
  }

  async releaseAllStreams() {
    try {
      console.log('🔥 AGGRESSIVE RELEASE: Releasing ALL video and audio streams...');
      
      // 1. Stop MediaRecorder first
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        console.log('Stopping MediaRecorder...');
        try {
          this.mediaRecorder.stop();
        } catch (e) {
          console.log('MediaRecorder already stopped or error stopping:', e);
        }
        this.mediaRecorder = null;
      }
      
      // 2. Stop ALL tracks in ALL streams
      this.stopAllTracks(this.currentStream, 'current');
      this.stopAllTracks(this.originalTabStream, 'originalTab');
      this.stopAllTracks(this.originalDisplayStream, 'originalDisplay');
      this.stopAllTracks(this.micStream, 'microphone');
      
      // Also stop destination stream if it exists
      if (this.destination && this.destination.stream) {
        this.stopAllTracks(this.destination.stream, 'destination');
      }
      
      // 3. Detach any video/audio elements
      this.detachMediaElements();
      
      // 4. Forcefully close AudioContext (without suspend)
      if (this.audioContext) {
        const audioContextToClose = this.audioContext;
        console.log('Force closing AudioContext...', audioContextToClose.state);
        
        // Clear reference immediately
        this.audioContext = null;
        this.destination = null;
        
        if (audioContextToClose.state !== 'closed') {
          try {
            // Don't call suspend() - just close directly
            await audioContextToClose.close();
            console.log('✅ AudioContext forcefully closed');
          } catch (e) {
            console.warn('AudioContext close failed:', e);
            // Try again without await
            try {
              audioContextToClose.close();
            } catch (e2) {
              console.warn('Second AudioContext close attempt failed:', e2);
            }
          }
        }
      }
      
      // 5. NULL OUT ALL STREAM REFERENCES
      this.currentStream = null;
      this.originalTabStream = null;
      this.originalDisplayStream = null;
      this.micStream = null;
      this.destination = null;
      
      // 6. Force garbage collection (if available)
      if (window.gc) {
        setTimeout(() => {
          console.log('🗑️ Forcing garbage collection...');
          window.gc();
        }, 100);
      }
      
      // 7. Additional Chrome-specific cleanup
      // Clear any remaining MediaStream references that might be lingering
      setTimeout(() => {
        // Force one more GC after delay to ensure everything is cleaned up
        if (window.gc) {
          window.gc();
        }
      }, 500);
      
      console.log('🎉 ALL video and audio streams AGGRESSIVELY released!');
      console.log('📱 Chrome capture indicator should disappear');
      console.log('🔊 Device audio should resume normal playback');
      
      // 8. Send confirmation that ALL streams are released
      chrome.runtime.sendMessage({
        action: 'allStreamsReleased',
        message: 'ALL video and audio streams aggressively released - normal playback should fully resume'
      }).catch(() => {
        // Ignore errors if no listeners
      });
      
    } catch (error) {
      console.error('❌ Error in aggressive stream release:', error);
    }
  }

  handleRecordingStop() {
    try {
      console.log('Processing recorded data...');
      
      // Create final chunk from remaining data
      this.createChunkBlob();
      
      // Combine all chunks
      let finalBlob;
      if (this.chunkBlobs.length > 0) {
        finalBlob = new Blob(this.chunkBlobs, {
          type: this.getSupportedMimeType()
        });
      } else if (this.recordedChunks.length > 0) {
        finalBlob = new Blob(this.recordedChunks, {
          type: this.getSupportedMimeType()
        });
      } else {
        throw new Error('No recorded data available');
      }
      
      // Calculate actual recording duration (excluding paused time)
      const totalRecordingTime = Date.now() - this.recordingStartTime;
      const actualDuration = (totalRecordingTime - this.totalPausedTime) / 1000;
      
      // Create recording data
      const recordingData = {
        url: URL.createObjectURL(finalBlob),
        size: finalBlob.size,
        duration: actualDuration,
        filename: this.generateFilename(),
        mimeType: this.getSupportedMimeType()
      };
      
      console.log(`Recording complete: ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB, ${actualDuration.toFixed(1)}s`);
      
      // Notify background script about completion
      chrome.runtime.sendMessage({
        action: 'recordingComplete',
        recordingData: recordingData
      });
      
      console.log('Recording completion message sent to background');
      
      // Cleanup (but keep recording data available)
      this.cleanup();
      
    } catch (error) {
      console.error('Error processing recorded data:', error);
      this.notifyError('Failed to process recording: ' + error.message);
      this.cleanup();
    }
  }

  cleanup() {
    console.log('🧹 Starting comprehensive cleanup...');
    
    // Use aggressive stream release
    this.releaseAllStreams();
    
    // Reset recording state
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.totalPausedTime = 0;
    this.lastPauseTime = null;
    
    // Clear chunks (but keep blobs for potential use)
    this.recordedChunks = [];
    this.currentChunkSize = 0;
    
    console.log('✅ Comprehensive cleanup completed');
  }

  getVideoConstraints(quality) {
    const constraints = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 }
    };
    
    return constraints[quality] || constraints['1080p'];
  }

  getVideoBitrate(quality) {
    const bitrates = {
      '720p': 2500000,    // 2.5 Mbps
      '1080p': 5000000,   // 5 Mbps
      '4k': 15000000      // 15 Mbps
    };
    
    return bitrates[quality] || bitrates['1080p'];
  }

  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'video/webm';
  }

  generateFilename() {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    
    const extension = this.getSupportedMimeType().includes('mp4') ? 'mp4' : 'webm';
    return `meet-recording-${timestamp}.${extension}`;
  }

  notifyError(message) {
    chrome.runtime.sendMessage({
      action: 'recordingError',
      error: message
    }).catch(console.error);
  }

  notifyMemoryWarning() {
    chrome.runtime.sendMessage({
      action: 'memoryWarning',
      message: 'Recording size is getting large'
    }).catch(console.error);
  }
}

// Initialize recorder
const recorder = new MeetRecorderOffscreen();

// Update status display
document.addEventListener('DOMContentLoaded', () => {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = 'Meet recorder ready for comprehensive video and audio recording';
  }
});