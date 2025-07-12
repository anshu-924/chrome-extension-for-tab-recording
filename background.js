// Background Service Worker for Google Meet Recorder with Authentication and Audio Support

let recordingState = {
  isRecording: false,
  isPaused: false,
  recordingType: null,
  currentTabId: null,
  recordingStartTime: null,
  recordingData: null,
};

let refreshTimeout = null;
let refreshRetryCount = 0;
const MAX_REFRESH_RETRIES = 3;

// Create offscreen document for MediaRecorder API
async function createOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification:
      "Recording screen content using MediaRecorder API with audio-only option",
  });
}

// API Handler Functions (moved from frontend to avoid CSP issues)
async function handleGetPhoneCodes(sendResponse) {
  try {
    console.log("Background: Fetching phone codes from API...");

    const response = await fetch("https://arc.vocallabs.ai/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query GetExchangeRate {
            vocallabs_exchange_rate {
              phone_code
              country_code
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || "GraphQL error");
    }

    const phoneCodes = data.data.vocallabs_exchange_rate || [];
    console.log(`Background: Loaded ${phoneCodes.length} phone codes`);

    sendResponse({
      success: true,
      phoneCodes: phoneCodes,
    });
  } catch (error) {
    console.error("Background: Error loading phone codes:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

async function handleLogoutAPI(refreshToken, sendResponse) {
  try {
    console.log("Background: Calling logout API");

    // Get auth token and user_id from storage for the API call
    const result = await chrome.storage.local.get(['auth_token', 'user_id']);
    
    if (!result.auth_token || !result.user_id) {
      console.warn("Background: Missing auth_token or user_id for logout API");
      // Don't fail the logout process, just continue with local logout
      sendResponse({
        success: true,
        warning: "Missing authentication data for logout API, proceeding with local logout"
      });
      return;
    }

    const response = await fetch("https://db.subspace.money/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${result.auth_token}`
      },
      body: JSON.stringify({
        query: `
          mutation Logout($request: logoutInput!) {
            logout(request: $request) {
              message
            }
          }
        `,
        variables: {
          request: {
            refresh_token: refreshToken,
            user_id: result.user_id
          }
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || "Logout API failed");
    }

    const logoutResult = data.data.logout;
    console.log("Background: Logout API result:", logoutResult);

    sendResponse({
      success: true,
      result: logoutResult,
    });
  } catch (error) {
    console.error("Background: Error calling logout API:", error);
    // Don't fail the logout process if API call fails
    sendResponse({
      success: true,
      warning: error.message,
    });
  }
}

async function handleRefreshTokenFromFrontend(
  refreshToken,
  userId,
  sendResponse
) {
  try {
    console.log("Background: Refreshing token for frontend request");

    const tokens = await refreshAuthToken(refreshToken, userId);
    updateTokens(tokens.auth_token, tokens.refresh_token);

    sendResponse({
      success: true,
      authToken: tokens.auth_token,
      refreshToken: tokens.refresh_token,
    });
  } catch (error) {
    console.error("Background: Error refreshing token for frontend:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

async function handleSendOTP(phone, sendResponse) {
  try {
    console.log("Background: Sending OTP to:", phone);

    const response = await fetch("https://db.subspace.money/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation Register($phone: String!) {
            registerWithoutPasswordV2(credentials: {phone: $phone}) {
              request_id
              status
            }
          }
        `,
        variables: { phone: phone },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || "Failed to send OTP");
    }

    const result = data.data.registerWithoutPasswordV2;
    console.log("Background: OTP sent, result:", result);

    sendResponse({
      success: true,
      result: result,
    });
  } catch (error) {
    console.error("Background: Error sending OTP:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

async function handleVerifyOTP(phone, otp, sendResponse) {
  try {
    console.log("Background: Verifying OTP for:", phone);

    const response = await fetch("https://db.subspace.money/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation VerifyOTP($phone1: String!, $otp1: String!) {
            verifyOTPV2(request: {otp: $otp1, phone: $phone1}) {
              auth_token
              refresh_token
              id
              status
              deviceInfoSaved
            }
          }
        `,
        variables: { phone1: phone, otp1: otp },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0]?.message || "Failed to verify OTP");
    }

    const result = data.data.verifyOTPV2;
    console.log("Background: OTP verification result:", result);

    // Check if verification was successful
    if (result.auth_token && result.refresh_token && result.id) {
      // Store tokens
      await chrome.storage.local.set({
        auth_token: result.auth_token,
        refresh_token: result.refresh_token,
        user_id: result.id,
      });

      console.log("Background: OTP verification successful, tokens stored");

      // Schedule token refresh
      scheduleTokenRefresh();

      // Dispatch login success event
      handleAuthEvent("loginSuccess", {
        userId: result.id,
        authToken: result.auth_token,
      });

      sendResponse({
        success: true,
        result: {
          ...result,
          status: "success", // Ensure status is set for frontend
        },
      });
    } else {
      throw new Error("Invalid OTP or verification failed");
    }
  } catch (error) {
    console.error("Background: Error verifying OTP:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Google Meet Recorder Extension installed");

  // Initialize storage with default settings
  chrome.storage.local.set({
    videoQuality: "1080p",
    includeDeviceAudio: true,
    includeMicrophone: false,
    recordingFormat: "webm",
  });

  // Schedule token refresh check
  scheduleTokenRefresh();
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Google Meet Recorder Extension started");

  // Schedule token refresh check
  scheduleTokenRefresh();
});

// Authentication Functions
function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error("Failed to parse JWT:", error);
    return null;
  }
}

async function refreshAuthToken(refreshToken, userId) {
  try {
    const response = await fetch("https://db.subspace.money/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation MyMutation($refresh_token: String = "", $user_id: uuid = "") {
            refreshToken(request: {refresh_token: $refresh_token, user_id: $user_id}) {
              auth_token
              refresh_token
              status
              id
            }
          }
        `,
        variables: { refresh_token: refreshToken, user_id: userId },
      }),
    });

    const data = await response.json();
    const result = data.data.refreshToken;

    if (result.status === "success") {
      return {
        auth_token: result.auth_token,
        refresh_token: result.refresh_token,
      };
    }
    throw new Error("Token refresh failed");
  } catch (error) {
    console.error("Failed to refresh token:", error);
    throw error;
  }
}

function clearTokensAndRedirect() {
  chrome.storage.local.remove(["auth_token", "refresh_token", "user_id"]);

  // Notify any open popup about token clearance
  chrome.runtime
    .sendMessage({
      action: "authEvent",
      eventType: "tokensCleared",
    })
    .catch(() => {
      // Popup might not be open, ignore error
    });
}

function scheduleTokenRefresh() {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }

  chrome.storage.local
    .get(["auth_token", "refresh_token", "user_id"])
    .then((result) => {
      const { auth_token, refresh_token, user_id } = result;

      // Validate tokens before scheduling refresh
      if (!auth_token || !refresh_token || !user_id) {
        console.log("No tokens found for refresh scheduling");
        return;
      }

      const tokenData = parseJwt(auth_token);
      if (!tokenData || !tokenData.exp) {
        console.log("Invalid token format, clearing tokens");
        clearTokensAndRedirect();
        return;
      }
      console.log("time to expire:", tokenData.exp);

      const expiryTime = tokenData.exp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const timeUntilExpiry = expiryTime - currentTime;
      const refreshTime = timeUntilExpiry - 2 * 60 * 1000; // 2 minutes before expiry

      console.log(
        `Token expires in ${Math.round(
          timeUntilExpiry / 1000 / 60
        )} minutes, refresh scheduled in ${Math.round(
          refreshTime / 1000 / 60
        )} minutes`
      );

      if (refreshTime <= 0) {
        // Token is already expired or will expire very soon
        if (refreshRetryCount >= MAX_REFRESH_RETRIES) {
          console.log("Max refresh retries reached, clearing tokens");
          clearTokensAndRedirect();
          return;
        }

        console.log(
          "Token expired or expiring soon, refreshing immediately..."
        );
        refreshAuthToken(refresh_token, user_id)
          .then(({ auth_token, refresh_token }) => {
            updateTokens(auth_token, refresh_token);
            refreshRetryCount = 0;
            scheduleTokenRefresh(); // Schedule next refresh
          })
          .catch(() => {
            refreshRetryCount++;
            console.log(
              `Token refresh failed, retry count: ${refreshRetryCount}`
            );
            clearTokensAndRedirect();
          });
        return;
      }

      refreshTimeout = setTimeout(() => {
        if (refreshRetryCount >= MAX_REFRESH_RETRIES) {
          console.log("Max refresh retries reached, clearing tokens");
          clearTokensAndRedirect();
          return;
        }

        console.log("Refreshing auth token...");
        refreshAuthToken(refresh_token, user_id)
          .then(({ auth_token, refresh_token }) => {
            updateTokens(auth_token, refresh_token);
            refreshRetryCount = 0;
            scheduleTokenRefresh(); // Schedule next refresh
          })
          .catch(() => {
            refreshRetryCount++;
            console.log(
              `Token refresh failed, retry count: ${refreshRetryCount}`
            );
            clearTokensAndRedirect();
          });
      }, refreshTime);
    })
    .catch((error) => {
      console.error("Error scheduling token refresh:", error);
    });
}

function updateTokens(authToken, refreshToken) {
  chrome.storage.local
    .set({
      auth_token: authToken,
      refresh_token: refreshToken,
    })
    .then(() => {
      console.log("Tokens updated successfully in background");

      // Notify popup about token update
      chrome.runtime
        .sendMessage({
          action: "authEvent",
          eventType: "tokensUpdated",
          data: { authToken, refreshToken },
        })
        .catch(() => {
          // Popup might not be open, ignore error
        });
    })
    .catch((error) => {
      console.error("Error updating tokens:", error);
    });
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  switch (message.action) {
    case "getRecordingState":
      sendResponse(recordingState);
      break;

    // API Calls (moved from frontend to avoid CSP issues)
    case "getPhoneCodes":
      handleGetPhoneCodes(sendResponse);
      return true;

    case "sendOTP":
      handleSendOTP(message.phone, sendResponse);
      return true;

    case "verifyOTP":
      handleVerifyOTP(message.phone, message.otp, sendResponse);
      return true;

    case "refreshToken":
      handleRefreshTokenFromFrontend(
        message.refreshToken,
        message.userId,
        sendResponse
      );
      return true;

    case "logoutAPI":
      handleLogoutAPI(message.refreshToken, sendResponse);
      return true;

    case "startRecording":
      handleStartRecording(message.options, sendResponse);
      return true;

    case "stopRecording":
      handleStopRecording(sendResponse);
      return true;

    case "createOffscreen":
      try {
        createOffscreenDocument()
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;

    case "testMicrophonePermission":
      handleTestMicrophonePermission(sendResponse);
      return true;

    case "checkMicrophoneStatus":
      handleCheckMicrophoneStatus(sendResponse);
      return true;

    case "microphonePermissionResult":
      handleMicrophonePermissionResult(message, sendResponse);
      break;

    case "recordingComplete":
      handleRecordingComplete(message, sender);
      break;

    case "recordingError":
      handleRecordingError(message, sender);
      break;

    case "microphoneAccessFailed":
      handleMicrophoneAccessFailed(message, sender);
      break;

    case "memoryWarning":
      console.warn("Memory warning during recording:", message.message);
      notifyPopupStateChange();
      break;

    case "audioReleased":
      console.log("Audio streams released:", message.message);
      break;

    case "allStreamsReleased":
      console.log("ALL video and audio streams released:", message.message);
      break;

    case "meetSessionDetected":
      handleMeetDetection(message, sender);
      break;

    case "tabClosing":
      handleTabClosing(message.tabId);
      break;

    case "openPopup":
      try {
        chrome.action.openPopup();
      } catch (error) {
        console.log("Could not open popup programmatically:", error);
      }
      break;

    // Authentication related messages
    case "authEvent":
      handleAuthEvent(message.eventType, message.data);
      break;

    case "checkAuthentication":
      handleCheckAuthentication(sendResponse);
      return true;

    case "refreshToken":
      handleRefreshTokenRequest(sendResponse);
      return true;

    case "clearTokens":
      clearTokensAndRedirect();
      sendResponse({ success: true });
      break;

    case "validateUploadAuth":
      handleValidateUploadAuth(sendResponse);
      return true;

    case "getUploadAuthContext":
      handleGetUploadAuthContext(sendResponse);
      return true;

    case "recordingUploaded":
      handleRecordingUploaded(message, sendResponse);
      break;
    case "getUserRecordings":
      handleGetUserRecordings(sendResponse);
      return true;

    case "downloadRecordingFromS3":
      handleDownloadRecording(message.recordingKey, sendResponse);
      return true;

    default:
      console.warn("Unknown message action:", message.action);
  }
});

// Authentication message handlers
function handleAuthEvent(eventType, data) {
  console.log("Background received auth event:", eventType, data);

  switch (eventType) {
    case "tokensUpdated":
      // Reschedule token refresh with new tokens
      scheduleTokenRefresh();
      break;

    case "tokensCleared":
      // Clear any scheduled refresh
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
      }
      refreshRetryCount = 0;
      break;

    case "loginSuccess":
      // Start token refresh scheduling
      scheduleTokenRefresh();
      break;

    case "logoutComplete":
      // Clear any scheduled refresh and reset retry count
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
      }
      refreshRetryCount = 0;
      console.log("Logout completed, token refresh cleared");
      break;
  }
}

async function handleValidateUploadAuth(sendResponse) {
  try {
    console.log('Background: Validating upload authentication');
    
    const result = await chrome.storage.local.get(['auth_token', 'refresh_token', 'user_id']);
    
    if (!result.auth_token || !result.refresh_token || !result.user_id) {
      sendResponse({ 
        isValid: false, 
        error: 'No authentication tokens found' 
      });
      return;
    }

    // Parse and validate token
    const tokenData = parseJwt(result.auth_token);
    if (!tokenData || !tokenData.exp) {
      sendResponse({ 
        isValid: false, 
        error: 'Invalid token format' 
      });
      return;
    }

    const currentTime = Date.now() / 1000;
    const timeUntilExpiry = tokenData.exp - currentTime;

    // If token expires soon, try to refresh
    if (timeUntilExpiry < 300) { // 5 minutes
      console.log('Background: Token expiring soon, attempting refresh for upload');
      
      try {
        const tokens = await refreshAuthToken(result.refresh_token, result.user_id);
        updateTokens(tokens.auth_token, tokens.refresh_token);
        
        sendResponse({
          isValid: true,
          refreshed: true,
          message: 'Token refreshed for upload'
        });
      } catch (error) {
        console.error('Background: Token refresh failed for upload:', error);
        sendResponse({
          isValid: false,
          error: 'Token refresh failed'
        });
      }
    } else {
      sendResponse({
        isValid: true,
        expiresIn: timeUntilExpiry,
        message: 'Authentication valid for upload'
      });
    }

  } catch (error) {
    console.error('Background: Error validating upload auth:', error);
    sendResponse({
      isValid: false,
      error: error.message
    });
  }
}

async function handleGetUploadAuthContext(sendResponse) {
  try {
    console.log('Background: Getting upload auth context');
    
    const result = await chrome.storage.local.get(['auth_token', 'user_id']);
    
    if (!result.auth_token || !result.user_id) {
      sendResponse({
        success: false,
        error: 'No authentication context available'
      });
      return;
    }

    // Parse token for user info
    const tokenData = parseJwt(result.auth_token);
    if (!tokenData) {
      sendResponse({
        success: false,
        error: 'Invalid token format'
      });
      return;
    }

    const authContext = {
      userId: result.user_id,
      authToken: result.auth_token,
      phone: tokenData.phone || 'unknown',
      email: tokenData.email || null,
      userInfo: {
        id: tokenData.id,
        phone: tokenData.phone,
        email: tokenData.email,
        fullname: tokenData.fullname || 'User',
        phone_verified: tokenData.phone_verified,
        email_verified: tokenData.email_verified
      }
    };

    console.log('Background: Auth context prepared for upload:', {
      userId: authContext.userId,
      phone: authContext.phone
    });

    sendResponse({
      success: true,
      authContext: authContext
    });

  } catch (error) {
    console.error('Background: Error getting upload auth context:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}
// Handler for getting user recordings
async function handleGetUserRecordings(sendResponse) {
  try {
    console.log("Background: Fetching user recordings from API...");

    // Get auth token from storage
    const result = await chrome.storage.local.get(['auth_token']);
    if (!result.auth_token) {
      throw new Error('No authentication token found');
    }

    const response = await fetch("https://n8n.subspace.money/webhook/get-user-recordings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authToken: result.auth_token
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch recordings");
    }

    console.log(`Background: Loaded ${data.recordings?.length || 0} recordings`);

    sendResponse({
      success: true,
      recordings: data.recordings || [],
      recordingsCount: data.recordingsCount || 0,
      userId: data.userId
    });
  } catch (error) {
    console.error("Background: Error loading recordings:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

// Handler for downloading recordings
async function handleDownloadRecording(recordingKey, sendResponse) {
  try {
    console.log("Background: Getting download URL for recording:", recordingKey);

    // Get auth token from storage
    const result = await chrome.storage.local.get(['auth_token']);
    if (!result.auth_token) {
      throw new Error('No authentication token found');
    }

    const response = await fetch("https://n8n.subspace.money/webhook/download-recording", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authToken: result.auth_token,
        recordingKey: recordingKey
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to get download URL");
    }

    console.log("Background: Download URL generated successfully");

    sendResponse({
      success: true,
      downloadUrl: data.data.downloadUrl,
      filename: data.data.filename,
      expiresIn: data.data.expiresIn,
      expiresAt: data.data.expiresAt
    });
  } catch (error) {
    console.error("Background: Error getting download URL:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}

function handleRecordingUploaded(message, sendResponse) {
  try {
    console.log('Background: Recording uploaded successfully:', message);
    
    // Store upload info for potential future use
    const uploadInfo = {
      recordingId: message.recordingId,
      s3Key: message.s3Key,
      uploadedAt: new Date().toISOString(),
      fileSize: message.fileSize,
      duration: message.duration
    };

    // Could store in local storage for history
    chrome.storage.local.get(['uploadHistory'], (result) => {
      const history = result.uploadHistory || [];
      history.push(uploadInfo);
      
      // Keep only last 50 uploads
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }
      
      chrome.storage.local.set({ uploadHistory: history });
    });

    // Show success notification
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Recording Uploaded',
      message: `Audio recording uploaded to cloud successfully!`
    }).catch(() => {
      // Notifications might not be available
    });

    // Update badge to show success (temporarily)
    updateBadge('✓');
    setTimeout(() => {
      updateBadge('');
    }, 3000);

    console.log('Background: Upload notification handled');
    
    if (sendResponse) {
      sendResponse({ received: true });
    }

  } catch (error) {
    console.error('Background: Error handling upload notification:', error);
  }
}

async function handleCheckAuthentication(sendResponse) {
  try {
    const result = await chrome.storage.local.get([
      "auth_token",
      "refresh_token",
      "user_id",
    ]);

    if (!result.auth_token || !result.refresh_token) {
      sendResponse({ isAuthenticated: false, reason: "No tokens found" });
      return;
    }

    const tokenData = parseJwt(result.auth_token);
    if (!tokenData || !tokenData.exp) {
      sendResponse({ isAuthenticated: false, reason: "Invalid token format" });
      return;
    }

    const currentTime = Date.now() / 1000;
    const isExpired = tokenData.exp < currentTime;

    if (isExpired) {
      sendResponse({ isAuthenticated: false, reason: "Token expired" });
      return;
    }

    sendResponse({
      isAuthenticated: true,
      tokenData: tokenData,
      expiresIn: tokenData.exp - currentTime,
    });
  } catch (error) {
    console.error("Error checking authentication:", error);
    sendResponse({ isAuthenticated: false, reason: error.message });
  }
}

async function handleRefreshTokenRequest(sendResponse) {
  try {
    const result = await chrome.storage.local.get(["refresh_token", "user_id"]);

    if (!result.refresh_token || !result.user_id) {
      sendResponse({ success: false, error: "No refresh token found" });
      return;
    }

    const tokens = await refreshAuthToken(result.refresh_token, result.user_id);
    updateTokens(tokens.auth_token, tokens.refresh_token);

    sendResponse({
      success: true,
      authToken: tokens.auth_token,
      refreshToken: tokens.refresh_token,
    });
  } catch (error) {
    console.error("Error refreshing token:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Start recording based on options
async function handleStartRecording(options, sendResponse) {
  try {
    if (recordingState.isRecording) {
      sendResponse({ success: false, error: "Recording already in progress" });
      return;
    }

    // Check authentication before starting recording
    const authCheck = await new Promise((resolve) => {
      handleCheckAuthentication(resolve);
    });

    if (!authCheck.isAuthenticated) {
      sendResponse({
        success: false,
        error: "Authentication required. Please login first.",
      });
      return;
    }

    // Validate recording options
    if (!options.tabId) {
      sendResponse({
        success: false,
        error: "No tab specified for recording. Please try again.",
      });
      return;
    }

    await createOffscreenDocument();

    // Update recording state first
    recordingState = {
      isRecording: false, // Will be set to true after successful start
      isPaused: false,
      recordingType: options.recordingType,
      currentTabId: options.tabId,
      recordingStartTime: null, // Will be set after start
      recordingData: null,
    };

    // Store recording options
    await chrome.storage.session.set({ currentRecordingOptions: options });

    // Start tab recording with enhanced error handling
    console.log("Attempting to start tab recording with options:", options);
    const result = await startTabRecording(options);

    if (result.success) {
      recordingState.isRecording = true;
      recordingState.recordingStartTime = Date.now();
      updateBadge("REC");
      notifyPopupStateChange();
      
      console.log("Recording started successfully");
      sendResponse({
        success: true,
        message: "Recording started successfully",
      });
    } else {
      console.error("Failed to start recording:", result.error);
      resetRecordingState();
      sendResponse({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error("Error in handleStartRecording:", error);
    resetRecordingState();
    sendResponse({ 
      success: false, 
      error: `Recording failed: ${error.message}` 
    });
  }
}

// Start tab recording
// Enhanced tab recording with better error handling and validation
async function startTabRecording(options) {
  try {
    console.log("Starting tab recording for tab:", options.tabId);

    // Step 1: Validate the tab exists and is accessible
    let targetTab;
    try {
      targetTab = await chrome.tabs.get(options.tabId);
      console.log("Target tab details:", {
        id: targetTab.id,
        url: targetTab.url,
        title: targetTab.title,
        active: targetTab.active
      });
    } catch (tabError) {
      console.error("Failed to get tab details:", tabError);
      return {
        success: false,
        error: "Cannot access the target tab. Please ensure the tab is still open and try again."
      };
    }

    // Step 2: Validate tab is not a Chrome internal page
    if (targetTab.url.startsWith('chrome://') || 
        targetTab.url.startsWith('chrome-extension://') ||
        targetTab.url.startsWith('edge://') ||
        targetTab.url.startsWith('about:')) {
      return {
        success: false,
        error: "Cannot record Chrome internal pages. Please navigate to a regular webpage and try again."
      };
    }

    // Step 3: Ensure tab is active (required for tabCapture)
    if (!targetTab.active) {
      console.log("Target tab is not active, switching to it...");
      try {
        await chrome.tabs.update(options.tabId, { active: true });
        // Wait a moment for tab to become active
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (switchError) {
        console.error("Failed to switch to target tab:", switchError);
        return {
          success: false,
          error: "Cannot switch to the target tab. Please click on the tab you want to record and try again."
        };
      }
    }

    // Step 4: Get the media stream ID with enhanced error handling
    let streamId;
    try {
      console.log("from background.js Requesting media stream ID for tab :", options.tabId);
      
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: options.tabId,
      });
      
      console.log("in background.js Got Tab stream ID:", streamId);
      
      if (!streamId) {
        throw new Error("Failed to get stream ID - the extension may not have been invoked on this tab");
      }
      
    } catch (streamError) {
      console.error("Tab capture stream ID error:", streamError);
      
      // Provide specific error messages based on the error
      let errorMessage = "Failed to start recording. ";
      
      if (streamError.message.includes("not been invoked")) {
        errorMessage += "Please open this extension popup on the tab you want to record, then try again.";
      } else if (streamError.message.includes("Chrome pages")) {
        errorMessage += "Cannot record Chrome internal pages.";
      } else if (streamError.message.includes("permission")) {
        errorMessage += "Recording permission was denied.";
      } else {
        errorMessage += streamError.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }

    // Step 5: Send to offscreen document and wait for response
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "startTabRecording",
          target: "offscreen",
          streamId: streamId, 
          options: options,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending to offscreen:", chrome.runtime.lastError);
            resolve({
              success: false,
              error: `Offscreen communication error: ${chrome.runtime.lastError.message}`,
            });
          } else {
            console.log("Offscreen response:", response);
            resolve(
              response || {
                success: false,
                error: "No response from offscreen document",
              }
            );
          }
        }
      );
    });
    
  } catch (error) {
    console.error("Tab recording error:", error);
    return { 
      success: false, 
      error: `Recording setup failed: ${error.message}` 
    };
  }
}

// Stop recording
async function handleStopRecording(sendResponse) {
  try {
    if (!recordingState.isRecording) {
      sendResponse({ success: false, error: "No recording in progress" });
      return;
    }

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "stopRecording" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(
            response || { success: false, error: "No response from offscreen" }
          );
        }
      });
    });

    if (response.success) {
      recordingState.recordingData = response.recordingData;
      resetRecordingState();
      updateBadge("");
      notifyPopupStateChange();
      sendResponse({
        success: true,
        message: "Recording stopped",
        recordingData: response.recordingData,
      });
    } else {
      sendResponse({ success: false, error: response.error });
    }
  } catch (error) {
    console.error("Error stopping recording:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Test microphone permission via iframe injection
async function handleTestMicrophonePermission(sendResponse) {
  try {
    console.log("Testing microphone permission via iframe injection");

    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      sendResponse({ success: false, error: "No active tab found" });
      return;
    }

    const activeTabId = tabs[0].id;

    // Inject content script to handle microphone iframe
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: injectMicrophoneIframe,
    });

    sendResponse({
      success: true,
      message: "Microphone permission iframe injected",
    });
  } catch (error) {
    console.error("Error testing microphone permission:", error);
    sendResponse({ success: false, error: error.message });
  }
}

// Function to inject microphone iframe (will be executed in content script context)
function injectMicrophoneIframe() {
  // Remove any existing microphone iframe
  console.log("Injecting microphone permission iframe");
  const existingIframe = document.getElementById(
    "meet-recorder-microphone-iframe"
  );
  if (existingIframe) {
    existingIframe.remove();
  }

  // Create new iframe
  const microphoneIframe = document.createElement("iframe");
  microphoneIframe.id = "meet-recorder-microphone-iframe";
  microphoneIframe.setAttribute("allow", "microphone");
  microphoneIframe.setAttribute(
    "style",
    `
    all: initial;
    position: fixed;
    top: -1000px;
    left: -1000px;
    width: 1px;
    height: 1px;
    z-index: -1;
    opacity: 0;
    pointer-events: none;
  `
  );

  // Set source to extension microphone permission page
  microphoneIframe.src = chrome.runtime.getURL("microphone-permission.html");

  // Add to page
  document.body.appendChild(microphoneIframe);

  console.log("Microphone permission iframe injected");

  // Listen for messages from iframe
  window.addEventListener("message", function handleMicrophoneMessage(event) {
    if (event.data && event.data.action === "microphonePermissionResult") {
      console.log("Received microphone permission result:", event.data);

      // Send result to background script
      chrome.runtime.sendMessage({
        action: "microphonePermissionResult",
        success: event.data.success,
        error: event.data.error,
      });

      // Remove iframe and listener
      setTimeout(() => {
        const iframe = document.getElementById(
          "meet-recorder-microphone-iframe"
        );
        if (iframe) {
          iframe.remove();
        }
      }, 100);

      window.removeEventListener("message", handleMicrophoneMessage);
    }
  });

  // Auto-remove after timeout
  setTimeout(() => {
    const iframe = document.getElementById("meet-recorder-microphone-iframe");
    if (iframe) {
      iframe.remove();
      chrome.runtime.sendMessage({
        action: "microphonePermissionResult",
        success: false,
        error: "Request timed out. Please try again.",
      });
    }
  }, 10000); // 10 second timeout
}

// Check microphone permission status via iframe injection
async function handleCheckMicrophoneStatus(sendResponse) {
  try {
    console.log("Checking microphone status via iframe injection");

    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
      sendResponse({ hasPermission: null, error: "No active tab found" });
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
    console.error("Error checking microphone status:", error);
    sendResponse({ hasPermission: null, error: error.message });
  }
}

// Function to check microphone permission status (executed in content script context)
async function checkMicrophonePermissionStatus() {
  try {
    // Try to query microphone permission status
    const permissionStatus = await navigator.permissions.query({
      name: "microphone",
    });

    console.log("Microphone permission status:", permissionStatus.state);

    switch (permissionStatus.state) {
      case "granted":
        return { hasPermission: true };
      case "denied":
        return { hasPermission: false };
      case "prompt":
        return { hasPermission: null }; // Permission will be requested when needed
      default:
        return { hasPermission: null };
    }
  } catch (error) {
    console.log("Could not check microphone permission status:", error);
    return { hasPermission: null };
  }
}

// Handle microphone permission result from content script
function handleMicrophonePermissionResult(message, sendResponse) {
  console.log("Received microphone permission result:", message);

  // Forward the result to popup
  chrome.runtime
    .sendMessage({
      action: "microphonePermissionResult",
      success: message.success,
      error: message.error,
    })
    .catch(() => {
      // Popup might not be open, ignore error
    });

  if (sendResponse) {
    sendResponse({ received: true });
  }
}

// Handle microphone access failures during recording
function handleMicrophoneAccessFailed(message, sender) {
  console.warn("Microphone access failed during recording:", message.error);

  // Update any stored recording options to reflect microphone is not available
  chrome.storage.session
    .get(["currentRecordingOptions"])
    .then((result) => {
      if (result.currentRecordingOptions) {
        const updatedOptions = {
          ...result.currentRecordingOptions,
          includeMicrophone: false, // Disable microphone in current recording
        };

        chrome.storage.session.set({ currentRecordingOptions: updatedOptions });
        console.log("Updated recording options to disable microphone");
      }
    })
    .catch(console.error);

  // Notify popup about the microphone failure
  chrome.runtime
    .sendMessage({
      action: "microphoneAccessFailed",
      error: message.error,
    })
    .catch(() => {
      // Popup might not be open, ignore error
    });

  // Optionally show a notification
  chrome.notifications
    ?.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Microphone Access Failed",
      message:
        "Recording will continue without microphone audio. " + message.error,
    })
    .catch(() => {
      // Notifications might not be available
    });
}

// Handle Meet session detection
function handleMeetDetection(message, sender) {
  console.log("Meet session detected:", message);

  // Store Meet info for UI
  chrome.storage.session.set({
    activeMeetSession: {
      tabId: sender.tab.id,
      url: message.url,
      title: message.title,
      timestamp: Date.now(),
    },
  });
}

// Handle recording completion from offscreen document
function handleRecordingComplete(message, sender) {
  console.log('Recording completed:', message.recordingData);
  
  // Validate recording data structure
  const recordingData = message.recordingData;
  
  if (!recordingData || !recordingData.url) {
    console.error('Invalid recording data received');
    handleRecordingError({ error: 'Invalid recording data received' }, sender);
    return;
  }
  
  // Log recording details including audio data
  console.log('Recording details:', {
    videoSize: recordingData.size ? `${(recordingData.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown',
    audioSize: recordingData.audioSize ? `${(recordingData.audioSize / 1024 / 1024).toFixed(2)} MB` : 'No audio',
    duration: recordingData.duration ? `${recordingData.duration.toFixed(1)}s` : 'Unknown',
    hasAudio: !!recordingData.audioUrl
  });
  
  // Update recording state
  recordingState.recordingData = recordingData;
  recordingState.isRecording = false;
  recordingState.isPaused = false;
  
  // Clear badge
  updateBadge('');
  
  // Store recording data for preview tab with upload context
  chrome.storage.session.set({ 
    recordingData: recordingData,
    canUpload: !!recordingData.audioUrl && recordingData.audioSize > 0
  });
  
  // Add upload readiness check
  chrome.storage.local.get(['auth_token', 'user_id'], (result) => {
    const uploadReady = !!(result.auth_token && result.user_id && recordingData.audioUrl);
    
    chrome.storage.session.set({ 
      uploadReady: uploadReady 
    });
    
    console.log('Upload readiness:', uploadReady);
  });
  
  // Open preview tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('preview.html')
  });
  
  // Notify popup about completion
  notifyPopupStateChange();
  
  console.log('Recording completion handled successfully with upload support');
}
function cleanupUploadData() {
  try {
    // Clean up any temporary upload data
    chrome.storage.session.remove(['uploadReady', 'canUpload']);
    console.log('Upload data cleaned up');
  } catch (error) {
    console.error('Error cleaning upload data:', error);
  }
}
function trackUploadEvent(eventType, data = {}) {
  try {
    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data: data
    };
    
    // Could send to analytics service or store locally
    console.log('Upload event:', event);
    
    // Store in session for debugging
    chrome.storage.session.get(['uploadEvents'], (result) => {
      const events = result.uploadEvents || [];
      events.push(event);
      
      // Keep only last 20 events
      if (events.length > 20) {
        events.splice(0, events.length - 20);
      }
      
      chrome.storage.session.set({ uploadEvents: events });
    });
    
  } catch (error) {
    console.error('Error tracking upload event:', error);
  }
}
function enhancedCleanup() {
  // Existing cleanup code...
  cleanupUploadData();
}
// Handle recording errors from offscreen document
function handleRecordingError(message, sender) {
  console.error("Recording error from offscreen:", message.error);

  // Reset recording state
  resetRecordingState();
  updateBadge("");

  // Notify popup about error
  notifyPopupStateChange();

  // Could also show a notification to user
  chrome.notifications
    ?.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Recording Error",
      message: message.error || "An error occurred during recording",
    })
    .catch(() => {
      // Notifications might not be available
    });
}

// Handle tab closing during recording
function handleTabClosing(tabId) {
  if (recordingState.isRecording && recordingState.currentTabId === tabId) {
    console.log("Recording tab is closing, stopping recording...");

    // Stop recording automatically
    chrome.runtime
      .sendMessage({ action: "stopRecording" })
      .then(() => {
        resetRecordingState();
        updateBadge("");
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
    recordingData: recordingState.recordingData, // Keep recording data
  };
}

// Update extension badge
function updateBadge(text) {
  chrome.action.setBadgeText({ text });

  let color = "#000000";
  if (text === "REC") color = "#ff4444";
  else if (text === "⏸️") color = "#ff9500";

  chrome.action.setBadgeBackgroundColor({ color });
}

// Notify popup about state changes
function notifyPopupStateChange() {
  chrome.runtime
    .sendMessage({
      action: "recordingStateChanged",
      state: recordingState,
    })
    .catch(() => {
      // Popup might not be open, ignore error
    });
}

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabClosing(tabId);
});

// Handle tab navigation away from Meet
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.url &&
    recordingState.isRecording &&
    recordingState.currentTabId === tabId
  ) {
    // Check if navigating away from a Meet session
    console.log(`Recording tab navigated to: ${changeInfo.url}`);
  }
});
