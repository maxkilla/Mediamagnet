// Utility functions (moved to top level)
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function logToConsole(message, type = 'info', details = null) {
  const consoleOutput = document.getElementById('consoleOutput');
  if (!consoleOutput) return;

  const messageElement = document.createElement('div');
  messageElement.className = `console-message ${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  const messageText = `[${timestamp}] ${message}`;
  
  messageElement.textContent = messageText;
  
  if (details) {
    const detailsElement = document.createElement('div');
    detailsElement.className = 'console-details';
    detailsElement.textContent = JSON.stringify(details, null, 2);
    messageElement.appendChild(detailsElement);
  }
  
  consoleOutput.appendChild(messageElement);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;

  if (type === 'error') {
    const consoleTab = document.querySelector('[data-tab="console"]');
    if (consoleTab) consoleTab.click();
  }
}

// Define HistoryManager before any other code
const HistoryManager = {
  async getHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['scanHistory'], (data) => {
        resolve(data.scanHistory || []);
      });
    });
  },

  async saveHistory(history) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ scanHistory: history }, resolve);
    });
  },

  async addEntry(url, results) {
    const history = await this.getHistory();
    const timestamp = new Date().toISOString();
    
    const existingIndex = history.findIndex(entry => entry.url === url);
    const entry = {
      url,
      timestamp,
      fileCount: results.length,
      totalSize: results.reduce((sum, file) => sum + (file.size || 0), 0),
      lastResults: results
    };

    if (existingIndex !== -1) {
      history[existingIndex] = entry;
    } else {
      history.unshift(entry);
    }

    if (history.length > 100) history.pop();
    await this.saveHistory(history);
    return this.updateView();
  },

  async clearHistory() {
    await this.saveHistory([]);
    return this.updateView();
  },

  async updateView() {
    try {
      const history = await this.getHistory();
      const historyList = document.querySelector('.history-list');
      
      if (!historyList) return;
      
      if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No scan history yet</div>';
        return;
      }

      historyList.innerHTML = history.map(entry => `
        <div class="history-item" data-url="${entry.url}">
          <div class="history-item-header">
            ${new Date(entry.timestamp).toLocaleString()}
          </div>
          <div class="history-item-url">${entry.url}</div>
          <div class="history-item-stats">
            Files: ${entry.fileCount} | Size: ${formatFileSize(entry.totalSize)}
          </div>
          <div class="history-item-actions">
            <button class="history-action-btn" data-action="rescan">Rescan</button>
            <button class="history-action-btn" data-action="playlist">Playlist</button>
          </div>
        </div>
      `).join('');

      this.attachEventHandlers(history);
    } catch (error) {
      console.error('History view update error:', error);
    }
  },

  attachEventHandlers(history) {
    document.querySelectorAll('.history-item').forEach(item => {
      const url = item.dataset.url;
      const historyEntry = history.find(h => h.url === url);

      item.querySelector('.history-item-url').addEventListener('click', () => {
        window.open(url, '_blank');
      });

      item.querySelector('[data-action="rescan"]').addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url }, function(tab) {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              chrome.tabs.sendMessage(tabId, {
                type: 'START_SCAN',
                settings: window.currentSettings
              });
            }
          });
        });
      });

      if (historyEntry?.lastResults) {
        item.querySelector('[data-action="playlist"]').addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'generatePlaylist',
              results: historyEntry.lastResults
            });
          });
        });
      }
    });
  }
};

// Add stats management
const Stats = {
  data: {
    totalFiles: 0,
    totalSize: 0,
    scannedDirs: 0,
    qualities: {},
    types: {}
  },

  charts: {
    quality: null,
    type: null
  },

  initializeCharts() {
    // Ensure Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('Chart.js is not loaded');
      return;
    }

    // Quality distribution chart
    this.charts.quality = new Chart(
      document.getElementById('qualityChart'),
      {
        type: 'doughnut',
        data: {
          labels: ['4K', '1080p', '720p', 'Unknown'],
          datasets: [{
            data: [0, 0, 0, 0],
            backgroundColor: [
              '#ff69b4',
              '#ff1493',
              '#db7093',
              '#444444'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#fff' }
            }
          }
        }
      }
    );

    // Content type chart
    this.charts.type = new Chart(
      document.getElementById('typeChart'),
      {
        type: 'doughnut',
        data: {
          labels: ['Movies', 'TV', 'Anime', 'Other'],
          datasets: [{
            data: [0, 0, 0, 0],
            backgroundColor: [
              '#ff69b4',
              '#ff1493',
              '#db7093',
              '#444444'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#fff' }
            }
          }
        }
      }
    );
  },

  updateStats(results) {
    this.data.totalFiles = results.length;
    this.data.totalSize = results.reduce((sum, file) => sum + (file.size || 0), 0);
    
    // Update UI
    document.getElementById('totalFiles').textContent = this.data.totalFiles;
    document.getElementById('totalSize').textContent = formatFileSize(this.data.totalSize);
    
    // Update charts
    this.updateCharts(results);
  },

  updateCharts(results) {
    // Calculate quality distribution
    const qualities = { '4K': 0, '1080p': 0, '720p': 0, 'Unknown': 0 };
    const types = { 'Movies': 0, 'TV': 0, 'Anime': 0, 'Other': 0 };

    results.forEach(file => {
      qualities[file.quality] = (qualities[file.quality] || 0) + 1;
      types[file.type] = (types[file.type] || 0) + 1;
    });

    // Update charts
    this.charts.quality.data.datasets[0].data = Object.values(qualities);
    this.charts.type.data.datasets[0].data = Object.values(types);
    
    this.charts.quality.update();
    this.charts.type.update();
  },

  updateProgress(current, total) {
    const progress = (current / total) * 100;
    document.querySelector('.progress-fill').style.width = `${progress}%`;
    document.getElementById('scanProgress').textContent = `${current}/${total}`;
  }
};

// Start DOM content loaded handler
document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  const startScanButton = document.getElementById('startScan');
  const generatePlaylistButton = document.getElementById('generatePlaylist');
  const resultsContainer = document.getElementById('results');
  const scanDepthInput = document.getElementById('scanDepth');
  const recursiveScanCheckbox = document.getElementById('recursiveScan');
  const contentTypeSelect = document.getElementById('contentType');
  const qualitySelect = document.getElementById('quality');

  // Initialize scan settings from storage
  chrome.storage.sync.get(['scanDepth', 'recursiveScan'], function(items) {
    if (items.scanDepth) scanDepthInput.value = items.scanDepth;
    if (items.recursiveScan !== undefined) recursiveScanCheckbox.checked = items.recursiveScan;
  });

  // Save settings when changed
  function saveSettings() {
    chrome.storage.sync.set({
      scanDepth: scanDepthInput.value,
      recursiveScan: recursiveScanCheckbox.checked
    });
  }

  scanDepthInput.addEventListener('change', saveSettings);
  recursiveScanCheckbox.addEventListener('change', saveSettings);

  // Store current settings globally for rescan operations
  window.currentSettings = {
    depth: scanDepthInput.value,
    recursive: recursiveScanCheckbox.checked,
    contentType: contentTypeSelect.value,
    quality: qualitySelect.value
  };

  // Update settings when changed
  function updateSettings() {
    window.currentSettings = {
      depth: scanDepthInput.value,
      recursive: recursiveScanCheckbox.checked,
      contentType: contentTypeSelect.value,
      quality: qualitySelect.value
    };
  }

  // Add settings change listeners
  [scanDepthInput, recursiveScanCheckbox, contentTypeSelect, qualitySelect].forEach(el => {
    el.addEventListener('change', updateSettings);
  });

  // Update scan button handler
  const initializeScanButton = () => {
    const button = document.getElementById('startScan');
    
    button.addEventListener('click', () => {
      document.getElementById('consoleOutput').innerHTML = '';
      logToConsole('Checking page compatibility...', 'info');
      
      chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
        if (!tabs[0]?.url) {
          logToConsole('No valid page found to scan.', 'error');
          return;
        }

        // Check URL before attempting scan
        if (tabs[0].url.startsWith('chrome://') || 
            tabs[0].url.startsWith('edge://') || 
            tabs[0].url.startsWith('about:') ||
            tabs[0].url.startsWith('chrome-extension://')) {
          logToConsole('Cannot scan browser pages. Please navigate to a website with video files.', 'error');
          return;
        }

        logToConsole('Initializing scan...', 'info');
        chrome.runtime.sendMessage({
          type: 'SCAN_START',
          settings: {
            depth: scanDepthInput.value,
            recursive: recursiveScanCheckbox.checked,
            contentType: contentTypeSelect.value,
            quality: qualitySelect.value
          }
        });
      });
    });

    return button;
  };

  // Initialize the scan button
  initializeScanButton();

  // Update playlist button handler
  generatePlaylistButton.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'generatePlaylist'
      }, response => {
        if (chrome.runtime.lastError || response?.status === 'ERROR') {
          logToConsole(response?.error || 'Failed to generate playlist', 'error');
        } else {
          logToConsole('Playlist generated successfully', 'success');
        }
      });
    });
  });

  // Listen for scan results from content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'scanResults') {
      displayResults(request.results);
    }
  });

  function displayResults(results) {
    if (!results || !Array.isArray(results)) {
      logToConsole('No valid results received', 'warning');
      return;
    }

    resultsContainer.innerHTML = '';
    if (results.length === 0) {
      logToConsole('No video files found', 'info');
      return;
    }

    results.forEach(result => {
      const resultElement = document.createElement('div');
      resultElement.classList.add('result-item');
      resultElement.innerHTML = `
        <div class="result-title">${result.title || 'Untitled'}</div>
        <div class="result-info">
          <span>${result.type || 'Unknown'}</span>
          <span>${result.quality || 'Unknown'}</span>
          <span>${result.size ? formatFileSize(result.size) : 'Unknown'}</span>
        </div>
      `;
      resultsContainer.appendChild(resultElement);
    });

    logToConsole(`Found ${results.length} video files`, 'success');

    // Add to history using HistoryManager
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]?.url) {
        HistoryManager.addEntry(tabs[0].url, results);
      }
    });

    // Switch to results tab
    document.querySelector('[data-tab="results"]').click();

    // Update stats
    Stats.updateStats(results);
  }

  // Console logging utility
  function logToConsole(message, type = 'info', details = null) {
    const consoleOutput = document.getElementById('consoleOutput');
    const messageElement = document.createElement('div');
    messageElement.className = `console-message ${type}`;
    
    // Add timestamp
    const timestamp = new Date().toLocaleTimeString();
    const messageText = `[${timestamp}] ${message}`;
    
    messageElement.textContent = messageText;
    
    // Add details if present
    if (details) {
      const detailsElement = document.createElement('div');
      detailsElement.className = 'console-details';
      detailsElement.textContent = JSON.stringify(details, null, 2);
      messageElement.appendChild(detailsElement);
    }
    
    consoleOutput.appendChild(messageElement);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    // Switch to console tab on error
    if (type === 'error') {
      document.querySelector('[data-tab="console"]').click();
    }
  }

  // Clear console
  document.getElementById('clearConsole').addEventListener('click', () => {
    document.getElementById('consoleOutput').innerHTML = '';
  });

  // Message queue to prevent duplicates
  let messageQueue = new Set();

  // Single message listener for all message types
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Generate unique message ID
    const messageId = `${message.type}-${message.data || message.error || ''}-${Date.now()}`;
    
    if (messageQueue.has(messageId)) return true;
    messageQueue.add(messageId);
    setTimeout(() => messageQueue.delete(messageId), 100);

    switch (message.type) {
      case 'SCAN_PROGRESS':
        logToConsole(message.data, 'info');
        break;
      case 'SCAN_COMPLETE':
        logToConsole('Scan complete!', 'success');
        if (message.results) {
          displayResults(message.results);
        }
        break;
      case 'SCAN_ERROR':
        logToConsole(message.error, 'error', message.details);
        break;
      case 'scanResults':
        if (message.results) {
          displayResults(message.results);
        }
        break;
    }
    return true;
  });

  // Remove any duplicate message listeners
  const oldListeners = chrome.runtime.onMessage.hasListeners();
  if (oldListeners) {
    chrome.runtime.onMessage.removeListener();
  }

  // Add tab switching functionality
  function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const historyTab = document.querySelector('[data-tab="history"]');
    const clearHistoryBtn = document.getElementById('clearHistory');

    if (tabButtons) {
      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
          
          button.classList.add('active');
          const targetPane = document.getElementById(button.dataset.tab);
          if (targetPane) {
            targetPane.classList.add('active');
            // Refresh history view when switching to history tab
            if (button.dataset.tab === 'history') {
              HistoryManager.updateView();
            }
          }
        });
      });
    }

    // Initialize clear history button
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all scan history?')) {
          HistoryManager.clearHistory();
        }
      });
    }
  }

  // Initialize UI components
  function initializeUI() {
    try {
      initializeScanButton();
      initializeTabs();
      
      // Initialize history
      HistoryManager.updateView();
      
      // Update clear history handler
      const clearHistoryBtn = document.getElementById('clearHistory');
      if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to clear all scan history?')) {
            HistoryManager.clearHistory();
            logToConsole('Scan history cleared', 'info');
          }
        });
      }

      // Initialize history tab click handler
      const historyTab = document.querySelector('[data-tab="history"]');
      if (historyTab) {
        historyTab.addEventListener('click', () => HistoryManager.updateView());
      }

      // Initialize generate playlist button
      const generatePlaylistButton = document.getElementById('generatePlaylist');
      if (generatePlaylistButton) {
        generatePlaylistButton.addEventListener('click', function() {
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'generatePlaylist'
            }, response => {
              if (chrome.runtime.lastError || response?.status === 'ERROR') {
                logToConsole(response?.error || 'Failed to generate playlist', 'error');
              } else {
                logToConsole('Playlist generated successfully', 'success');
              }
            });
          });
        });
      }

      // Initialize charts
      Stats.initializeCharts();

    } catch (error) {
      console.error('UI initialization error:', error);
      // Add visual feedback for initialization error
      const container = document.querySelector('.container');
      if (container) {
        container.innerHTML = `
          <div class="error-message">
            Failed to initialize UI components. Please try reloading the extension.
            <br>Error: ${error.message}
          </div>
        `;
      }
    }
  }

  // Start initialization
  initializeUI();

  // Remove tree view functionality and related event listeners
  const renderTreeView = null; // Remove function
  
  // Update message listener to remove tree handling
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ...existing message handling...
    
    // Remove tree-related message handling
    if (message.type === 'DIRECTORY_TREE') {
      return true;
    }
    return true;
  });

  // Remove tree tab click handler
  // Remove this section:
  // document.querySelector('[data-tab="tree"]').addEventListener('click', () => { ... });

  // Initialize history view
  document.querySelector('[data-tab="history"]').addEventListener('click', () => HistoryManager.updateView());
  HistoryManager.updateView(); // Show initial history

});
