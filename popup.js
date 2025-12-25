// popup.js

let currentPage = {
  url: '',
  title: '',
  tabId: null,
};

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
                const timer = setTimeout(() => {
                  img.onload = null;
                  img.onerror = null;
                  resolve(false);
                }, timeout);

                img.onload = () => {
                  clearTimeout(timer);
                  resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
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

            document.querySelectorAll('img').forEach(img => {
              if (!visibleEnough(img)) return;
              const src =
                img.currentSrc || img.src || img.getAttribute('data-src');
              add(src);
            });

            const metaSelectors = [
              'meta[property="og:image"]',
              'meta[name="twitter:image"]',
              'meta[name="twitter:image:src"]',
            ];
            const metaUrls = [];
            metaSelectors.forEach(sel => {
              const el = document.querySelector(sel);
              if (el?.content && !seen.has(el.content.trim())) {
                metaUrls.push(el.content.trim());
              }
            });

            const icon = document.querySelector('link[rel*="icon"]');
            if (icon?.href && !seen.has(icon.href)) {
              metaUrls.push(icon.href);
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

    const result = await chrome.runtime.sendMessage({
      type: 'laterlist:addLink',
      payload: {
        url: currentPage.url,
        title: currentPage.title,
        tabId,
        containerId,
        imageUrl,
        imageUrls,
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

    document.getElementById('link-count').textContent = totalLinks;
  }

  await updateLinkCount();

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

  try {
    await loadCurrentTab();
    await loadDataAndPopulatePickers();
  } catch {
    setStatus('Failed to load');
  }
});
