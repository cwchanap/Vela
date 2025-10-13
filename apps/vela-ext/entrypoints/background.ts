export default defineBackground(() => {
  console.log('Vela extension background script loaded', { id: browser.runtime.id });

  // Create context menu when extension is installed
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-vela',
      title: 'Save to Vela Dictionary',
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
        // Get authentication tokens from storage
        const result = await browser.storage.local.get('vela_auth_tokens');
        const tokens = result.vela_auth_tokens;

        if (!tokens || !tokens.accessToken) {
          // Show notification to user to login
          browser.notifications.create({
            type: 'basic',
            iconUrl: browser.runtime.getURL('/icon/128.png'),
            title: 'Vela - Not Logged In',
            message: 'Please open the extension and log in to save sentences.',
          });
          return;
        }

        // Get API URL from environment or use default
        const API_BASE_URL = 'https://vela.cwchanap.dev/api';

        // Save the sentence to the backend
        const response = await fetch(`${API_BASE_URL}/saved-sentences`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          body: JSON.stringify({
            sentence: selectedText,
            sourceUrl: tab?.url,
            context: tab?.title,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save sentence');
        }

        // Show success notification
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Sentence Saved',
          message: `Saved: ${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}`,
        });

        console.log('Sentence saved successfully:', selectedText);
      } catch (error) {
        console.error('Error saving sentence:', error);

        // Show error notification
        browser.notifications.create({
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: 'Vela - Error',
          message: error instanceof Error ? error.message : 'Failed to save sentence',
        });
      }
    }
  });
});
