// popup.js

let currentPage = {
  url: '',
  title: '',
  tabId: null,
};

// Preview state for the current page
let previewData = {
  imageUrl: null,
  imageUrls: [],
  publishedAt: null,
  description: null,
  summary: null,
  keywords: null,
  ruleExtracted: [],
};

// Track which images are selected for saving
let selectedImageUrls = [];

let savedCopiesState = [];
let previewExtractionPromise = null;

function extractionRuleMatchesHost(host, hostname) {
  if (host === '*') return true;
  if (host.startsWith('*.')) {
    const baseHost = host.slice(2);
    return hostname === baseHost || hostname.endsWith(`.${baseHost}`);
  }
  return hostname === host;
}

function extractionRuleMatchesUrlPattern(pattern, url) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    'i',
  );
  return regex.test(url);
}

async function updateExtractionRuleStatus() {
  const statusEl = document.getElementById('extraction-rule-status');
  if (!statusEl) return;

  statusEl.hidden = true;
  statusEl.textContent = '';
  if (!currentPage.url) return;

  let hostname;
  try {
    hostname = new URL(currentPage.url).hostname.toLowerCase();
  } catch {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'laterlist:getSettings',
    });
    const rules = Array.isArray(response?.settings?.extractionRules)
      ? response.settings.extractionRules
      : [];
    const matches = rules.filter(rule => {
      const host = String(rule?.host || '')
        .trim()
        .toLowerCase();
      if (!host) return false;
      if (host.includes('://')) {
        return extractionRuleMatchesUrlPattern(host, currentPage.url);
      }
      return extractionRuleMatchesHost(host, hostname);
    });
    if (!matches.length) return;

    const hostNames = matches
      .map(rule => String(rule.host).trim())
      .filter(Boolean)
      .join(', ');
    statusEl.textContent = `${matches.length} extraction rule${
      matches.length === 1 ? '' : 's'
    } match${matches.length === 1 ? 'es' : ''}: ${hostNames}`;
    statusEl.hidden = false;
  } catch (err) {
    console.warn('[LaterList Popup] Failed to load extraction rules:', err);
  }
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text || '';
  if (text) setTimeout(() => (el.textContent = ''), 2000);
}

function setBusy(isBusy) {
  const saveBtn = document.getElementById('save-current');
  const saveCloseBtn = document.getElementById('save-close');
  const openBtn = document.getElementById('open-view');
  const sendAllBtn = document.getElementById('send-all-tabs');
  const sendBeforeBtn = document.getElementById('send-tabs-before');
  const sendAfterBtn = document.getElementById('send-tabs-after');
  const settingsBtn = document.getElementById('open-settings');
  if (saveBtn) saveBtn.disabled = isBusy;
  if (saveCloseBtn) saveCloseBtn.disabled = isBusy;
  if (openBtn) openBtn.disabled = isBusy;
  if (sendAllBtn) sendAllBtn.disabled = isBusy;
  if (sendBeforeBtn) sendBeforeBtn.disabled = isBusy;
  if (sendAfterBtn) sendAfterBtn.disabled = isBusy;
  if (settingsBtn) settingsBtn.disabled = isBusy;
}

function populateSelect(selectEl, options, selectedId) {
  selectEl.replaceChildren();
  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.id;
    option.textContent = opt.label;
    if (opt.id === selectedId) option.selected = true;
    selectEl.appendChild(option);
  });
}

function formatSavedCopyPath(copy) {
  const parts = [copy.tabName, copy.containerName].filter(Boolean);
  const basePath = parts.length
    ? parts.join(' › ')
    : 'Saved location unavailable';
  return `${basePath} › ${copy.title || 'Untitled'}`;
}

function formatSavedCopyDate(savedAt) {
  if (!savedAt) return '';
  try {
    return new Date(savedAt).toLocaleString();
  } catch {
    return '';
  }
}

async function updateLinkCount() {
  const response = await chrome.runtime.sendMessage({
    type: 'laterlist:getData',
  });

  const data = response?.data;
  let totalLinks = 0;

  if (data?.tabs) {
    data.tabs.forEach(tab => {
      if (tab.containers) {
        tab.containers.forEach(container => {
          if (container.links) {
            totalLinks += container.links.length;
          }
        });
      }
    });
  }

  const pill = document.getElementById('link-count');
  if (pill) pill.textContent = totalLinks;
}

async function loadSavedCopies() {
  const panel = document.getElementById('saved-copies-panel');
  const listEl = document.getElementById('saved-copies-list');
  const emptyEl = document.getElementById('saved-copies-empty');
  const countEl = document.getElementById('saved-copies-count');
  if (!panel || !listEl || !emptyEl || !countEl) return;

  if (!currentPage.url) {
    savedCopiesState = [];
    panel.hidden = true;
    listEl.replaceChildren();
    emptyEl.hidden = true;
    countEl.textContent = '0';
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'laterlist:getSavedLinksForUrl',
      payload: { url: currentPage.url },
    });

    savedCopiesState = response?.savedLinks || [];
  } catch {
    savedCopiesState = [];
  }

  countEl.textContent = String(savedCopiesState.length);
  panel.hidden = savedCopiesState.length === 0;
  listEl.replaceChildren();
  emptyEl.hidden = savedCopiesState.length > 0;

  if (!savedCopiesState.length) return;

  savedCopiesState.forEach(copy => {
    const row = document.createElement('div');
    row.className = 'saved-copy-row';

    const info = document.createElement('div');
    info.className = 'saved-copy-info';

    const title = document.createElement('div');
    title.className = 'saved-copy-title';
    title.textContent = copy.title || copy.url || 'Untitled';

    const path = document.createElement('div');
    path.className = 'saved-copy-path';
    path.textContent = `Path: ${formatSavedCopyPath(copy)}`;

    const meta = document.createElement('div');
    meta.className = 'saved-copy-meta';
    const savedLabel = formatSavedCopyDate(copy.savedAt);
    meta.textContent = savedLabel ? `Saved: ${savedLabel}` : '';

    info.appendChild(title);
    info.appendChild(path);
    if (meta.textContent) info.appendChild(meta);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'saved-copy-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.title = 'Send this copy to Trash';
    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'laterlist:trashSavedLink',
          payload: {
            tabId: copy.tabId,
            containerId: copy.containerId,
            linkId: copy.linkId,
            url: currentPage.url,
          },
        });

        if (result?.error) {
          setStatus(result.error);
          removeBtn.disabled = false;
          return;
        }

        setStatus('Removed');
        await loadSavedCopies();
        await updateLinkCount();
        await chrome.runtime.sendMessage({ type: 'laterlist:updateView' });
      } catch {
        removeBtn.disabled = false;
        setStatus('Remove failed');
      }
    });

    row.appendChild(info);
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  });
}

// Extract lightweight preview info from the active tab using background extraction with image rules
async function extractPreview(tabId) {
  if (typeof tabId !== 'number') return;
  try {
    // Request extraction from background - it will apply image rules
    const result = await chrome.runtime.sendMessage({
      type: 'laterlist:extractFromTab',
      tabId,
      url: currentPage.url,
    });

    if (result?.extracted) {
      previewData = {
        imageUrl: result.extracted.imageUrl || null,
        imageUrls: result.extracted.imageUrls || [],
        description: result.extracted.description || null,
        summary: result.extracted.summary || null,
        publishedAt: result.extracted.publishedAt || null,
        keywords: result.extracted.keywords || null,
        author: result.extracted.author || null,
        siteName: result.extracted.siteName || null,
        type: result.extracted.type || null,
        locale: result.extracted.locale || null,
        ruleExtracted: result.extracted.ruleExtracted || [],
        iframes: result.extracted.iframes || [],
        canonical: result.extracted.canonical || null,
      };
      // Reset selected images - select ALL by default
      selectedImageUrls = [...(result.extracted.imageUrls || [])];
      renderPreview();
    }
  } catch (err) {
    console.warn('[LaterList Popup] Preview extraction failed:', err);
  }
}

function renderPreview() {
  const thumb = document.getElementById('preview-thumb');
  const titleEl = document.getElementById('preview-title');
  const domainEl = document.getElementById('preview-domain');
  const descEl = document.getElementById('preview-description');
  const imagesEl = document.getElementById('preview-images');
  const dateEl = document.getElementById('preview-date');
  const keywordsEl = document.getElementById('preview-keywords');
  const summaryEl = document.getElementById('preview-summary');

  if (thumb) {
    thumb.classList.remove('skeleton');
    if (previewData.imageUrl) {
      thumb.style.backgroundImage = `url(${previewData.imageUrl})`;
    } else {
      thumb.style.backgroundImage = '';
    }
  }
  if (titleEl) {
    titleEl.classList.remove('skeleton');
    titleEl.textContent = currentPage.title || 'Untitled';
  }
  if (domainEl) {
    domainEl.classList.remove('skeleton');
    try {
      domainEl.textContent = new URL(currentPage.url).hostname;
    } catch {
      domainEl.textContent = '';
    }
  }
  if (descEl) {
    descEl.classList.remove('skeleton');
    descEl.textContent = previewData.description || '';
  }
  if (imagesEl) {
    imagesEl.replaceChildren();
    (previewData.imageUrls || []).slice(0, 8).forEach((u, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'image-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'image-checkbox';
      checkbox.value = u;
      checkbox.id = `image-${idx}`;
      checkbox.checked = selectedImageUrls.includes(u);
      checkbox.addEventListener('change', e => {
        if (e.target.checked) {
          if (!selectedImageUrls.includes(u)) selectedImageUrls.push(u);
        } else {
          selectedImageUrls = selectedImageUrls.filter(x => x !== u);
        }
      });

      const img = document.createElement('img');
      img.src = u;

      wrapper.appendChild(checkbox);
      wrapper.appendChild(img);
      imagesEl.appendChild(wrapper);
    });

    // Auto-select all images by default
    if (
      selectedImageUrls.length === 0 &&
      (previewData.imageUrls || []).length > 0
    ) {
      selectedImageUrls = [...previewData.imageUrls];
      const checkboxes = imagesEl.querySelectorAll('.image-checkbox');
      checkboxes.forEach(cb => (cb.checked = true));
    }
  }
  if (dateEl) {
    if (previewData.publishedAt) {
      dateEl.textContent = new Date(
        previewData.publishedAt,
      ).toLocaleDateString();
    } else {
      dateEl.textContent = '';
    }
  }
  if (keywordsEl) {
    keywordsEl.replaceChildren();
    if (previewData.keywords && previewData.keywords.length > 0) {
      previewData.keywords.slice(0, 5).forEach(kw => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.textContent = kw;
        keywordsEl.appendChild(chip);
      });
    }
  }
  if (summaryEl) {
    summaryEl.replaceChildren();

    // Author & Site Name
    if (previewData.author || previewData.siteName) {
      const byline = document.createElement('div');
      byline.className = 'preview-byline';
      if (previewData.author) byline.textContent += `By ${previewData.author}`;
      if (previewData.siteName) {
        if (previewData.author) byline.textContent += ` • `;
        byline.textContent += previewData.siteName;
      }
      summaryEl.appendChild(byline);
    }

    // Type badge
    if (previewData.type) {
      const typeBadge = document.createElement('div');
      typeBadge.className = 'preview-type-badge';
      typeBadge.textContent = previewData.type;
      summaryEl.appendChild(typeBadge);
    }

    // Summary text
    if (previewData.summary) {
      const summaryText = document.createElement('div');
      summaryText.className = 'preview-summary-text';
      summaryText.textContent = previewData.summary;
      summaryEl.appendChild(summaryText);
    }

    // iFrames
    if (previewData.iframes && previewData.iframes.length > 0) {
      const iframesDiv = document.createElement('div');
      iframesDiv.className = 'preview-iframes';

      const iframesLabel = document.createElement('div');
      iframesLabel.className = 'preview-iframes-label';
      iframesLabel.textContent = `📺 Embedded iFrames (${previewData.iframes.length})`;
      iframesDiv.appendChild(iframesLabel);

      const iframesList = document.createElement('div');
      iframesList.className = 'preview-iframes-list';

      previewData.iframes.slice(0, 5).forEach(url => {
        const item = document.createElement('div');
        item.className = 'preview-iframe-item';
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url.length > 50 ? url.substring(0, 47) + '...' : url;
        link.title = url;
        item.appendChild(link);
        iframesList.appendChild(item);
      });

      if (previewData.iframes.length > 5) {
        const more = document.createElement('div');
        more.className = 'preview-iframes-more';
        more.textContent = `+${previewData.iframes.length - 5} more`;
        iframesList.appendChild(more);
      }

      iframesDiv.appendChild(iframesList);
      summaryEl.appendChild(iframesDiv);
    }

    // Show/hide section
    if (summaryEl.children.length > 0) {
      summaryEl.style.display = 'block';
    } else {
      summaryEl.style.display = 'none';
    }
  }
}

function selectAllImages() {
  selectedImageUrls = [...previewData.imageUrls];
  const checkboxes = document.querySelectorAll('.image-checkbox');
  checkboxes.forEach(cb => (cb.checked = true));
}

function deselectAllImages() {
  selectedImageUrls = [];
  const checkboxes = document.querySelectorAll('.image-checkbox');
  checkboxes.forEach(cb => (cb.checked = false));
}

async function loadCurrentTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  currentPage.url = activeTab?.url || '';
  currentPage.title = activeTab?.title || activeTab?.url || '';
  currentPage.tabId = typeof activeTab?.id === 'number' ? activeTab.id : null;

  const titleEl = document.getElementById('page-title');
  const urlEl = document.getElementById('page-url');
  if (titleEl) titleEl.textContent = currentPage.title || 'Untitled';
  if (urlEl) urlEl.textContent = currentPage.url;
}

async function loadDataAndPopulatePickers() {
  const tabSelect = document.getElementById('tab-select');
  const containerSelect = document.getElementById('container-select');
  if (!tabSelect || !containerSelect) return;

  const response = await chrome.runtime.sendMessage({
    type: 'laterlist:getData',
  });

  const data = response?.data;
  const tabs = data?.tabs || [];
  if (!tabs.length) {
    populateSelect(tabSelect, [{ id: '', label: 'No tabs found' }], '');
    populateSelect(
      containerSelect,
      [{ id: '', label: 'No containers found' }],
      '',
    );
    return;
  }

  const tabOptions = tabs.map(tab => ({ id: tab.id, label: tab.name }));
  const selectedTabId = tabOptions[0].id;
  populateSelect(tabSelect, tabOptions, selectedTabId);

  const updateContainers = () => {
    const selectedTab = tabs.find(t => t.id === tabSelect.value) || tabs[0];
    const containers = selectedTab?.containers || [];
    const containerOptions = containers.length
      ? containers.map(c => ({ id: c.id, label: c.name }))
      : [{ id: '', label: 'No containers (will create on save)' }];
    populateSelect(containerSelect, containerOptions, containerOptions[0].id);
  };

  tabSelect.addEventListener('change', updateContainers);
  updateContainers();
}

async function saveToSelection({ closeTabAfterSave }) {
  if (!currentPage.url) return setStatus('No active tab URL found');

  const tabSelect = document.getElementById('tab-select');
  const containerSelect = document.getElementById('container-select');
  const tabId = tabSelect?.value || undefined;
  const containerId = containerSelect?.value || undefined;

  setBusy(true);
  try {
    if (previewExtractionPromise) await previewExtractionPromise;

    // Extract metadata from the current tab (images already extracted in preview via background)
    let publishedAt = null;
    let description = null;
    let summary = null;
    let keywords = null;
    let author = previewData?.author || null;
    let siteName = previewData?.siteName || null;
    let canonical = previewData?.canonical || null;
    let type = previewData?.type || null;
    let locale = previewData?.locale || null;
    let iframes = Array.isArray(previewData?.iframes)
      ? previewData.iframes
      : null;
    let ruleExtracted = Array.isArray(previewData?.ruleExtracted)
      ? previewData.ruleExtracted
      : [];
    if (typeof currentPage.tabId === 'number') {
      try {
        const metaResults = await chrome.scripting.executeScript({
          target: { tabId: currentPage.tabId },
          function: () => {
            const extractJsonLd = () => {
              const scripts = document.querySelectorAll(
                'script[type="application/ld+json"]',
              );
              for (const script of scripts) {
                try {
                  const data = JSON.parse(script.textContent);
                  if (data) return Array.isArray(data) ? data[0] : data;
                } catch {}
              }
              return null;
            };

            const extractPublishedDate = () => {
              const jsonLd = extractJsonLd();
              if (jsonLd?.datePublished)
                return new Date(jsonLd.datePublished).getTime();

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
            };

            const extractDescription = () => {
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
            };

            const extractSummary = () => {
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
                  const cleaned = text.trim().replace(/\\s+/g, ' ');
                  if (cleaned.length > 50) {
                    return cleaned.length > 500
                      ? cleaned.slice(0, 500) + '...'
                      : cleaned;
                  }
                }
              }

              return null;
            };

            const extractKeywords = () => {
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

              const metaKeywords = document.querySelector(
                'meta[name="keywords"]',
              );
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

              const metaTags = document.querySelectorAll(
                'meta[property="article:tag"]',
              );
              metaTags.forEach(tag => {
                const content = tag.getAttribute('content');
                if (content && !seen.has(content)) {
                  seen.add(content);
                  keywords.push(content);
                }
              });

              return keywords.length > 0 ? keywords : null;
            };

            const extractAuthor = () => {
              const authorMeta = document.querySelector(
                'meta[name="author"], meta[property="article:author"], meta[property="og:author"], meta[name="parsely-author"]',
              );
              if (authorMeta?.content) return authorMeta.content.trim();

              const jsonLd = extractJsonLd();
              if (jsonLd?.author) {
                if (typeof jsonLd.author === 'string')
                  return jsonLd.author.trim();
                if (jsonLd.author?.name) return jsonLd.author.name.trim();
              }
              return null;
            };

            const extractSiteName = () => {
              const siteMeta = document.querySelector(
                'meta[property="og:site_name"]',
              );
              if (siteMeta?.content) return siteMeta.content.trim();
              return null;
            };

            const extractCanonical = () => {
              const canonicalLink = document.querySelector(
                'link[rel="canonical"]',
              );
              if (canonicalLink?.href) return canonicalLink.href.trim();
              const ogUrl = document.querySelector('meta[property="og:url"]');
              if (ogUrl?.content) return ogUrl.content.trim();
              return null;
            };

            const extractType = () => {
              const typeMeta = document.querySelector(
                'meta[property="og:type"]',
              );
              if (typeMeta?.content) return typeMeta.content.trim();
              return null;
            };

            const extractLocale = () => {
              const localeMeta = document.querySelector(
                'meta[property="og:locale"]',
              );
              if (localeMeta?.content) return localeMeta.content.trim();
              return null;
            };

            const extractIframes = () => {
              const iframeNodes = document.querySelectorAll('iframe');
              const iframeUrls = [];
              iframeNodes.forEach(iframe => {
                const src = iframe.getAttribute('src');
                if (src && src.trim()) {
                  try {
                    const absoluteSrc = new URL(src, document.baseURI).href;
                    if (!iframeUrls.includes(absoluteSrc))
                      iframeUrls.push(absoluteSrc);
                  } catch {}
                }
              });
              return iframeUrls.length > 0 ? iframeUrls : null;
            };

            return {
              publishedAt: extractPublishedDate(),
              description: extractDescription(),
              summary: extractSummary(),
              keywords: extractKeywords(),
              author: extractAuthor(),
              siteName: extractSiteName(),
              canonical: extractCanonical(),
              type: extractType(),
              locale: extractLocale(),
              iframes: extractIframes(),
            };
          },
        });

        const meta = metaResults?.[0]?.result || {};
        publishedAt = meta.publishedAt;
        description = meta.description;
        summary = meta.summary;
        keywords = meta.keywords;
        author = meta.author || author;
        siteName = meta.siteName || siteName;
        canonical = meta.canonical || canonical;
        type = meta.type || type;
        locale = meta.locale || locale;
        if (Array.isArray(meta.iframes)) iframes = meta.iframes;
        if (Array.isArray(meta.ruleExtracted) && meta.ruleExtracted.length) {
          ruleExtracted = meta.ruleExtracted;
        }
        console.log('[LaterList] Extracted metadata:', meta);
      } catch (error) {
        console.log('[LaterList] Metadata extraction failed:', error);
      }
    }

    // Use selected images if user manually chose them, otherwise let background extract with rules
    const finalImageUrls =
      selectedImageUrls.length > 0
        ? selectedImageUrls
        : previewData.imageUrls || [];
    const finalImageUrl = finalImageUrls.length > 0 ? finalImageUrls[0] : null;

    const result = await chrome.runtime.sendMessage({
      type: 'laterlist:addLink',
      payload: {
        url: currentPage.url,
        title: currentPage.title,
        tabId,
        containerId,
        imageUrl: finalImageUrl,
        imageUrls: finalImageUrls,
        publishedAt,
        description,
        summary,
        keywords,
        author,
        siteName,
        canonical,
        type,
        locale,
        iframes,
        ruleExtracted,
      },
    });

    if (result?.error) {
      setStatus(result.error);
      return;
    }

    // Notify view.html to refresh
    await chrome.runtime.sendMessage({ type: 'laterlist:updateView' });
    await loadSavedCopies();

    if (closeTabAfterSave) {
      const tabIdToClose =
        typeof currentPage.tabId === 'number'
          ? currentPage.tabId
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
              ?.id;

      if (typeof tabIdToClose === 'number') {
        await chrome.tabs.remove(tabIdToClose);
        return;
      }
      setStatus('Saved (could not close tab)');
      return;
    }

    setStatus('Saved');
  } catch {
    setStatus('Save failed');
  } finally {
    setBusy(false);
  }
}

async function saveCurrentToSelection() {
  return saveToSelection({ closeTabAfterSave: false });
}

async function saveAndCloseCurrentTab() {
  return saveToSelection({ closeTabAfterSave: true });
}

async function sendAllTabs() {
  setBusy(true);
  setStatus('Sending all tabs...');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'laterlist:sendAllTabs',
    });

    if (result?.success) {
      // Notify view.html to refresh
      await chrome.runtime.sendMessage({ type: 'laterlist:updateView' });

      setStatus(`✓ ${result.count} tabs saved to "${result.containerName}"`);
      // Close popup after a brief delay
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus(result?.error || 'Failed to send tabs');
    }
  } catch (err) {
    setStatus('Error: ' + (err.message || 'Unknown error'));
  } finally {
    setBusy(false);
  }
}

async function sendTabsAround(direction) {
  setBusy(true);
  const dirText = direction === 'before' ? 'Tabs before...' : 'Tabs after...';
  setStatus(dirText);

  try {
    const messageType =
      direction === 'before'
        ? 'laterlist:sendTabsBefore'
        : 'laterlist:sendTabsAfter';
    const result = await chrome.runtime.sendMessage({
      type: messageType,
    });

    if (result?.success) {
      // Notify view.html to refresh
      await chrome.runtime.sendMessage({ type: 'laterlist:updateView' });

      const dirLabel =
        direction === 'before' ? 'before current' : 'after current';
      setStatus(
        `✓ ${result.count} tabs ${dirLabel} saved to "${result.containerName}"`,
      );
      // Close popup after a brief delay
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus(result?.error || 'Failed to send tabs');
    }
  } catch (err) {
    setStatus('Error: ' + (err.message || 'Unknown error'));
  } finally {
    setBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await updateLinkCount();
  } catch {
    // Non-blocking if count fails
  }

  document.getElementById('open-view')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document
    .getElementById('save-current')
    ?.addEventListener('click', saveCurrentToSelection);

  document
    .getElementById('save-close')
    ?.addEventListener('click', saveAndCloseCurrentTab);

  document
    .getElementById('send-all-tabs')
    ?.addEventListener('click', sendAllTabs);

  document
    .getElementById('send-tabs-before')
    ?.addEventListener('click', () => sendTabsAround('before'));

  document
    .getElementById('send-tabs-after')
    ?.addEventListener('click', () => sendTabsAround('after'));

  document.getElementById('open-settings')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'settings.html' });
  });

  document
    .getElementById('select-all-images')
    ?.addEventListener('click', selectAllImages);
  document
    .getElementById('deselect-all-images')
    ?.addEventListener('click', deselectAllImages);

  try {
    await loadCurrentTab();
    await updateExtractionRuleStatus();
    await loadDataAndPopulatePickers();
    if (typeof currentPage.tabId === 'number') {
      previewExtractionPromise = extractPreview(currentPage.tabId);
    }
    await loadSavedCopies();
  } catch {
    setStatus('Failed to load');
  }

  // Toggle preview details visibility
  document.getElementById('toggle-preview')?.addEventListener('click', () => {
    const details = document.getElementById('preview-details');
    const btn = document.getElementById('toggle-preview');
    if (!details || !btn) return;
    const hidden = details.hasAttribute('hidden');
    if (hidden) {
      details.removeAttribute('hidden');
      btn.textContent = 'Hide details';
    } else {
      details.setAttribute('hidden', '');
      btn.textContent = 'Show details';
    }
  });
});
