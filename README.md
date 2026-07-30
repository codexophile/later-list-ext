# LaterList Extension

This is a Chromium browser extension inspired by the Onetab extension. The goal is to create a functional and user-friendly extension that allows users to manage their tabs efficiently.

## Features

- Save and restore tabs
- Organize tabs into groups
- User-friendly interface
- Reorder tabs directly in the view via drag-and-drop
- Status overlay auto-hides at drag start and stays suppressed during drag so it never blocks drop targets
- Main view stays open in a single pinned tab to avoid duplicates and is restored on extension load/reload
- Clicking a saved link opens it in a focused foreground tab
- Background metadata capture: the extension automatically captures page metadata (preview images, description, summary, published date, keywords, author, site name, canonical URL, type, locale, and embedded iframe URLs) when a tab finishes loading, so sending/closing tabs is fast for pages with cached metadata. Preview images prefer social and structured image tags such as `og:image`, `twitter:image`, `itemprop="image"`, and `image_src` before falling back to visible images or icons.

## Installation

1. Clone the repository.
2. Load the extension in Chrome via `chrome://extensions`.
3. Enable Developer Mode and load the unpacked extension.

## Usage

- Click the extension icon to save your current tabs.
- Access saved tabs from the popup interface. The main LaterList view lives in a pinned tab and is restored automatically when the extension loads or reloads; actions reuse that tab instead of opening new ones. When the current tab URL is already saved, the popup shows each matching copy with its tab and container path and lets you remove copies one by one.
- When browsing, metadata is captured automatically at page load. Later, when you send tabs, cached metadata (including embedded iframe URLs) is attached immediately. Discarded/hibernated tabs are not post-processed in the background after sending. Unsupported schemes (non-http/https) are skipped.
- If the storage quota is exceeded, the extension automatically trims heavy metadata fields (like iframe lists, extra images, summaries, and keywords). All links are preserved.

## License

This project is licensed under the MIT License.
