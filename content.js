// content.js
// Injects a Ctrl + right-click mini popup to save the clicked link or page to LaterList.

(() => {
  const POPUP_STYLES = `
    .laterlist-popup {
        position: fixed;
        background: linear-gradient(to bottom, #3b4252, #2e3440);
        border: 1px solid #4c566a;
        border-radius: 12px;
        padding: 16px;
        z-index: 2147483646;
        color: #eceff4;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1);
        max-width: 340px;
        width: 100%;
        transition: opacity 0.18s ease-in-out;
        opacity: 0;
    }
    .laterlist-popup__title {
        font-weight: 600;
        font-size: 1.05em;
        margin-bottom: 6px;
        color: #eceff4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .laterlist-popup__url {
        font-size: 0.9em;
        color: #88c0d0;
        margin-bottom: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.9;
    }
    .laterlist-popup__select-wrapper {
        display: grid;
        gap: 10px;
        margin-bottom: 12px;
    }
    .laterlist-popup__select {
        width: 100%;
        padding: 8px 12px;
        background: #4c566a;
        border: 1px solid #6c7a96;
        border-radius: 6px;
        color: #eceff4;
        font-size: 0.95em;
        cursor: pointer;
        outline: none;
    }
    .laterlist-popup__button-container {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }
    .laterlist-popup__button {
        padding: 8px 14px;
        border: none;
        border-radius: 6px;
        font-size: 0.95em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        background: #434c5e;
        color: #e5e9f0;
    }
    .laterlist-popup__button:hover {
        background: #4c566a;
    }
    .laterlist-popup__button--primary {
        background: #88c0d0;
        color: #2e3440;
    }
    .laterlist-popup__button--primary:hover {
        background: #8fcfdf;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = POPUP_STYLES;
  document.documentElement.appendChild(styleEl);

  let popupEl = null;

  function removePopup() {
    popupEl?.remove();
    popupEl = null;
    window.removeEventListener('keydown', handleKeydown, true);
  }

  // Extract JSON-LD metadata
  function extractJsonLd() {
    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data) return Array.isArray(data) ? data[0] : data;
      } catch {}
    }
    return null;
  }

  // Extract publication date
  function extractPublishedDate() {
    const jsonLd = extractJsonLd();
    if (jsonLd?.datePublished) return new Date(jsonLd.datePublished).getTime();

    const metaSelectors = [
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[name="date"]',
      'meta[property="og:published_time"]',
    ];

    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      const content = el?.getAttribute('content');
      if (content) {
        const timestamp = new Date(content).getTime();
        if (!isNaN(timestamp)) return timestamp;
      }
    }

    return null;
  }

  // Extract description
  function extractDescription() {
    const jsonLd = extractJsonLd();
    if (jsonLd?.description) return jsonLd.description.trim();

    const metaSelectors = [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ];

    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      const content = el?.getAttribute('content');
      if (content) return content.trim();
    }

    const firstP = document.querySelector('article p, main p, p');
    if (firstP?.textContent) {
      const text = firstP.textContent.trim();
      return text.length > 300 ? text.slice(0, 300) + '...' : text;
    }

    return null;
  }

  // Extract main text summary
  function extractSummary() {
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText || el.textContent || '';
        const cleaned = text.trim().replace(/\s+/g, ' ');
        if (cleaned.length > 50) {
          return cleaned.length > 500 ? cleaned.slice(0, 500) + '...' : cleaned;
        }
      }
    }

    return null;
  }

  // Extract keywords and tags
  function extractKeywords() {
    const keywords = [];
    const seen = new Set();

    const jsonLd = extractJsonLd();
    if (jsonLd?.keywords) {
      const kw = Array.isArray(jsonLd.keywords)
        ? jsonLd.keywords
        : jsonLd.keywords.split(',');
      kw.forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      const content = metaKeywords.getAttribute('content') || '';
      content.split(',').forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaTags = document.querySelectorAll('meta[property="article:tag"]');
    metaTags.forEach(tag => {
      const content = tag.getAttribute('content');
      if (content && !seen.has(content)) {
        seen.add(content);
        keywords.push(content);
      }
    });

    return keywords.length > 0 ? keywords : null;
  }

  // Validate if an image URL is loadable
  function testImageUrl(url, timeout = 3000) {
    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve(false);
      }, timeout);

      img.onload = () => {
        clearTimeout(timer);
        // Check if image actually has dimensions
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
      };

      img.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };

      img.src = url;
    });
  }

  // Extract multiple meaningful images from the page
  async function extractPageImages() {
    try {
      const candidates = [];
      const seen = new Set();

      const isSvg = url => {
        const u = url.trim().toLowerCase();
        return u.endsWith('.svg') || u.startsWith('data:image/svg');
      };

      const add = url => {
        if (!url) return;
        const trimmed = url.trim();
        if (!trimmed || seen.has(trimmed)) return;
        // Filter out obviously invalid URLs
        if (
          trimmed.startsWith('data:') ||
          trimmed.startsWith('about:') ||
          trimmed.startsWith('javascript:')
        )
          return;
        if (isSvg(trimmed)) return;
        seen.add(trimmed);
        candidates.push(trimmed);
      };

      const visibleEnough = img => {
        // Check if image actually loaded successfully
        if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0)
          return false;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (w < 128 || h < 128) return false;
        const ratio = w / h;
        return ratio > 0.3 && ratio < 3.5 && img.offsetParent !== null;
      };

      // Visible, reasonably large images in the page (already loaded)
      document.querySelectorAll('img').forEach(img => {
        if (!visibleEnough(img)) return;
        const src = img.currentSrc || img.src || img.getAttribute('data-src');
        add(src);
      });

      // Meta tags (need validation since they might not be loaded)
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
      ];
      const metaUrls = [];
      metaSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el?.content) {
          const val = el.content.trim();
          if (!seen.has(val) && !isSvg(val)) {
            metaUrls.push(val);
          }
        }
      });

      // Icons
      const icon = document.querySelector('link[rel*="icon"]');
      if (icon?.href) {
        const val = icon.href;
        if (!seen.has(val) && !isSvg(val)) {
          metaUrls.push(val);
        }
      }

      // Validate meta tag images (check if they actually load)
      const validationPromises = metaUrls.map(async url => {
        const isValid = await testImageUrl(url);
        return isValid ? url : null;
      });

      const validatedMeta = (await Promise.all(validationPromises)).filter(
        Boolean
      );

      // Prepend validated meta images (higher priority)
      return [...validatedMeta, ...candidates];
    } catch {
      return [];
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      removePopup();
    }
  }

  function createSelect(options, selectedId) {
    const select = document.createElement('select');
    select.className = 'laterlist-popup__select';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.textContent = opt.label;
      if (opt.id === selectedId) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  async function showPopup(event) {
    removePopup();

    const targetAnchor = event.target.closest('a');
    const url = targetAnchor?.href || window.location.href;
    const title = (targetAnchor?.textContent || document.title || url).trim();

    const { data } = await chrome.runtime.sendMessage({
      type: 'laterlist:getData',
    });
    const tabs = data?.tabs || [];
    if (!tabs.length) return;

    const tabOptions = tabs.map(tab => ({ id: tab.id, label: tab.name }));
    const defaultTabId = tabOptions[0].id;
    const firstTabContainers =
      tabs.find(t => t.id === defaultTabId)?.containers || [];
    const containerOptions = firstTabContainers.map(c => ({
      id: c.id,
      label: c.name,
    }));
    const defaultContainerId = containerOptions[0]?.id;

    popupEl = document.createElement('div');
    popupEl.className = 'laterlist-popup';
    popupEl.style.left = `${event.clientX}px`;
    popupEl.style.top = `${event.clientY}px`;

    const titleEl = document.createElement('div');
    titleEl.className = 'laterlist-popup__title';
    titleEl.textContent = title;

    const urlEl = document.createElement('div');
    urlEl.className = 'laterlist-popup__url';
    urlEl.textContent = url;

    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'laterlist-popup__select-wrapper';

    const tabSelect = createSelect(tabOptions, defaultTabId);
    let containerSelect = createSelect(containerOptions, defaultContainerId);

    tabSelect.addEventListener('change', () => {
      const selectedTab = tabs.find(t => t.id === tabSelect.value);
      const nextContainers = selectedTab?.containers || [];
      const opts = nextContainers.map(c => ({ id: c.id, label: c.name }));
      const newSelect = createSelect(opts, opts[0]?.id);
      selectWrapper.replaceChild(newSelect, containerSelect);
      containerSelect = newSelect;
    });

    selectWrapper.appendChild(tabSelect);
    selectWrapper.appendChild(containerSelect);

    const buttons = document.createElement('div');
    buttons.className = 'laterlist-popup__button-container';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'laterlist-popup__button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', removePopup);

    const saveBtn = document.createElement('button');
    saveBtn.className =
      'laterlist-popup__button laterlist-popup__button--primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const imageUrls = await extractPageImages();
      const imageUrl = imageUrls[0] || null;
      const publishedAt = extractPublishedDate();
      const description = extractDescription();
      const summary = extractSummary();
      const keywords = extractKeywords();

      await chrome.runtime.sendMessage({
        type: 'laterlist:addLink',
        payload: {
          url,
          title,
          tabId: tabSelect.value,
          containerId: containerSelect.value,
          imageUrl,
          imageUrls,
          publishedAt,
          description,
          summary,
          keywords,
        },
      });
      removePopup();
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);

    popupEl.appendChild(titleEl);
    popupEl.appendChild(urlEl);
    popupEl.appendChild(selectWrapper);
    popupEl.appendChild(buttons);

    document.body.appendChild(popupEl);
    requestAnimationFrame(() => {
      popupEl.style.opacity = '1';
    });

    window.addEventListener('keydown', handleKeydown, true);
  }

  document.addEventListener('contextmenu', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    showPopup(event).catch(() => removePopup());
  });

  document.addEventListener('click', () => removePopup());
})();
