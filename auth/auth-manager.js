// Updated Global Authentication Manager for Chrome Extension

class AuthManager {
  constructor() {
    this.isAuthenticated = false;
    this.currentUser = null;
    this.authToken = null;
    this.refreshToken = null;
    this.logoutManager = null; // Will be set when logout.js loads
    
    console.log('AuthManager initialized');
    
    // Initialize logout manager if available
    if (window.logoutManager) {
      this.logoutManager = window.logoutManager;
    }
  }

  // Set logout manager reference
  setLogoutManager(logoutManager) {
    this.logoutManager = logoutManager;
    console.log('LogoutManager reference set in AuthManager');
  }

  // Check if user is authenticated
  async checkAuthentication() {
    try {
      // Get tokens from storage
      const result = await chrome.storage.local.get(['auth_token', 'refresh_token', 'user_id']);
      
      if (!result.auth_token || !result.refresh_token) {
        console.log('No tokens found, user not authenticated');
        this.isAuthenticated = false;
        this.currentUser = null;
        return false;
      }

      // Validate token
      const tokenData = this.parseJwt(result.auth_token);
      if (!tokenData || !tokenData.exp) {
        console.log('Invalid token format');
        await this.clearTokens();
        return false;
      }

      const currentTime = Date.now() / 1000;
      const timeUntilExpiry = tokenData.exp - currentTime;

      // If token expires in less than 5 minutes, try to refresh
      if (timeUntilExpiry < 300) { // 5 minutes
        console.log('Token expiring soon, attempting refresh...');
        const refreshResult = await this.refreshAuthToken(result.refresh_token, result.user_id);
        
        if (!refreshResult.success) {
          console.log('Token refresh failed');
          await this.clearTokens();
          return false;
        }
      }

      // User is authenticated
      this.isAuthenticated = true;
      this.authToken = result.auth_token;
      this.refreshToken = result.refresh_token;
      this.currentUser = this.extractUserFromToken(tokenData);
      
      console.log('User is authenticated');
      return true;

    } catch (error) {
      console.error('Error checking authentication:', error);
      await this.clearTokens();
      return false;
    }
  }

  // Extract user info from token
  extractUserFromToken(tokenData) {
    return {
      id: tokenData.id,
      phone: tokenData.phone,
      email: tokenData.email,
      fullname: tokenData.fullname || 'User',
      phone_verified: tokenData.phone_verified,
      email_verified: tokenData.email_verified,
      created_at: tokenData.created_at,
      updated_at: tokenData.updated_at
    };
  }

  // Parse JWT token
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

  // Refresh auth token via background script
  async refreshAuthToken(refreshToken, userId) {
    try {
      // Call background script instead of direct fetch to avoid CSP issues
      const response = await chrome.runtime.sendMessage({
        action: 'refreshToken',
        refreshToken: refreshToken,
        userId: userId
      });

      if (!response.success) {
        throw new Error(response.error || 'Token refresh failed');
      }

      console.log('Auth tokens refreshed via background script');
      return { success: true };
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return { success: false, error: error.message };
    }
  }

  // Update tokens in storage
  async updateTokens(authToken, refreshToken) {
    try {
      await chrome.storage.local.set({
        'auth_token': authToken,
        'refresh_token': refreshToken
      });
      
      this.authToken = authToken;
      this.refreshToken = refreshToken;
      this.isAuthenticated = true;
      
      // Update current user info
      const tokenData = this.parseJwt(authToken);
      if (tokenData) {
        this.currentUser = this.extractUserFromToken(tokenData);
      }
      
      console.log('Tokens updated successfully');
      
      // Dispatch event for other parts of extension
      this.dispatchAuthEvent('tokensUpdated', { authToken, refreshToken });
      
    } catch (error) {
      console.error('Error updating tokens:', error);
      throw error;
    }
  }

  // Clear all authentication data
  async clearTokens() {
    try {
      await chrome.storage.local.remove(['auth_token', 'refresh_token', 'user_id']);
      
      this.isAuthenticated = false;
      this.authToken = null;
      this.refreshToken = null;
      this.currentUser = null;
      
      console.log('Tokens cleared');
      
      // Dispatch event
      this.dispatchAuthEvent('tokensCleared');
      
    } catch (error) {
      console.error('Error clearing tokens:', error);
    }
  }

  // Logout user using LogoutManager if available
  async logout() {
    try {
      console.log('AuthManager: Starting logout process...');
      
      if (this.logoutManager) {
        console.log('Using LogoutManager for logout');
        const result = await this.logoutManager.logout();
        
        if (result.success) {
          // Update local state
          this.isAuthenticated = false;
          this.authToken = null;
          this.refreshToken = null;
          this.currentUser = null;
          
          console.log('AuthManager: Logout completed successfully');
          return result;
        } else {
          console.error('AuthManager: LogoutManager failed:', result.error);
          return result;
        }
      } else {
        console.log('LogoutManager not available, using fallback');
        return await this.fallbackLogout();
      }
      
    } catch (error) {
      console.error('AuthManager: Error during logout:', error);
      return { success: false, error: error.message };
    }
  }

  // Fallback logout method
  async fallbackLogout() {
    try {
      // Get refresh token for logout API
      const result = await chrome.storage.local.get(['refresh_token']);
      
      // Call logout API if we have a refresh token
      if (result.refresh_token) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'logoutAPI',
            refreshToken: result.refresh_token
          });
          
          if (response.warning) {
            console.warn('Logout API warning:', response.warning);
          }
        } catch (error) {
          console.warn('Logout API call failed, continuing with local logout:', error);
        }
      }
      
      // Clear all authentication data
      await this.clearTokens();
      
      console.log('Fallback logout completed');
      return { success: true };
      
    } catch (error) {
      console.error('Error in fallback logout:', error);
      return { success: false, error: error.message };
    }
  }

  // Redirect to login page
  redirectToLogin() {
    const loginUrl = chrome.runtime.getURL('auth/login.html');
    chrome.tabs.create({ url: loginUrl });
  }

  // Redirect to main popup
  redirectToMain() {
    // Close current tab if it's the login page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url.includes('login.html')) {
        chrome.tabs.remove(currentTab.id);
      }
    });
  }

  // Dispatch authentication events
  dispatchAuthEvent(eventType, data = null) {
    try {
      // Send message to background script
      chrome.runtime.sendMessage({
        action: 'authEvent',
        eventType: eventType,
        data: data
      }).catch(() => {
        // Background script might not be listening, ignore error
      });
    } catch (error) {
      console.error('Error dispatching auth event:', error);
    }
  }

  // Get current authentication status
  getAuthStatus() {
    return {
      isAuthenticated: this.isAuthenticated,
      hasToken: !!this.authToken,
      currentUser: this.currentUser
    };
  }

  // Get current user info
  getCurrentUser() {
    return this.currentUser;
  }

  // Validate authentication before allowing actions
  async requireAuth() {
    const isAuth = await this.checkAuthentication();
    if (!isAuth) {
      this.redirectToLogin();
      throw new Error('Authentication required');
    }
    return true;
  }

  // Check if user is currently logged in (simple check)
  async isLoggedIn() {
    try {
      const result = await chrome.storage.local.get(['auth_token']);
      return !!result.auth_token;
    } catch (error) {
      console.error('Error checking login status:', error);
      return false;
    }
  }
}

// Create global instance
window.authManager = new AuthManager();

// Set up LogoutManager reference when it becomes available
if (window.logoutManager) {
  window.authManager.setLogoutManager(window.logoutManager);
} else {
  // Watch for LogoutManager to become available
  const checkForLogoutManager = setInterval(() => {
    if (window.logoutManager) {
      window.authManager.setLogoutManager(window.logoutManager);
      clearInterval(checkForLogoutManager);
    }
  }, 100);
  
  // Stop checking after 5 seconds
  setTimeout(() => {
    clearInterval(checkForLogoutManager);
  }, 5000);
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthManager;
}