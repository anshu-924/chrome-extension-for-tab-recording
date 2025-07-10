// Login Page Controller with Complete OTP Flow and 6-Block OTP Input

class LoginController {
  constructor() {
    this.countryCodes = [];
    this.selectedCountryCode = null;
    this.phoneNumber = '';
    this.fullPhoneNumber = '';
    this.currentStep = 'phone'; // phone, otp, success, maxAttempts
    this.isLoading = false;
    this.requestId = null;
    
    // OTP related
    this.otpValue = '';
    this.otpAttempts = 0;
    this.maxOTPAttempts = 3;
    this.resendTimer = null;
    this.resendSeconds = 30;
    this.otpBlocks = []; // Store references to OTP input blocks
    
    console.log('LoginController initialized');
    
    this.initializeElements();
    this.setupEventListeners();
    this.loadPhoneCodes();
  }

  initializeElements() {
    // Steps
    this.phoneStep = document.getElementById('phoneStep');
    this.otpStep = document.getElementById('otpStep');
    this.successStep = document.getElementById('successStep');
    this.maxAttemptsStep = document.getElementById('maxAttemptsStep');
    
    // Phone step elements
    this.countrySelect = document.getElementById('countrySelect');
    this.phoneInput = document.getElementById('phoneInput');
    this.sendOtpBtn = document.getElementById('sendOtpBtn');
    
    // OTP step elements
    this.backToPhoneBtn = document.getElementById('backToPhone');
    this.otpInput = document.getElementById('otpInput');
    this.phoneDisplay = document.getElementById('phoneDisplay');
    this.attemptsLeft = document.getElementById('attemptsLeft');
    this.resendTimer = document.getElementById('resendTimer');
    this.resendBtn = document.getElementById('resendBtn');
    this.verifyOtpBtn = document.getElementById('verifyOtpBtn');
    
    // Max attempts step
    this.startOverBtn = document.getElementById('startOverBtn');
    
    // Overlay elements
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.errorOverlay = document.getElementById('errorOverlay');
    this.errorMessage = document.getElementById('errorMessage');
    this.dismissErrorBtn = document.getElementById('dismissErrorBtn');
    
    console.log('Login elements initialized');
  }

  setupEventListeners() {
    // Phone step events
    if (this.countrySelect) {
      this.countrySelect.addEventListener('change', (e) => this.onCountryChange(e));
    }
    
    if (this.phoneInput) {
      this.phoneInput.addEventListener('input', (e) => this.onPhoneInput(e));
      this.phoneInput.addEventListener('keypress', (e) => this.onPhoneKeypress(e));
    }
    
    if (this.sendOtpBtn) {
      this.sendOtpBtn.addEventListener('click', () => this.handleSendOTP());
    }
    
    // OTP step events
    if (this.backToPhoneBtn) {
      this.backToPhoneBtn.addEventListener('click', () => this.goBackToPhone());
    }
    
    if (this.resendBtn) {
      this.resendBtn.addEventListener('click', () => this.handleResendOTP());
    }
    
    if (this.verifyOtpBtn) {
      this.verifyOtpBtn.addEventListener('click', () => this.handleVerifyOTP());
    }
    
    // Max attempts step
    if (this.startOverBtn) {
      this.startOverBtn.addEventListener('click', () => this.startOver());
    }
    
    // Error handling
    if (this.dismissErrorBtn) {
      this.dismissErrorBtn.addEventListener('click', () => this.hideError());
    }
    
    console.log('Event listeners setup complete');
  }

  // Create 6-block OTP input interface
  createOTPBlocks() {
    const otpInputGroup = document.querySelector('.otp-input-group');
    if (!otpInputGroup) return;

    // Clear existing content
    otpInputGroup.innerHTML = '';
    this.otpBlocks = [];

    // Create 6 individual input blocks
    for (let i = 0; i < 6; i++) {
      const block = document.createElement('input');
      block.type = 'text';
      block.className = 'otp-block';
      block.maxLength = 1;
      block.inputMode = 'numeric';
      block.pattern = '[0-9]';
      block.autocomplete = 'one-time-code';
      
      // Add event listeners for each block
      this.setupOTPBlockListeners(block, i);
      
      otpInputGroup.appendChild(block);
      this.otpBlocks.push(block);
    }

    // Focus the first block
    if (this.otpBlocks[0]) {
      this.otpBlocks[0].focus();
    }

    console.log('6-block OTP interface created');
  }

  // Setup event listeners for individual OTP blocks
  setupOTPBlockListeners(block, index) {
    // Handle input
    block.addEventListener('input', (e) => {
      let value = e.target.value;
      
      // Only allow numeric characters
      value = value.replace(/[^\d]/g, '');
      
      if (value.length > 1) {
        value = value.charAt(0);
      }
      
      e.target.value = value;
      
      // Update OTP value
      this.updateOTPValue();
      
      // Move to next block if value entered
      if (value && index < 5) {
        this.otpBlocks[index + 1].focus();
      }
      
      // Auto-submit when all 6 digits entered
      if (this.otpValue.length === 6 && !this.verifyOtpBtn.disabled) {
        setTimeout(() => this.handleVerifyOTP(), 100);
      }
    });

    // Handle keydown for navigation
    block.addEventListener('keydown', (e) => {
      // Handle backspace
      if (e.key === 'Backspace') {
        if (!e.target.value && index > 0) {
          // Move to previous block if current is empty
          this.otpBlocks[index - 1].focus();
          this.otpBlocks[index - 1].select();
        }
      }
      
      // Handle arrow keys
      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        this.otpBlocks[index - 1].focus();
      }
      
      if (e.key === 'ArrowRight' && index < 5) {
        e.preventDefault();
        this.otpBlocks[index + 1].focus();
      }
      
      // Handle Enter key
      if (e.key === 'Enter' && !this.verifyOtpBtn.disabled) {
        this.handleVerifyOTP();
      }
    });

    // Handle paste
    block.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text');
      const digits = pasteData.replace(/[^\d]/g, '').substring(0, 6);
      
      if (digits.length > 0) {
        // Fill blocks with pasted digits
        for (let i = 0; i < 6; i++) {
          if (this.otpBlocks[i] && digits[i]) {
            this.otpBlocks[i].value = digits[i];
          } else if (this.otpBlocks[i]) {
            this.otpBlocks[i].value = '';
          }
        }
        
        // Update OTP value and focus appropriate block
        this.updateOTPValue();
        
        const focusIndex = Math.min(digits.length, 5);
        this.otpBlocks[focusIndex].focus();
        
        // Auto-submit if 6 digits pasted
        if (digits.length === 6 && !this.verifyOtpBtn.disabled) {
          setTimeout(() => this.handleVerifyOTP(), 100);
        }
      }
    });

    // Handle focus
    block.addEventListener('focus', (e) => {
      e.target.select();
    });
  }

  // Update OTP value from blocks
  updateOTPValue() {
    this.otpValue = this.otpBlocks.map(block => block.value).join('');
    this.validateOtpForm();
    console.log('OTP value updated:', this.otpValue);
  }

  // Clear all OTP blocks
  clearOTPBlocks() {
    this.otpBlocks.forEach(block => {
      block.value = '';
    });
    this.otpValue = '';
    this.validateOtpForm();
    
    // Focus first block
    if (this.otpBlocks[0]) {
      this.otpBlocks[0].focus();
    }
  }

  // Load phone codes from API via background script
  async loadPhoneCodes() {
    try {
      this.showLoading('Loading phone codes...');
      
      console.log('Requesting phone codes from background script...');
      
      const response = await chrome.runtime.sendMessage({ 
        action: 'getPhoneCodes' 
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to load phone codes');
      }

      this.countryCodes = response.phoneCodes || [];
      console.log(`Loaded ${this.countryCodes.length} country codes`);
      
      this.populateCountrySelect();
      this.hideLoading();
      
    } catch (error) {
      console.error('Error loading phone codes:', error);
      this.hideLoading();
      this.showError('Failed to load phone codes. Please try again.');
    }
  }

  // Populate country select dropdown
  populateCountrySelect() {
    if (!this.countrySelect || !this.countryCodes.length) {
      console.error('Country select element or codes not available');
      return;
    }

    // Clear existing options
    this.countrySelect.innerHTML = '';

    // Filter out entries with missing country_code or phone_code
    const validCodes = this.countryCodes.filter(
      (c) => c.country_code && c.phone_code
    );

    // Sort countries: India first, then alphabetically by country code
    const sortedCodes = validCodes.sort((a, b) => {
      if (a.country_code === 'IN') return -1;
      if (b.country_code === 'IN') return 1;
      return a.country_code.localeCompare(b.country_code);
    });

    // Add options
    sortedCodes.forEach((country) => {
      const option = document.createElement('option');
      option.value = country.phone_code;
      option.setAttribute('data-country', country.country_code);
      option.textContent = `${country.country_code} (+${country.phone_code})`;

      // Select India by default
      if (country.country_code === 'IN') {
        option.selected = true;
        this.selectedCountryCode = country.phone_code;
      }

      this.countrySelect.appendChild(option);
    });

    console.log('Country select populated with', sortedCodes.length, 'options');
    this.validatePhoneForm();
  }

  // Handle country selection change
  onCountryChange(event) {
    const selectedValue = event.target.value;
    const selectedOption = event.target.selectedOptions[0];
    
    if (selectedOption) {
      this.selectedCountryCode = selectedValue;
      const countryCode = selectedOption.getAttribute('data-country');
      
      console.log(`Country changed to: ${countryCode} (+${selectedValue})`);
      this.validatePhoneForm();
    }
  }

  // Handle phone number input
  onPhoneInput(event) {
    let value = event.target.value;
    
    // Remove any non-numeric characters except + and spaces
    value = value.replace(/[^\d\s]/g, '');
    
    // Limit length
    if (value.length > 15) {
      value = value.substring(0, 15);
    }
    
    this.phoneNumber = value;
    event.target.value = value;
    
    this.validatePhoneForm();
  }

  // Handle Enter key in phone input
  onPhoneKeypress(event) {
    if (event.key === 'Enter' && !this.sendOtpBtn.disabled) {
      this.handleSendOTP();
    }
  }

  // Validate phone form
  validatePhoneForm() {
    const isValid = this.selectedCountryCode && 
                   this.phoneNumber.trim().length >= 6 && 
                   !this.isLoading;
    
    if (this.sendOtpBtn) {
      this.sendOtpBtn.disabled = !isValid;
    }
    
    return isValid;
  }

  // Validate OTP form
  validateOtpForm() {
    const isValid = this.otpValue.length === 6 && !this.isLoading;
    
    if (this.verifyOtpBtn) {
      this.verifyOtpBtn.disabled = !isValid;
    }
    
    return isValid;
  }

  // Handle send OTP
  async handleSendOTP() {
    if (!this.validatePhoneForm()) {
      return;
    }

    try {
      this.setLoadingState(true);
      
      this.fullPhoneNumber = `+${this.selectedCountryCode}${this.phoneNumber}`;
      console.log('Attempting to send OTP to:', this.fullPhoneNumber);
      
      await this.sendOTP(this.fullPhoneNumber);
      
    } catch (error) {
      console.error('Send OTP error:', error);
      this.showError(error.message || 'Failed to send OTP. Please try again.');
      this.setLoadingState(false);
    }
  }

  // Send OTP via background script
  async sendOTP(phoneNumber) {
    try {
      console.log('Sending OTP to:', phoneNumber);
      
      const response = await chrome.runtime.sendMessage({
        action: 'sendOTP',
        phone: phoneNumber
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to send OTP');
      }
      
      const result = response.result;
      
      if (result.status === 'success') {
        console.log('OTP sent successfully');
        this.requestId = result.request_id;
        this.showOTPStep();
      } else {
        throw new Error('Failed to send OTP');
      }
      
    } catch (error) {
      console.error('Error sending OTP:', error);
      throw error;
    }
  }

  // Show OTP verification step
  showOTPStep() {
    this.currentStep = 'otp';
    this.setLoadingState(false);
    
    // Hide phone step, show OTP step
    this.phoneStep.style.display = 'none';
    this.otpStep.style.display = 'flex';
    
    // Update phone display
    if (this.phoneDisplay) {
      this.phoneDisplay.textContent = this.formatPhoneNumber(this.fullPhoneNumber);
    }
    
    // Create OTP blocks interface
    this.createOTPBlocks();
    
    // Reset OTP state
    this.otpValue = '';
    this.otpAttempts = 0;
    
    // Update attempts display
    this.updateAttemptsDisplay();
    
    // Start resend timer
    this.startResendTimer();
    
    console.log('Switched to OTP verification step with 6-block interface');
  }

  // Handle verify OTP
  async handleVerifyOTP() {
    if (!this.validateOtpForm()) {
      return;
    }

    try {
      this.setLoadingState(true);
      
      console.log('Verifying OTP:', this.otpValue);
      
      await this.verifyOTP(this.fullPhoneNumber, this.otpValue);
      
    } catch (error) {
      console.error('Verify OTP error:', error);
      this.handleOTPError(error.message || 'Invalid OTP. Please try again.');
    }
  }

  // Verify OTP via background script
  async verifyOTP(phoneNumber, otp) {
    try {
      console.log('Verifying OTP for:', phoneNumber);
      
      const response = await chrome.runtime.sendMessage({
        action: 'verifyOTP',
        phone: phoneNumber,
        otp: otp
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to verify OTP');
      }
      
      const result = response.result;
      
      if (result.auth_token && result.refresh_token) {
        console.log('OTP verification successful');
        this.showSuccessStep();
        
        // Redirect after delay
        setTimeout(() => {
          this.redirectToMainApp();
        }, 2000);
      } else {
        throw new Error('Invalid OTP or verification failed');
      }
      
    } catch (error) {
      console.error('Error verifying OTP:', error);
      throw error;
    }
  }

  // Handle OTP verification errors
  handleOTPError(errorMessage) {
    this.setLoadingState(false);
    this.otpAttempts++;
    
    console.log(`OTP attempt ${this.otpAttempts}/${this.maxOTPAttempts} failed`);
    
    if (this.otpAttempts >= this.maxOTPAttempts) {
      this.showMaxAttemptsReached();
    } else {
      this.updateAttemptsDisplay();
      this.showError(errorMessage);
      
      // Clear OTP blocks
      this.clearOTPBlocks();
    }
  }

  // Update attempts display
  updateAttemptsDisplay() {
    if (this.attemptsLeft) {
      const remaining = this.maxOTPAttempts - this.otpAttempts;
      this.attemptsLeft.textContent = `${remaining} attempts left`;
      
      if (remaining <= 1) {
        this.attemptsLeft.classList.add('warning');
      } else {
        this.attemptsLeft.classList.remove('warning');
      }
    }
  }

  // Show success step
  showSuccessStep() {
    this.currentStep = 'success';
    this.setLoadingState(false);
    
    // Hide OTP step, show success step
    this.otpStep.style.display = 'none';
    this.successStep.style.display = 'flex';
    
    console.log('Switched to success step');
  }

  // Show max attempts reached
  showMaxAttemptsReached() {
    this.currentStep = 'maxAttempts';
    this.setLoadingState(false);
    
    // Hide OTP step, show max attempts step
    this.otpStep.style.display = 'none';
    this.maxAttemptsStep.style.display = 'flex';
    
    console.log('Switched to max attempts step');
  }

  // Start resend timer
  startResendTimer() {
    this.stopResendTimer();
    this.resendSeconds = 60;
    
    if (this.resendBtn) {
      this.resendBtn.disabled = true;
    }
    
    this.updateResendDisplay();
    
    this.resendTimerInterval = setInterval(() => {
      this.resendSeconds--;
      this.updateResendDisplay();
      
      if (this.resendSeconds <= 0) {
        this.stopResendTimer();
        if (this.resendBtn) {
          this.resendBtn.disabled = false;
        }
        if (this.resendTimer) {
          this.resendTimer.textContent = 'Didn\'t receive the code?';
        }
      }
    }, 1000);
  }

  // Stop resend timer
  stopResendTimer() {
    if (this.resendTimerInterval) {
      clearInterval(this.resendTimerInterval);
      this.resendTimerInterval = null;
    }
  }

  // Update resend display
  updateResendDisplay() {
    if (this.resendTimer) {
      if (this.resendSeconds > 0) {
        this.resendTimer.textContent = `Resend in ${this.resendSeconds}s`;
      } else {
        this.resendTimer.textContent = 'Didn\'t receive the code?';
      }
    }
  }

  // Handle resend OTP
  async handleResendOTP() {
    try {
      this.setLoadingState(true);
      
      console.log('Resending OTP to:', this.fullPhoneNumber);
      
      await this.sendOTP(this.fullPhoneNumber);
      
      // Reset attempts counter on successful resend
      this.otpAttempts = 0;
      this.updateAttemptsDisplay();
      
      // Clear OTP blocks
      this.clearOTPBlocks();
      
      this.setLoadingState(false);
      
    } catch (error) {
      console.error('Resend OTP error:', error);
      this.showError(error.message || 'Failed to resend OTP. Please try again.');
      this.setLoadingState(false);
    }
  }

  // Go back to phone step
  goBackToPhone() {
    this.currentStep = 'phone';
    this.stopResendTimer();
    
    // Hide OTP step, show phone step
    this.otpStep.style.display = 'none';
    this.phoneStep.style.display = 'flex';
    
    // Reset OTP state
    this.otpValue = '';
    this.otpAttempts = 0;
    this.requestId = null;
    this.otpBlocks = [];
    
    // Focus phone input
    if (this.phoneInput) {
      this.phoneInput.focus();
    }
    
    console.log('Returned to phone step');
  }

  // Start over from the beginning
  startOver() {
    this.currentStep = 'phone';
    this.stopResendTimer();
    
    // Hide all steps except phone
    this.otpStep.style.display = 'none';
    this.successStep.style.display = 'none';
    this.maxAttemptsStep.style.display = 'none';
    this.phoneStep.style.display = 'flex';
    
    // Reset all state
    this.phoneNumber = '';
    this.fullPhoneNumber = '';
    this.otpValue = '';
    this.otpAttempts = 0;
    this.requestId = null;
    this.otpBlocks = [];
    
    // Clear inputs
    if (this.phoneInput) {
      this.phoneInput.value = '';
      this.phoneInput.focus();
    }
    
    this.validatePhoneForm();
    
    console.log('Started over from beginning');
  }

  // Redirect to main app after successful login
  redirectToMainApp() {
    console.log('Redirecting to main app...');
    
    // Close the login tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.remove(tabs[0].id);
      }
    });
  }

  // Set loading state
  setLoadingState(loading) {
    this.isLoading = loading;
    
    // Update send OTP button
    if (this.sendOtpBtn) {
      if (loading && this.currentStep === 'phone') {
        this.sendOtpBtn.classList.add('loading');
        this.sendOtpBtn.disabled = true;
      } else {
        this.sendOtpBtn.classList.remove('loading');
        if (this.currentStep === 'phone') {
          this.validatePhoneForm();
        }
      }
    }
    
    // Update verify OTP button
    if (this.verifyOtpBtn) {
      if (loading && this.currentStep === 'otp') {
        this.verifyOtpBtn.classList.add('loading');
        this.verifyOtpBtn.disabled = true;
      } else {
        this.verifyOtpBtn.classList.remove('loading');
        if (this.currentStep === 'otp') {
          this.validateOtpForm();
        }
      }
    }
  }

  // Show loading overlay
  showLoading(message) {
    if (this.loadingOverlay) {
      const loadingText = this.loadingOverlay.querySelector('.loading-text');
      if (loadingText) {
        loadingText.textContent = message;
      }
      this.loadingOverlay.style.display = 'flex';
    }
  }

  // Hide loading overlay
  hideLoading() {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = 'none';
    }
  }

  // Show error message
  showError(message) {
    if (this.errorMessage && this.errorOverlay) {
      this.errorMessage.textContent = message;
      this.errorOverlay.style.display = 'flex';
    }
  }

  // Hide error message
  hideError() {
    if (this.errorOverlay) {
      this.errorOverlay.style.display = 'none';
    }
  }

  // Format phone number for display
  formatPhoneNumber(phoneNumber) {
    // Simple formatting for display
    if (phoneNumber.startsWith('+91')) {
      const number = phoneNumber.substring(3);
      return `+91 ${number.substring(0, 5)} ${number.substring(5)}`;
    }
    return phoneNumber;
  }

  // Helper function to parse JWT (for debugging)
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

  // Debug functions (remove in production)
  async testPhoneCodes() {
    console.log('Testing phone codes API...');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getPhoneCodes' });
      console.log('Phone codes response:', response);
      alert(`Phone codes test: ${response.success ? 'SUCCESS' : 'FAILED'}\nCount: ${response.phoneCodes?.length || 0}`);
    } catch (error) {
      console.error('Phone codes test error:', error);
      alert('Phone codes test FAILED: ' + error.message);
    }
  }

  async testTokens() {
    console.log('Checking stored tokens...');
    try {
      const result = await chrome.storage.local.get(['auth_token', 'refresh_token', 'user_id']);
      console.log('Stored tokens:', result);
      
      let message = 'Token Status:\n';
      message += `Auth Token: ${result.auth_token ? 'EXISTS' : 'MISSING'}\n`;
      message += `Refresh Token: ${result.refresh_token ? 'EXISTS' : 'MISSING'}\n`;
      message += `User ID: ${result.user_id || 'MISSING'}`;
      
      if (result.auth_token) {
        const tokenData = this.parseJwt(result.auth_token);
        if (tokenData) {
          message += `\n\nUser Info:\n`;
          message += `Name: ${tokenData.fullname || 'N/A'}\n`;
          message += `Phone: ${tokenData.phone || 'N/A'}\n`;
          message += `Expires: ${new Date(tokenData.exp * 1000).toLocaleString()}`;
        }
      }
      
      alert(message);
    } catch (error) {
      console.error('Token test error:', error);
      alert('Token test FAILED: ' + error.message);
    }
  }

  async clearAll() {
    console.log('Clearing all storage...');
    try {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      alert('All storage cleared! You can now test fresh login.');
      location.reload();
    } catch (error) {
      console.error('Clear storage error:', error);
      alert('Clear storage FAILED: ' + error.message);
    }
  }
}

// Initialize login controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing login controller');
  window.loginController = new LoginController();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.loginController) {
    console.log('Login page became visible');
  }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (window.loginController && window.loginController.resendTimerInterval) {
    clearInterval(window.loginController.resendTimerInterval);
  }
});