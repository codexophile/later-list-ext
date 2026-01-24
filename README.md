# LaterList Extension

This is a Chromium browser extension inspired by the Onetab extension. The goal is to create a functional and user-friendly extension that allows users to manage their tabs efficiently.

## Features

- Save and restore tabs
- Organize tabs into groups
- User-friendly interface
- Reorder tabs directly in the view via drag-and-drop
- Main view stays open in a single pinned tab to avoid duplicates
- Background metadata capture: the extension automatically captures page metadata (images, description, summary, published date, keywords, author, site name, canonical URL, type, locale, and embedded iframe URLs) when a tab finishes loading, so sending/closing tabs is fast and metadata still appears even if tabs are later hibernated.

## Installation

1. Clone the repository.
2. Load the extension in Chrome via `chrome://extensions`.
3. Enable Developer Mode and load the unpacked extension.

## Usage

- Click the extension icon to save your current tabs.
- Access saved tabs from the popup interface. The main LaterList view lives in a pinned tab; actions reuse that tab instead of opening new ones.
- When browsing, metadata is captured automatically at page load. Later, when you send tabs, cached metadata (including embedded iframe URLs) is attached immediately. Unsupported schemes (non-http/https) are skipped.
- If the storage quota is exceeded, the extension automatically trims heavy metadata fields (like iframe lists, extra images, summaries, and keywords) and may drop the oldest links to recover.

## License

This project is licensed under the MIT License.
