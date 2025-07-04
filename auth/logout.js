// Logout functionality for Chrome Extension

class LogoutManager {
  constructor() {
    console.log('LogoutManager initialized');
  }

  // Logout user and clear all data
  async logout() {
    try {
      console.log('Logging out user...');
      
      // Get current tokens for logout API call (optional)
      const result = await chrome.storage.local.get(['refresh_token']);
      
      // Call logout API if we have a refresh token
      if (result.refresh_token) {
        try {
          await this.callLogoutAPI(result.refresh_token);
        } catch (error) {
          console.warn('Logout API call failed, but continuing with local logout:', error);
        }
      }
      
      // Clear all authentication data
      await this.clearAllAuthData();
      
      // Notify background script
      chrome.runtime.sendMessage({
        action: 'authEvent',
        eventType: 'logoutComplete'
      }).catch(() => {
        // Background might not be listening, ignore
      });
      
      console.log('Logout completed successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Error during logout:', error);
      return { success: false, error: error.message };
    }
  }

  // Call logout API
  async callLogoutAPI(refreshToken) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'logoutAPI',
        refreshToken: refreshToken
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Logout API call failed');
      }
      
      console.log('Logout API call successful');
      return response;
      
    } catch (error) {
      console.error('Error calling logout API:', error);
      throw error;
    }
  }

  // Clear all authentication data
  async clearAllAuthData() {
    try {
      // Clear auth tokens
      await chrome.storage.local.remove([
        'auth_token',
        'refresh_token', 
        'user_id'
      ]);
      
      // Clear any session data
      await chrome.storage.session.clear();
      
      console.log('All authentication data cleared');
      
    } catch (error) {
      console.error('Error clearing auth data:', error);
      throw error;
    }
  }

  // Check if user is currently logged in
  async isLoggedIn() {
    try {
      const result = await chrome.storage.local.get(['auth_token']);
      return !!result.auth_token;
    } catch (error) {
      console.error('Error checking login status:', error);
      return false;
    }
  }

  // Get current user info
  async getCurrentUser() {
    try {
      const result = await chrome.storage.local.get(['auth_token', 'user_id']);
      
      if (!result.auth_token) {
        return null;
      }
      
      // Parse JWT to get user info
      const tokenData = this.parseJwt(result.auth_token);
      
      return {
        id: result.user_id || tokenData?.id,
        phone: tokenData?.phone,
        email: tokenData?.email,
        fullname: tokenData?.fullname || 'User',
        phone_verified: tokenData?.phone_verified,
        email_verified: tokenData?.email_verified
      };
      
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
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

  // Force logout (for emergencies)
  async forceLogout() {
    try {
      await this.clearAllAuthData();
      
      // Reload extension popup/pages
      chrome.runtime.reload();
      
      return { success: true };
    } catch (error) {
      console.error('Error during force logout:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.logoutManager = new LogoutManager();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LogoutManager;
}