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

const DEFAULT_IMAGE_RULES = [];

const DEFAULT_SETTINGS = {
  containerNameFormat: 'ddd, MMM DD, YYYY at HHmm Hrs',
  sendAllTabsDestination: '', // Empty means first tab
  urlCleanup: DEFAULT_URL_CLEANUP,
  imageRules: DEFAULT_IMAGE_RULES,
  gist: {
    token: '',
    gistId: '',
    fileName: 'laterlist.json',
    autoSync: false,
  },
};

function mergeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.urlCleanup = { ...DEFAULT_URL_CLEANUP, ...(raw.urlCleanup || {}) };
  merged.imageRules = Array.isArray(raw.imageRules) ? raw.imageRules : [];
  merged.gist = { ...DEFAULT_SETTINGS.gist, ...(raw.gist || {}) };
  return merged;
}

// --- Gist sync support ---
let _gistSyncTimer = null;
let _gistSyncInProgress = false;

function scheduleGistSync(delay = 1200) {
  try {
    if (_gistSyncTimer) clearTimeout(_gistSyncTimer);
    _gistSyncTimer = setTimeout(() => {
      _gistSyncTimer = null;
      performGistSync().catch(err => {
        console.warn('[LaterList] Gist sync failed:', err);
      });
    }, delay);
  } catch (err) {
    console.warn('[LaterList] scheduleGistSync failed:', err);
  }
}

async function performGistSync(force = false) {
  if (_gistSyncInProgress) return;
  _gistSyncInProgress = true;
  try {
    const settings = await getSettings();
    const gist = settings.gist || {};
    if (!force) {
      if (!gist.autoSync) return;
    }
    if (!gist.token || !gist.gistId || !gist.fileName) return;

    const stored = await chrome.storage.local.get([
      'readLaterData',
      'laterlistSettings',
      METADATA_CACHE_KEY,
    ]);

    // Remove any secret token from settings before uploading to gist
    let laterlistSettingsToUpload = stored.laterlistSettings || settings;
    try {
      laterlistSettingsToUpload = JSON.parse(
        JSON.stringify(laterlistSettingsToUpload),
      );
      if (laterlistSettingsToUpload && laterlistSettingsToUpload.gist) {
        laterlistSettingsToUpload.gist = {
          ...laterlistSettingsToUpload.gist,
          token: '',
        };
      }
    } catch (err) {
      // fallback: ensure no token
      if (laterlistSettingsToUpload && laterlistSettingsToUpload.gist) {
        laterlistSettingsToUpload.gist = {
          ...laterlistSettingsToUpload.gist,
          token: '',
        };
      }
    }

    const payload = {
      readLaterData: stored.readLaterData || DEFAULT_DATA,
      laterlistSettings: laterlistSettingsToUpload,
      metadataCache: stored[METADATA_CACHE_KEY] || {},
      exportedAt: Date.now(),
    };

    const body = {
      files: {
        [gist.fileName]: { content: JSON.stringify(payload, null, 2) },
      },
    };

    const resp = await fetch(`https://api.github.com/gists/${gist.gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${gist.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gist update failed: ${resp.status} ${text}`);
    }
    console.log('[LaterList] Gist sync completed');
    return true;
  } finally {
    _gistSyncInProgress = false;
  }
}

async function restoreFromGist() {
  const settings = await getSettings();
  const gist = settings.gist || {};
  if (!gist.token || !gist.gistId || !gist.fileName) {
    throw new Error('Missing gist settings');
  }

  const resp = await fetch(`https://api.github.com/gists/${gist.gistId}`, {
    method: 'GET',
    headers: {
      Authorization: `token ${gist.token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gist fetch failed: ${resp.status} ${text}`);
  }

  const g = await resp.json();
  if (!g.files || !g.files[gist.fileName] || !g.files[gist.fileName].content) {
    throw new Error('Gist file not found or empty');
  }

  let parsed;
  try {
    parsed = JSON.parse(g.files[gist.fileName].content);
  } catch (err) {
    throw new Error('Invalid JSON in gist file');
  }

  const toSet = {};
  if (parsed.readLaterData) toSet.readLaterData = parsed.readLaterData;
  if (parsed.laterlistSettings) {
    // Preserve any locally stored token instead of trusting token in gist
    const existing = await chrome.storage.local.get('laterlistSettings');
    const existingToken = existing?.laterlistSettings?.gist?.token || '';

    const parsedGist = parsed.laterlistSettings.gist || {};
    parsedGist.token = existingToken;

    toSet.laterlistSettings = { ...parsed.laterlistSettings, gist: parsedGist };
  }
  if (parsed.metadataCache) toSet[METADATA_CACHE_KEY] = parsed.metadataCache;

  if (Object.keys(toSet).length === 0)
    throw new Error('No supported keys in gist file');

  await chrome.storage.local.set(toSet);
  // Notify view to refresh
  chrome.runtime.sendMessage({ type: 'laterlist:updateView' }).catch(() => {});
  return { success: true };
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|\[\]\\]/g, '\\$&');
  const regex = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regex, 'i');
}

function getActiveImageRule(settings, url) {
  const rules = settings?.imageRules || [];
  for (const rule of rules) {
    if (!rule?.pattern) continue;
    try {
      const re = wildcardToRegex(rule.pattern.trim());
      if (re.test(url || '')) {
        return {
          allow: Array.isArray(rule.allow) ? rule.allow : [],
          deny: Array.isArray(rule.deny) ? rule.deny : [],
        };
      }
    } catch (err) {
      console.warn(
        '[LaterList] Invalid image rule pattern:',
        rule.pattern,
        err,
      );
    }
  }
  return { allow: [], deny: [] };
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

const VIEW_URL = chrome.runtime.getURL('view.html');

// Persistent metadata cache captured when tabs finish loading
const METADATA_CACHE_KEY = 'metadataCache';
const MAX_METADATA_CACHE_ENTRIES = 100;

async function getMetadataCacheObject() {
  try {
    const obj = await chrome.storage.local.get(METADATA_CACHE_KEY);
    return obj[METADATA_CACHE_KEY] || {};
  } catch {
    return {};
  }
}

async function getMetadataFromCache(url) {
  if (!url) return null;
  const cache = await getMetadataCacheObject();
  return cache[url] || null;
}

async function saveMetadataToCache(url, data) {
  if (!url || !data) return;
  try {
    const cache = await getMetadataCacheObject();
    cache[url] = { ...data, capturedAt: Date.now() };

    // Trim oldest entries if exceeding max size
    const keys = Object.keys(cache);
    if (keys.length > MAX_METADATA_CACHE_ENTRIES) {
      keys.sort(
        (a, b) => (cache[a].capturedAt || 0) - (cache[b].capturedAt || 0),
      );
      const excess = keys.length - MAX_METADATA_CACHE_ENTRIES;
      for (let i = 0; i < excess; i++) delete cache[keys[i]];
    }

    await chrome.storage.local.set({ [METADATA_CACHE_KEY]: cache });
  } catch (err) {
    if (err.message && err.message.includes('quota')) {
      console.warn('[LaterList] Quota exceeded, clearing old metadata cache');
      // Clear cache and try saving just this one entry
      try {
        const freshCache = { [url]: { ...data, capturedAt: Date.now() } };
        await chrome.storage.local.set({ [METADATA_CACHE_KEY]: freshCache });
      } catch (retryErr) {
        console.error(
          '[LaterList] Cannot save metadata even after clearing cache:',
          retryErr,
        );
      }
    } else {
      throw err;
    }
  }
}

function getViewTabQueryPatterns() {
  return [VIEW_URL, `${VIEW_URL}#*`, `${VIEW_URL}?*`];
}

async function ensureViewTab({
  activate = false,
  reload = false,
  pinned = true,
} = {}) {
  try {
    const viewTabs = await chrome.tabs.query({
      url: getViewTabQueryPatterns(),
    });
    let target = viewTabs[0];

    if (target) {
      const updates = {};
      if (pinned && !target.pinned) updates.pinned = true;
      if (activate) updates.active = true;

      if (Object.keys(updates).length > 0) {
        target = await chrome.tabs.update(target.id, updates);
      }

      if (reload) {
        try {
          await chrome.tabs.reload(target.id);
        } catch {}
      }

      return target;
    }

    return await chrome.tabs.create({
      url: 'view.html',
      active: activate,
      pinned,
    });
  } catch (err) {
    console.warn('Could not ensure view tab:', err);
    return null;
  }
}

async function getData() {
  const stored = await chrome.storage.local.get('readLaterData');
  if (stored.readLaterData) return stored.readLaterData;
  await chrome.storage.local.set({ readLaterData: DEFAULT_DATA });
  return DEFAULT_DATA;
}

async function saveData(data) {
  try {
    await chrome.storage.local.set({ readLaterData: data });
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    const trimmed = trimDataToQuota(data);
    await chrome.storage.local.set({ readLaterData: trimmed });
  }
}

function moveLinkToTrashInData(data, tabId, containerId, linkId) {
  const tab = data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return null;

  const linkIndex = container.links.findIndex(l => l.id === linkId);
  if (linkIndex === -1) return null;

  const [removed] = container.links.splice(linkIndex, 1);
  removed.deletedAt = Date.now();
  data.trash = data.trash || [];
  data.trash.push(removed);
  return removed;
}

const STORAGE_QUOTA_BYTES =
  chrome?.storage?.local?.QUOTA_BYTES || 5 * 1024 * 1024;

function estimateBytes(value) {
  try {
    const json = JSON.stringify(value);
    return new TextEncoder().encode(json).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isQuotaError(err) {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('quota') || message.includes('quota_bytes');
}

function pruneLinkMetadata(link) {
  if (!link || typeof link !== 'object') return;
  if (Array.isArray(link.imageUrls) && !link.imageUrl && link.imageUrls[0]) {
    link.imageUrl = link.imageUrls[0];
  }
  delete link.imageUrls;
  delete link.iframes;
  delete link.summary;
  delete link.description;
  delete link.keywords;
}

function trimDataToQuota(data) {
  let currentBytes = estimateBytes(data);
  if (currentBytes <= STORAGE_QUOTA_BYTES) return data;

  // Remove heavy metadata fields from all links to reduce size
  const allLinks = [];
  data?.tabs?.forEach(tab => {
    tab?.containers?.forEach(container => {
      container?.links?.forEach(link => {
        allLinks.push({ container, link, bucket: 'tab' });
      });
    });
  });
  data?.trash?.forEach(link => {
    allLinks.push({ container: data.trash, link, bucket: 'trash' });
  });

  allLinks.forEach(({ link }) => pruneLinkMetadata(link));

  return data;
}

async function getSettings() {
  const stored = await chrome.storage.local.get('laterlistSettings');
  return mergeSettings(stored.laterlistSettings || {});
}

// Automatic metadata extraction on page load has been disabled.
// Metadata extraction now occurs only when a link is saved (user action)
// or when explicitly requested from the main UI. The previous onUpdated
// listener performed in-page scans and image validations after every
// completed tab load which could cause high concurrent memory and CPU
// usage on image-heavy pages or when many tabs load in parallel.

// NOTE: If you need to re-enable automatic capture in the future, restore
// the listener above or implement a configurable setting to toggle it.

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

// Helper function to check if URL supports extraction
function canExtractFromUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Only allow http and https
  return lower.startsWith('http://') || lower.startsWith('https://');
}

function copyMetadataToLink(extracted, link) {
  if (extracted.imageUrls?.length > 0) {
    link.imageUrls = extracted.imageUrls;
    link.imageUrl = extracted.imageUrl;
  }
  if (extracted.publishedAt) link.publishedAt = extracted.publishedAt;
  if (extracted.description) link.description = extracted.description;
  if (extracted.summary) link.summary = extracted.summary;
  if (extracted.keywords) link.keywords = extracted.keywords;
  if (extracted.author) link.author = extracted.author;
  if (extracted.siteName) link.siteName = extracted.siteName;
  if (extracted.canonical) link.canonical = extracted.canonical;
  if (extracted.type) link.type = extracted.type;
  if (extracted.locale) link.locale = extracted.locale;
  if (extracted.iframes) link.iframes = extracted.iframes;
}

async function sendAllBrowserTabsToLaterList() {
  try {
    // Get all browser tabs from all windows
    const allBrowserTabs = await chrome.tabs.query({});

    // Get the view.html URL to filter it out
    const viewUrl = VIEW_URL;

    // Filter: exclude pinned tabs, extension pages, and view.html
    const tabsToSave = allBrowserTabs.filter(tab => {
      if (tab.pinned) return false;
      if (!tab.url) return false;
      // Exclude extension pages, chrome:// pages, etc.
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))
        return false;
      // Exclude view.html specifically
      if (tab.url.includes('view.html') || tab.url.startsWith(viewUrl))
        return false;
      return true;
    });

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
      settings.containerNameFormat,
    );
    const newContainer = {
      id: `container-${Date.now()}`,
      name: containerName,
      links: [],
    };

    // Convert browser tabs to links
    const savedTabIds = [];
    const linksByTab = new Map(); // tab.id -> link object

    for (const tab of tabsToSave) {
      if (tab.url && tab.id !== undefined) {
        const linkId = `link-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const link = {
          id: linkId,
          title: tab.title || tab.url,
          url: tab.url,
          savedAt: Date.now(),
          metaStatus: 'pending',
          metaError: '',
        };

        const isHttp = canExtractFromUrl(tab.url);
        const cached = isHttp ? await getMetadataFromCache(tab.url) : null;
        if (cached) {
          if (cached.imageUrls?.length > 0) {
            link.imageUrls = cached.imageUrls;
            link.imageUrl = cached.imageUrl;
          }
          if (cached.publishedAt) link.publishedAt = cached.publishedAt;
          if (cached.description) link.description = cached.description;
          if (cached.summary) link.summary = cached.summary;
          if (cached.keywords) link.keywords = cached.keywords;
          if (cached.author) link.author = cached.author;
          if (cached.siteName) link.siteName = cached.siteName;
          if (cached.canonical) link.canonical = cached.canonical;
          if (cached.type) link.type = cached.type;
          if (cached.locale) link.locale = cached.locale;
          if (cached.iframes) link.iframes = cached.iframes;
          link.metaStatus = 'done';
          link.metaError = '';
        } else if (!tab.discarded && isHttp) {
          // Live tab: mark for extraction, will do in parallel after loop
          link.metaStatus = 'processing';
          linksByTab.set(tab.id, { link, tabId: tab.id });
        } else if (isHttp) {
          // Discarded/hibernated tabs are not extracted after save.
          link.metaStatus = 'skipped';
          link.metaError = 'Metadata not collected for discarded tabs';
        } else {
          // Unsupported scheme: skip extraction
          link.metaStatus = 'skipped';
          link.metaError = 'Unsupported URL scheme';
        }

        newContainer.links.push(link);
        savedTabIds.push(tab.id);
      }
    }

    // Add container to the BEGINNING of the target tab
    targetTab.containers.unshift(newContainer);

    // Save data first
    await saveData(data);

    // Extract metadata from live tabs in parallel (non-blocking)
    if (linksByTab.size > 0) {
      const extractPromises = Array.from(linksByTab.values()).map(
        async ({ link, tabId: liveTabId }) => {
          try {
            const rule = getActiveImageRule(settings, link.url);
            const extracted = await extractFromTab(liveTabId, link.url, rule);
            if (extracted.imageUrls?.length > 0) {
              link.imageUrls = extracted.imageUrls;
              link.imageUrl = extracted.imageUrl;
            }
            if (extracted.publishedAt) link.publishedAt = extracted.publishedAt;
            if (extracted.description) link.description = extracted.description;
            if (extracted.summary) link.summary = extracted.summary;
            if (extracted.keywords) link.keywords = extracted.keywords;
            if (extracted.author) link.author = extracted.author;
            if (extracted.siteName) link.siteName = extracted.siteName;
            if (extracted.canonical) link.canonical = extracted.canonical;
            if (extracted.type) link.type = extracted.type;
            if (extracted.locale) link.locale = extracted.locale;
            if (extracted.iframes) link.iframes = extracted.iframes;
            link.metaStatus = 'done';
            link.metaError = '';
          } catch (err) {
            link.metaStatus = 'failed';
            link.metaError = err?.message || 'Metadata extraction failed';
          }
        },
      );

      // Wait for all live extractions in parallel (with timeout safety)
      await Promise.allSettled(extractPromises);

      // Save updated links
      await saveData(data);
    }

    // Close successfully saved tabs
    if (savedTabIds.length > 0) {
      try {
        console.log(
          `[LaterList] Closing ${savedTabIds.length} tabs, IDs:`,
          savedTabIds,
        );
        await chrome.tabs.remove(savedTabIds);
        console.log('[LaterList] Tabs closed successfully');
      } catch (err) {
        console.warn('Some tabs could not be closed:', err);
      }
    } else {
      console.warn('[LaterList] No tabs to close (savedTabIds is empty)');
    }

    await ensureViewTab({ activate: true, reload: true });

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
    const viewUrl = VIEW_URL;

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

    // Filter: exclude pinned tabs, extension pages, and view.html
    tabsToSave = tabsToSave.filter(tab => {
      if (tab.pinned) return false;
      if (!tab.url) return false;
      // Exclude extension pages, chrome:// pages, etc.
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))
        return false;
      // Exclude view.html specifically
      if (tab.url.includes('view.html') || tab.url.startsWith(viewUrl))
        return false;
      return true;
    });

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
      settings.containerNameFormat,
    );
    const newContainer = {
      id: `container-${Date.now()}`,
      name: containerName,
      links: [],
    };

    // Convert browser tabs to links
    const savedTabIds = [];
    const linksByTab = new Map(); // tab.id -> link object

    for (const tab of tabsToSave) {
      if (tab.url && tab.id !== undefined) {
        const linkId = `link-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const link = {
          id: linkId,
          title: tab.title || tab.url,
          url: tab.url,
          savedAt: Date.now(),
          metaStatus: 'pending',
          metaError: '',
        };

        const isHttp = canExtractFromUrl(tab.url);
        const cached = isHttp ? await getMetadataFromCache(tab.url) : null;
        if (cached) {
          if (cached.imageUrls?.length > 0) {
            link.imageUrls = cached.imageUrls;
            link.imageUrl = cached.imageUrl;
          }
          if (cached.publishedAt) link.publishedAt = cached.publishedAt;
          if (cached.description) link.description = cached.description;
          if (cached.summary) link.summary = cached.summary;
          if (cached.keywords) link.keywords = cached.keywords;
          if (cached.author) link.author = cached.author;
          if (cached.siteName) link.siteName = cached.siteName;
          if (cached.canonical) link.canonical = cached.canonical;
          if (cached.type) link.type = cached.type;
          if (cached.locale) link.locale = cached.locale;
          if (cached.iframes) link.iframes = cached.iframes;
          link.metaStatus = 'done';
          link.metaError = '';
        } else if (!tab.discarded && isHttp) {
          // Live tab: mark for extraction, will do in parallel after loop
          link.metaStatus = 'processing';
          linksByTab.set(tab.id, { link, tabId: tab.id });
        } else if (isHttp) {
          // Discarded/hibernated tabs are not extracted after save.
          link.metaStatus = 'skipped';
          link.metaError = 'Metadata not collected for discarded tabs';
        } else {
          // Unsupported scheme: skip extraction
          link.metaStatus = 'skipped';
          link.metaError = 'Unsupported URL scheme';
        }

        newContainer.links.push(link);
        savedTabIds.push(tab.id);
      }
    }

    // Add container to the BEGINNING of the target tab
    targetTab.containers.unshift(newContainer);

    // Save data first
    await saveData(data);

    // Extract metadata from live tabs in parallel (non-blocking)
    if (linksByTab.size > 0) {
      const extractPromises = Array.from(linksByTab.values()).map(
        async ({ link, tabId: liveTabId }) => {
          try {
            const rule = getActiveImageRule(settings, link.url);
            const extracted = await extractFromTab(liveTabId, link.url, rule);
            if (extracted.imageUrls?.length > 0) {
              link.imageUrls = extracted.imageUrls;
              link.imageUrl = extracted.imageUrl;
            }
            if (extracted.publishedAt) link.publishedAt = extracted.publishedAt;
            if (extracted.description) link.description = extracted.description;
            if (extracted.summary) link.summary = extracted.summary;
            if (extracted.keywords) link.keywords = extracted.keywords;
            if (extracted.author) link.author = extracted.author;
            if (extracted.siteName) link.siteName = extracted.siteName;
            if (extracted.canonical) link.canonical = extracted.canonical;
            if (extracted.type) link.type = extracted.type;
            if (extracted.locale) link.locale = extracted.locale;
            if (extracted.iframes) link.iframes = extracted.iframes;
            link.metaStatus = 'done';
            link.metaError = '';
          } catch (err) {
            link.metaStatus = 'failed';
            link.metaError = err?.message || 'Metadata extraction failed';
          }
        },
      );

      // Wait for all live extractions in parallel (with timeout safety)
      await Promise.allSettled(extractPromises);

      // Save updated links
      await saveData(data);
    }

    // Close successfully saved tabs
    if (savedTabIds.length > 0) {
      try {
        await chrome.tabs.remove(savedTabIds);
      } catch (err) {
        console.warn('Some tabs could not be closed:', err);
      }
    }

    await ensureViewTab({ activate: true, reload: true });

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
  author,
  siteName,
  canonical,
  type,
  locale,
  iframes,
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
    author,
    siteName,
    canonical,
    type,
    locale,
    iframes,
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
    'author',
    'siteName',
    'canonical',
    'type',
    'locale',
    'iframes',
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

async function getSavedLinksForUrl(url) {
  if (!url) return [];

  const settings = await getSettings();
  const normalize = target =>
    normalizeUrlWithSettings(target, settings.urlCleanup);
  const target = normalize(url);
  const data = await getData();
  const matches = [];

  for (const tab of data.tabs || []) {
    for (const container of tab.containers || []) {
      for (const link of container.links || []) {
        if (normalize(link.url) !== target) continue;
        matches.push({
          tabId: tab.id,
          tabName: tab.name,
          containerId: container.id,
          containerName: container.name,
          linkId: link.id,
          title: link.title,
          url: link.url,
          savedAt: link.savedAt,
        });
      }
    }
  }

  return matches.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

async function trashSavedLink(payload) {
  const data = await getData();
  const removed = moveLinkToTrashInData(
    data,
    payload?.tabId,
    payload?.containerId,
    payload?.linkId,
  );
  if (!removed) throw new Error('Saved link not found');

  await saveData(data);
  return removed;
}

async function refreshTabActionState(tabId, url) {
  try {
    // Check if tab still exists before updating
    await chrome.tabs.get(tabId);

    const saved = await isUrlSaved(url);
    const title = saved ? 'Saved in LaterList' : 'Save to LaterList';
    await chrome.action.setTitle({ tabId, title });
    await chrome.action.setBadgeText({ tabId, text: saved ? '✓' : '' });
    if (saved) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2E7D32' });
    }
  } catch (err) {
    // Silently ignore errors for closed tabs
    if (!err?.message?.includes('No tab with id')) {
      console.warn('[LaterList] refreshTabActionState failed:', err);
    }
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
      'i',
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
      err,
    );
  }
  return [];
}

async function extractMetadataForLink({ url, linkId } = {}) {
  if (!url) {
    throw new Error('URL is required for metadata extraction');
  }

  let tempTab = null;
  try {
    // Create a hidden tab to extract metadata
    tempTab = await chrome.tabs.create({ url, active: false });

    // Wait for the page to load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Page load timeout'));
      }, 30000); // 30 second timeout

      const listener = (tabId, changeInfo) => {
        if (tabId === tempTab.id && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Get settings for image rules
    const settings = await getSettings();
    const rule = getActiveImageRule(settings, url);

    // Extract metadata using the existing function
    const metadata = await extractFromTab(tempTab.id, url, rule);

    return metadata;
  } catch (err) {
    console.warn('[LaterList] extractMetadataForLink failed for', url, err);
    throw new Error(err.message || 'Failed to extract metadata');
  } finally {
    // Always clean up the temporary tab
    if (tempTab?.id) {
      try {
        await chrome.tabs.remove(tempTab.id);
      } catch (e) {
        console.warn('[LaterList] Failed to close temp tab:', e);
      }
    }
  }
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

async function extractFromHtml(html, url, rule = { allow: [], deny: [] }) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
    author: null,
    siteName: null,
    canonical: null,
    type: null,
    locale: null,
    iframes: [],
  };

  try {
    if (typeof DOMParser === 'undefined') {
      // DOMParser is not available in MV3 service workers; skip HTML parsing.
      return result;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const allowSelectors = Array.isArray(rule.allow) ? rule.allow : [];
    const denySelectors = Array.isArray(rule.deny) ? rule.deny : [];

    const matchesAny = (el, selectors) =>
      selectors.some(sel => {
        try {
          return el.matches(sel);
        } catch {
          return false;
        }
      });

    const isAllowed = el =>
      !allowSelectors.length || matchesAny(el, allowSelectors);
    const isDenied = el => matchesAny(el, denySelectors);

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

    const seen = new Set();
    const metaUrls = [];
    const imgUrls = [];
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ];

    metaSelectors.forEach(sel => {
      const el = doc.querySelector(sel);
      if (el?.content) {
        if (isDenied(el)) return;
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

    // Visible images from HTML (best-effort without size checks)
    doc.querySelectorAll('img').forEach(img => {
      if (isDenied(img)) return;
      if (!isAllowed(img)) return;
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (!src) return;
      const abs = absolutizeUrl(src, url);
      if (!abs || seen.has(abs) || isSvg(abs)) return;
      seen.add(abs);
      imgUrls.push(abs);
    });

    let iconUrl = null;
    const iconEl = doc.querySelector('link[rel*="icon"]');
    if (iconEl && !isDenied(iconEl)) {
      const href = iconEl.getAttribute('href');
      const abs = absolutizeUrl(href, url);
      if (abs && !isSvg(abs) && !isBlockedMeta(abs)) {
        iconUrl = abs;
      }
    }

    const combined = metaUrls.concat(imgUrls);
    if (!combined.length && iconUrl) combined.push(iconUrl);

    result.imageUrls = combined;
    result.imageUrl = combined[0] || null;

    // Extract metadata
    const extractJsonLd = () => {
      const scripts = doc.querySelectorAll(
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

    // Author
    const authorMeta = doc.querySelector('meta[name="author"]');
    if (authorMeta?.content) {
      result.author = authorMeta.content.trim();
    } else if (jsonLd?.author?.name) {
      result.author = jsonLd.author.name;
    }

    // Site Name
    const siteNameMeta = doc.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta?.content) {
      result.siteName = siteNameMeta.content.trim();
    }

    // Canonical URL
    const canonicalLink = doc.querySelector('link[rel="canonical"]');
    if (canonicalLink?.href) {
      result.canonical = canonicalLink.href.trim();
    }

    // Content Type
    const typeMeta = doc.querySelector('meta[property="og:type"]');
    if (typeMeta?.content) {
      result.type = typeMeta.content.trim();
    }

    // Locale
    const localeMeta = doc.querySelector('meta[property="og:locale"]');
    if (localeMeta?.content) {
      result.locale = localeMeta.content.trim();
    }

    // Summary: combine description + first paragraph
    if (result.description) {
      result.summary = result.description;
    }
    // Try to get first paragraph for richer summary
    const firstParagraph = doc.querySelector(
      'article p, .entry-content p, .post-content p, main p',
    );
    if (firstParagraph?.textContent) {
      const paragraphText = firstParagraph.textContent.trim();
      if (paragraphText.length > 50) {
        if (result.summary && result.summary !== paragraphText) {
          // Combine both if different
          result.summary = `${result.summary}\n\n${paragraphText}`;
        } else if (!result.summary) {
          result.summary = paragraphText;
        }
      }
    }

    // iframes
    const iframes = doc.querySelectorAll('iframe');
    const iframeUrls = [];
    iframes.forEach(iframe => {
      const src = iframe.getAttribute('src');
      if (src && src.trim()) {
        const absoluteSrc = absolutizeUrl(src, url);
        if (absoluteSrc && !iframeUrls.includes(absoluteSrc)) {
          iframeUrls.push(absoluteSrc);
        }
      }
    });
    if (iframeUrls.length > 0) {
      result.iframes = iframeUrls;
    }
  } catch (err) {
    console.warn('[LaterList] HTML extraction failed:', err);
  }

  return result;
}

async function extractFromUrl(url, rule = { allow: [], deny: [] }) {
  try {
    const res = await fetch(url, { redirect: 'follow', credentials: 'omit' });
    if (!res.ok) return { imageUrls: [], imageUrl: null };
    const html = await res.text();
    return await extractFromHtml(html, url, rule);
  } catch (err) {
    console.warn('[LaterList] extractFromUrl failed for', url, err);
    return { imageUrls: [], imageUrl: null };
  }
}

async function extractFromTab(tabId, pageUrl, rule = { allow: [], deny: [] }) {
  const result = {
    imageUrls: [],
    imageUrl: null,
    publishedAt: null,
    description: null,
    summary: null,
    keywords: null,
    author: null,
    siteName: null,
    canonical: null,
    type: null,
    locale: null,
    iframes: [],
  };

  try {
    // Safety check: only extract from http/https URLs
    if (
      !pageUrl ||
      (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://'))
    ) {
      return result;
    }

    const allowSelectors = Array.isArray(rule.allow) ? rule.allow : [];
    const denySelectors = Array.isArray(rule.deny) ? rule.deny : [];

    // Extract images
    const imageResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (allowSelectors, denySelectors) => {
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
                img.naturalWidth >= MIN_DIM && img.naturalHeight >= MIN_DIM,
              );
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            img.src = url;
          });
        };

        const matchesAny = (el, selectors) =>
          selectors.some(sel => {
            try {
              return el.matches(sel);
            } catch {
              return false;
            }
          });

        const isAllowed = el =>
          !allowSelectors.length || matchesAny(el, allowSelectors);
        const isDenied = el => matchesAny(el, denySelectors);

        const candidates = [];
        const seen = new Set();

        const isSvg = url => {
          const u = url.trim().toLowerCase();
          return u.endsWith('.svg') || u.startsWith('data:image/svg');
        };

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

        // Meta tags first
        const metaSelectors = [
          'meta[property="og:image"]',
          'meta[name="twitter:image"]',
          'meta[name="twitter:image:src"]',
        ];
        const metaUrls = [];
        metaSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            if (isDenied(el)) return;
            const val = el.content?.trim();
            if (!val) return;
            if (!seen.has(val) && !isSvg(val) && !isBlockedMeta(val)) {
              metaUrls.push(val);
            }
          });
        });

        const validationPromises = metaUrls.map(async url => {
          const isValid = await testImageUrl(url);
          return isValid ? url : null;
        });
        const validatedMeta = (await Promise.all(validationPromises)).filter(
          Boolean,
        );
        validatedMeta.forEach(v => seen.add(v));

        // Visible images next
        document.querySelectorAll('img').forEach(img => {
          if (!visibleEnough(img)) return;
          if (isInExcludedContext(img)) return;
          if (isDenied(img)) return;
          if (!isAllowed(img)) return;
          const src = img.currentSrc || img.src || img.getAttribute('data-src');
          add(src);
        });

        // Icon fallback only if nothing else
        let iconUrl = null;
        const icon = document.querySelector('link[rel*="icon"]');
        if (icon?.href && !validatedMeta.length && !candidates.length) {
          if (!isDenied(icon)) {
            const val = icon.href;
            if (!seen.has(val) && !isSvg(val) && !isBlockedMeta(val)) {
              const ok = await testImageUrl(val);
              if (ok) iconUrl = val;
            }
          }
        }

        const combined = [...validatedMeta, ...candidates];
        if (!combined.length && iconUrl) combined.push(iconUrl);
        return combined;
      },
      args: [allowSelectors, denySelectors],
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
          const authorMeta = document.querySelector('meta[name="author"]');
          if (authorMeta?.content) return authorMeta.content.trim();
          const jsonLd = extractJsonLd();
          if (jsonLd?.author?.name) return jsonLd.author.name;
          return null;
        };

        const extractSiteName = () => {
          const siteNameMeta = document.querySelector(
            'meta[property="og:site_name"]',
          );
          if (siteNameMeta?.content) return siteNameMeta.content.trim();
          return null;
        };

        const extractCanonical = () => {
          const canonicalLink = document.querySelector('link[rel="canonical"]');
          if (canonicalLink?.href) return canonicalLink.href.trim();
          return null;
        };

        const extractType = () => {
          const typeMeta = document.querySelector('meta[property="og:type"]');
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
          const iframes = document.querySelectorAll('iframe');
          const iframeUrls = [];
          iframes.forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src && src.trim()) {
              try {
                // Convert to absolute URL
                const absoluteSrc = new URL(src, document.baseURI).href;
                if (!iframeUrls.includes(absoluteSrc)) {
                  iframeUrls.push(absoluteSrc);
                }
              } catch (e) {
                // Ignore invalid URLs
              }
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
    result.publishedAt = meta.publishedAt;
    result.description = meta.description;
    result.summary = meta.summary;
    result.keywords = meta.keywords;
    result.author = meta.author;
    result.siteName = meta.siteName;
    result.canonical = meta.canonical;
    result.type = meta.type;
    result.locale = meta.locale;
    result.iframes = meta.iframes || [];
    result.type = meta.type;
    result.locale = meta.locale;
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
  await ensureViewTab({ activate: true, pinned: true });
  // Set a pleasant badge background for the saved indicator
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#2E7D32' });
  } catch {}
  console.log('LaterList installed and initialized.');
});

chrome.runtime.onStartup.addListener(async () => {
  createContextMenus();
  await ensureViewTab({ pinned: true });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  const title = info.selectionText || tab?.title || url;
  if (!url) return;

  // Extract images and metadata if we have a valid tab
  let payload = { url, title };
  if (tab?.id && typeof tab.id === 'number') {
    try {
      const settings = await getSettings();
      const rule = getActiveImageRule(settings, url);
      // Use fetch-based extraction for discarded tabs
      const extracted = tab.discarded
        ? await extractFromUrl(url, rule)
        : await extractFromTab(tab.id, url, rule);
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
  if (message?.type === 'laterlist:getSettings') {
    getSettings()
      .then(settings => sendResponse({ settings }))
      .catch(() => sendResponse({ settings: mergeSettings() }));
    return true;
  }
  if (message?.type === 'laterlist:extractFromTab') {
    (async () => {
      try {
        const settings = await getSettings();
        const rule = getActiveImageRule(settings, message.url);
        const extracted = await extractFromTab(
          message.tabId,
          message.url,
          rule,
        );
        sendResponse({ extracted });
      } catch (err) {
        console.warn('[LaterList] extractFromTab failed:', err);
        sendResponse({ extracted: null, error: err?.message });
      }
    })();
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
  if (message?.type === 'laterlist:getSavedLinksForUrl') {
    getSavedLinksForUrl(message.payload?.url)
      .then(savedLinks => sendResponse({ savedLinks }))
      .catch(err => sendResponse({ savedLinks: [], error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:trashSavedLink') {
    trashSavedLink(message.payload || {})
      .then(removed => {
        if (message.payload?.tabId && message.payload?.url) {
          refreshTabActionState(message.payload.tabId, message.payload.url);
        }
        sendResponse({ removed });
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
  if (message?.type === 'laterlist:gistSync') {
    performGistSync(true)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err?.message }));
    return true;
  }
  if (message?.type === 'laterlist:gistRestore') {
    restoreFromGist()
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err?.message }));
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
  if (message?.type === 'laterlist:extractMetadata') {
    extractMetadataForLink(message.payload || {})
      .then(metadata => sendResponse({ success: true, metadata }))
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
  if (areaName !== 'local') return;

  const changedRelevant =
    changes.readLaterData ||
    changes.laterlistSettings ||
    changes[METADATA_CACHE_KEY];

  // Refresh UI state for all tabs
  chrome.tabs
    .query({})
    .then(tabs => {
      tabs.forEach(t => {
        if (t.url) refreshTabActionState(t.id, t.url);
      });
    })
    .catch(() => {});

  // Schedule gist sync if enabled
  if (changedRelevant) {
    scheduleGistSync();
  }
});
