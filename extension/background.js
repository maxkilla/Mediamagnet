let activeTabId = null;
let injectedTabs = new Set();
let initializationQueue = new Map();

// Helper function to check URL validity
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    // Allow http, https, and ftp protocols
    return ['http:', 'https:', 'ftp:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Ensure content script is injected with retry mechanism
async function ensureContentScriptInjected(tabId, retries = 3) {
  if (injectedTabs.has(tabId)) return true;

  let currentTab;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      currentTab = await chrome.tabs.get(tabId);
      
      // Validate URL
      if (!currentTab.url || !isValidUrl(currentTab.url)) {
        throw new Error('Please navigate to a web page with video files. Browser pages cannot be scanned.');
      }

      // Check if tab is already being initialized
      if (initializationQueue.has(tabId)) {
        await initializationQueue.get(tabId);
        return true;
      }

      // Create initialization promise
      const initPromise = (async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });

          // Wait for script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));

          // Verify script loaded
          const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
          if (response?.status === 'OK') {
            injectedTabs.add(tabId);
            return true;
          }
          throw new Error('Script verification failed');
        } catch (error) {
          console.error('Script injection error:', error);
          throw error;
        }
      })();

      initializationQueue.set(tabId, initPromise);
      const result = await initPromise;
      initializationQueue.delete(tabId);
      return result;

    } catch (error) {
      if (attempt === retries - 1) {
        chrome.runtime.sendMessage({
          type: 'SCAN_ERROR',
          error: error.message,
          details: {
            url: currentTab?.url,
            tabId,
            attempt: attempt + 1
          }
        });
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCAN_START') {
    // Handle scan initialization
    (async () => {
      try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (!tabs[0]) throw new Error('No active tab found');
        
        // Try to inject the content script
        await ensureContentScriptInjected(tabs[0].id);
        
        // Send the scan command
        await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'START_SCAN',
          settings: message.settings
        });
        
        sendResponse({ status: 'OK' });
      } catch (error) {
        chrome.runtime.sendMessage({
          type: 'SCAN_ERROR',
          error: error.message,
          details: { timestamp: new Date().toISOString() }
        });
        sendResponse({ status: 'ERROR', error: error.message });
      }
    })();
    return true; // Keep message channel open
  }
  return false;
});

// Handle tab updates
chrome.tabs.onActivated.addListener(function(activeInfo) {
  activeTabId = activeInfo.tabId;
});

// Handle tab cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    injectedTabs.delete(tabId);
  }
  if (changeInfo.status === 'complete' && tabId === activeTabId) {
    ensureContentScriptInjected(tabId);
  }
});
