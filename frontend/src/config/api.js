// API Configuration
const getApiBaseUrl = () => {
  // Check environment variable first
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // Check if we're in development mode
  if (import.meta.env.DEV) {
    return 'http://localhost:8000';
  }
  
  // Default to local backend when env var is not set
  return 'http://localhost:8000';
};

const API_BASE_URL = getApiBaseUrl();

// Debug logging

/**
 * Make an authenticated API request with JWT token
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @param {Function} getToken - Function to get the authentication token
 * @returns {Promise<Response>} - The fetch response
 */
export const authenticatedFetch = async (url, options = {}, getToken) => {
  try {
    // Get the token from auth provider
    const token = await getToken();
    
    // Merge headers with authentication
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };
    
    // If body is an object (not FormData), stringify it and set content-type
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    
    return await fetch(url, {
      ...options,
      headers,
    });
  } catch (error) {
    console.error('Error in authenticated fetch:', error);
    throw error;
  }
};

/**
 * Feature flags — flip ENABLE_SCREENSHOTS to false to hide screenshot
 * functionality across the app and show a "coming soon" placeholder instead.
 */
export const ENABLE_SCREENSHOTS = true;

export { API_BASE_URL };
