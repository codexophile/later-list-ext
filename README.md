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
- Background metadata capture: when a tab is saved, the extension captures page metadata (preview images, description, summary, published date, keywords, author, site name, canonical URL, type, locale, and embedded iframe URLs). Preview images prefer social and structured image tags such as `og:image`, `twitter:image`, `itemprop="image"`, and `image_src` before falling back to visible images or icons.
- Host extraction rules: Settings > Rules stores rules as `{ host, selectors }`. Each selector is `{ name, selector, extract: { text, attributes } }`; a host can have multiple named selectors, and every matching element is extracted. A host can be exact (`example.com`) or include subdomains (`*.example.com`).
- CSS-rule results: The main view's link details overlay groups every matched element by the user-provided selector name and shows only the selected textContent and attributes, in addition to the resulting metadata and media. Legacy selector strings remain supported as named text selectors.

## Installation

1. Clone the repository.
2. Load the extension in Chrome via `chrome://extensions`.
3. Enable Developer Mode and load the unpacked extension.

## Usage

- Click the extension icon to save your current tabs.
- Access saved tabs from the popup interface. The main LaterList view lives in a pinned tab and is restored automatically when the extension loads or reloads; actions reuse that tab instead of opening new ones. When the current tab URL is already saved, the popup shows each matching copy with its tab and container path and lets you remove copies one by one.
- When you save tabs, live pages are extracted before the saved links are finalized. Discarded/hibernated tabs are not post-processed in the background after sending. Unsupported schemes (non-http/https) are skipped. Configure host rules under Settings > Rules; add a name, CSS selector, and extraction options for each selector. Invalid CSS selectors are ignored.
- If the storage quota is exceeded, the extension automatically trims heavy metadata fields (like iframe lists, extra images, summaries, and keywords). All links are preserved.

## License

This project is licensed under the MIT License.
