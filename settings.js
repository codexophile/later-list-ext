// settings.js
// Settings page for LaterList

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

async function loadSettings() {
  const stored = await chrome.storage.local.get('laterlistSettings');
  return mergeSettings(stored.laterlistSettings || {});
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ laterlistSettings: settings });
}

async function loadData() {
  const response = await chrome.runtime.sendMessage({
    type: 'laterlist:getData',
  });
  return response?.data || { tabs: [] };
}

function updatePreview() {
  const formatInput = document.getElementById('container-format');
  const previewEl = document.getElementById('format-preview');

  if (!formatInput || !previewEl) return;

  const format = formatInput.value || DEFAULT_SETTINGS.containerNameFormat;
  const preview = formatContainerName(new Date(), format);
  previewEl.innerHTML = `Preview: <strong>${preview}</strong>`;
}

function showStatus(message, isError = false) {
  const statusEl = document.getElementById('status-message');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = `status-message ${isError ? 'error' : 'success'}`;
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

function parseListTextarea(value) {
  return value
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean);
}

function parsePathRewriteRules(value) {
  const rules = [];
  value
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean)
    .forEach(line => {
      const [pattern, replace = ''] = line.split('=>').map(part => part.trim());
      if (!pattern) return;
      rules.push({ pattern, replace });
    });
  return rules;
}

function formatPathRewriteRules(rules) {
  return (rules || [])
    .map(rule => `${rule.pattern} => ${rule.replace || ''}`.trimEnd())
    .join('\n');
}

function formatList(list) {
  return (list || []).join('\n');
}

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

function getUrlCleanupFromInputs() {
  const enabledEl = document.getElementById('url-cleanup-enabled');
  const stripEl = document.getElementById('strip-tracking-params');
  const namesEl = document.getElementById('tracking-param-names');
  const prefixesEl = document.getElementById('tracking-param-prefixes');
  const hashEl = document.getElementById('hash-ignore-patterns');
  const pathRulesEl = document.getElementById('path-rewrite-rules');

  const enabled = enabledEl ? enabledEl.checked : DEFAULT_URL_CLEANUP.enabled;
  const stripTracking = stripEl
    ? stripEl.checked
    : DEFAULT_URL_CLEANUP.stripTrackingParams;

  return {
    ...DEFAULT_URL_CLEANUP,
    enabled,
    stripTrackingParams: stripTracking,
    trackingParamNames: namesEl ? parseListTextarea(namesEl.value) : [],
    trackingParamPrefixes: prefixesEl
      ? parseListTextarea(prefixesEl.value)
      : [],
    ignoreHashPatterns: hashEl ? parseListTextarea(hashEl.value) : [],
    pathRewriteRules: pathRulesEl
      ? parsePathRewriteRules(pathRulesEl.value)
      : [],
  };
}

function populateUrlCleanupFields(settings) {
  const cleanup = settings.urlCleanup || DEFAULT_URL_CLEANUP;
  const enabledEl = document.getElementById('url-cleanup-enabled');
  if (enabledEl) enabledEl.checked = cleanup.enabled;

  const stripEl = document.getElementById('strip-tracking-params');
  if (stripEl) stripEl.checked = cleanup.stripTrackingParams;

  const namesEl = document.getElementById('tracking-param-names');
  if (namesEl) namesEl.value = formatList(cleanup.trackingParamNames);

  const prefixesEl = document.getElementById('tracking-param-prefixes');
  if (prefixesEl) prefixesEl.value = formatList(cleanup.trackingParamPrefixes);

  const hashEl = document.getElementById('hash-ignore-patterns');
  if (hashEl) hashEl.value = formatList(cleanup.ignoreHashPatterns);

  const pathRulesEl = document.getElementById('path-rewrite-rules');
  if (pathRulesEl)
    pathRulesEl.value = formatPathRewriteRules(cleanup.pathRewriteRules);
}

function updateNormalizationTest() {
  const inputEl = document.getElementById('normalization-input');
  const outputEl = document.getElementById('normalization-output');
  if (!inputEl || !outputEl) return;

  const cleanup = getUrlCleanupFromInputs();
  const value = inputEl.value.trim();

  if (!value) {
    outputEl.textContent = 'Enter a URL to preview cleanup.';
    return;
  }

  outputEl.textContent = normalizeUrlWithSettings(value, cleanup);
}

async function populateDestinationTabs(settingsOverride) {
  const select = document.getElementById('destination-tab');
  if (!select) return;

  const data = await loadData();
  const settings = settingsOverride || (await loadSettings());

  select.innerHTML = '';

  if (!data.tabs || data.tabs.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No tabs available (will use first tab)';
    select.appendChild(option);
    return;
  }

  // Add "First Tab" option
  const firstOption = document.createElement('option');
  firstOption.value = '';
  firstOption.textContent = 'First Tab (default)';
  select.appendChild(firstOption);

  // Add all tabs
  data.tabs.forEach(tab => {
    const option = document.createElement('option');
    option.value = tab.id;
    option.textContent = tab.name;
    if (tab.id === settings.sendAllTabsDestination) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function loadAndPopulateSettings() {
  const settings = await loadSettings();

  const formatInput = document.getElementById('container-format');
  if (formatInput) {
    formatInput.value = settings.containerNameFormat;
  }

  populateUrlCleanupFields(settings);
  await populateDestinationTabs(settings);
  updatePreview();
  updateNormalizationTest();
}

async function handleSave() {
  const formatInput = document.getElementById('container-format');
  const destinationSelect = document.getElementById('destination-tab');
  const saveButton = document.getElementById('save-settings');

  if (!formatInput || !destinationSelect) return;

  const settings = {
    containerNameFormat:
      formatInput.value.trim() || DEFAULT_SETTINGS.containerNameFormat,
    sendAllTabsDestination: destinationSelect.value,
    urlCleanup: getUrlCleanupFromInputs(),
  };

  try {
    saveButton.disabled = true;
    await saveSettings(mergeSettings(settings));
    showStatus('Settings saved successfully!');
  } catch (err) {
    showStatus('Failed to save settings: ' + err.message, true);
  } finally {
    saveButton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAndPopulateSettings();

  const formatInput = document.getElementById('container-format');
  if (formatInput) {
    formatInput.addEventListener('input', updatePreview);
  }

  const saveButton = document.getElementById('save-settings');
  if (saveButton) {
    saveButton.addEventListener('click', handleSave);
  }

  const normalizationIds = [
    'url-cleanup-enabled',
    'strip-tracking-params',
    'tracking-param-names',
    'tracking-param-prefixes',
    'hash-ignore-patterns',
    'path-rewrite-rules',
    'normalization-input',
  ];

  normalizationIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventName, updateNormalizationTest);
  });
});
