// ==UserScript==
// @name         MediaMagnet
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  A powerful media link finder and playlist generator
// @author       Your Name
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

/* global GM_setValue, GM_getValue, GM_addStyle, GM_download, GM_xmlhttpRequest, GM_registerMenuCommand */

/**
 * @typedef {Object} Video
 * @property {string} url - URL of the video
 * @property {string} filename - Filename of the video
 * @property {string} path - Path of the video
 * @property {number|null} size - Size of the video in bytes
 * @property {string} quality - Quality of the video (e.g., '1080p', '720p')
 * @property {string} type - Type of video (e.g., 'movie', 'tv')
 * @property {string} year - Release year
 * @property {string} [title] - Optional title of the video
 * @property {number|null} [season] - Optional season number
 * @property {number|null} [episode] - Optional episode number
 */

/**
 * @typedef {Object} KeyboardShortcut
 * @property {string} key - Key combination (e.g., 'Ctrl+M')
 * @property {string} description - Description of what the shortcut does
 * @property {() => void} action - Function to execute when shortcut is triggered
 */

/**
 * @typedef {Object} UIElements
 * @property {HTMLElement|null} container - Main container element
 * @property {HTMLButtonElement|null} scanBtn - Scan button
 * @property {HTMLButtonElement|null} generateBtn - Generate playlist button
 * @property {HTMLButtonElement|null} clearBtn - Clear results button
 * @property {HTMLButtonElement|null} exportBtn - Export settings button
 * @property {HTMLButtonElement|null} importBtn - Import settings button
 * @property {HTMLInputElement|null} recursiveCheckbox - Recursive scan checkbox
 * @property {HTMLInputElement|null} skipExternalCheckbox - Skip external links checkbox
 * @property {HTMLInputElement|null} maxDepthInput - Maximum scan depth input
 * @property {HTMLElement|null} console - Console element
 * @property {HTMLElement|null} results - Results container
 */

/**
 * @typedef {Object} UIState
 * @property {UIElements} elements - UI elements
 * @property {number} [containerHeight] - Container height
 * @property {number} [scrollPosition] - Current scroll position
 * @property {ResizeObserver} [resizeObserver] - Resize observer instance
 */

/**
 * @typedef {Object} SearchOptions
 * @property {boolean} recursive - Whether to search recursively
 * @property {number} maxDepth - Maximum search depth
 * @property {boolean} skipExternal - Whether to skip external links
 */

/**
 * @typedef {Object} Store
 * @property {Video[]} videos - List of found videos
 * @property {boolean} scanning - Whether a scan is in progress
 * @property {number} retryCount - Number of retry attempts
 * @property {number} maxRetries - Maximum number of retries
 * @property {number} timeoutMs - Timeout in milliseconds
 * @property {Object} loading - Loading states
 * @property {boolean} loading.scan - Whether scan is loading
 * @property {boolean} loading.import - Whether import is loading
 * @property {boolean} loading.export - Whether export is loading
 * @property {boolean} dragOver - Whether dragging over container
 * @property {Object} filters - Filter states
 * @property {string} filters.quality - Quality filter
 * @property {string} filters.type - Type filter
 * @property {number} filters.minSize - Minimum size filter
 * @property {number} filters.maxSize - Maximum size filter
 * @property {string} filters.searchTerm - Search term filter
 * @property {string} filters.year - Year filter
 * @property {string} filters.hasEpisode - Episode filter
 * @property {SearchOptions} searchOptions - Search options
 * @property {UIState} ui - UI state
 * @property {string} [sortBy] - Sort field
 * @property {string} [sortOrder] - Sort order
 * @property {string[]} [errors] - Error messages
 */

/** @type {Store} */
const initialState = {
    videos: [],
    scanning: false,
    retryCount: 0,
    maxRetries: 3,
    timeoutMs: 5000,
    loading: {
        scan: false,
        import: false,
        export: false
    },
    dragOver: false,
    filters: {
        quality: 'all',
        type: 'all',
        minSize: 0,
        maxSize: Infinity,
        searchTerm: '',
        year: 'all',
        hasEpisode: 'all'
    },
    searchOptions: {
        recursive: true,
        maxDepth: 10,
        skipExternal: true
    },
    ui: {
        elements: /** @type {UIElements} */ ({
            container: null,
            scanBtn: null,
            generateBtn: null,
            clearBtn: null,
            exportBtn: null,
            importBtn: null,
            recursiveCheckbox: null,
            skipExternalCheckbox: null,
            maxDepthInput: null,
            console: null,
            results: null
        }),
        shortcuts: [
            { key: 'M', ctrlKey: true, shiftKey: false, description: 'Toggle interface' },
            { key: 'F', ctrlKey: true, shiftKey: false, description: 'Focus search' },
            { key: 'S', ctrlKey: true, shiftKey: false, description: 'Start scan' },
            { key: 'L', ctrlKey: true, shiftKey: false, description: 'Clear results' },
            { key: 'E', ctrlKey: true, shiftKey: true, description: 'Export settings' },
            { key: 'I', ctrlKey: true, shiftKey: true, description: 'Import settings' }
        ]
    },
    sortBy: 'name',
    sortOrder: 'asc',
    errors: [],
    queuedLogs: []
};

/**
 * Creates a store for state management
 * @param {Store} initialState - Initial state
 * @returns {Store} Store instance
 */
const createStore = (initialState) => {
    /** @type {Set<(state: Store) => void>} */
    const listeners = new Set();
    /** @type {Store} */
    let state = initialState;

    return {
        /**
         * Get current state
         * @returns {Store} Current state
         */
        getState: () => state,

        /**
         * Update state
         * @param {Partial<Store>} newState - New state to merge
         */
        setState: (newState) => {
            state = { ...state, ...newState };
            listeners.forEach(listener => listener(state));
        },

        /**
         * Subscribe to state changes
         * @param {(state: Store) => void} listener - State change listener
         * @returns {() => void} Unsubscribe function
         */
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
};

// Create store with initial state
const store = createStore(initialState);

// Subscribe to state changes for UI updates
store.subscribe((state) => {
    updateResults();
    updateButtons();
    updateStats();
    updateLoadingUI();
    savePreferences();
    processQueuedLogs();
});

(function() {
    'use strict';

    // Constants
    const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'm4v', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'mpg'];
    const QUALITY_PATTERNS = {
        '4K': /\b(4k|2160p|uhd)\b/i,
        '1080p': /\b(1080p|1080i|fhd)\b/i,
        '720p': /\b(720p|720i|hd)\b/i,
        '480p': /\b(480p|480i|sd)\b/i
    };
    const SIZE_UNITS = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024
    };

    // Smart filename parsing
    function parseFilename(filename) {
        // Remove extension
        const name = filename.replace(/\.[^/.]+$/, '');
        
        // Detect quality
        let quality = 'Unknown';
        for (const [q, pattern] of Object.entries(QUALITY_PATTERNS)) {
            if (pattern.test(name)) {
                quality = q;
                break;
            }
        }

        // Extract year if present
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : null;

        // Extract season/episode if present
        const episodeMatch = name.match(/S(\d{1,2})E(\d{1,2})/i);
        const season = episodeMatch ? parseInt(episodeMatch[1]) : null;
        const episode = episodeMatch ? parseInt(episodeMatch[2]) : null;

        // Clean title
        let title = name
            .replace(/\b(19|20)\d{2}\b/, '') // Remove year
            .replace(/S\d{1,2}E\d{1,2}/i, '') // Remove episode info
            .replace(/\b(4k|2160p|1080p|720p|480p|uhd|fhd|hd|sd)\b/i, '') // Remove quality
            .replace(/\b(x264|x265|hevc|aac|ac3)\b/i, '') // Remove codec info
            .replace(/[._-]/g, ' ') // Replace separators with spaces
            .replace(/\s+/g, ' ') // Remove multiple spaces
            .trim();

        return {
            title,
            year,
            season,
            episode,
            quality
        };
    }

    // Utility Functions
    function log(message, type = 'info') {
        try {
            // Get console element from store
            const state = store.getState();
            const consoleElement = state?.ui?.elements?.console;
            
            // If console element doesn't exist yet, queue the message
            if (!consoleElement) {
                const queuedLogs = state.queuedLogs || [];
                updateState({ queuedLogs: [...queuedLogs, { message, type, timestamp: new Date() }] });
                return;
            }

            // Create log entry
            const timestamp = new Date().toLocaleTimeString();
            const entry = document.createElement('div');
            entry.className = `mm-log-entry mm-log-${type}`;
            entry.textContent = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
            
            // Safely append entry
            if (consoleElement instanceof HTMLElement) {
                consoleElement.appendChild(entry);
                consoleElement.scrollTop = consoleElement.scrollHeight;

                // Keep only last 1000 log entries
                while (consoleElement.children.length > 1000) {
                    consoleElement.removeChild(consoleElement.firstChild);
                }
            }
        } catch (error) {
            console.error('Logging error:', error.message);
        }
    }

    // Process any queued logs after console is initialized
    function processQueuedLogs() {
        const state = store.getState();
        const queuedLogs = state.queuedLogs || [];
        
        if (queuedLogs.length > 0 && state?.ui?.elements?.console) {
            queuedLogs.forEach(({ message, type, timestamp }) => {
                log(message, type);
            });
            updateState({ queuedLogs: [] });
        }
    }

    // Cache frequently accessed DOM elements
    function cacheElements() {
        const elements = /** @type {UIElements} */ ({
            container: document.getElementById('mm-container'),
            console: document.getElementById('mm-console'),
            results: document.getElementById('mm-results'),
            totalCount: document.getElementById('mm-total-count'),
            filteredCount: document.getElementById('mm-filtered-count'),
            totalSize: document.getElementById('mm-total-size'),
            searchInput: document.getElementById('mm-search'),
            qualityFilter: document.getElementById('mm-quality-filter'),
            typeFilter: document.getElementById('mm-type-filter'),
            yearFilter: document.getElementById('mm-year-filter'),
            sortBy: document.getElementById('mm-sort-by'),
            sortOrder: document.getElementById('mm-sort-order'),
            scanBtn: document.getElementById('mm-scan-btn'),
            generateBtn: document.getElementById('mm-generate-btn'),
            clearBtn: document.getElementById('mm-clear-btn')
        });

        updateState({ ui: { elements } });
        return elements;
    }

    // Initialize ResizeObserver for dynamic UI updates
    function initializeResizeObserver() {
        if (store.getState().ui.resizeObserver) {
            store.getState().ui.resizeObserver.disconnect();
        }

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                updateUILayout(entry.contentRect);
            }
        });

        if (store.getState().ui.elements.container) {
            resizeObserver.observe(store.getState().ui.elements.container);
        }

        updateState({ ui: { resizeObserver } });
    }

    // Update UI layout based on container size
    function updateUILayout(contentRect) {
        updateState({
            ui: {
                containerHeight: contentRect.height,
                visibleItems: Math.ceil(contentRect.height / store.getState().ui.itemHeight) + 2 // Add buffer
            }
        });
        updateResults();
    }

    // Virtual scrolling implementation
    function virtualizeResults(filtered) {
        const { scrollPosition, itemHeight, visibleItems } = store.getState().ui;
        
        // Calculate visible range
        const startIndex = Math.max(0, Math.floor(scrollPosition / itemHeight) - 1);
        const endIndex = Math.min(filtered.length, startIndex + visibleItems);
        
        // Create placeholder for total scroll height
        const totalHeight = filtered.length * itemHeight;
        const visibleItemsHtml = filtered.slice(startIndex, endIndex).map((video, index) => `
            <div class="video-item" style="position: absolute; top: ${(startIndex + index) * itemHeight}px; left: 0; right: 0;">
                <div class="video-title">
                    ${video.title}
                    ${video.year ? `<span class="video-year">(${video.year})</span>` : ''}
                    ${video.season !== null ? `<span class="video-episode">S${video.season.toString().padStart(2, '0')}E${video.episode.toString().padStart(2, '0')}</span>` : ''}
                </div>
                <div class="video-meta">
                    <span class="video-quality">${video.quality}</span>
                    <span class="video-size">${formatFileSize(video.size)}</span>
                </div>
                <div class="video-url">${video.url}</div>
            </div>
        `).join('');
        
        // Generate HTML with proper offsets
        const html = `
            <div class="virtual-scroll-container" style="height: ${totalHeight}px; position: relative;">
                ${visibleItemsHtml}
            </div>
        `;
        
        return html;
    }

    // Throttle scroll handler
    const handleScroll = throttle((e) => {
        const container = e.target;
        updateState({ ui: { scrollPosition: container.scrollTop } });
        updateResults();
    }, 16); // ~60fps

    // Utility function for throttling
    function throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    // UI Creation
    function createInterface() {
        try {
            const state = getState();
            const container = state?.ui?.elements?.container;
            
            if (!container || !(container instanceof HTMLElement)) {
                throw new Error('Container not initialized');
            }

            // Create interface content
            const content = document.createElement('div');
            if (!content) {
                throw new Error('Failed to create content element');
            }
            content.id = 'mm-content';

            // Get shortcuts safely from store
            const shortcuts = state?.ui?.shortcuts || [];
            
            // Create shortcut HTML safely
            const shortcutHtml = Array.isArray(shortcuts) ? shortcuts.map(shortcut => {
                if (!shortcut) return '';
                const combo = [
                    shortcut.ctrlKey && 'Ctrl',
                    shortcut.shiftKey && 'Shift',
                    shortcut.key
                ].filter(Boolean).join('+');
                return `
                    <div class="mm-shortcut">
                        <span class="mm-shortcut-combo">${combo}</span>
                        <span class="mm-shortcut-desc">${shortcut.description || ''}</span>
                    </div>
                `;
            }).join('') : '';

            // Create header
            const header = document.createElement('div');
            if (!header) {
                throw new Error('Failed to create header element');
            }
            header.id = 'mm-header';
            header.innerHTML = `
                <h2>MediaMagnet</h2>
                <div id="mm-controls">
                    <button id="mm-minimize">_</button>
                    <button id="mm-close">×</button>
                </div>
            `;

            // Create main content
            content.innerHTML = `
                <div id="mm-tabs">
                    <button class="mm-tab active" data-tab="scanner">Scanner</button>
                    <button class="mm-tab" data-tab="results">Results</button>
                    <button class="mm-tab" data-tab="settings">Settings</button>
                </div>
                <div id="mm-tab-content">
                    <div id="mm-scanner-tab" class="mm-tab-pane active">
                        <div class="mm-search-box">
                            <input type="text" id="mm-search" placeholder="Search videos...">
                        </div>
                        <div class="mm-filters">
                            <div class="mm-filter-group">
                                <label>Quality:</label>
                                <select id="mm-quality-filter">
                                    <option value="all">All Qualities</option>
                                    <option value="4K">4K</option>
                                    <option value="1080p">1080p</option>
                                    <option value="720p">720p</option>
                                    <option value="480p">480p</option>
                                    <option value="Unknown">Unknown</option>
                                </select>
                            </div>
                            <div class="mm-filter-group">
                                <label>Type:</label>
                                <select id="mm-type-filter">
                                    <option value="all">All Types</option>
                                    <option value="movie">Movies</option>
                                    <option value="tv">TV Shows</option>
                                </select>
                            </div>
                            <div class="mm-filter-group">
                                <label>Year:</label>
                                <select id="mm-year-filter">
                                    <option value="all">All Years</option>
                                </select>
                            </div>
                        </div>
                        <div class="mm-filters">
                            <div class="mm-filter-group">
                                <label>Min Size:</label>
                                <div class="mm-size-input">
                                    <input type="number" id="mm-min-size" min="0" step="0.1">
                                    <select id="mm-min-size-unit">
                                        <option value="MB">MB</option>
                                        <option value="GB">GB</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mm-filter-group">
                                <label>Max Size:</label>
                                <div class="mm-size-input">
                                    <input type="number" id="mm-max-size" min="0" step="0.1">
                                    <select id="mm-max-size-unit">
                                        <option value="MB">MB</option>
                                        <option value="GB">GB</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mm-filter-group">
                                <label>Sort By:</label>
                                <div class="mm-sort-controls">
                                    <select id="mm-sort-by">
                                        <option value="name">Name</option>
                                        <option value="quality">Quality</option>
                                        <option value="size">Size</option>
                                        <option value="year">Year</option>
                                    </select>
                                    <button id="mm-sort-order" title="Toggle sort order">↓</button>
                                </div>
                            </div>
                        </div>
                        <div class="mm-button-group">
                            <button id="mm-scan-btn">Scan Directory</button>
                            <button id="mm-generate-btn" disabled>Generate M3U</button>
                            <button id="mm-clear-btn">Clear Results</button>
                        </div>
                        <div class="mm-stats">
                            <div>Total Videos: <span id="mm-total-count">0</span></div>
                            <div>Filtered: <span id="mm-filtered-count">0</span></div>
                            <div>Total Size: <span id="mm-total-size">0 MB</span></div>
                        </div>
                    </div>
                    <div id="mm-results-tab" class="mm-tab-pane">
                        <div id="mm-results"></div>
                    </div>
                    <div id="mm-settings-tab" class="mm-tab-pane">
                        <div class="mm-settings-group">
                            <h3>Search Options</h3>
                            <label class="mm-checkbox">
                                <input type="checkbox" id="mm-recursive" checked>
                                Enable recursive search
                            </label>
                            <div class="mm-setting-item">
                                <label>Maximum search depth:</label>
                                <input type="number" id="mm-max-depth" value="10" min="1" max="100">
                            </div>
                            <label class="mm-checkbox">
                                <input type="checkbox" id="mm-skip-external" checked>
                                Skip external links
                            </label>
                        </div>
                        <div class="mm-settings-group">
                            <h3>Display Options</h3>
                            <label class="mm-checkbox">
                                <input type="checkbox" id="mm-show-path" checked>
                                Show full path
                            </label>
                            <label class="mm-checkbox">
                                <input type="checkbox" id="mm-group-episodes" checked>
                                Group TV episodes
                            </label>
                        </div>
                        <div class="mm-settings-group">
                            <h3>Settings Management</h3>
                            <div class="mm-button-group">
                                <button id="mm-export-btn">Export Settings</button>
                                <button id="mm-import-btn">Import Settings</button>
                            </div>
                            <div class="mm-shortcuts-list">
                                <h4>Keyboard Shortcuts</h4>
                                ${shortcutHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Safely append elements
            if (!safeAppendChild(container, header)) {
                throw new Error('Failed to append header');
            }
            if (!safeAppendChild(container, content)) {
                throw new Error('Failed to append content');
            }

            // Create console wrapper
            const consoleWrapper = document.createElement('div');
            if (!consoleWrapper) {
                throw new Error('Failed to create console wrapper');
            }
            consoleWrapper.id = 'mm-console-wrapper';
            consoleWrapper.innerHTML = `
                <div id="mm-console-header">
                    <span>Console</span>
                    <button id="mm-console-clear">Clear</button>
                </div>
                <div id="mm-console"></div>
            `;

            // Safely append console wrapper
            if (!safeAppendChild(container, consoleWrapper)) {
                throw new Error('Failed to append console wrapper');
            }

            // Cache UI elements
            const elements = {
                container,
                console: document.getElementById('mm-console'),
                results: document.getElementById('mm-results'),
                scanBtn: document.getElementById('mm-scan-btn'),
                generateBtn: document.getElementById('mm-generate-btn'),
                clearBtn: document.getElementById('mm-clear-btn'),
                exportBtn: document.getElementById('mm-export-btn'),
                importBtn: document.getElementById('mm-import-btn'),
                recursiveCheckbox: document.getElementById('mm-recursive'),
                skipExternalCheckbox: document.getElementById('mm-skip-external'),
                maxDepthInput: document.getElementById('mm-max-depth')
            };

            // Validate critical elements
            if (!elements.console || !elements.results) {
                throw new Error('Failed to initialize critical UI elements');
            }

            // Update state with new elements
            updateState({
                ui: {
                    ...state.ui,
                    elements
                }
            });

            // Process any queued logs
            processQueuedLogs();

            log('Interface created successfully', 'success');
        } catch (error) {
            log(`Failed to create interface: ${error.message}`, 'error');
            console.error('Interface creation error:', error);
        }
    }

    // Event Listeners
    function initializeEventListeners() {
        const state = getState();
        const { elements } = state.ui;

        try {
            // Ensure container exists
            if (!elements.container || !(elements.container instanceof HTMLElement)) {
                throw new Error('Container not initialized');
            }

            // Scroll handler for virtual scrolling
            const resultsElement = elements.results;
            if (resultsElement && resultsElement instanceof HTMLElement) {
                resultsElement.addEventListener('scroll', handleScroll);
            }

            // Window controls
            const minimizeBtn = document.getElementById('mm-minimize');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => {
                    if (elements.container) {
                        elements.container.style.display = 'none';
                    }
                });
            }

            const closeBtn = document.getElementById('mm-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    if (elements.container) {
                        elements.container.remove();
                        const resizeObserver = store.getState().ui.resizeObserver;
                        if (resizeObserver instanceof ResizeObserver) {
                            resizeObserver.disconnect();
                        }
                    }
                });
            }

            // Clear console
            const clearConsoleBtn = document.getElementById('mm-console-clear');
            const consoleElement = elements.console;
            if (clearConsoleBtn && consoleElement instanceof HTMLElement) {
                clearConsoleBtn.addEventListener('click', () => {
                    consoleElement.innerHTML = '';
                });
            }

            // Tab switching
            const tabButtons = document.querySelectorAll('.mm-tab');
            tabButtons.forEach(button => {
                if (button instanceof HTMLElement) {
                    button.addEventListener('click', () => {
                        const tabId = button.dataset.tab;
                        if (!tabId) return;

                        // Remove active class from all tabs and panes
                        tabButtons.forEach(btn => btn.classList.remove('active'));
                        document.querySelectorAll('.mm-tab-pane').forEach(pane => {
                            if (pane instanceof HTMLElement) {
                                pane.classList.remove('active');
                            }
                        });

                        // Add active class to clicked tab and corresponding pane
                        button.classList.add('active');
                        const pane = document.getElementById(`mm-${tabId}-tab`);
                        if (pane) {
                            pane.classList.add('active');
                        }
                    });
                }
            });

            // Filter change handlers
            const setupFilterHandler = (id, callback) => {
                const element = document.getElementById(id);
                if (element instanceof HTMLElement) {
                    element.addEventListener('change', callback);
                }
            };

            setupFilterHandler('mm-quality-filter', updateResults);
            setupFilterHandler('mm-type-filter', updateResults);
            setupFilterHandler('mm-year-filter', updateResults);
            setupFilterHandler('mm-min-size', updateResults);
            setupFilterHandler('mm-max-size', updateResults);
            setupFilterHandler('mm-sort-by', updateResults);

            // Sort order toggle
            const sortOrderBtn = document.getElementById('mm-sort-order');
            if (sortOrderBtn) {
                sortOrderBtn.addEventListener('click', () => {
                    const state = getState();
                    const newOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
                    updateState({ sortOrder: newOrder });
                    sortOrderBtn.textContent = newOrder === 'asc' ? '↓' : '↑';
                    updateResults();
                });
            }

            // Search input
            const searchInput = document.getElementById('mm-search');
            if (searchInput instanceof HTMLInputElement) {
                const debouncedSearch = debounce(() => {
                    updateState({
                        filters: {
                            ...getState().filters,
                            searchTerm: searchInput.value
                        }
                    });
                    updateResults();
                }, 300);

                searchInput.addEventListener('input', debouncedSearch);
            }

            // Make container draggable
            makeDraggable(elements.container);

            log('Event listeners initialized', 'success');
        } catch (error) {
            log(`Failed to initialize event listeners: ${error.message}`, 'error');
            console.error('Event listener initialization error:', error);
        }
    }

    // Helper Functions
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        }
    }

    function populateYearFilter() {
        const yearSelect = /** @type {HTMLSelectElement} */ (document.getElementById('mm-year-filter'));
        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year >= 1900; year--) {
            const option = document.createElement('option');
            option.value = year.toString();
            option.textContent = year.toString();
            yearSelect.appendChild(option);
        }
    }

    async function scanDirectory(depth = 0) {
        if (store.getState().scanning) {
            log('Scan already in progress', 'warning');
            return;
        }

        try {
            updateState({ scanning: true });
            updateState({ errors: { scan: [] } });
            updateButtons();

            const frames = document.querySelectorAll('frame, iframe');
            log(`Found ${frames.length} frames to scan`);

            for (const frame of frames) {
                try {
                    if (!store.getState().searchOptions.skipExternal || isSameOrigin(frame.src)) {
                        await scanFrame(frame, depth);
                    }
                } catch (frameError) {
                    updateState({ errors: { scan: [...store.getState().errors.scan, { type: 'frame', url: frame.src, error: frameError.message }] } });
                    log(`Failed to scan frame ${frame.src}: ${frameError.message}`, 'error');
                }
            }

            // Scan the main document
            await scanDocument(document, depth);
            
            if (store.getState().errors.scan.length > 0) {
                log(`Scan completed with ${store.getState().errors.scan.length} errors`, 'warning');
            } else {
                log('Scan completed successfully');
            }

        } catch (error) {
            updateState({ errors: { scan: [...store.getState().errors.scan, { type: 'global', error: error.message }] } });
            log(`Scan failed: ${error.message}`, 'error');

            // Implement retry mechanism
            if (store.getState().retryCount < store.getState().maxRetries) {
                updateState({ retryCount: store.getState().retryCount + 1 });
                log(`Retrying scan (attempt ${store.getState().retryCount}/${store.getState().maxRetries})...`, 'warning');
                await new Promise(resolve => setTimeout(resolve, 1000 * store.getState().retryCount));
                return scanDirectory(depth);
            } else {
                log('Max retry attempts reached', 'error');
            }
        } finally {
            updateState({ scanning: false });
            updateState({ retryCount: 0 });
            updateButtons();
        }
    }

    // Fetch with timeout and error handling
    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeout = options.timeout || store.getState().timeoutMs;
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }

    // Enhanced file size fetching with retry
    async function getFileSize(url) {
        for (let attempt = 1; attempt <= store.getState().maxRetries; attempt++) {
            try {
                const response = await fetchWithTimeout(url, {
                    method: 'HEAD',
                    timeout: store.getState().timeoutMs
                });

                const size = response.headers.get('content-length');
                return size ? parseInt(size, 10) : null;
            } catch (error) {
                updateState({ errors: { network: [...store.getState().errors.network, { type: 'fileSize', url, attempt, error: error.message }] } });

                if (attempt === store.getState().maxRetries) {
                    log(`Failed to get file size for ${url}: ${error.message}`, 'error');
                    return null;
                }

                // Exponential backoff
                await new Promise(resolve => 
                    setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 5000))
                );
            }
        }
    }

    // Safe parsing with error handling
    function safeParseYear(str) {
        try {
            const year = parseInt(str.match(/\b(19|20)\d{2}\b/)?.[0]);
            return isNaN(year) ? null : year;
        } catch (error) {
            updateState({ errors: { parse: [...store.getState().errors.parse, { type: 'year', input: str, error: error.message }] } });
            return null;
        }
    }

    function safeParseEpisode(str) {
        try {
            const match = str.match(/S(\d{1,2})E(\d{1,2})/i);
            if (!match) return { season: null, episode: null };
            return {
                season: parseInt(match[1]),
                episode: parseInt(match[2])
            };
        } catch (error) {
            updateState({ errors: { parse: [...store.getState().errors.parse, { type: 'episode', input: str, error: error.message }] } });
            return { season: null, episode: null };
        }
    }

    async function scanFrame(frame, depth = 0) {
        if (depth > store.getState().searchOptions.maxDepth) return [];

        const frameDoc = frame.contentDocument || frame.contentWindow.document;
        const results = await scanDocument(frameDoc, depth + 1);
        return results;
    }

    async function scanDocument(doc, depth = 0) {
        const results = [];

        // Process links in current document
        const links = Array.from(doc.getElementsByTagName('a'));
        for (const link of links) {
            try {
                const href = link.href || link.getAttribute('href');
                if (!href) continue;

                const url = new URL(href, window.location.href);
                
                // Skip external links if option is enabled
                if (store.getState().searchOptions.skipExternal && url.host !== window.location.host) {
                    continue;
                }

                const ext = url.pathname.split('.').pop().toLowerCase();
                if (VIDEO_EXTENSIONS.includes(ext)) {
                    const filename = link.textContent.trim() || decodeURIComponent(url.pathname.split('/').pop());
                    const info = parseFilename(filename);
                    
                    let size = null;
                    try {
                        size = await getFileSize(url.href);
                    } catch (error) {
                        // Ignore size fetch errors
                    }

                    results.push({
                        url: url.href,
                        filename,
                        path: url.pathname,
                        size,
                        ...info
                    });
                }
            } catch (error) {
                continue;
            }
        }

        // Recursively process frames if recursive search is enabled
        if (store.getState().searchOptions.recursive) {
            const frames = Array.from(doc.getElementsByTagName('frame'))
                .concat(Array.from(doc.getElementsByTagName('iframe')));
            
            for (const frame of frames) {
                try {
                    const frameResults = await scanFrame(frame, depth);
                    results.push(...frameResults);
                } catch (error) {
                    // Skip inaccessible frames
                    continue;
                }
            }
        }

        return results;
    }

    async function generateM3U() {
        try {
            log('Generating M3U playlist...');
            
            const content = ['#EXTM3U'];
            store.getState().videos.forEach(video => {
                content.push(`#EXTINF:-1,${video.filename}`);
                content.push(video.url);
            });

            const blob = new Blob([content.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'playlist.m3u';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            log('Playlist generated successfully', 'success');
        } catch (error) {
            log(`M3U generation error: ${error.message}`, 'error');
        }
    }

    // Helper Functions
    function formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    function updateStats() {
        const { elements } = store.getState().ui;
        const totalCount = elements.totalCount;
        const totalSize = elements.totalSize;
        const filteredCount = elements.filteredCount;

        if (totalCount) totalCount.textContent = store.getState().videos.length;
        if (totalSize) {
            const bytes = store.getState().videos.reduce((sum, video) => sum + (video.size || 0), 0);
            totalSize.textContent = formatFileSize(bytes);
        }
        if (filteredCount) {
            const filtered = getFilteredAndSortedVideos();
            filteredCount.textContent = filtered.length;
        }
    }

    function getFilteredAndSortedVideos() {
        let filtered = store.getState().videos;

        // Apply text search
        if (store.getState().filters.searchTerm) {
            const terms = store.getState().filters.searchTerm.split(' ').filter(t => t);
            filtered = filtered.filter(video => 
                terms.every(term => 
                    video.title.toLowerCase().includes(term) ||
                    video.filename.toLowerCase().includes(term)
                )
            );
        }

        // Apply quality filter
        if (store.getState().filters.quality !== 'all') {
            filtered = filtered.filter(video => video.quality === store.getState().filters.quality);
        }

        // Apply type filter
        if (store.getState().filters.type !== 'all') {
            filtered = filtered.filter(video => 
                store.getState().filters.type === 'tv' ? video.season !== null : video.season === null
            );
        }

        // Apply year filter
        if (store.getState().filters.year !== 'all') {
            filtered = filtered.filter(video => video.year === store.getState().filters.year);
        }

        // Apply size filters
        filtered = filtered.filter(video => {
            const size = video.size || 0;
            return size >= store.getState().filters.minSize && size <= store.getState().filters.maxSize;
        });

        // Apply sorting
        filtered.sort((a, b) => {
            let comparison = 0;
            switch (store.getState().sortBy) {
                case 'name':
                    comparison = a.title.localeCompare(b.title);
                    break;
                case 'quality':
                    const qualityOrder = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
                    comparison = qualityOrder[b.quality] - qualityOrder[a.quality];
                    break;
                case 'size':
                    comparison = (b.size || 0) - (a.size || 0);
                    break;
                case 'year':
                    comparison = (b.year || 0) - (a.year || 0);
                    break;
            }
            return store.getState().sortOrder === 'asc' ? comparison : -comparison;
        });

        return filtered;
    }

    // UI Updates
    function updateButtons() {
        const { elements } = store.getState().ui;
        const scanBtn = elements.scanBtn;
        const generateBtn = elements.generateBtn;

        if (scanBtn) scanBtn.disabled = store.getState().scanning;
        if (generateBtn) generateBtn.disabled = store.getState().videos.length === 0;
    }

    // Draggable Functionality
    function makeDraggable(element) {
        const header = element.querySelector('#mm-header');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            
            if (e.target === header) {
                isDragging = true;
            }
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                element.style.transform = `translate(${currentX}px, ${currentY}px)`;
            }
        }

        function dragEnd() {
            isDragging = false;
        }
    }

    // Loading indicator management
    function showLoading(operation) {
        updateState({ loading: { ...getState().loading, [operation]: true } });
        updateLoadingUI();
    }

    function hideLoading(operation) {
        updateState({ loading: { ...getState().loading, [operation]: false } });
        updateLoadingUI();
    }

    function updateLoadingUI() {
        const state = getState();
        const { elements } = state.ui;
        
        // Update loading spinners
        Object.entries(state.loading).forEach(([operation, isLoading]) => {
            const button = elements[`${operation}Btn`];
            if (button instanceof HTMLButtonElement) {
                if (isLoading) {
                    button.classList.add('loading');
                    button.disabled = true;
                } else {
                    button.classList.remove('loading');
                    button.disabled = false;
                }
            }
        });

        // Update main loading overlay
        const container = elements.container;
        if (!(container instanceof HTMLElement)) return;

        let overlay = container.querySelector('.mm-loading-overlay');
        if (Object.values(state.loading).some(Boolean)) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'mm-loading-overlay';
                overlay.innerHTML = `
                    <div class="mm-loader"></div>
                    <div class="mm-loading-text">Processing...</div>
                `;
                container.appendChild(overlay);
            }
        } else if (overlay) {
            overlay.remove();
        }
    }

    // Tooltip management
    function addTooltips() {
        const tooltips = {
            'mm-scan-btn': 'Start scanning for media files',
            'mm-generate-btn': 'Generate M3U playlist from found media',
            'mm-clear-btn': 'Clear all found media',
            'mm-export-btn': 'Export current settings',
            'mm-import-btn': 'Import settings from file',
            'mm-recursive': 'Enable recursive directory scanning',
            'mm-skip-external': 'Skip external links during scan',
            'mm-show-path': 'Show full file paths in results',
            'mm-group-episodes': 'Group TV show episodes together',
            'mm-sort-order': 'Toggle sort order (ascending/descending)',
            'mm-quality-filter': 'Filter results by video quality',
            'mm-type-filter': 'Filter results by media type',
            'mm-year-filter': 'Filter results by release year',
            'mm-search': 'Search within found media',
            'mm-minimize': 'Minimize MediaMagnet window',
            'mm-close': 'Close MediaMagnet window'
        };

        // Create a single tooltip element to be reused
        const tooltip = document.createElement('div');
        tooltip.className = 'mm-tooltip';
        tooltip.style.position = 'fixed';
        tooltip.style.display = 'none';
        tooltip.style.zIndex = '10000';
        
        // Add tooltip to document only once
        document.body.appendChild(tooltip);
        
        // Track current element being hovered
        let currentElement = null;
        let hideTimeout = null;

        Object.entries(tooltips).forEach(([id, text]) => {
            const element = document.getElementById(id);
            if (!element) return;

            // Set accessibility attributes
            element.setAttribute('title', text);
            element.setAttribute('aria-label', text);
            
            const showTooltip = (e) => {
                try {
                    // Clear any existing hide timeout
                    if (hideTimeout) {
                        clearTimeout(hideTimeout);
                        hideTimeout = null;
                    }

                    currentElement = element;
                    const rect = element.getBoundingClientRect();
                    
                    // Position tooltip
                    tooltip.style.display = 'block';
                    tooltip.textContent = text;
                    
                    // Calculate position
                    const tooltipRect = tooltip.getBoundingClientRect();
                    const top = rect.bottom + 5;
                    const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                    
                    // Ensure tooltip stays within viewport
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    
                    tooltip.style.top = `${Math.min(Math.max(0, top), viewportHeight - tooltipRect.height)}px`;
                    tooltip.style.left = `${Math.min(Math.max(0, left), viewportWidth - tooltipRect.width)}px`;
                } catch (error) {
                    console.error('Error showing tooltip:', error);
                }
            };
            
            const hideTooltip = () => {
                if (currentElement === element) {
                    hideTimeout = setTimeout(() => {
                        tooltip.style.display = 'none';
                        currentElement = null;
                    }, 100); // Small delay to handle gap between elements
                }
            };

            // Add event listeners
            element.addEventListener('mouseenter', showTooltip);
            element.addEventListener('mouseleave', hideTooltip);
            element.addEventListener('focus', showTooltip);
            element.addEventListener('blur', hideTooltip);
        });
    }

    // Add tooltip styles
    GM_addStyle(`
        .mm-tooltip {
            position: fixed;
            background: var(--bg-tertiary);
            color: var(--text-color);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            transform: translateX(-50%);
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-color);
            max-width: 200px;
            white-space: normal;
        }
        
        .mm-tooltip::before {
            content: '';
            position: absolute;
            top: -5px;
            left: 50%;
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-bottom-color: var(--border-color);
        }
    `);

    // Styles
    GM_addStyle(`
        :root {
            --bg-primary: rgba(18, 18, 18, 0.95);
            --bg-secondary: rgba(28, 28, 28, 0.95);
            --bg-tertiary: rgba(35, 35, 35, 0.95);
            --accent: #ff69b4;
            --accent-dark: #d44a91;
            --text-primary: #ffffff;
            --text-secondary: #b0b0b0;
            --border-color: rgba(255, 255, 255, 0.1);
            --hover-bg: rgba(255, 105, 180, 0.1);
        }

        #mm-launcher {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            background: var(--accent);
            border-radius: 50%;
            cursor: pointer;
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(255, 105, 180, 0.3);
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }

        #mm-launcher:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(255, 105, 180, 0.4);
        }

        #mm-launcher svg {
            width: 24px;
            height: 24px;
            color: white;
        }

        #mm-container {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            background: var(--bg-primary);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            z-index: 999998;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
            border: 1px solid var(--border-color);
            backdrop-filter: blur(10px);
            color: var(--text-primary);
        }

        #mm-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            border-radius: 12px 12px 0 0;
            border-bottom: 1px solid var(--border-color);
        }

        #mm-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 500;
        }

        #mm-controls button {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 4px 8px;
            font-size: 16px;
            transition: color 0.2s ease;
        }

        #mm-controls button:hover {
            color: var(--accent);
        }

        #mm-content {
            padding: 15px;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            min-height: 0;
        }

        #mm-tabs {
            display: flex;
            gap: 5px;
            margin-bottom: 15px;
            padding: 5px;
            background: var(--bg-tertiary);
            border-radius: 8px;
        }

        .mm-tab {
            padding: 8px 15px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.2s ease;
            flex: 1;
            font-size: 14px;
        }

        .mm-tab:hover {
            color: var(--text-primary);
            background: var(--hover-bg);
        }

        .mm-tab.active {
            background: var(--accent);
            color: white;
        }

        .mm-search-box input {
            width: 100%;
            padding: 10px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 14px;
            transition: all 0.2s ease;
        }

        .mm-search-box input:focus {
            border-color: var(--accent);
            outline: none;
        }

        .mm-filters {
            margin-bottom: 15px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .mm-filter-group {
            flex: 1;
            min-width: 150px;
        }

        .mm-filter-group label {
            display: block;
            margin-bottom: 5px;
            color: var(--text-secondary);
            font-size: 12px;
        }

        .mm-filter-group select,
        .mm-size-input input,
        .mm-size-input select {
            width: 100%;
            padding: 8px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-primary);
            font-size: 14px;
            transition: all 0.2s ease;
        }

        .mm-filter-group select:focus,
        .mm-size-input input:focus,
        .mm-size-input select:focus {
            border-color: var(--accent);
            outline: none;
        }

        .mm-button-group {
            display: flex;
            gap: 10px;
        }

        .mm-button-group button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            background: var(--accent);
            color: white;
            cursor: pointer;
            flex: 1;
            font-size: 14px;
            transition: all 0.2s ease;
            text-transform: uppercase;
            font-weight: 500;
            letter-spacing: 0.5px;
        }

        .mm-button-group button:hover {
            background: var(--accent-dark);
            transform: translateY(-1px);
        }

        .mm-button-group button:disabled {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            cursor: not-allowed;
            transform: none;
        }

        .mm-stats {
            margin-top: 15px;
            padding: 12px;
            background: var(--bg-tertiary);
            border-radius: 8px;
            display: flex;
            justify-content: space-around;
            color: var(--text-secondary);
            font-size: 13px;
        }

        .mm-stats span {
            color: var(--accent);
            font-weight: 500;
        }

        #mm-console-wrapper {
            margin-top: auto;
            border-top: 1px solid var(--border-color);
            flex-shrink: 0;
            height: 150px;
            display: flex;
            flex-direction: column;
        }

        #mm-console-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            color: var(--text-secondary);
        }

        #mm-clear-console {
            padding: 4px 8px;
            font-size: 12px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        #mm-clear-console:hover {
            border-color: var(--accent);
            color: var(--accent);
        }

        #mm-console {
            flex-grow: 1;
            overflow-y: auto;
            background: var(--bg-tertiary);
            padding: 10px;
            font-family: 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.4;
            color: var(--text-secondary);
        }

        .log-entry {
            margin-bottom: 4px;
            padding: 4px 6px;
            border-radius: 4px;
            background: var(--bg-primary);
        }

        .log-entry.error {
            color: #ff4444;
            background: rgba(255, 68, 68, 0.1);
        }

        .log-entry.warning {
            color: #ffbb33;
            background: rgba(255, 187, 51, 0.1);
        }

        .log-entry.success {
            color: #00C851;
            background: rgba(0, 200, 81, 0.1);
        }

        .video-item {
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
            border: 1px solid var(--border-color);
            transition: all 0.2s ease;
        }

        .video-item:hover {
            border-color: var(--accent);
            transform: translateX(2px);
        }

        .video-title {
            font-weight: 500;
            color: var(--text-primary);
            margin-bottom: 8px;
        }

        .video-meta {
            display: flex;
            gap: 10px;
            margin: 8px 0;
            font-size: 12px;
            flex-wrap: wrap;
        }

        .video-quality {
            background: var(--accent);
            color: white;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: 500;
        }

        .video-size {
            color: var(--text-secondary);
        }

        .video-year {
            color: var(--text-secondary);
            background: var(--bg-tertiary);
            padding: 3px 8px;
            border-radius: 4px;
        }

        .video-episode {
            background: var(--accent);
            color: white;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: 500;
        }

        .video-url {
            font-size: 12px;
            color: var(--text-secondary);
            word-break: break-all;
            padding: 8px;
            background: var(--bg-tertiary);
            border-radius: 4px;
        }

        .mm-settings-group {
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
        }

        .mm-settings-group h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            color: var(--text-primary);
            font-weight: 500;
        }

        .mm-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 8px 0;
            cursor: pointer;
            color: var(--text-secondary);
        }

        .mm-checkbox input {
            width: 16px;
            height: 16px;
            accent-color: var(--accent);
        }

        .mm-setting-item {
            margin: 12px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .mm-setting-item input[type="number"] {
            width: 70px;
            padding: 6px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-primary);
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: var(--bg-tertiary);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--accent);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--accent-dark);
        }

        /* Custom Select Styling */
        select {
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ff69b4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 8px center;
            padding-right: 30px !important;
        }

        .mm-shortcuts-list {
            margin-top: 15px;
            padding: 12px;
            background: var(--bg-tertiary);
            border-radius: 8px;
        }

        .mm-shortcut {
            display: flex;
            align-items: center;
            margin: 8px 0;
        }

        .mm-shortcut-combo {
            background: var(--bg-secondary);
            padding: 4px 8px;
            border-radius: 4px;
            margin-right: 10px;
            font-family: monospace;
            color: var(--accent-color);
        }

        .mm-shortcut-desc {
            color: var(--text-secondary);
        }

        .mm-loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .mm-loader {
            width: 40px;
            height: 40px;
            border: 3px solid var(--accent-color);
            border-top-color: transparent;
            border-radius: 50%;
            animation: mm-spin 1s linear infinite;
        }

        .mm-loading-text {
            color: var(--text-primary);
            margin-top: 10px;
            font-size: 14px;
        }

        @keyframes mm-spin {
            to { transform: rotate(360deg); }
        }

        .loading {
            position: relative;
            color: transparent !important;
        }

        .loading::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 16px;
            height: 16px;
            margin: -8px 0 0 -8px;
            border: 2px solid var(--accent-color);
            border-top-color: transparent;
            border-radius: 50%;
            animation: mm-spin 1s linear infinite;
        }

        .mm-tooltip {
            position: fixed;
            background: var(--bg-secondary);
            color: var(--text-color);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            transform: translateX(-50%);
            z-index: 1000;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-color);
            max-width: 200px;
            white-space: normal;
        }

        .mm-tooltip::before {
            content: '';
            position: absolute;
            top: -5px;
            left: 50%;
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-bottom-color: var(--border-color);
        }

        .mm-drop-zone {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .drag-over .mm-drop-zone {
            display: flex;
        }

        .mm-drop-zone-content {
            text-align: center;
            color: var(--text-color);
        }

        .mm-drop-icon {
            font-size: 48px;
            margin-bottom: 10px;
        }

        .mm-drop-text {
            font-size: 24px;
            margin-bottom: 5px;
        }

        .mm-drop-subtext {
            font-size: 14px;
            color: var(--text-secondary);
        }
    `);

    // Add log-related styles
    GM_addStyle(`
        .mm-log-entry {
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color);
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        .mm-log-info {
            color: var(--text-color);
        }
        
        .mm-log-success {
            color: #4caf50;
        }
        
        .mm-log-warning {
            color: #ff9800;
        }
        
        .mm-log-error {
            color: #f44336;
        }
        
        #mm-console {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            height: 150px;
            overflow-y: auto;
            margin-top: 10px;
            font-family: monospace;
            font-size: 12px;
        }
        
        #mm-console-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-color);
        }
        
        #mm-clear-console {
            padding: 2px 8px;
            font-size: 12px;
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
        }
        
        #mm-clear-console:hover {
            background: var(--bg-hover);
        }
    `);

    // Initialize the application
    function initialize() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeApp);
        } else {
            initializeApp();
        }
    }

    // Main initialization function
    function initializeApp() {
        try {
            // Create store with initial state
            const store = createStore(initialState);

            // Load saved preferences
            loadPreferences();

            // Initialize keyboard shortcuts
            initializeKeyboardShortcuts();

            // Create and initialize interface
            const container = createInterface();
            if (!container) {
                throw new Error('Failed to create interface container');
            }

            // Cache DOM elements after interface is created
            cacheElements();

            // Initialize other components
            initializeResizeObserver();
            initializeDragAndDrop();
            initializeEventListeners();
            populateYearFilter();

            // Update UI state
            updateButtons();
            updateStats();
            updateResults();

            log('MediaMagnet initialized successfully', 'success');
        } catch (error) {
            log(`Initialization failed: ${error.message}`, 'error');
            console.error('MediaMagnet initialization error:', error);
        }
    }

    // Start initialization
    initialize();

    function isSameOrigin(url) {
        try {
            const urlObj = new URL(url, window.location.origin);
            return urlObj.origin === window.location.origin;
        } catch (error) {
            return false;
        }
    }

    function updateState(newState) {
        store.setState(newState);
    }

    function getState() {
        return store.getState();
    }

    /**
     * Updates the UI elements based on current loading state
     */
    function updateLoadingUI() {
        const state = getState();
        const { elements } = state.ui;
        
        // Update loading spinners
        Object.entries(state.loading).forEach(([operation, isLoading]) => {
            const button = elements[`${operation}Btn`];
            if (button instanceof HTMLButtonElement) {
                if (isLoading) {
                    button.classList.add('loading');
                    button.disabled = true;
                } else {
                    button.classList.remove('loading');
                    button.disabled = false;
                }
            }
        });

        // Update main loading overlay
        const container = elements.container;
        if (!(container instanceof HTMLElement)) return;

        let overlay = container.querySelector('.mm-loading-overlay');
        if (Object.values(state.loading).some(Boolean)) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'mm-loading-overlay';
                overlay.innerHTML = `
                    <div class="mm-loader"></div>
                    <div class="mm-loading-text">Processing...</div>
                `;
                container.appendChild(overlay);
            }
        } else if (overlay) {
            overlay.remove();
        }
    }

    // Event handlers
    function handleRecursiveChange(e) {
        const target = e.target;
        if (!target) return;
        
        updateState({ searchOptions: { ...getState().searchOptions, recursive: target.checked } });
    }

    function handleMaxDepthChange(e) {
        const target = e.target;
        if (!target) return;
        
        updateState({ searchOptions: { ...getState().searchOptions, maxDepth: parseInt(target.value, 10) } });
    }

    function handleSkipExternalChange(e) {
        const target = e.target;
        if (!target) return;
        
        updateState({ searchOptions: { ...getState().searchOptions, skipExternal: target.checked } });
    }

    // UI updates
    function updateResults() {
        const { elements } = store.getState().ui;
        if (!elements.results) return;

        const filtered = getFilteredAndSortedVideos();
        elements.results.innerHTML = virtualizeResults(filtered);

        // Update stats
        if (elements.totalCount) elements.totalCount.textContent = store.getState().videos.length;
        if (elements.filteredCount) elements.filteredCount.textContent = filtered.length;
        if (elements.totalSize) {
            const bytes = store.getState().videos.reduce((sum, video) => sum + (video.size || 0), 0);
            elements.totalSize.textContent = formatFileSize(bytes);
        }
    }

    function updateButtons() {
        const state = getState();
        const { elements } = state.ui;
        
        // Update button states based on video count
        if (elements.generateBtn) {
            elements.generateBtn.disabled = state.videos.length === 0;
        }
        if (elements.clearBtn) {
            elements.clearBtn.disabled = state.videos.length === 0;
        }
    }

    function updateStats() {
        const state = getState();
        const { elements } = state.ui;
        const container = elements.container;
        if (!(container instanceof HTMLElement)) return;

        const statsDiv = container.querySelector('.mm-stats');
        if (!statsDiv) return;

        const filteredVideos = getFilteredAndSortedVideos();
        statsDiv.textContent = `Found ${filteredVideos.length} videos`;
    }

    // Settings management
    /**
     * @returns {Promise<void>}
     */
    async function exportSettings() {
        const settings = {
            searchOptions: getState().searchOptions,
            filters: getState().filters
        };

        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        try {
            await GM_download({
                url,
                name: 'mediamagnet-settings.json',
                saveAs: true
            });
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /**
     * @param {File} file
     * @returns {Promise<void>}
     */
    async function importSettings(file) {
        try {
            const text = await file.text();
            const settings = JSON.parse(text);
            
            updateState({
                searchOptions: { ...getState().searchOptions, ...settings.searchOptions },
                filters: { ...getState().filters, ...settings.filters }
            });
            
            log('Settings imported successfully', 'success');
        } catch (error) {
            log(`Failed to import settings: ${error.message}`, 'error');
        }
    }

    /**
     * @param {Store} state
     * @returns {Video[]}
     */
    function filterVideos(state) {
        return state.videos.filter(video => {
            const { filters } = state;
            
            if (filters.quality !== 'all' && video.quality !== filters.quality) return false;
            if (filters.type !== 'all' && video.type !== filters.type) return false;
            if (video.size !== null) {
                if (video.size < filters.minSize) return false;
                if (filters.maxSize !== Infinity && video.size > filters.maxSize) return false;
            }
            if (filters.year !== 'all' && video.year !== filters.year) return false;
            
            if (filters.searchTerm) {
                const searchLower = filters.searchTerm.toLowerCase();
                const filenameLower = video.filename.toLowerCase();
                if (!filenameLower.includes(searchLower)) return false;
            }
            
            return true;
        });
    }

    /**
     * @param {Video[]} videos
     * @returns {Video[]}
     */
    function sortVideos(videos) {
        return [...videos].sort((a, b) => {
            return a.filename.localeCompare(b.filename);
        });
    }

    /**
     * @param {Video} video
     * @returns {HTMLElement}
     */
    function createVideoElement(video) {
        try {
            if (!video) {
                throw new Error('Video object is required');
            }

            const element = document.createElement('div');
            if (!element) {
                throw new Error('Failed to create video element');
            }
            element.className = 'mm-video-item';

            // Create video info container
            const infoContainer = document.createElement('div');
            if (!infoContainer) {
                throw new Error('Failed to create info container');
            }
            infoContainer.className = 'mm-video-info';

            // Create title element
            const title = document.createElement('div');
            if (!title) {
                throw new Error('Failed to create title element');
            }
            title.className = 'mm-video-title';
            title.textContent = video.name || 'Unknown';

            // Create details element
            const details = document.createElement('div');
            if (!details) {
                throw new Error('Failed to create details element');
            }
            details.className = 'mm-video-details';
            details.innerHTML = `
                ${video.quality ? `<span class="mm-video-quality">${video.quality}</span>` : ''}
                ${video.size ? `<span class="mm-video-size">${formatFileSize(video.size)}</span>` : ''}
                ${video.year ? `<span class="mm-video-year">${video.year}</span>` : ''}
            `;

            // Create path element
            const path = document.createElement('div');
            if (!path) {
                throw new Error('Failed to create path element');
            }
            path.className = 'mm-video-path';
            path.textContent = video.path || '';

            // Create actions container
            const actions = document.createElement('div');
            if (!actions) {
                throw new Error('Failed to create actions container');
            }
            actions.className = 'mm-video-actions';

            // Create play button
            const playBtn = document.createElement('button');
            if (!playBtn) {
                throw new Error('Failed to create play button');
            }
            playBtn.className = 'mm-video-play';
            playBtn.textContent = '▶';
            playBtn.title = 'Play video';
            playBtn.onclick = () => {
                if (video.url) {
                    window.open(video.url, '_blank');
                }
            };

            // Safely append elements
            if (!safeAppendChild(infoContainer, title)) {
                throw new Error('Failed to append title');
            }
            if (!safeAppendChild(infoContainer, details)) {
                throw new Error('Failed to append details');
            }
            if (!safeAppendChild(infoContainer, path)) {
                throw new Error('Failed to append path');
            }
            if (!safeAppendChild(actions, playBtn)) {
                throw new Error('Failed to append play button');
            }
            if (!safeAppendChild(element, infoContainer)) {
                throw new Error('Failed to append info container');
            }
            if (!safeAppendChild(element, actions)) {
                throw new Error('Failed to append actions');
            }

            return element;
        } catch (error) {
            log(`Failed to create video element: ${error.message}`, 'error');
            console.error('Video element creation error:', error);
            return null;
        }
    }

    // Import M3U playlist
    async function importM3U(file) {
        try {
            const text = await file.text();
            const lines = text.split('\n');
            const videos = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                try {
                    if (line.startsWith('#EXTINF:')) {
                        const url = lines[++i]?.trim();
                        if (url && isValidUrl(url)) {
                            const filename = decodeURIComponent(url.split('/').pop() || '');
                            const info = parseFilename(filename);
                            videos.push({
                                url,
                                filename,
                                path: new URL(url).pathname,
                                size: null,
                                ...info
                            });
                        }
                    } else if (line && !line.startsWith('#') && isValidUrl(line)) {
                        const url = line;
                        const filename = decodeURIComponent(url.split('/').pop() || '');
                        const info = parseFilename(filename);
                        videos.push({
                            url,
                            filename,
                            path: new URL(url).pathname,
                            size: null,
                            ...info
                        });
                    }
                } catch (lineError) {
                    log(`Failed to process M3U line: ${lineError.message}`, 'warning');
                    continue;
                }
            }

            if (videos.length > 0) {
                const state = store.getState();
                updateState({ 
                    videos: [...(state.videos || []), ...videos] 
                });
                log(`Imported ${videos.length} videos from M3U playlist`, 'success');
                updateResults();
            } else {
                log('No valid videos found in M3U playlist', 'warning');
            }
        } catch (error) {
            log(`Failed to import M3U playlist: ${error.message}`, 'error');
            console.error('M3U import error:', error);
            throw error; // Re-throw to be handled by caller
        }
    }

    // Helper function to validate URLs
    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Initialize Drag and Drop
    function initializeDragAndDrop() {
        try {
            // Get container from state
            const state = store.getState();
            const container = state?.ui?.elements?.container;
            
            if (!container || !(container instanceof HTMLElement)) {
                throw new Error('Container not initialized');
            }

            // Create drop zone if it doesn't exist
            let dropZone = container.querySelector('.mm-drop-zone');
            if (!dropZone) {
                dropZone = document.createElement('div');
                dropZone.className = 'mm-drop-zone';
                dropZone.innerHTML = `
                    <div class="mm-drop-zone-content">
                        <div class="mm-drop-icon">📁</div>
                        <div class="mm-drop-text">Drop files here</div>
                        <div class="mm-drop-subtext">Import settings or M3U files</div>
                    </div>
                `;
                container.appendChild(dropZone);
            }

            // Counter for drag events to handle nested elements
            let dragCounter = 0;

            // Drag enter event
            const handleDragEnter = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                dragCounter++;
                if (dragCounter === 1) {
                    updateState({ dragOver: true });
                    container.classList.add('mm-drag-over');
                    dropZone.style.display = 'flex';
                }
            };

            // Drag over event
            const handleDragOver = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            // Drag leave event
            const handleDragLeave = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                dragCounter--;
                if (dragCounter === 0) {
                    updateState({ dragOver: false });
                    container.classList.remove('mm-drag-over');
                    dropZone.style.display = 'none';
                }
            };

            // Drop event
            const handleDrop = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                dragCounter = 0;
                updateState({ dragOver: false });
                container.classList.remove('mm-drag-over');
                dropZone.style.display = 'none';

                const files = Array.from(e.dataTransfer.files);
                if (files.length === 0) return;

                showLoading('import');
                try {
                    for (const file of files) {
                        if (file.name.toLowerCase().endsWith('.json')) {
                            await importSettings(file);
                        } else if (file.name.toLowerCase().endsWith('.m3u') || 
                                 file.name.toLowerCase().endsWith('.m3u8')) {
                            await importM3U(file);
                        } else {
                            log(`Unsupported file type: ${file.name}`, 'error');
                        }
                    }
                } catch (error) {
                    log(`Failed to process dropped files: ${error.message}`, 'error');
                    console.error('Drop error:', error);
                } finally {
                    hideLoading('import');
                }
            };

            // Clean up existing listeners
            const cleanupListeners = () => {
                container.removeEventListener('dragenter', handleDragEnter);
                container.removeEventListener('dragover', handleDragOver);
                container.removeEventListener('dragleave', handleDragLeave);
                container.removeEventListener('drop', handleDrop);
            };

            // Add new listeners
            cleanupListeners();
            container.addEventListener('dragenter', handleDragEnter);
            container.addEventListener('dragover', handleDragOver);
            container.addEventListener('dragleave', handleDragLeave);
            container.addEventListener('drop', handleDrop);

            // Add styles for drag and drop
            GM_addStyle(`
                .mm-drop-zone {
                    display: none;
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    border: 2px dashed var(--accent);
                    border-radius: 8px;
                }

                .mm-drop-zone-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-color);
                }

                .mm-drop-icon {
                    font-size: 48px;
                    margin-bottom: 16px;
                }

                .mm-drop-text {
                    font-size: 24px;
                    margin-bottom: 5px;
                }

                .mm-drop-subtext {
                    font-size: 14px;
                    color: var(--text-secondary);
                }

                .mm-drag-over {
                    border-color: var(--accent);
                }
            `);

            log('Drag and drop initialized', 'success');
        } catch (error) {
            log(`Failed to initialize drag and drop: ${error.message}`, 'error');
            console.error('Drag and drop initialization error:', error);
        }
    }
})();
