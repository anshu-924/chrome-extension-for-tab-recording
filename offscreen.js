// Offscreen Document for Google Meet Recorder
// Handles MediaRecorder API with memory management and audio-only recording

class MeetRecorderOffscreen {
  constructor() {
    this.mediaRecorder = null;
    this.audioRecorder = null; // New: Audio-only recorder
    this.recordedChunks = [];
    this.audioChunks = []; // New: Audio-only chunks
    this.currentStream = null;
    this.audioOnlyStream = null; // New: Audio-only stream
    this.audioContext = null;
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.totalPausedTime = 0;
    this.lastPauseTime = null;
    
    // Memory management
    this.maxChunkSize = 50 * 1024 * 1024; // 50MB chunks
    this.currentChunkSize = 0;
    this.audioChunkSize = 0; // New: Audio chunk size tracking
    this.chunkBlobs = [];
    this.audioChunkBlobs = []; // New: Audio chunk blobs
    
    this.setupMessageListener();
    console.log('Meet Recorder Offscreen document initialized');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Offscreen received message:', message);
      const validactions = [
        'startTabRecording', 
        'pauseRecording', 
        'resumeRecording', 
        'stopRecording', 
        'recordingStateChanged'
      ];
      
      if( !message || !message.action || !validactions.includes(message.action)) {
        return;
      }
      
      switch (message.action) {
        case 'startTabRecording':
          this.startTabRecording(message.streamId, message.options)
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
      this.audioChunks = []; // New: Reset audio chunks
      this.chunkBlobs = [];
      this.audioChunkBlobs = []; // New: Reset audio chunk blobs
      this.currentChunkSize = 0;
      this.audioChunkSize = 0; // New: Reset audio chunk size
      this.totalPausedTime = 0;
      this.lastPauseTime = null;
      this.recordingStartTime = Date.now();
      
      // Create combined stream and separate audio-only stream
      const { combinedStream, audioOnlyStream } = await this.createTabCombinedStreamWithAudio(streamId, options);
      this.currentStream = combinedStream;
      this.audioOnlyStream = audioOnlyStream; // New: Store audio-only stream
      
      // Initialize both recorders
      await this.initializeMediaRecorders(this.currentStream, this.audioOnlyStream, options);
      
      this.isRecording = true;
      this.isPaused = false;
      
      return { success: true, message: 'Tab recording started successfully with audio-only stream' };
      
    } catch (error) {
      console.error('Error starting tab recording:', error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

async createTabCombinedStreamWithAudio(streamId, options) {
  try {
    console.log('Creating combined tab stream with separate audio stream');
    
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

    // If microphone is not needed, return the streams
    if (!options.includeMicrophone) {
      const videoTracks = this.originalTabStream.getVideoTracks();
      const audioTracks = options.includeDeviceAudio && this.destination.stream.getAudioTracks().length > 0 
        ? this.destination.stream.getAudioTracks() 
        : [];
      
      const combinedStream = new MediaStream([...videoTracks, ...audioTracks]);
      const audioOnlyStream = new MediaStream(audioTracks); // New: Audio-only stream
      
      return { combinedStream, audioOnlyStream };
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

    // Create audio-only stream with just the mixed audio
    const audioOnlyStream = new MediaStream([
      this.destination.stream.getTracks()[0],
    ]);

    console.log('Combined stream and audio-only stream created successfully with audio passthrough');
    return { combinedStream, audioOnlyStream };

  } catch (error) {
    console.error('Error creating combined tab stream:', error);
    throw error;
  }
}

  async initializeMediaRecorders(videoStream, audioStream, options) {
    const mimeType = this.getSupportedMimeType();
    const audioMimeType = this.getSupportedAudioMimeType(); // New: Audio-only mime type
    
    const mediaRecorderOptions = {
      mimeType: mimeType,
      videoBitsPerSecond: this.getVideoBitrate(options.videoQuality),
      audioBitsPerSecond: 128000
    };

    const audioRecorderOptions = {
      mimeType: audioMimeType,
      audioBitsPerSecond: 128000
    };
    
    // Initialize video+audio recorder
    this.mediaRecorder = new MediaRecorder(videoStream, mediaRecorderOptions);
    
    // Initialize audio-only recorder
    this.audioRecorder = new MediaRecorder(audioStream, audioRecorderOptions);
    
    // Setup event handlers for video+audio recorder
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.handleVideoDataAvailable(event.data);
      }
    };
    
    this.mediaRecorder.onstop = () => {
      this.handleRecordingStop();
    };
    
    this.mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      this.releaseAllStreams();
      this.notifyError('Recording error: ' + event.error.message);
    };

    // Setup event handlers for audio-only recorder
    this.audioRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.handleAudioDataAvailable(event.data);
      }
    };
    
    this.audioRecorder.onstop = () => {
      console.log('Audio-only recorder stopped');
    };
    
    this.audioRecorder.onerror = (event) => {
      console.error('Audio MediaRecorder error:', event.error);
    };
    
    // Start both recordings
    this.mediaRecorder.start(1000); // Collect data every second
    this.audioRecorder.start(1000); // Collect audio data every second
    console.log('Both MediaRecorders started (video+audio and audio-only)');
    
    // Handle stream end
    videoStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      console.log('Video stream ended by user');
      this.releaseAllStreams();
      this.stopRecording();
    });
  }

  handleVideoDataAvailable(data) {
    this.recordedChunks.push(data);
    this.currentChunkSize += data.size;
    
    // Check memory usage and create chunk if needed
    if (this.currentChunkSize >= this.maxChunkSize) {
      this.createVideoChunkBlob();
    }
    
    // Memory warning if getting large
    if (this.currentChunkSize > 100 * 1024 * 1024) { // 100MB warning
      this.notifyMemoryWarning();
    }
  }

  handleAudioDataAvailable(data) {
    this.audioChunks.push(data);
    this.audioChunkSize += data.size;
    
    // Check memory usage and create audio chunk if needed
    if (this.audioChunkSize >= this.maxChunkSize) {
      this.createAudioChunkBlob();
    }
  }

  createVideoChunkBlob() {
    if (this.recordedChunks.length > 0) {
      const chunkBlob = new Blob(this.recordedChunks, {
        type: "video/webm"
      });
      
      this.chunkBlobs.push(chunkBlob);
      this.recordedChunks = [];
      this.currentChunkSize = 0;
      
      console.log(`Created video chunk blob: ${(chunkBlob.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  createAudioChunkBlob() {
    if (this.audioChunks.length > 0) {
      const audioChunkBlob = new Blob(this.audioChunks, {
        type: this.getSupportedAudioMimeType()
      });
      
      this.audioChunkBlobs.push(audioChunkBlob);
      this.audioChunks = [];
      this.audioChunkSize = 0;
      
      console.log(`Created audio chunk blob: ${(audioChunkBlob.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  async stopRecording() {
    try {
      console.log('Stop recording requested. Current state:', {
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        mediaRecorderState: this.mediaRecorder?.state,
        audioRecorderState: this.audioRecorder?.state
      });
      
      if (!this.isRecording || !this.mediaRecorder || !this.audioRecorder) {
        return { success: false, error: 'No recording in progress' };
      }
      
      // Calculate final paused time if currently paused
      if (this.isPaused && this.lastPauseTime) {
        this.totalPausedTime += Date.now() - this.lastPauseTime;
      }
      
      // Stop both MediaRecorders
      this.mediaRecorder.stop();
      this.audioRecorder.stop();
      
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
      
      // 1. Stop MediaRecorders first
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        console.log('Stopping video MediaRecorder...');
        try {
          this.mediaRecorder.stop();
        } catch (e) {
          console.log('Video MediaRecorder already stopped or error stopping:', e);
        }
        this.mediaRecorder = null;
      }

      if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
        console.log('Stopping audio MediaRecorder...');
        try {
          this.audioRecorder.stop();
        } catch (e) {
          console.log('Audio MediaRecorder already stopped or error stopping:', e);
        }
        this.audioRecorder = null;
      }
      
      // 2. Stop ALL tracks in ALL streams
      this.stopAllTracks(this.currentStream, 'current');
      this.stopAllTracks(this.audioOnlyStream, 'audioOnly');
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
      this.audioOnlyStream = null;
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
      
      // Create final chunks from remaining data
      this.createVideoChunkBlob();
      this.createAudioChunkBlob();
      
      // Combine all video chunks
      let finalVideoBlob;
      if (this.chunkBlobs.length > 0) {
        finalVideoBlob = new Blob(this.chunkBlobs, {
          type: this.getSupportedMimeType()
        });
      } else if (this.recordedChunks.length > 0) {
        finalVideoBlob = new Blob(this.recordedChunks, {
          type: this.getSupportedMimeType()
        });
      } else {
        throw new Error('No video recorded data available');
      }

      // Combine all audio chunks
      let finalAudioBlob;
      if (this.audioChunkBlobs.length > 0) {
        finalAudioBlob = new Blob(this.audioChunkBlobs, {
          type: this.getSupportedAudioMimeType()
        });
      } else if (this.audioChunks.length > 0) {
        finalAudioBlob = new Blob(this.audioChunks, {
          type: this.getSupportedAudioMimeType()
        });
      } else {
        console.warn('No audio recorded data available');
        finalAudioBlob = null;
      }
      
      // Calculate actual recording duration (excluding paused time)
      const totalRecordingTime = Date.now() - this.recordingStartTime;
      const actualDuration = (totalRecordingTime - this.totalPausedTime) / 1000;
      
      // Create recording data with both video and audio
      const recordingData = {
        url: URL.createObjectURL(finalVideoBlob),
        size: finalVideoBlob.size,
        duration: actualDuration,
        filename: this.generateFilename(),
        mimeType: this.getSupportedMimeType(),
        // New: Audio-only data
        audioUrl: finalAudioBlob ? URL.createObjectURL(finalAudioBlob) : null,
        audioSize: finalAudioBlob ? finalAudioBlob.size : 0,
        audioFilename: this.generateAudioFilename(),
        audioMimeType: this.getSupportedAudioMimeType()
      };
      
      console.log(`Recording complete: Video ${(finalVideoBlob.size / 1024 / 1024).toFixed(2)} MB, Audio ${finalAudioBlob ? (finalAudioBlob.size / 1024 / 1024).toFixed(2) : 0} MB, ${actualDuration.toFixed(1)}s`);
      
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
    this.audioChunks = [];
    this.currentChunkSize = 0;
    this.audioChunkSize = 0;
    
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

  getSupportedAudioMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm';
  }

  generateFilename() {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    
    const extension = this.getSupportedMimeType().includes('mp4') ? 'mp4' : 'webm';
    return `meet-recording-${timestamp}.${extension}`;
  }

  generateAudioFilename() {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    
    const extension = this.getSupportedAudioMimeType().includes('mp4') ? 'm4a' : 
                     this.getSupportedAudioMimeType().includes('ogg') ? 'ogg' :
                     this.getSupportedAudioMimeType().includes('wav') ? 'wav' : 'webm';
    return `meet-audio-${timestamp}.${extension}`;
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
    statusElement.textContent = 'Meet recorder ready for comprehensive video and audio recording with audio-only option';
  }
});