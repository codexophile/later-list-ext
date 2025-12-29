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
};

// Track which images are selected for saving
let selectedImageUrls = [];

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

// Extract lightweight preview info from the active tab
async function extractPreview(tabId) {
  if (typeof tabId !== 'number') return;
  try {
    const imgResults = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => {
        const isSvg = url => {
          const u = (url || '').trim().toLowerCase();
          return u.endsWith('.svg') || u.startsWith('data:image/svg');
        };
        const candidates = [];
        const seen = new Set();
        const add = url => {
          if (!url) return;
          const trimmed = url.trim();
          if (!trimmed || seen.has(trimmed)) return;
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
          if (
            !img.complete ||
            img.naturalWidth === 0 ||
            img.naturalHeight === 0
          )
            return false;
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w < 96 || h < 96) return false;
          const ratio = w / h;
          return ratio > 0.3 && ratio < 3.5 && img.offsetParent !== null;
        };
        document.querySelectorAll('img').forEach(img => {
          if (!visibleEnough(img)) return;
          const src = img.currentSrc || img.src || img.getAttribute('data-src');
          add(src);
        });
        [
          'meta[property="og:image"]',
          'meta[name="twitter:image"]',
          'meta[name="twitter:image:src"]',
        ].forEach(sel => {
          const el = document.querySelector(sel);
          if (el?.content && !isSvg(el.content)) add(el.content);
        });
        const icon = document.querySelector('link[rel*="icon"]');
        if (icon?.href && !isSvg(icon.href)) add(icon.href);
        return candidates;
      },
    });
    const imageUrls = imgResults?.[0]?.result || [];

    const metaResults = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => {
        const extractJsonLd = () => {
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
        };
        const jsonLd = extractJsonLd();
        const description =
          jsonLd?.description ||
          document.querySelector('meta[name="description"]')?.content ||
          document.querySelector('meta[property="og:description"]')?.content ||
          null;
        const publishedCandidates = [
          document.querySelector('meta[property="article:published_time"]')
            ?.content,
          document.querySelector('meta[name="publish_date"]')?.content,
          document.querySelector('meta[name="date"]')?.content,
          document.querySelector('meta[property="og:published_time"]')?.content,
          jsonLd?.datePublished,
        ].filter(Boolean);
        let publishedAt = null;
        for (const v of publishedCandidates) {
          const ts = new Date(v).getTime();
          if (!isNaN(ts)) {
            publishedAt = ts;
            break;
          }
        }
        const keywords =
          jsonLd?.keywords ||
          document.querySelector('meta[name="keywords"]')?.content ||
          null;
        return { description, publishedAt, keywords };
      },
    });
    const meta = metaResults?.[0]?.result || {};

    previewData = {
      imageUrl: imageUrls[0] || null,
      imageUrls,
      description: meta?.description || null,
      summary: null,
      publishedAt: meta?.publishedAt || null,
      keywords: meta?.keywords || null,
    };
    // Reset selected images - select ALL by default
    selectedImageUrls = [...imageUrls];
    renderPreview();
  } catch {}
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
    if (selectedImageUrls.length === 0 && (previewData.imageUrls || []).length > 0) {
      selectedImageUrls = [...previewData.imageUrls];
      const checkboxes = imagesEl.querySelectorAll('.image-checkbox');
      checkboxes.forEach(cb => (cb.checked = true));
    }
  }
  if (dateEl) {
    if (previewData.publishedAt) {
      dateEl.textContent = new Date(
        previewData.publishedAt
      ).toLocaleDateString();
    } else {
      dateEl.textContent = '';
    }
  }
  if (keywordsEl) {
    keywordsEl.textContent = previewData.keywords || '';
  }
  if (summaryEl) {
    if (previewData.summary) {
      summaryEl.textContent = previewData.summary;
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
      ''
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
    // Extract images from the current tab
    let imageUrls = [];
    let imageUrl = null;
    if (typeof currentPage.tabId === 'number') {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: currentPage.tabId },
          function: async () => {
            const testImageUrl = (url, timeout = 3000) => {
              return new Promise(resolve => {
                const img = new Image();
                const MIN_DIM = 128;
                const timer = setTimeout(() => {
                  img.onload = null;
                  img.onerror = null;
                  resolve(false);
                }, timeout);

                img.onload = () => {
                  clearTimeout(timer);
                  resolve(
                    img.naturalWidth >= MIN_DIM && img.naturalHeight >= MIN_DIM
                  );
                };

                img.onerror = () => {
                  clearTimeout(timer);
                  resolve(false);
                };

                img.src = url;
              });
            };

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
              if (
                !img.complete ||
                img.naturalWidth === 0 ||
                img.naturalHeight === 0
              )
                return false;
              const w = img.naturalWidth || img.width || 0;
              const h = img.naturalHeight || img.height || 0;
              if (w < 128 || h < 128) return false;
              const ratio = w / h;
              return ratio > 0.3 && ratio < 3.5 && img.offsetParent !== null;
            };

            const isInExcludedContext = img => {
              const selectors = [
                'nav',
                'header',
                'footer',
                'aside',
                'form',
                'button',
                '[role="navigation"]',
                '[role="banner"]',
                '[role="contentinfo"]',
                '[role="toolbar"]',
                '[role="tablist"]',
                '[aria-label*="breadcrumb" i]',
                '.sidebar',
                '.menu',
              ];
              return Boolean(img.closest(selectors.join(',')));
            };

            document.querySelectorAll('img').forEach(img => {
              if (!visibleEnough(img)) return;
              if (isInExcludedContext(img)) return;
              const src =
                img.currentSrc || img.src || img.getAttribute('data-src');
              add(src);
            });

            const metaSelectors = [
              'meta[property="og:image"]',
              'meta[name="twitter:image"]',
              'meta[name="twitter:image:src"]',
            ];
            const isBlockedMeta = url => {
              const lowered = url.trim().toLowerCase();
              const pattern = /logo|icon|sprite|favicon|social|share/;
              if (pattern.test(lowered)) return true;
              try {
                const parsed = new URL(url, location.href);
                const path = parsed.pathname.toLowerCase();
                if (path.includes('favicon')) return true;
                const file = path.split('/').pop() || '';
                return pattern.test(file);
              } catch {
                return false;
              }
            };
            const metaUrls = [];
            metaSelectors.forEach(sel => {
              const el = document.querySelector(sel);
              if (el?.content) {
                const val = el.content.trim();
                if (!seen.has(val) && !isSvg(val) && !isBlockedMeta(val)) {
                  metaUrls.push(val);
                }
              }
            });

            const icon = document.querySelector('link[rel*="icon"]');
            if (icon?.href) {
              const val = icon.href;
              if (!seen.has(val) && !isSvg(val)) {
                metaUrls.push(val);
              }
            }

            const validationPromises = metaUrls.map(async url => {
              const isValid = await testImageUrl(url);
              return isValid ? url : null;
            });

            const validatedMeta = (
              await Promise.all(validationPromises)
            ).filter(Boolean);

            return [...validatedMeta, ...candidates];
          },
        });
        imageUrls = results?.[0]?.result || [];
        imageUrl = imageUrls[0] || null;
        console.log('[LaterList] Extracted image URLs:', imageUrls);
      } catch (error) {
        // If extraction fails, continue without images
        console.log('[LaterList] Image extraction failed:', error);
        imageUrls = [];
        imageUrl = null;
      }
    }

    // Extract metadata from the current tab
    let publishedAt = null;
    let description = null;
    let summary = null;
    let keywords = null;
    if (typeof currentPage.tabId === 'number') {
      try {
        const metaResults = await chrome.scripting.executeScript({
          target: { tabId: currentPage.tabId },
          function: () => {
            const extractJsonLd = () => {
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
                'meta[name="keywords"]'
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
                'meta[property="article:tag"]'
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

            return {
              publishedAt: extractPublishedDate(),
              description: extractDescription(),
              summary: extractSummary(),
              keywords: extractKeywords(),
            };
          },
        });

        const meta = metaResults?.[0]?.result || {};
        publishedAt = meta.publishedAt;
        description = meta.description;
        summary = meta.summary;
        keywords = meta.keywords;
        console.log('[LaterList] Extracted metadata:', meta);
      } catch (error) {
        console.log('[LaterList] Metadata extraction failed:', error);
      }
    }

    // Use selected images instead of all extracted images
    const finalImageUrls =
      selectedImageUrls.length > 0 ? selectedImageUrls : imageUrls;
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
      },
    });

    if (result?.error) {
      setStatus(result.error);
      return;
    }

    // Notify view.html to refresh
    await chrome.runtime.sendMessage({ type: 'laterlist:updateView' });

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
        `✓ ${result.count} tabs ${dirLabel} saved to "${result.containerName}"`
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
  async function updateLinkCount() {
    const response = await chrome.runtime.sendMessage({
      type: 'laterlist:getData',
    });

    const data = response?.data;
    let totalLinks = 0;

    // Count all links across all tabs and containers
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

  document.getElementById('select-all-images')?.addEventListener('click', selectAllImages);
  document.getElementById('deselect-all-images')?.addEventListener('click', deselectAllImages);

  try {
    await loadCurrentTab();
    await loadDataAndPopulatePickers();
    if (typeof currentPage.tabId === 'number') {
      extractPreview(currentPage.tabId);
    }
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
