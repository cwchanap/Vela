import { getValidIdToken, refreshIdToken } from './utils/storage';

// Get API URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

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
        let idToken: string;

        // Try to get valid ID token, handle auth errors specifically
        try {
          idToken = await getValidIdToken();
        } catch (authError) {
          // Handle authentication errors from getValidIdToken
          const errorMessage = authError instanceof Error ? authError.message : String(authError);
          console.error('Authentication error:', errorMessage);
          browser.notifications.create({
            type: 'basic',
            iconUrl: browser.runtime.getURL('/icon/128.png'),
            title: 'Vela - Authentication Required',
            message: 'Please log in to save sentences to your dictionary.',
          });
          return;
        }

        // Try to save the dictionary entry
        let response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
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
            idToken = await refreshIdToken();
          } catch (refreshError) {
            // Handle authentication errors from refreshIdToken
            const errorMessage =
              refreshError instanceof Error ? refreshError.message : String(refreshError);
            console.error('Token refresh error:', errorMessage);
            browser.notifications.create({
              type: 'basic',
              iconUrl: browser.runtime.getURL('/icon/128.png'),
              title: 'Vela - Session Expired',
              message: 'Please log in again to save sentences.',
            });
            return;
          }

          // Retry the request with new token
          response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              sentence: selectedText,
              sourceUrl: tab?.url,
              context: tab?.title,
            }),
          });
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
