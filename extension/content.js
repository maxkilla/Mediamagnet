// Content script for MediaMagnet

// Global state (single declaration)
const MediaMagnetState = {
  currentResults: [],
  visited: new Set(),
  scanning: false
};

// Helper function to detect video files from links
function isVideoFile(url) {
  // Video extensions to check for
  const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg'];
  
  // Clean and decode the URL
  const decodedUrl = decodeURIComponent(url).toLowerCase();
  const filename = decodedUrl.split('/').pop();
  
  // Check for video extensions
  if (videoExtensions.some(ext => decodedUrl.endsWith(ext))) {
    return true;
  }

  // Check for content-type in link attributes if available
  const contentType = url.getAttribute?.('type') || '';
  if (contentType.startsWith('video/')) {
    return true;
  }

  // Additional checks for numbered files
  const hasVideoExtension = videoExtensions.some(ext => {
    const extIndex = decodedUrl.lastIndexOf(ext);
    if (extIndex === -1) return false;
    
    // Check if there's content before the extension
    const beforeExt = decodedUrl.substring(0, extIndex);
    return beforeExt.length > 0;
  });

  // Check for number-only filenames with video extensions
  const isNumberedVideo = /\/\d+\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg)$/i.test(decodedUrl);

  return hasVideoExtension || isNumberedVideo;
}

// Function to parse file size from text
function parseFileSize(text) {
  if (!text) return null;
  
  // Handle more size formats
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|B|K|M|G)/i);
  if (!sizeMatch) {
    // Try to find any numbers followed by size units
    const altMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:KB|MB|GB|B|K|M|G)/i);
    if (altMatch) return parseFloat(altMatch[1]) * 1024 * 1024; // Assume MB if unclear
    return null;
  }
  
  const [, size, unit] = sizeMatch;
  const sizeNum = parseFloat(size);
  
  switch (unit.toUpperCase()) {
    case 'B': return sizeNum;
    case 'K':
    case 'KB': return sizeNum * 1024;
    case 'M':
    case 'MB': return sizeNum * 1024 * 1024;
    case 'G':
    case 'GB': return sizeNum * 1024 * 1024 * 1024;
    default: return null;
  }
}

// Function to detect video quality from filename
function detectQuality(filename) {
  const patterns = {
    '4K': [/2160p/i, /4k/i, /uhd/i],
    '1080p': [/1080p/i, /1920x1080/i, /full.?hd/i],
    '720p': [/720p/i, /1280x720/i, /hd/i],
    '480p': [/480p/i, /854x480/i, /sd/i]
  };

  for (const [quality, tests] of Object.entries(patterns)) {
    if (tests.some(pattern => pattern.test(filename))) {
      return quality;
    }
  }

  // Try to detect from numbers in filename
  const resMatch = filename.match(/\d{3,4}x\d{3,4}/i);
  if (resMatch) {
    const height = parseInt(resMatch[0].split('x')[1]);
    if (height >= 2160) return '4K';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    return '480p';
  }

  return 'Unknown';
}

// Add recursive scanning helper
async function scanRecursively(baseUrl, depth, maxDepth) {
  if (depth > maxDepth || MediaMagnetState.visited.has(baseUrl)) return [];
  MediaMagnetState.visited.add(baseUrl);

  try {
    const response = await fetch(baseUrl);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    const results = [];

    // Send progress update
    chrome.runtime.sendMessage({
      type: 'SCAN_PROGRESS',
      data: `Scanning: ${baseUrl} (Depth: ${depth}/${maxDepth})`
    });

    // Scan for video files in current directory
    const links = doc.getElementsByTagName('a');
    for (const link of links) {
      const url = new URL(link.href, baseUrl).href;
      
      if (isVideoFile(url)) {
        const filename = link.textContent.trim();
        const parentText = link.parentElement?.textContent || '';
        const size = parseFileSize(parentText);
        const quality = detectQuality(filename);

        // Skip files that don't meet size requirement
        if (size !== null) {
          results.push({
            title: filename,
            url: url,
            size: size,
            quality: quality,
            type: 'Unknown'
          });
        }
      }
      // Check if it's a directory link
      else if (url.endsWith('/') && !url.includes('..')) {
        // Recursively scan subdirectories
        const subResults = await scanRecursively(url, depth + 1, maxDepth);
        results.push(...subResults);
      }
    }

    return results;
  } catch (error) {
    console.error(`Error scanning ${baseUrl}:`, error);
    return [];
  }
}

// Add directory tree building function
async function buildDirectoryTree(baseUrl, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return null;
  
  try {
    const response = await fetch(baseUrl);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    
    const tree = {
      name: baseUrl.split('/').filter(Boolean).pop() || baseUrl,
      path: baseUrl,
      type: 'directory',
      children: [],
      files: []
    };

    const links = doc.getElementsByTagName('a');
    for (const link of links) {
      const url = new URL(link.href, baseUrl).href;
      const name = link.textContent.trim();

      if (url.endsWith('/') && !url.includes('..') && url !== baseUrl) {
        const subtree = await buildDirectoryTree(url, depth + 1, maxDepth);
        if (subtree) tree.children.push(subtree);
      } else if (isVideoFile(url)) {
        tree.files.push({
          name,
          path: url,
          type: 'video',
          size: parseFileSize(link.parentElement?.textContent || ''),
          quality: detectQuality(name)
        });
      }
    }

    return tree;
  } catch (error) {
    console.error(`Error building tree for ${baseUrl}:`, error);
    return null;
  }
}

// Update main scanning function
async function scanDirectory(settings) {
  try {
    // Reset state for new scan
    MediaMagnetState.currentResults = [];
    MediaMagnetState.visited.clear();
    MediaMagnetState.scanning = true;

    chrome.runtime.sendMessage({
      type: 'SCAN_PROGRESS',
      data: 'Starting scan...'
    });

    let results = [];
    const currentUrl = window.location.href;
    const minSize = parseInt(settings.minSize) || 0;

    if (settings.recursive) {
      results = await scanRecursively(currentUrl, 1, parseInt(settings.depth) || 3);
    } else {
      // Original non-recursive scanning logic
      const links = document.getElementsByTagName('a');
      for (const link of links) {
        const url = link.href;
        if (!isVideoFile(url)) continue;

        const filename = link.textContent;
        const parentText = link.parentElement.textContent;
        const size = parseFileSize(parentText);
        
        // Skip files smaller than minimum size
        if (size === null || size < minSize) continue;

        const quality = detectQuality(filename);
        results.push({
          title: filename,
          url: url,
          size: size,
          quality: quality,
          type: 'Unknown'
        });
      }
    }

    // Filter results by size
    results = results.filter(result => result.size >= minSize);

    // Store results in state
    MediaMagnetState.currentResults = results;
    MediaMagnetState.scanning = false;

    // Send results
    chrome.runtime.sendMessage({
      type: 'SCAN_COMPLETE',
      results: results
    });

    chrome.runtime.sendMessage({
      action: 'scanResults',
      results: results
    });

    return results;
  } catch (error) {
    MediaMagnetState.scanning = false;
    chrome.runtime.sendMessage({
      type: 'SCAN_ERROR',
      error: error.message
    });
    throw error;
  }
}

// Function to generate M3U playlist
function generatePlaylist(results) {
  const playlistResults = results || MediaMagnetState.currentResults;
  if (!playlistResults || playlistResults.length === 0) {
    throw new Error('No results available for playlist generation');
  }

  let m3uContent = '#EXTM3U\n';
  playlistResults.forEach(result => {
    m3uContent += `#EXTINF:-1,${result.title}\n`;
    m3uContent += `${result.url}\n`;
  });

  // Create and download the playlist file
  const blob = new Blob([m3uContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'playlist.m3u';
  a.click();
  URL.revokeObjectURL(url);
}

// Single message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle PING immediately
  if (message.type === 'PING') {
    sendResponse({ status: 'OK' });
    return false;
  }

  // Handle scan start
  if (message.type === 'START_SCAN') {
    scanDirectory(message.settings)
      .then(() => sendResponse({ status: 'OK' }))
      .catch(error => sendResponse({ status: 'ERROR', error: error.message }));
    return true;
  }

  // Update playlist handler
  if (message.type === 'generatePlaylist' || message.action === 'generatePlaylist') {
    try {
      generatePlaylist(message.results);
      sendResponse({ status: 'OK' });
    } catch (error) {
      sendResponse({ status: 'ERROR', error: error.message });
    }
    return false;
  }

  if (message.type === 'GET_DIRECTORY_TREE') {
    buildDirectoryTree(window.location.href, 0, message.maxDepth || 3)
      .then(tree => {
        chrome.runtime.sendMessage({
          type: 'DIRECTORY_TREE',
          tree: tree
        });
        sendResponse({ status: 'OK' });
      })
      .catch(error => {
        sendResponse({ status: 'ERROR', error: error.message });
      });
    return true;
  }
});
