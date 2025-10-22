// Get API URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

/**
 * Get access token from storage
 */
async function getAccessToken(): Promise<string> {
  const result = await browser.storage.local.get('vela_auth_tokens');
  const tokens = result.vela_auth_tokens;

  if (!tokens || !tokens.accessToken) {
    throw new Error('Not authenticated');
  }

  return tokens.accessToken;
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(): Promise<string> {
  const result = await browser.storage.local.get('vela_auth_tokens');
  const tokens = result.vela_auth_tokens;

  if (!tokens || !tokens.refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!refreshResponse.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await refreshResponse.json();
    const newTokens = data.tokens;

    // Save new tokens
    await browser.storage.local.set({ vela_auth_tokens: newTokens });

    return newTokens.accessToken;
  } catch (error) {
    // Refresh failed, clear auth data
    await browser.storage.local.remove(['vela_auth_tokens', 'vela_user_email']);
    throw new Error('Session expired. Please log in again.');
  }
}

export default defineBackground(() => {
  console.log('Vela extension background script loaded', { id: browser.runtime.id });

  // Create context menu when extension is installed
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-vela',
      title: 'Save to My Dictionaries',
      contexts: ['selection'],
    });
    console.log('Context menu created');
  });

  // Handle context menu clicks
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'save-to-vela' && info.selectionText) {
      const selectedText = info.selectionText.trim();

      if (!selectedText) {
        console.log('No text selected');
        return;
      }

      try {
        let accessToken = await getAccessToken();

        // Try to save the dictionary entry
        let response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            sentence: selectedText,
            sourceUrl: tab?.url,
            context: tab?.title,
          }),
        });

        // If unauthorized, try to refresh token and retry once
        if (response.status === 401) {
          try {
            accessToken = await refreshAccessToken();

            // Retry the request with new token
            response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                sentence: selectedText,
                sourceUrl: tab?.url,
                context: tab?.title,
              }),
            });
          } catch (refreshError) {
            throw refreshError;
          }
        }

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save dictionary entry');
        }

        // Show success notification
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Entry Saved',
          message: `Saved: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`,
        });
      } catch (error) {
        console.error('Error saving sentence:', error);

        // Show error notification
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Error',
          message: error instanceof Error ? error.message : 'Failed to save dictionary entry',
        });
      }
    }
  });
});
