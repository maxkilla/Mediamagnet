# MediaMagnet

A Chrome extension for scanning open directories and organizing video content. MediaMagnet helps you discover, catalog, and create playlists from video files found in open directories.

## Features

### Core Functionality
- Scans web directories for video files (MP4, MKV, AVI, etc.)
- Recursive directory scanning with configurable depth
- Intelligent media file detection and categorization
- M3U playlist generation

### Smart Detection
- Automatic quality detection (4K, 1080p, 720p)
- File size parsing
- Content type categorization
- Metadata extraction

### Modern Interface
- Dark theme with pink highlights
- Real-time scanning progress
- Tabbed interface:
  - History: Track previously scanned directories
  - Results: View current scan findings
  - Console: Monitor scanning progress
- Responsive and clean design

### Advanced Features
- Persistent scan history
- One-click rescan of previous directories
- Quick playlist generation from history
- Advanced filtering options
- Configurable scan depth
- External link handling

## Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The MediaMagnet icon should appear in your browser toolbar

## Usage

1. Navigate to any web directory containing video files
2. Click the MediaMagnet extension icon
3. Configure scan settings:
   - Set maximum scan depth
   - Enable/disable recursive scanning
   - Select content filters
4. Click "Scan Directory" to begin
5. Use the tabs to:
   - View scan results
   - Monitor progress in the console
   - Access scan history
6. Generate M3U playlists from results

## Supported Formats

Video Extensions:
- MP4, MKV, AVI
- MOV, WMV, FLV
- WebM, M4V
- MPG/MPEG

## Technical Details

- Built with vanilla JavaScript
- Chrome Extension Manifest V3
- Uses modern browser APIs:
  - Chrome Storage API
  - Tabs API
  - Scripting API
- Asynchronous scanning with progress tracking
- Persistent storage for scan history
- Error handling with automatic retries

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## License

[Add your chosen license here]
