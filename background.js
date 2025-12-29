// background.js
// Core data store and background services for LaterList.

const DEFAULT_URL_CLEANUP = {
  enabled: true,
  stripTrackingParams: true,
  trackingParamNames: ['ref', 'ref_src', 'igshid'],
  trackingParamPrefixes: ['utm_', 'icid', 'fbclid', 'gclid', 'mc_eid'],
  ignoreHashPatterns: ['^slot=\\d+$'],
  pathRewriteRules: [
    { pattern: '^/models/([^/]+)(?:/.*)?$', replace: '/models/$1' },
  ],
  trimTrailingSlash: true,
  lowercase: true,
};

const DEFAULT_SETTINGS = {
  containerNameFormat: 'ddd, MMM DD, YYYY at HHmm Hrs',
  sendAllTabsDestination: '', // Empty means first tab
  urlCleanup: DEFAULT_URL_CLEANUP,
};

function mergeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.urlCleanup = { ...DEFAULT_URL_CLEANUP, ...(raw.urlCleanup || {}) };
  return merged;
}

const DEFAULT_DATA = {
  tabs: [
    {
      id: 'tab-1',
      name: 'Getting Started',
      containers: [
        {
          id: 'container-1',
          name: 'Examples',
          links: [
            {
              id: 'link-1',
              title: 'LaterList (repo)',
              url: 'https://example.com/laterlist',
              savedAt: Date.now(),
            },
            {
              id: 'link-2',
              title: 'MDN: WebExtensions',
              url: 'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions',
              savedAt: Date.now(),
            },
          ],
        },
      ],
    },
  ],
  trash: [],
};

async function getData() {
  const stored = await chrome.storage.local.get('readLaterData');
  if (stored.readLaterData) return stored.readLaterData;
  await chrome.storage.local.set({ readLaterData: DEFAULT_DATA });
  return DEFAULT_DATA;
}

async function saveData(data) {
  await chrome.storage.local.set({ readLaterData: data });
}

async function getSettings() {
  const stored = await chrome.storage.local.get('laterlistSettings');
  return mergeSettings(stored.laterlistSettings || {});
}

// Simple date formatter
function formatContainerName(date, formatString) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const pad = n => String(n).padStart(2, '0');

  const tokens = {
    YYYY: date.getFullYear(),
    YY: String(date.getFullYear()).slice(-2),
    MMM: months[date.getMonth()],
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    ddd: days[date.getDay()],
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    HHmm: pad(date.getHours()) + pad(date.getMinutes()),
  };

  let result = formatString;
  Object.entries(tokens).forEach(([token, value]) => {
    result = result.replace(new RegExp(token, 'g'), value);
  });

  return result;
}

async function sendAllBrowserTabsToLaterList() {
  try {
    // Get all browser tabs from all windows
    const allBrowserTabs = await chrome.tabs.query({});

    // Get the view.html URL to filter it out
    const viewUrl = chrome.runtime.getURL('view.html');

    // Filter: exclude pinned tabs and view.html
    const tabsToSave = allBrowserTabs.filter(
      tab =>
        !tab.pinned &&
        !tab.url.includes('view.html') &&
        !tab.url.startsWith(viewUrl)
    );

    if (tabsToSave.length === 0) {
      return {
        success: false,
        error: 'No tabs to save (all tabs are pinned or excluded)',
      };
    }

    // Get settings and data
    const settings = await getSettings();
    const data = await getData();

    // Determine destination tab
    let targetTab;
    if (settings.sendAllTabsDestination) {
      targetTab = data.tabs.find(t => t.id === settings.sendAllTabsDestination);
    }
    if (!targetTab) {
      targetTab = ensureTab(data, null); // Use first tab as fallback
    }

    // Create new container with formatted name
    const containerName = formatContainerName(
      new Date(),
      settings.containerNameFormat
    );
    const newContainer = {
      id: `container-${Date.now()}`,
      name: containerName,
      links: [],
    };

    // Convert browser tabs to links with extraction
    const savedTabIds = [];
    for (const tab of tabsToSave) {
      if (tab.url && tab.id !== undefined) {
        const link = {
          id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          title: tab.title || tab.url,
          url: tab.url,
          savedAt: Date.now(),
        };

        // Extract images and metadata if possible
        if (typeof tab.id === 'number') {
          try {
            // Use fetch-based extraction for discarded tabs
            const extracted = tab.discarded
              ? await extractFromUrl(tab.url)
              : await extractFromTab(tab.id);
            if (extracted.imageUrls?.length > 0) {
              link.imageUrls = extracted.imageUrls;
              link.imageUrl = extracted.imageUrl;
            }
            if (extracted.publishedAt) link.publishedAt = extracted.publishedAt;
            if (extracted.description) link.description = extracted.description;
            if (extracted.summary) link.summary = extracted.summary;
            if (extracted.keywords) link.keywords = extracted.keywords;
          } catch (err) {
            console.warn(
              '[LaterList] Extraction failed for tab:',
              tab.url,
              err
            );
          }
        }

        newContainer.links.push(link);
        savedTabIds.push(tab.id);
      }
    }

    // Add container to the BEGINNING of the target tab
    targetTab.containers.unshift(newContainer);

    // Save data
    await saveData(data);

    // Close successfully saved tabs
    if (savedTabIds.length > 0) {
      try {
        await chrome.tabs.remove(savedTabIds);
      } catch (err) {
        console.warn('Some tabs could not be closed:', err);
      }
    }

    // Open or activate view.html and reload it
    try {
      const viewTabs = await chrome.tabs.query({ url: viewUrl });
      if (viewTabs.length > 0) {
        // View tab exists, activate and reload it
        await chrome.tabs.update(viewTabs[0].id, { active: true });
        await chrome.tabs.reload(viewTabs[0].id);
      } else {
        // Open new view tab
        await chrome.tabs.create({ url: 'view.html', active: true });
      }
    } catch (err) {
      console.warn('Could not open/reload view.html:', err);
    }

    return {
      success: true,
      count: savedTabIds.length,
      containerName,
      targetTabName: targetTab.name,
    };
  } catch (err) {
    console.error('Error sending all tabs:', err);
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}

async function sendTabsAroundCurrentTab(direction) {
  try {
    // Get active tab in current window
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab || activeTab.id === undefined) {
      return {
        success: false,
        error: 'No active tab found',
      };
    }

    // Get all tabs in the current window
    const windowTabs = await chrome.tabs.query({
      windowId: activeTab.windowId,
    });

    if (windowTabs.length === 0) {
      return {
        success: false,
        error: 'No tabs found in current window',
      };
    }

    // Get the view.html URL to filter it out
    const viewUrl = chrome.runtime.getURL('view.html');

    // Find active tab index
    const activeTabIndex = windowTabs.findIndex(t => t.id === activeTab.id);

    // Filter tabs based on direction
    let tabsToSave;
    if (direction === 'before') {
      // All tabs BEFORE the active tab
      tabsToSave = windowTabs.slice(0, activeTabIndex);
    } else if (direction === 'after') {
      // All tabs AFTER the active tab
      tabsToSave = windowTabs.slice(activeTabIndex + 1);
    } else {
      return {
        success: false,
        error: 'Invalid direction',
      };
    }

    // Filter: exclude pinned tabs and view.html
    tabsToSave = tabsToSave.filter(
      tab =>
        !tab.pinned &&
        !tab.url.includes('view.html') &&
        !tab.url.startsWith(viewUrl)
    );

    if (tabsToSave.length === 0) {
      const directionText =
        direction === 'before' ? 'to the left' : 'to the right';
      return {
        success: false,
        error: `No tabs to save ${directionText} (all are pinned or excluded)`,
      };
    }

    // Get settings and data
    const settings = await getSettings();
    const data = await getData();

    // Determine destination tab
    let targetTab;
    if (settings.sendAllTabsDestination) {
      targetTab = data.tabs.find(t => t.id === settings.sendAllTabsDestination);
    }
    if (!targetTab) {
      targetTab = ensureTab(data, null); // Use first tab as fallback
    }

    // Create new container with formatted name
    const containerName = formatContainerName(
      new Date(),
      settings.containerNameFormat
    );
    const newContainer = {
      id: `container-${Date.now()}`,
      name: containerName,
      links: [],
    };

    // Convert browser tabs to links
    const savedTabIds = [];
    for (const tab of tabsToSave) {
      if (tab.url && tab.id !== undefined) {
        const link = {
          id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          title: tab.title || tab.url,
          url: tab.url,
          savedAt: Date.now(),
        };

        // Extract images and metadata if possible
        if (typeof tab.id === 'number') {
          try {
            // Use fetch-based extraction for discarded tabs
            const extracted = tab.discarded
              ? await extractFromUrl(tab.url)
              : await extractFromTab(tab.id);
            if (extracted.imageUrls?.length > 0) {
              link.imageUrls = extracted.imageUrls;
              link.imageUrl = extracted.imageUrl;
            }
            if (extracted.publishedAt) link.publishedAt = extracted.publishedAt;
            if (extracted.description) link.description = extracted.description;
            if (extracted.summary) link.summary = extracted.summary;
            if (extracted.keywords) link.keywords = extracted.keywords;
          } catch (err) {
            console.warn(
              '[LaterList] Extraction failed for tab:',
              tab.url,
              err
            );
          }
        }

        newContainer.links.push(link);
        savedTabIds.push(tab.id);
      }
    }

    // Add container to the BEGINNING of the target tab
    targetTab.containers.unshift(newContainer);

    // Save data
    await saveData(data);

    // Close successfully saved tabs
    if (savedTabIds.length > 0) {
      try {
        await chrome.tabs.remove(savedTabIds);
      } catch (err) {
        console.warn('Some tabs could not be closed:', err);
      }
    }

    // Open or activate view.html and reload it
    try {
      const viewTabs = await chrome.tabs.query({ url: viewUrl });
      if (viewTabs.length > 0) {
        // View tab exists, activate and reload it
        await chrome.tabs.update(viewTabs[0].id, { active: true });
        await chrome.tabs.reload(viewTabs[0].id);
      } else {
        // Open new view tab
        await chrome.tabs.create({ url: 'view.html', active: true });
      }
    } catch (err) {
      console.warn('Could not open/reload view.html:', err);
    }

    return {
      success: true,
      count: savedTabIds.length,
      containerName,
      targetTabName: targetTab.name,
      direction,
    };
  } catch (err) {
    console.error('Error sending tabs:', err);
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}

function ensureTab(data, tabId) {
  if (!data.tabs.length) {
    data.tabs.push({
      id: `tab-${Date.now()}`,
      name: 'Saved',
      containers: [],
    });
  }

  if (tabId) {
    const tab = data.tabs.find(t => t.id === tabId);
    if (tab) return tab;
  }

  return data.tabs[0];
}

function ensureContainerInTab(tab) {
  if (!tab.containers.length) {
    tab.containers.push({
      id: `container-${Date.now()}`,
      name: 'Links',
      links: [],
    });
  }
  return tab.containers[0];
}

async function addLink({
  url,
  title,
  tabId,
  containerId,
  imageUrl,
  imageUrls,
  publishedAt,
  description,
  summary,
  keywords,
}) {
  console.log('[LaterList Background] addLink called with:', {
    url,
    title,
    tabId,
    containerId,
    imageUrl,
    imageUrls,
    publishedAt,
    description,
    summary,
    keywords,
  });

  const data = await getData();
  const tab = ensureTab(data, tabId);

  let container = null;
  if (containerId) {
    container = tab.containers.find(c => c.id === containerId) || null;
  }
  if (!container) {
    container = ensureContainerInTab(tab);
  }

  const normalizedImages = Array.isArray(imageUrls)
    ? imageUrls.filter(Boolean)
    : [];
  const primaryImage = imageUrl || normalizedImages[0] || null;
  if (primaryImage && !normalizedImages.length) {
    normalizedImages.push(primaryImage);
  }

  const newLink = {
    id: `link-${Date.now()}`,
    title: title || url,
    url,
    savedAt: Date.now(),
    imageUrl: primaryImage || undefined,
    imageUrls: normalizedImages,
  };

  // Include optional metadata if present
  const extra = [
    'imageUrl',
    'imageUrls',
    'publishedAt',
    'description',
    'summary',
    'keywords',
  ];
  try {
    extra.forEach(key => {
      const val = arguments[0]?.[key];
      if (val !== undefined) newLink[key] = val;
    });
  } catch {}

  if (publishedAt) newLink.publishedAt = publishedAt;
  if (description) newLink.description = description;
  if (summary) newLink.summary = summary;
  if (keywords) newLink.keywords = keywords;

  if (primaryImage) {
    console.log('[LaterList Background] Image URL saved:', primaryImage);
  } else {
    console.log('[LaterList Background] No image URL provided');
  }

  container.links.push(newLink);
  console.log('[LaterList Background] Link saved:', newLink);
  await saveData(data);
  return newLink;
}

function absolutizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

// --- Action badge & title for saved pages ---
function normalizeUrlWithSettings(url, cleanup) {
  const rules = { ...DEFAULT_URL_CLEANUP, ...(cleanup || {}) };
  const fallback = rules.lowercase
    ? (url || '').toLowerCase().trim()
    : (url || '').trim();

  if (!rules.enabled) return fallback;

  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);

    if (rules.stripTrackingParams) {
      const names = rules.trackingParamNames || [];
      const prefixes = rules.trackingParamPrefixes || [];
      [...params.keys()].forEach(key => {
        if (
          names.includes(key) ||
          prefixes.some(prefix => prefix && key.startsWith(prefix))
        ) {
          params.delete(key);
        }
      });
    }

    let path = u.pathname || '/';
    if (Array.isArray(rules.pathRewriteRules)) {
      rules.pathRewriteRules.forEach(rule => {
        if (!rule || !rule.pattern) return;
        try {
          const regex = new RegExp(rule.pattern, 'i');
          if (regex.test(path)) {
            path = path.replace(regex, rule.replace || '');
          }
        } catch (err) {
          console.warn('[LaterList] Invalid path rewrite rule:', rule, err);
        }
      });
    }

    if (rules.trimTrailingSlash !== false) {
      path = path.replace(/\/+$/, '') || '/';
    }

    let hash = u.hash || '';
    const hashValue = hash.startsWith('#') ? hash.slice(1) : hash;
    if (Array.isArray(rules.ignoreHashPatterns)) {
      for (const pattern of rules.ignoreHashPatterns) {
        if (!pattern) continue;
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(hashValue)) {
            hash = '';
            break;
          }
        } catch (err) {
          console.warn('[LaterList] Invalid hash ignore rule:', pattern, err);
        }
      }
    }

    const query = params.toString();
    const basePath = path || '/';
    const base = `${u.protocol}//${u.host}${basePath}`;
    let normalized = query ? `${base}?${query}` : base;
    if (hash) normalized += hash;

    return rules.lowercase ? normalized.toLowerCase() : normalized;
  } catch {
    return fallback;
  }
}

async function isUrlSaved(url) {
  if (!url) return false;
  const settings = await getSettings();
  const normalize = target =>
    normalizeUrlWithSettings(target, settings.urlCleanup);
  const target = normalize(url);
  const data = await getData();
  for (const tab of data.tabs) {
    for (const container of tab.containers) {
      for (const link of container.links) {
        if (normalize(link.url) === target) return true;
      }
    }
  }
  return false;
}

async function refreshTabActionState(tabId, url) {
  try {
    const saved = await isUrlSaved(url);
    const title = saved ? 'Saved in LaterList' : 'Save to LaterList';
    await chrome.action.setTitle({ tabId, title });
    await chrome.action.setBadgeText({ tabId, text: saved ? '✓' : '' });
    if (saved) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2E7D32' });
    }
  } catch (err) {
    console.warn('[LaterList] refreshTabActionState failed:', err);
  }
}

function decodeBasicEntities(str) {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function extractImageFromHtml(html, pageUrl) {
  const findAttr = (tag, attr) => {
    const re = new RegExp(
      `${attr}\\s*=\\s*"([^"]+)"|${attr}\\s*=\\s*'([^']+)'`,
      'i'
    );
    const m = tag.match(re);
    return decodeBasicEntities(m?.[1] || m?.[2] || '');
  };

  const firstMatch = regex => {
    const m = html.match(regex);
    return m ? m[0] : null;
  };

  // og:image
  const ogTag = firstMatch(/<meta[^>]+property=["']og:image["'][^>]*>/i);
  if (ogTag) {
    const content = findAttr(ogTag, 'content');
    const abs = absolutizeUrl(content, pageUrl);
    if (abs) return abs;
  }

  // icon
  const iconTag = firstMatch(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconTag) {
    const href = findAttr(iconTag, 'href');
    const abs = absolutizeUrl(href, pageUrl);
    if (abs) return abs;
  }

  // first img
  const imgTag = firstMatch(/<img[^>]+src=["'][^"']+["'][^>]*>/i);
  if (imgTag) {
    const src = findAttr(imgTag, 'src');
    const abs = absolutizeUrl(src, pageUrl);
    if (abs) return abs;
  }

  return null;
}

async function fetchImageForPage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', credentials: 'omit' });
    if (!res.ok) return [];
    const html = await res.text();
    return extractImagesFromHtml(html, url);
  } catch (err) {
    console.warn(
      '[LaterList Background] fetchImageForPage failed for',
      url,
      err
    );
  }
  return [];
}

async function refreshMissingImages({ limit = 50 } = {}) {
  const data = await getData();

  const targets = [];
  data.tabs.forEach(tab => {
    tab.containers.forEach(container => {
      container.links.forEach(link => {
        if (!link.imageUrl && !link.imageUrls?.length) targets.push(link);
      });
    });
  });

  data.trash.forEach(link => {
    if (!link.imageUrl && !link.imageUrls?.length) targets.push(link);
  });

  let processed = 0;
  let updated = 0;
  const slice = targets.slice(0, limit);
  for (const link of slice) {
    processed += 1;
    const imageUrls = await fetchImageForPage(link.url);
    if (imageUrls && imageUrls.length > 0) {
      link.imageUrls = imageUrls;
      link.imageUrl = imageUrls[0];
      updated += 1;
    }
  }

  if (updated > 0) {
    await saveData(data);
  }

  return {
    processed,
    updated,
    remaining: Math.max(0, targets.length - processed),
  };
}

async function extractFromHtml(html, url) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
  };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const isSvg = url => {
      const u = url.trim().toLowerCase();
      return u.endsWith('.svg') || u.startsWith('data:image/svg');
    };

    const isBlockedMeta = url => {
      const lowered = url.trim().toLowerCase();
      const pattern = /logo|icon|sprite|favicon|social|share/;
      if (pattern.test(lowered)) return true;
      try {
        const parsed = new URL(url, url);
        const path = parsed.pathname.toLowerCase();
        if (path.includes('favicon')) return true;
        const file = path.split('/').pop() || '';
        return pattern.test(file);
      } catch {
        return false;
      }
    };

    // Extract images from meta tags
    const seen = new Set();
    const metaUrls = [];
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ];

    metaSelectors.forEach(sel => {
      const el = doc.querySelector(sel);
      if (el?.content) {
        const val = el.content.trim();
        if (!seen.has(val) && !isSvg(val) && !isBlockedMeta(val)) {
          const abs = absolutizeUrl(val, url);
          if (abs) {
            metaUrls.push(abs);
            seen.add(val);
          }
        }
      }
    });

    result.imageUrls = metaUrls;
    result.imageUrl = metaUrls[0] || null;

    // Extract metadata
    const extractJsonLd = () => {
      const scripts = doc.querySelectorAll(
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

    // Published date
    if (jsonLd?.datePublished) {
      result.publishedAt = new Date(jsonLd.datePublished).getTime();
    } else {
      const dateSelectors = [
        'meta[property="article:published_time"]',
        'meta[name="publish_date"]',
        'meta[name="date"]',
        'meta[property="og:published_time"]',
      ];
      for (const sel of dateSelectors) {
        const el = doc.querySelector(sel);
        const content = el?.getAttribute('content');
        if (content) {
          const timestamp = new Date(content).getTime();
          if (!isNaN(timestamp)) {
            result.publishedAt = timestamp;
            break;
          }
        }
      }
    }

    // Description
    if (jsonLd?.description) {
      result.description = jsonLd.description.trim();
    } else {
      const descSelectors = [
        'meta[property="og:description"]',
        'meta[name="description"]',
        'meta[name="twitter:description"]',
      ];
      for (const sel of descSelectors) {
        const el = doc.querySelector(sel);
        const content = el?.getAttribute('content');
        if (content) {
          result.description = content.trim();
          break;
        }
      }
    }

    // Keywords
    const keywords = [];
    const kwSeen = new Set();
    if (jsonLd?.keywords) {
      const kw = Array.isArray(jsonLd.keywords)
        ? jsonLd.keywords
        : jsonLd.keywords.split(',');
      kw.forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !kwSeen.has(cleaned)) {
          kwSeen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaKeywords = doc.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      const content = metaKeywords.getAttribute('content') || '';
      content.split(',').forEach(k => {
        const cleaned = k.trim();
        if (cleaned && !kwSeen.has(cleaned)) {
          kwSeen.add(cleaned);
          keywords.push(cleaned);
        }
      });
    }

    const metaTags = doc.querySelectorAll('meta[property="article:tag"]');
    metaTags.forEach(tag => {
      const content = tag.getAttribute('content');
      if (content && !kwSeen.has(content)) {
        kwSeen.add(content);
        keywords.push(content);
      }
    });

    if (keywords.length > 0) result.keywords = keywords;
  } catch (err) {
    console.warn('[LaterList] HTML extraction failed:', err);
  }

  return result;
}

async function extractFromUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', credentials: 'omit' });
    if (!res.ok) return { imageUrls: [], imageUrl: null };
    const html = await res.text();
    return await extractFromHtml(html, url);
  } catch (err) {
    console.warn('[LaterList] extractFromUrl failed for', url, err);
    return { imageUrls: [], imageUrl: null };
  }
}

async function extractFromTab(tabId) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
  };

  try {
    // Extract images
    const imageResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
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
          const src = img.currentSrc || img.src || img.getAttribute('data-src');
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

        const validatedMeta = (await Promise.all(validationPromises)).filter(
          Boolean
        );

        return [...validatedMeta, ...candidates];
      },
      world: 'MAIN',
    });

    const imageUrls = imageResults?.[0]?.result || [];
    result.imageUrls = imageUrls;
    result.imageUrl = imageUrls[0] || null;

    // Extract metadata
    const metaResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
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
              const cleaned = text.trim().replace(/\s+/g, ' ');
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
    result.publishedAt = meta.publishedAt;
    result.description = meta.description;
    result.summary = meta.summary;
    result.keywords = meta.keywords;
  } catch (err) {
    console.warn('[LaterList] Extraction failed:', err);
  }

  return result;
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'laterlist-save-link',
      title: 'Save link to LaterList',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'laterlist-save-page',
      title: 'Save page to LaterList',
      contexts: ['page', 'frame'],
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await getData();
  createContextMenus();
  chrome.tabs.create({ url: 'view.html' });
  // Set a pleasant badge background for the saved indicator
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#2E7D32' });
  } catch {}
  console.log('LaterList installed and initialized.');
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  chrome.tabs.create({ url: 'view.html' });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  const title = info.selectionText || tab?.title || url;
  if (!url) return;

  // Extract images and metadata if we have a valid tab
  let payload = { url, title };
  if (tab?.id && typeof tab.id === 'number') {
    try {
      // Use fetch-based extraction for discarded tabs
      const extracted = tab.discarded
        ? await extractFromUrl(url)
        : await extractFromTab(tab.id);
      payload = { ...payload, ...extracted };
    } catch (err) {
      console.warn('[LaterList] Extraction failed for context menu save:', err);
    }
  }

  await addLink(payload);

  // Update the action badge/title for this tab (it remains open)
  if (tab?.id && url) {
    refreshTabActionState(tab.id, url);
  }

  // Notify view.html to refresh
  chrome.runtime.sendMessage({ type: 'laterlist:updateView' }).catch(() => {
    // Ignore errors if view.html is not open
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'laterlist:getData') {
    getData()
      .then(data => sendResponse({ data }))
      .catch(() => sendResponse({ data: DEFAULT_DATA }));
    return true;
  }
  if (message?.type === 'laterlist:addLink') {
    addLink(message.payload)
      .then(link => {
        // If the sender has a tab, refresh the badge for that tab
        if (sender?.tab?.id && message.payload?.url) {
          refreshTabActionState(sender.tab.id, message.payload.url);
        }
        sendResponse({ link });
      })
      .catch(err => sendResponse({ error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:setData') {
    saveData(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:sendAllTabs') {
    sendAllBrowserTabsToLaterList()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:sendTabsBefore') {
    sendTabsAroundCurrentTab('before')
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:sendTabsAfter') {
    sendTabsAroundCurrentTab('after')
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:refreshImages') {
    refreshMissingImages(message.payload || {})
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err?.message }));
    return true;
  }
  return false;
});

// Keyboard command handler
chrome.commands.onCommand.addListener(command => {
  const showNotification = (result, prefix = '') => {
    if (result.success) {
      // Notify view.html to refresh
      chrome.runtime.sendMessage({ type: 'laterlist:updateView' }).catch(() => {
        // Ignore errors if view.html is not open
      });

      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'LaterList',
        message: `${prefix}${result.count} tabs saved to "${result.containerName}"`,
      });
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'LaterList Error',
        message: result.error || 'Failed to save tabs',
      });
    }
  };

  if (command === 'send-all-tabs') {
    sendAllBrowserTabsToLaterList().then(result => {
      showNotification(result);
    });
  } else if (command === 'send-tabs-before') {
    sendTabsAroundCurrentTab('before').then(result => {
      showNotification(result, 'Tabs before: ');
    });
  } else if (command === 'send-tabs-after') {
    sendTabsAroundCurrentTab('after').then(result => {
      showNotification(result, 'Tabs after: ');
    });
  }
});

// Keep the action indicator in sync with tab changes and data updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || '';
  if (url) {
    refreshTabActionState(tabId, url);
  } else if (changeInfo.status === 'complete') {
    // Fallback: fetch tab to read URL when status completes
    chrome.tabs
      .get(tabId)
      .then(t => {
        if (t?.url) refreshTabActionState(tabId, t.url);
      })
      .catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async activeInfo => {
  try {
    const t = await chrome.tabs.get(activeInfo.tabId);
    if (t?.url) refreshTabActionState(activeInfo.tabId, t.url);
  } catch {}
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.readLaterData) return;
  chrome.tabs
    .query({})
    .then(tabs => {
      tabs.forEach(t => {
        if (t.url) refreshTabActionState(t.id, t.url);
      });
    })
    .catch(() => {});
});
