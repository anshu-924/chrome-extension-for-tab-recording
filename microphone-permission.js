// Microphone permission script - immediately requests microphone access
let stream = null;

async function requestMicrophonePermission() {
  try {
    console.log('Requesting microphone permission...');
    
    // Request microphone access - works because iframe has allow="microphone"
    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    console.log('Microphone access granted');
    
    // Stop the stream immediately - we just needed permission
    stream.getTracks().forEach(track => {
      track.stop();
      console.log('Test microphone track stopped');
    });
    stream = null;
    
    // Notify parent window about success
    window.parent.postMessage({
      action: 'microphonePermissionResult',
      success: true
    }, '*');
    
  } catch (error) {
    console.error('Microphone access denied:', error);
    
    let errorMessage = 'Microphone access denied.';
    if (error.name === 'NotAllowedError') {
      errorMessage = 'Please click "Allow" when prompted for microphone access.';
    } else if (error.name === 'NotFoundError') {
      errorMessage = 'No microphone found. Please connect a microphone.';
    } else if (error.name === 'AbortError') {
      errorMessage = 'Request was cancelled. Please try again.';
    } else {
      errorMessage = `Microphone error: ${error.message}`;
    }
    
    // Notify parent window about failure
    window.parent.postMessage({
      action: 'microphonePermissionResult',
      success: false,
      error: errorMessage
    }, '*');
  }
}

// Handle cleanup
window.addEventListener('beforeunload', () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
});

// Immediately request permission when script loads
requestMicrophonePermission();