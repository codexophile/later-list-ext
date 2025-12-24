// view.js
// Lightweight view page to browse and manage saved links. Drag/drop and advanced
// features will be added in later iterations.

let state = {
  data: null,
  activeTabId: null,
  duplicateUrls: new Set(),
  viewMode: 'links',
  aggressiveNormalization: false,
  bulkMode: false,
  selectedLinks: new Set(),
};

const dragHoverSwitch = {
  isDragging: false,
  timer: null,
  targetTabId: null,
  highlightEl: null,
};

function setDragHoverActive(isActive) {
  dragHoverSwitch.isDragging = isActive;
  if (!isActive) clearTabHoverSwitch();
}

function clearTabHoverSwitch() {
  if (dragHoverSwitch.timer) {
    clearTimeout(dragHoverSwitch.timer);
    dragHoverSwitch.timer = null;
  }
  if (dragHoverSwitch.highlightEl) {
    dragHoverSwitch.highlightEl.classList.remove('tab-hover-switch');
    dragHoverSwitch.highlightEl = null;
  }
  dragHoverSwitch.targetTabId = null;
}

function scheduleTabHoverSwitch(tabId, tabEl) {
  if (!dragHoverSwitch.isDragging) return;
  if (state.activeTabId === tabId) return;
  if (dragHoverSwitch.targetTabId === tabId) return;

  clearTabHoverSwitch();
  dragHoverSwitch.targetTabId = tabId;
  dragHoverSwitch.highlightEl = tabEl;
  tabEl.classList.add('tab-hover-switch');
  dragHoverSwitch.timer = setTimeout(() => {
    setActiveTab(tabId);
    clearTabHoverSwitch();
  }, 320);
}

const id = prefix =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Unknown';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

let statusOverlay = null;

function createStatusOverlay() {
  if (statusOverlay) return statusOverlay;

  statusOverlay = createEl('div', { className: 'status-overlay' });
  statusOverlay.style.display = 'none';
  document.body.appendChild(statusOverlay);
  return statusOverlay;
}

function showStatusOverlay(linkData) {
  const overlay = createStatusOverlay();

  let content = `<div class="status-overlay-title">${linkData.title}</div>`;
  content += `<div class="status-overlay-section">`;
  content += `<div class="status-overlay-label">URL</div>`;
  content += `<div class="status-overlay-value">${linkData.url}</div>`;
  content += `</div>`;

  if (linkData.savedAt) {
    content += `<div class="status-overlay-section">`;
    content += `<div class="status-overlay-label">Added</div>`;
    content += `<div class="status-overlay-value">${formatDate(
      linkData.savedAt
    )}</div>`;
    content += `<div class="status-overlay-relative">${formatRelativeTime(
      linkData.savedAt
    )}</div>`;
    content += `</div>`;
  }

  if (linkData.deletedAt) {
    content += `<div class="status-overlay-section">`;
    content += `<div class="status-overlay-label">Deleted</div>`;
    content += `<div class="status-overlay-value">${formatDate(
      linkData.deletedAt
    )}</div>`;
    content += `<div class="status-overlay-relative">${formatRelativeTime(
      linkData.deletedAt
    )}</div>`;
    content += `</div>`;
  }

  if (linkData.tabName) {
    content += `<div class="status-overlay-section">`;
    content += `<div class="status-overlay-label">Location</div>`;
    content += `<div class="status-overlay-value">${linkData.tabName} › ${linkData.containerName}</div>`;
    content += `</div>`;
  }

  if (linkData.locked) {
    content += `<div class="status-overlay-section">`;
    content += `<div class="status-overlay-badge locked">🔒 Locked</div>`;
    content += `</div>`;
  }

  overlay.innerHTML = content;
  overlay.style.display = 'block';
}

function hideStatusOverlay() {
  if (statusOverlay) {
    statusOverlay.style.display = 'none';
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function allocateUniqueId(existing, prefix, used) {
  const candidate = ensureString(existing, '');
  if (candidate && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  let next;
  do {
    next = id(prefix);
  } while (used.has(next));
  used.add(next);
  return next;
}

// Repairs imported/legacy data by ensuring all ids exist and are unique.
// Returns true if any changes were made.
function migrateAndFixData(data) {
  if (!data || typeof data !== 'object') return false;

  let changed = false;
  if (!Array.isArray(data.tabs)) {
    data.tabs = [];
    changed = true;
  }
  if (!Array.isArray(data.trash)) {
    data.trash = [];
    changed = true;
  }

  const usedTabIds = new Set();
  const usedContainerIds = new Set();
  const usedLinkIds = new Set();

  data.tabs = ensureArray(data.tabs);
  data.trash = ensureArray(data.trash);

  data.tabs.forEach((tab, tabIndex) => {
    if (!tab || typeof tab !== 'object') {
      data.tabs[tabIndex] = { id: id('tab'), name: 'Tab', containers: [] };
      changed = true;
      tab = data.tabs[tabIndex];
    }

    const nextTabId = allocateUniqueId(tab.id, 'tab', usedTabIds);
    if (tab.id !== nextTabId) {
      tab.id = nextTabId;
      changed = true;
    }

    const nextTabName = ensureString(tab.name, 'Tab');
    if (tab.name !== nextTabName) {
      tab.name = nextTabName;
      changed = true;
    }

    if (!Array.isArray(tab.containers)) {
      tab.containers = [];
      changed = true;
    }
    tab.containers = ensureArray(tab.containers);

    tab.containers.forEach((container, containerIndex) => {
      if (!container || typeof container !== 'object') {
        tab.containers[containerIndex] = {
          id: id('container'),
          name: 'Container',
          links: [],
        };
        changed = true;
        container = tab.containers[containerIndex];
      }

      const nextContainerId = allocateUniqueId(
        container.id,
        'container',
        usedContainerIds
      );
      if (container.id !== nextContainerId) {
        container.id = nextContainerId;
        changed = true;
      }

      const nextContainerName = ensureString(container.name, 'Container');
      if (container.name !== nextContainerName) {
        container.name = nextContainerName;
        changed = true;
      }

      if (!Array.isArray(container.links)) {
        container.links = [];
        changed = true;
      }
      container.links = ensureArray(container.links);

      container.links.forEach((link, linkIndex) => {
        if (!link || typeof link !== 'object') {
          container.links[linkIndex] = {
            id: id('link'),
            title: 'Link',
            url: '',
            savedAt: Date.now(),
          };
          changed = true;
          link = container.links[linkIndex];
        }

        const nextLinkId = allocateUniqueId(link.id, 'link', usedLinkIds);
        if (link.id !== nextLinkId) {
          link.id = nextLinkId;
          changed = true;
        }

        const nextTitle = ensureString(link.title, link.url || 'Link');
        if (link.title !== nextTitle) {
          link.title = nextTitle;
          changed = true;
        }
        const nextUrl = ensureString(link.url, '');
        if (link.url !== nextUrl) {
          link.url = nextUrl;
          changed = true;
        }

        const nextSavedAt =
          typeof link.savedAt === 'number' && Number.isFinite(link.savedAt)
            ? link.savedAt
            : Date.now();
        if (link.savedAt !== nextSavedAt) {
          link.savedAt = nextSavedAt;
          changed = true;
        }
      });
    });
  });

  // Trash links
  data.trash.sort((a, b) => b.savedAt - a.savedAt);
  data.trash.forEach((link, linkIndex) => {
    if (!link || typeof link !== 'object') {
      data.trash[linkIndex] = { id: id('link'), title: 'Link', url: '' };
      changed = true;
      link = data.trash[linkIndex];
    }

    const nextLinkId = allocateUniqueId(link.id, 'link', usedLinkIds);
    if (link.id !== nextLinkId) {
      link.id = nextLinkId;
      changed = true;
    }
    const nextTitle = ensureString(link.title, link.url || 'Link');
    if (link.title !== nextTitle) {
      link.title = nextTitle;
      changed = true;
    }
    const nextUrl = ensureString(link.url, '');
    if (link.url !== nextUrl) {
      link.url = nextUrl;
      changed = true;
    }

    const nextSavedAt =
      typeof link.savedAt === 'number' && Number.isFinite(link.savedAt)
        ? link.savedAt
        : Date.now();
    if (link.savedAt !== nextSavedAt) {
      link.savedAt = nextSavedAt;
      changed = true;
    }
  });

  return changed;
}

async function loadData() {
  const response = await chrome.runtime.sendMessage({
    type: 'laterlist:getData',
  });
  state.data = response?.data;
  if (!state.data.tabs?.length) {
    state.data.tabs = [];
  }

  const changed = migrateAndFixData(state.data);
  if (changed) {
    await persist();
  }

  state.activeTabId = state.activeTabId || state.data.tabs[0]?.id || 'trash';
  // If active tab no longer exists (e.g., ids were repaired), fall back safely.
  if (
    state.activeTabId !== 'trash' &&
    !state.data.tabs.some(t => t.id === state.activeTabId)
  ) {
    state.activeTabId = state.data.tabs[0]?.id || 'trash';
  }
}

async function persist() {
  await chrome.runtime.sendMessage({
    type: 'laterlist:setData',
    payload: state.data,
  });
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);

    // Only strip tracking params if aggressive mode is enabled
    if (state.aggressiveNormalization) {
      const TRACKING_PREFIXES = ['utm_', 'icid', 'fbclid', 'gclid', 'mc_eid'];
      const TRACKING_KEYS = ['ref', 'ref_src', 'igshid'];

      // Drop common tracking params
      [...params.keys()].forEach(key => {
        if (
          TRACKING_KEYS.includes(key) ||
          TRACKING_PREFIXES.some(prefix => key.startsWith(prefix))
        ) {
          params.delete(key);
        }
      });
    }

    const path = u.pathname.replace(/\/+$/, '');
    const query = params.toString();
    const hash = u.hash;
    const base = `${u.protocol}//${u.host}${path || '/'}`;
    return (query ? `${base}?${query}${hash}` : `${base}${hash}`).toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}

function collectDuplicateGroups() {
  const map = new Map();

  state.data.tabs.forEach(tab => {
    tab.containers.forEach(container => {
      container.links.forEach(link => {
        const normalized = normalizeUrl(link.url);
        if (!map.has(normalized)) {
          map.set(normalized, []);
        }
        map.get(normalized).push({
          tabId: tab.id,
          tabName: tab.name,
          containerId: container.id,
          containerName: container.name,
          linkId: link.id,
          title: link.title,
          url: link.url,
          savedAt: link.savedAt,
        });
      });
    });
  });

  return [...map.entries()]
    .filter(([, links]) => links.length > 1)
    .map(([normalized, links]) => ({ normalized, links }))
    .sort((a, b) => b.links.length - a.links.length);
}

function findAllDuplicates() {
  const urlCounts = new Map();
  const allLinks = [];

  state.data.tabs.forEach(tab => {
    tab.containers.forEach(container => {
      container.links.forEach(link => {
        const normalized = normalizeUrl(link.url);
        urlCounts.set(normalized, (urlCounts.get(normalized) || 0) + 1);
        allLinks.push({ link, normalized });
      });
    });
  });

  const duplicates = new Set();
  urlCounts.forEach((count, url) => {
    if (count > 1) duplicates.add(url);
  });

  return duplicates;
}

function addTab() {
  const name = prompt('Tab name');
  if (!name) return;
  state.data.tabs.push({ id: id('tab'), name, containers: [] });
  state.activeTabId = state.data.tabs.at(-1).id;
  persist();
  render();
}

function deleteTab(tabId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  if (!tab) return;
  if (!confirm('Delete tab and send its links to trash?')) return;
  tab.containers.forEach(c => {
    c.links.forEach(link => (link.deletedAt = Date.now()));
    state.data.trash.push(...c.links);
  });
  state.data.tabs = state.data.tabs.filter(t => t.id !== tabId);
  state.activeTabId = state.data.tabs[0]?.id || 'trash';
  persist();
  render();
}

function addContainer(tabId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const name = prompt('Container name');
  if (!name) return;
  tab.containers.unshift({ id: id('container'), name, links: [] });
  persist();
  render();
}

function deleteContainer(tabId, containerId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const container = tab.containers.find(c => c.id === containerId);
  if (!container) return;
  if (!confirm('Delete container and send its links to trash?')) return;
  container.links.forEach(link => (link.deletedAt = Date.now()));
  state.data.trash.push(...container.links);
  tab.containers = tab.containers.filter(c => c.id !== containerId);
  persist();
  render();
}

function addLink(tabId, containerId) {
  const url = prompt('Link URL');
  if (!url) return;
  const title = prompt('Link title (optional)', url) || url;
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return;
  container.links.push({ id: id('link'), title, url, savedAt: Date.now() });
  persist();
  render();
}

function renameTab(tabId, newName) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  if (!tab || !newName.trim()) return;
  tab.name = newName.trim();
  persist();
  render();
}

function renameContainer(tabId, containerId, newName) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container || !newName.trim()) return;
  container.name = newName.trim();
  persist();
  render();
}

function editLink(tabId, containerId, linkId, title, url) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  const link = container?.links.find(l => l.id === linkId);
  if (!link) return;
  if (title) link.title = title.trim();
  if (url) link.url = url.trim();
  persist();
  render();
}

function setActiveTab(tabId) {
  state.activeTabId = tabId;
  render();
}

function toggleBulkMode() {
  state.bulkMode = !state.bulkMode;
  if (!state.bulkMode) state.selectedLinks.clear();
  render();
}

function linkKey(tabId, containerId, linkId) {
  return `${tabId}|${containerId}|${linkId}`;
}

function parseLinkKey(key) {
  const [tabId, containerId, linkId] = key.split('|');
  return { tabId, containerId, linkId };
}

function isLinkSelected(tabId, containerId, linkId) {
  return state.selectedLinks.has(linkKey(tabId, containerId, linkId));
}

function setLinkSelected(tabId, containerId, linkId, selected) {
  const k = linkKey(tabId, containerId, linkId);
  if (selected) state.selectedLinks.add(k);
  else state.selectedLinks.delete(k);
}

function selectAllInContainer(tabId, containerId, selected) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return;
  container.links.forEach(l =>
    setLinkSelected(tabId, containerId, l.id, selected)
  );
}

function clearSelection() {
  state.selectedLinks.clear();
  render();
}

function bulkTrashSelected() {
  if (!state.selectedLinks.size) return;
  if (!confirm(`Trash ${state.selectedLinks.size} selected link(s)?`)) return;
  const keys = Array.from(state.selectedLinks).map(parseLinkKey);
  // Process in a way that tolerates items from multiple containers
  keys.forEach(({ tabId, containerId, linkId }) => {
    moveLinkToTrash(tabId, containerId, linkId);
  });
  state.selectedLinks.clear();
  persist();
  render();
}

function showMoveModal(onConfirm) {
  const modal = createEl('div', { className: 'modal-overlay' });
  const modalContent = createEl('div', { className: 'modal-content' });
  const title = createEl('h2', { textContent: 'Move selected links' });
  const desc = createEl('p', {
    className: 'modal-description',
    textContent: 'Choose a destination container:',
  });

  const select = document.createElement('select');
  select.style.width = '100%';
  select.style.margin = '8px 0 16px';
  state.data.tabs.forEach(tab => {
    tab.containers.forEach(container => {
      const option = document.createElement('option');
      option.value = `${tab.id}|${container.id}`;
      option.textContent = `${tab.name} — ${container.name}`;
      select.appendChild(option);
    });
  });
  if (!select.firstChild) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No containers available';
    select.appendChild(emptyOpt);
  }

  const buttons = createEl('div', { className: 'modal-button-group' });
  const confirmBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: 'Move',
  });
  const cancelBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Cancel',
  });
  confirmBtn.disabled = !select.value;

  select.addEventListener('change', () => {
    confirmBtn.disabled = !select.value;
  });

  confirmBtn.addEventListener('click', () => {
    if (!select.value) return;
    const [tabId, containerId] = select.value.split('|');
    document.body.removeChild(modal);
    onConfirm(tabId, containerId);
  });
  cancelBtn.addEventListener('click', () => document.body.removeChild(modal));

  buttons.appendChild(confirmBtn);
  buttons.appendChild(cancelBtn);
  modalContent.appendChild(title);
  modalContent.appendChild(desc);
  modalContent.appendChild(select);
  modalContent.appendChild(buttons);
  modal.appendChild(modalContent);
  modal.addEventListener('click', e => {
    if (e.target === modal) document.body.removeChild(modal);
  });
  document.body.appendChild(modal);
}

function bulkMoveSelected() {
  if (!state.selectedLinks.size) return;
  showMoveModal((targetTabId, targetContainerId) => {
    const targetTab = state.data.tabs.find(t => t.id === targetTabId);
    const targetContainer = targetTab?.containers.find(
      c => c.id === targetContainerId
    );
    if (!targetContainer) return;

    // Convert to array and sort keys to avoid index shifting issues by removing from bottom? We will remove by id lookup each time.
    const keys = Array.from(state.selectedLinks).map(parseLinkKey);
    keys.forEach(({ tabId, containerId, linkId }) => {
      const fromTab = state.data.tabs.find(t => t.id === tabId);
      const fromContainer = fromTab?.containers.find(c => c.id === containerId);
      if (!fromContainer) return;
      const idx = fromContainer.links.findIndex(l => l.id === linkId);
      if (idx === -1) return;
      const [moved] = fromContainer.links.splice(idx, 1);
      targetContainer.links.push(moved);
    });
    state.selectedLinks.clear();
    persist();
    render();
  });
}

function createEl(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.textContent !== undefined) el.textContent = opts.textContent;
  if (opts.html) el.innerHTML = opts.html;
  if (opts.attrs)
    Object.entries(opts.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  if (opts.style) el.style.cssText = opts.style;
  return el;
}

function attachTooltip(el, label, desc) {
  if (!el) return el;
  el.classList.add('button-with-tooltip');
  const tip = createEl('span', {
    className: 'btn-tooltip',
    textContent: `${label}: ${desc}`,
  });
  el.appendChild(tip);
  return el;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    // Keep query params and hash, just strip protocol prefix
    const path = u.pathname;
    const query = u.search;
    const hash = u.hash;
    return `${u.hostname}${path}${query}${hash}` || url;
  } catch {
    return url;
  }
}

function makeEditable(el, onSave) {
  el.contentEditable = true;
  el.classList.add('editable');
  el.addEventListener(
    'blur',
    () => {
      el.contentEditable = false;
      el.classList.remove('editable');
      const newVal = el.textContent.trim();
      if (newVal) onSave(newVal);
      render();
    },
    { once: true }
  );
  el.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        el.contentEditable = false;
        el.classList.remove('editable');
        render();
      }
    },
    { once: true }
  );
  el.focus();
  document.execCommand('selectAll', false, null);
}

function renderTabs(container) {
  container.innerHTML = '';
  const tabsWrapper = createEl('div', { className: 'tabs' });

  state.data.tabs.forEach(tab => {
    const tabEl = createEl('div', {
      className: `tab${tab.id === state.activeTabId ? ' active' : ''}`,
      onClick: e => {
        setActiveTab(tab.id);
      },
    });

    tabEl.dataset.tabId = tab.id;

    const handleTabDragHover = () => scheduleTabHoverSwitch(tab.id, tabEl);
    const handleTabDragLeave = () => clearTabHoverSwitch();
    tabEl.addEventListener('dragover', handleTabDragHover);
    tabEl.addEventListener('pointerenter', handleTabDragHover);
    tabEl.addEventListener('dragleave', handleTabDragLeave);
    tabEl.addEventListener('pointerleave', handleTabDragLeave);

    const tabName = createEl('span', {
      className: 'tab-name',
      textContent: tab.name,
    });

    const count = tab.containers.reduce((acc, c) => acc + c.links.length, 0);
    const countEl = createEl('span', {
      className: 'tab-count',
      textContent: count,
    });

    const actionsEl = createEl('div', {
      className: 'tab-actions',
    });

    const renameBtn = createEl('button', {
      className: 'tab-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      title: 'Rename tab',
      onClick: e => {
        e.stopPropagation();
        makeEditable(tabName, newName => renameTab(tab.id, newName));
      },
    });
    attachTooltip(renameBtn, 'Rename tab', 'Edit this tab name');

    const removeBtn = createEl('button', {
      className: 'tab-action-btn tab-delete-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      title: 'Delete tab',
      onClick: e => {
        e.stopPropagation();
        deleteTab(tab.id);
      },
    });
    attachTooltip(
      removeBtn,
      'Delete tab',
      'Move all links to trash and remove this tab'
    );

    tabEl.appendChild(tabName);
    tabEl.appendChild(countEl);
    actionsEl.appendChild(renameBtn);
    if (state.data.tabs.length > 1) actionsEl.appendChild(removeBtn);
    tabEl.appendChild(actionsEl);
    tabsWrapper.appendChild(tabEl);
  });

  // Trash tab
  const trashEl = createEl('div', {
    className: `tab trash-tab${state.activeTabId === 'trash' ? ' active' : ''}`,
    textContent: 'Trash',
    onClick: () => setActiveTab('trash'),
  });
  const trashCount = createEl('span', {
    className: 'tab-count',
    textContent: state.data.trash?.length ?? 0,
  });
  trashEl.appendChild(trashCount);

  // Special tabs wrapper for right alignment
  const specialTabsWrapper = createEl('div', { className: 'tabs-special' });

  // Duplicates tab
  const duplicateGroups = collectDuplicateGroups();
  const duplicatesEl = createEl('div', {
    className: `tab duplicates-tab${
      state.activeTabId === 'duplicates' ? ' active' : ''
    }`,
    onClick: () => setActiveTab('duplicates'),
  });
  const duplicatesLabel = createEl('span', {
    className: 'tab-name',
    textContent: 'Duplicates',
  });
  const duplicatesCount = createEl('span', {
    className: 'tab-count',
    textContent: duplicateGroups.length,
  });
  duplicatesEl.appendChild(duplicatesLabel);
  duplicatesEl.appendChild(duplicatesCount);
  specialTabsWrapper.appendChild(duplicatesEl);
  specialTabsWrapper.appendChild(trashEl);

  const addTabBtn = createEl('button', {
    className: 'btn-add-tab',
    html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    title: 'Add tab',
    onClick: e => {
      e.stopPropagation();
      addTab();
    },
  });
  attachTooltip(addTabBtn, 'Add tab', 'Create a new tab');

  tabsWrapper.appendChild(addTabBtn);
  tabsWrapper.appendChild(specialTabsWrapper);

  container.appendChild(tabsWrapper);
}

function ensureArchiveContainer() {
  const firstTab = state.data.tabs[0];
  if (!firstTab) return null;
  let archiveContainer = firstTab.containers.find(c => c.name === 'Archived');
  if (!archiveContainer) {
    archiveContainer = { id: id('container'), name: 'Archived', links: [] };
    firstTab.containers.push(archiveContainer);
  }
  return archiveContainer;
}

function archiveLink(tabId, containerId, linkId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return;
  const linkIndex = container.links.findIndex(l => l.id === linkId);
  if (linkIndex === -1) return;
  const [link] = container.links.splice(linkIndex, 1);
  const archiveContainer = ensureArchiveContainer();
  if (archiveContainer) {
    archiveContainer.links.push(link);
  }
  persist();
  render();
}

function handleOpenLink(url, tabId, containerId, linkId) {
  chrome.tabs.create({ url, active: false });
  if (tabId && containerId && linkId) {
    const link = getLinkById(tabId, containerId, linkId);
    // Only delete if the link is not locked
    if (link && !link.locked) {
      deleteLink(tabId, containerId, linkId);
    }
  }
}

function getLinkById(tabId, containerId, linkId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  return container?.links.find(l => l.id === linkId);
}

function toggleLockLink(tabId, containerId, linkId) {
  const link = getLinkById(tabId, containerId, linkId);
  if (link) {
    link.locked = !link.locked;
    persist();
    render();
  }
}

function deleteLink(tabId, containerId, linkId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return;
  const linkIndex = container.links.findIndex(l => l.id === linkId);
  if (linkIndex === -1) return;
  const [removed] = container.links.splice(linkIndex, 1);
  removed.deletedAt = Date.now();
  state.data.trash = state.data.trash || [];
  state.data.trash.push(removed);
  persist();
  render();
}

function moveLinkToTrash(tabId, containerId, linkId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return null;
  const linkIndex = container.links.findIndex(l => l.id === linkId);
  if (linkIndex === -1) return null;
  const [removed] = container.links.splice(linkIndex, 1);
  removed.deletedAt = Date.now();
  state.data.trash = state.data.trash || [];
  state.data.trash.push(removed);
  return removed;
}

function restoreLink(linkId) {
  const idx = state.data.trash.findIndex(l => l.id === linkId);
  if (idx === -1) return;
  const [link] = state.data.trash.splice(idx, 1);
  const firstTab = state.data.tabs[0];
  if (!firstTab.containers.length) {
    firstTab.containers.push({
      id: `container-${Date.now()}`,
      name: 'Restored',
      links: [],
    });
  }
  firstTab.containers[0].links.push(link);
  persist();
  render();
}

function renderActiveTab(container) {
  container.innerHTML = '';

  if (state.activeTabId === 'trash') {
    const trashContainer = createEl('div', { className: 'trash-container' });
    if (!state.data.trash?.length) {
      trashContainer.textContent = 'Trash is empty';
    } else {
      // Sort trash links by deletedAt in descending order (most recent first)
      const sortedTrash = [...state.data.trash].sort(
        (a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)
      );
      sortedTrash.forEach(link => {
        const linkRow = createEl('div', { className: 'trash-link' });
        const favicon = createEl('img', {
          className: 'link-favicon',
          attrs: {
            src: `https://www.google.com/s2/favicons?sz=32&domain=${
              new URL(link.url).hostname
            }`,
            alt: '',
            loading: 'lazy',
          },
        });
        favicon.onerror = () => {
          favicon.style.display = 'none';
        };
        const linkInfo = createEl('div', { className: 'link-info-wrapper' });
        const anchor = createEl('a', {
          textContent: link.title,
          attrs: { href: link.url, target: '_blank' },
        });
        anchor.addEventListener('click', e => {
          e.preventDefault();
          chrome.tabs.create({ url: link.url, active: false });
        });

        linkInfo.appendChild(anchor);

        // Add hover events for status overlay
        linkRow.addEventListener('mouseenter', () => {
          showStatusOverlay({
            title: link.title,
            url: link.url,
            savedAt: link.savedAt,
            deletedAt: link.deletedAt,
            type: 'trash',
          });
        });
        linkRow.addEventListener('mouseleave', () => {
          hideStatusOverlay();
        });

        const actions = createEl('div', { className: 'trash-actions' });
        const restoreBtn = createEl('button', {
          className: 'btn btn-restore',
          html: '↩️',
          onClick: () => restoreLink(link.id),
        });
        const deleteBtn = createEl('button', {
          className: 'btn btn-delete',
          html: '🗑️',
          onClick: () => {
            state.data.trash = state.data.trash.filter(l => l.id !== link.id);
            persist();
            render();
          },
        });
        attachTooltip(
          restoreBtn,
          'Restore',
          'Return this link to your first tab'
        );
        attachTooltip(deleteBtn, 'Delete', 'Permanently remove this link');
        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);
        linkRow.appendChild(favicon);
        linkRow.appendChild(linkInfo);
        linkRow.appendChild(actions);
        trashContainer.appendChild(linkRow);
      });
    }
    container.appendChild(trashContainer);
    return;
  }

  const tab = state.data.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;

  const containersGrid = createEl('div', { className: 'containers' });
  containersGrid.dataset.tabId = tab.id;
  tab.containers.forEach(containerData => {
    const containerEl = createEl('div', { className: 'container' });
    const header = createEl('div', { className: 'container-header' });
    // Bulk select checkbox in container header
    let containerSelectWrapper = null;
    if (state.bulkMode) {
      containerSelectWrapper = createEl('div', {
        className: 'container-stats',
      });
      const containerCheckbox = document.createElement('input');
      containerCheckbox.type = 'checkbox';
      // Determine if all links in container are selected
      const allSelected =
        containerData.links.length > 0 &&
        containerData.links.every(l =>
          isLinkSelected(tab.id, containerData.id, l.id)
        );
      const anySelected = containerData.links.some(l =>
        isLinkSelected(tab.id, containerData.id, l.id)
      );
      containerCheckbox.checked = allSelected;
      containerCheckbox.indeterminate = !allSelected && anySelected;
      containerCheckbox.addEventListener('click', e => {
        e.stopPropagation();
        selectAllInContainer(tab.id, containerData.id, e.currentTarget.checked);
        render();
      });
      containerSelectWrapper.appendChild(containerCheckbox);
    }
    const nameEl = createEl('div', {
      textContent: containerData.name,
      className: 'container-name',
      style: 'cursor: default; flex: 1;',
    });
    const stats = createEl('div', {
      className: 'link-count',
      textContent: `${containerData.links.length} links`,
    });
    const headerActions = createEl('div', { className: 'container-actions' });

    const renameBtn = createEl('button', {
      className: 'container-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      title: 'Rename container',
      onClick: e => {
        e.stopPropagation();
        makeEditable(nameEl, newName =>
          renameContainer(tab.id, containerData.id, newName)
        );
      },
    });
    attachTooltip(renameBtn, 'Rename container', 'Edit this container name');

    const addLinkBtn = createEl('button', {
      className: 'container-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
      title: 'Add link',
      onClick: e => {
        e.stopPropagation();
        addLink(tab.id, containerData.id);
      },
    });
    attachTooltip(addLinkBtn, 'Add link', 'Add a new link to this container');

    const trashAllBtn = createEl('button', {
      className: 'container-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
      title: 'Trash all links in this container',
      onClick: e => {
        e.stopPropagation();
        if (containerData.links.length === 0) return;
        if (
          !confirm(
            `Trash all ${containerData.links.length} links in "${containerData.name}"?`
          )
        )
          return;
        state.data.trash = state.data.trash || [];
        state.data.trash.push(...containerData.links);
        containerData.links = [];
        persist();
        render();
      },
    });
    attachTooltip(trashAllBtn, 'Trash all', 'Move every link here to Trash');

    const delContainerBtn = createEl('button', {
      className: 'container-action-btn container-delete-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      title: 'Delete container',
      onClick: e => {
        e.stopPropagation();
        deleteContainer(tab.id, containerData.id);
      },
    });
    attachTooltip(
      delContainerBtn,
      'Delete container',
      'Move links to Trash and remove this container'
    );

    headerActions.appendChild(renameBtn);
    headerActions.appendChild(addLinkBtn);
    headerActions.appendChild(trashAllBtn);
    headerActions.appendChild(delContainerBtn);
    if (containerSelectWrapper) header.appendChild(containerSelectWrapper);
    header.appendChild(nameEl);
    header.appendChild(stats);
    header.appendChild(headerActions);

    const content = createEl('div', {
      className: 'container-content',
      attrs: { 'data-tab-id': tab.id, 'data-container-id': containerData.id },
    });
    containerData.links.forEach(link => {
      const isDuplicate = state.duplicateUrls.has(normalizeUrl(link.url));
      const linkRow = createEl('div', {
        className: isDuplicate ? 'link duplicate-link' : 'link',
      });
      // Bulk-select checkbox per link
      if (state.bulkMode) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'link-select-checkbox';
        cb.checked = isLinkSelected(tab.id, containerData.id, link.id);
        cb.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          const checked = !isLinkSelected(tab.id, containerData.id, link.id);
          setLinkSelected(tab.id, containerData.id, link.id, checked);
          render();
        });
        linkRow.appendChild(cb);
        if (isLinkSelected(tab.id, containerData.id, link.id)) {
          linkRow.classList.add('selected');
        }
      }
      const favicon = createEl('img', {
        className: 'link-favicon',
        attrs: {
          src: `https://www.google.com/s2/favicons?sz=32&domain=${
            new URL(link.url).hostname
          }`,
          alt: '',
          loading: 'lazy',
        },
      });
      favicon.onerror = () => {
        favicon.style.display = 'none';
      };
      const linkInfo = createEl('div', { className: 'link-info-wrapper' });
      const anchor = createEl('a', {
        textContent: link.title,
        attrs: { href: link.url, target: '_blank' },
      });
      anchor.addEventListener('click', e => {
        e.preventDefault();
        handleOpenLink(link.url, tab.id, containerData.id, link.id);
      });

      linkInfo.appendChild(anchor);

      // Add hover events for status overlay
      linkRow.addEventListener('mouseenter', () => {
        showStatusOverlay({
          title: link.title,
          url: link.url,
          savedAt: link.savedAt,
          locked: link.locked,
          type: 'regular',
        });
      });
      linkRow.addEventListener('mouseleave', () => {
        hideStatusOverlay();
      });

      anchor.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        const newTitle = prompt('Edit title', link.title) || link.title;
        const newUrl = prompt('Edit URL', link.url) || link.url;
        if (newTitle || newUrl) {
          editLink(tab.id, containerData.id, link.id, newTitle, newUrl);
        }
      });
      const actions = createEl('div', { className: 'container-actions' });

      // Lock button
      const lockBtn = createEl('button', {
        className: 'btn btn-lock',
        html: link.locked ? '🔒' : '🔓',
        onClick: () => toggleLockLink(tab.id, containerData.id, link.id),
      });
      attachTooltip(
        lockBtn,
        link.locked ? 'Unlock link' : 'Lock link',
        link.locked
          ? 'Link is locked. Click to unlock.'
          : 'Protect link from being trashed when opened'
      );
      actions.appendChild(lockBtn);

      const deleteBtn = createEl('button', {
        className: 'btn btn-delete',
        html: '🗑️',
        onClick: () => deleteLink(tab.id, containerData.id, link.id),
      });
      attachTooltip(deleteBtn, 'Trash link', 'Send this link to Trash');
      actions.appendChild(deleteBtn);
      linkRow.appendChild(favicon);
      linkRow.appendChild(linkInfo);
      linkRow.appendChild(actions);

      // Add visual indicator for locked links
      if (link.locked) {
        linkRow.classList.add('link-locked');
      }

      content.appendChild(linkRow);
    });

    containerEl.appendChild(header);
    containerEl.appendChild(content);
    containersGrid.appendChild(containerEl);
  });

  container.appendChild(containersGrid);

  const addContainerBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '+ Container',
    onClick: () => addContainer(tab.id),
  });
  container.appendChild(addContainerBtn);
}

function exportToJSON() {
  const json = JSON.stringify(state.data, null, 2);
  showExportModal(json);
}

function downloadJSON(jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laterlist-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importFromJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    processJSONImport(e.target.result);
  };
  reader.readAsText(file);
}

function processJSONImport(jsonText) {
  try {
    const imported = JSON.parse(jsonText);
    if (!imported.tabs || !Array.isArray(imported.tabs)) {
      alert('Invalid LaterList JSON format');
      return;
    }
    if (
      !confirm(
        'Merge imported data with existing data? (Cancel to replace all)'
      )
    ) {
      state.data = imported;
    } else {
      state.data.tabs.push(...imported.tabs);
      state.data.trash = state.data.trash || [];
      if (imported.trash) state.data.trash.push(...imported.trash);
    }

    // Imported backups (especially from older userscripts) may be missing ids
    // or contain duplicate ids. Repair them to prevent tab collisions.
    migrateAndFixData(state.data);
    state.activeTabId = state.data.tabs[0]?.id || 'trash';

    persist();
    render();
  } catch (err) {
    alert('Error parsing JSON: ' + err.message);
  }
}

function importFromOneTab(file) {
  const reader = new FileReader();
  reader.onload = e => {
    processOneTabImport(e.target.result);
  };
  reader.readAsText(file);
}

function processOneTabImport(text) {
  try {
    // Split by double line breaks to get groups (containers)
    const groups = text.trim().split(/\n\s*\n/);

    const firstTab = state.data.tabs[0] || {
      id: id('tab'),
      name: 'Imported from OneTab',
      containers: [],
    };

    // Ensure firstTab has an id and is in the tabs array
    if (!firstTab.id) {
      firstTab.id = id('tab');
      state.data.tabs.push(firstTab);
    }

    let totalLinks = 0;
    let containersCreated = 0;

    // Process each group as a container
    groups.forEach((group, groupIndex) => {
      const lines = group.trim().split('\n');
      const links = [];

      lines.forEach(line => {
        const trimmed = line.trim();

        // Skip empty lines, localhost, and archived markers
        if (
          !trimmed ||
          trimmed.startsWith('http://localhost') ||
          trimmed === '(Archived)'
        ) {
          return;
        }

        // OneTab format: URL | Title
        // Some entries may have metadata like {category:...,tags:[...]} after title
        const pipeIndex = trimmed.indexOf(' | ');

        if (pipeIndex > -1) {
          // Extract URL and title
          const urlPart = trimmed.substring(0, pipeIndex).trim();
          let titlePart = trimmed.substring(pipeIndex + 3).trim();

          // Remove metadata if present (e.g., {category:...,tags:[...]})
          const metadataMatch = titlePart.match(/^(.*?)\s*\{category:/);
          if (metadataMatch) {
            titlePart = metadataMatch[1].trim();
          }

          try {
            // Validate URL
            const url = new URL(urlPart);
            links.push({
              id: id('link'),
              title: titlePart || url.hostname || url.toString(),
              url: url.toString(),
              savedAt: Date.now(),
            });
          } catch {
            // Skip invalid URLs
          }
        } else {
          // Fallback: try parsing as just a URL (old format)
          try {
            const url = new URL(trimmed);
            links.push({
              id: id('link'),
              title: url.hostname || url.toString(),
              url: url.toString(),
              savedAt: Date.now(),
            });
          } catch {
            // Skip invalid URLs
          }
        }
      });

      // Only create container if we have links
      if (links.length > 0) {
        const container = {
          id: id('container'),
          name: `Imported Group ${groupIndex + 1}`,
          links: links,
        };
        firstTab.containers.push(container);
        totalLinks += links.length;
        containersCreated++;
      }
    });

    migrateAndFixData(state.data);

    persist();
    render();
    alert(
      `Imported ${totalLinks} links into ${containersCreated} container(s)`
    );
  } catch (err) {
    alert('Error importing OneTab format: ' + err.message);
  }
}

function showExportModal(jsonText) {
  const modal = createEl('div', { className: 'modal-overlay' });
  const modalContent = createEl('div', {
    className: 'modal-content export-modal',
  });

  const title = createEl('h2', { textContent: 'Export LaterList Data' });
  const description = createEl('p', {
    textContent: 'Copy the backup text below or save it as a file:',
    className: 'modal-description',
  });

  const textarea = createEl('textarea', {
    className: 'export-textarea',
    value: jsonText,
    readOnly: true,
  });

  const buttonGroup = createEl('div', { className: 'modal-button-group' });

  const copyBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '📋 Copy to Clipboard',
    onClick: () => {
      textarea.select();
      navigator.clipboard.writeText(jsonText).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy to Clipboard';
        }, 2000);
      });
    },
  });

  attachTooltip(copyBtn, 'Copy', 'Copy this backup to your clipboard');

  const saveBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '💾 Save as File',
    onClick: () => {
      downloadJSON(jsonText);
      document.body.removeChild(modal);
    },
  });

  attachTooltip(saveBtn, 'Save file', 'Download the backup as a JSON file');

  const closeBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Close',
    onClick: () => document.body.removeChild(modal),
  });

  attachTooltip(closeBtn, 'Close', 'Close this export dialog');

  buttonGroup.appendChild(copyBtn);
  buttonGroup.appendChild(saveBtn);
  buttonGroup.appendChild(closeBtn);

  modalContent.appendChild(title);
  modalContent.appendChild(description);
  modalContent.appendChild(textarea);
  modalContent.appendChild(buttonGroup);
  modal.appendChild(modalContent);

  modal.addEventListener('click', e => {
    if (e.target === modal) document.body.removeChild(modal);
  });

  document.body.appendChild(modal);
  textarea.select();
}

function showImportModal(type = 'json') {
  const modal = createEl('div', { className: 'modal-overlay' });
  const modalContent = createEl('div', {
    className: 'modal-content import-modal',
  });

  const title = createEl('h2', {
    textContent:
      type === 'json' ? 'Import LaterList Data' : 'Import from OneTab',
  });
  const description = createEl('p', {
    textContent: 'Choose a file or paste the backup text:',
    className: 'modal-description',
  });

  const fileInputGroup = createEl('div', { className: 'import-option-group' });
  const fileLabel = createEl('label', {
    textContent: '📁 Choose File:',
    className: 'import-label',
  });
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = type === 'json' ? '.json' : '.txt';
  fileInput.className = 'import-file-input';
  fileInputGroup.appendChild(fileLabel);
  fileInputGroup.appendChild(fileInput);

  const divider = createEl('div', {
    className: 'import-divider',
    textContent: 'OR',
  });

  const textareaGroup = createEl('div', { className: 'import-option-group' });
  const textareaLabel = createEl('label', {
    textContent: '📝 Paste Text:',
    className: 'import-label',
  });
  const textarea = createEl('textarea', {
    className: 'import-textarea',
    placeholder:
      type === 'json'
        ? 'Paste your LaterList JSON backup here...'
        : 'Paste your OneTab URLs here (one per line)...',
  });
  textareaGroup.appendChild(textareaLabel);
  textareaGroup.appendChild(textarea);

  const buttonGroup = createEl('div', { className: 'modal-button-group' });

  const importBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '⬆ Import',
    onClick: () => {
      if (fileInput.files[0]) {
        if (type === 'json') {
          importFromJSON(fileInput.files[0]);
        } else {
          importFromOneTab(fileInput.files[0]);
        }
        document.body.removeChild(modal);
      } else if (textarea.value.trim()) {
        if (type === 'json') {
          processJSONImport(textarea.value);
        } else {
          processOneTabImport(textarea.value);
        }
        document.body.removeChild(modal);
      } else {
        alert('Please select a file or paste text to import');
      }
    },
  });

  const cancelBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Cancel',
    onClick: () => document.body.removeChild(modal),
  });

  attachTooltip(importBtn, 'Import', 'Import data from file or pasted text');
  attachTooltip(cancelBtn, 'Cancel', 'Close this dialog without importing');

  buttonGroup.appendChild(importBtn);
  buttonGroup.appendChild(cancelBtn);

  modalContent.appendChild(title);
  modalContent.appendChild(description);
  modalContent.appendChild(fileInputGroup);
  modalContent.appendChild(divider);
  modalContent.appendChild(textareaGroup);
  modalContent.appendChild(buttonGroup);
  modal.appendChild(modalContent);

  modal.addEventListener('click', e => {
    if (e.target === modal) document.body.removeChild(modal);
  });

  document.body.appendChild(modal);
}

function trashGroupExcept(group, strategy = 'newest') {
  if (!group || group.links.length < 2) return;

  let keepIndex = 0;
  if (strategy === 'newest') {
    keepIndex = group.links.reduce(
      (bestIdx, item, idx, arr) =>
        item.savedAt > arr[bestIdx].savedAt ? idx : bestIdx,
      0
    );
  } else if (strategy === 'oldest') {
    keepIndex = group.links.reduce(
      (bestIdx, item, idx, arr) =>
        item.savedAt < arr[bestIdx].savedAt ? idx : bestIdx,
      0
    );
  }

  const trashed = [];
  group.links.forEach((linkRef, idx) => {
    if (idx === keepIndex) return;
    const removed = moveLinkToTrash(
      linkRef.tabId,
      linkRef.containerId,
      linkRef.linkId
    );
    if (removed) trashed.push(removed);
  });

  if (!trashed.length) return;
  persist();
  render();
}

function renderDuplicates(container, duplicateGroups) {
  container.innerHTML = '';

  if (!duplicateGroups.length) {
    const empty = createEl('div', {
      className: 'duplicate-empty',
      textContent: 'No duplicates found. Nice and tidy!',
    });
    container.appendChild(empty);
    return;
  }

  const summaryRow = createEl('div', {
    className: 'duplicate-summary-row',
  });

  const summary = createEl('div', {
    className: 'duplicate-summary',
    textContent: `${duplicateGroups.length} duplicate group(s) detected`,
  });

  const normalizeToggle = createEl('label', {
    className: 'duplicate-normalize-toggle',
  });
  const checkbox = createEl('input', { attrs: { type: 'checkbox' } });
  checkbox.checked = state.aggressiveNormalization;
  checkbox.addEventListener('change', () => {
    state.aggressiveNormalization = checkbox.checked;
    render();
  });
  const label = createEl('span', {
    textContent: 'Strip tracking params (utm_, fbclid, etc.)',
  });
  normalizeToggle.appendChild(checkbox);
  normalizeToggle.appendChild(label);

  summaryRow.appendChild(summary);
  summaryRow.appendChild(normalizeToggle);
  container.appendChild(summaryRow);

  const containersGrid = createEl('div', { className: 'containers' });

  duplicateGroups.forEach(group => {
    const containerEl = createEl('div', { className: 'container' });
    const header = createEl('div', { className: 'container-header' });

    const nameEl = createEl('div', {
      textContent: prettyUrl(group.links[0].url),
      className: 'container-name',
      style: 'cursor: default; flex: 1;',
    });

    const stats = createEl('div', {
      className: 'link-count',
      textContent: `${group.links.length} copies`,
    });

    const headerActions = createEl('div', { className: 'container-actions' });

    const keepNewestBtn = createEl('button', {
      className: 'container-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
      title: 'Keep newest, trash rest',
      onClick: e => {
        e.stopPropagation();
        trashGroupExcept(group, 'newest');
      },
    });
    attachTooltip(
      keepNewestBtn,
      'Keep newest',
      'Keep the most recent link and trash the rest'
    );

    const keepOldestBtn = createEl('button', {
      className: 'container-action-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      title: 'Keep oldest, trash rest',
      onClick: e => {
        e.stopPropagation();
        trashGroupExcept(group, 'oldest');
      },
    });
    attachTooltip(
      keepOldestBtn,
      'Keep oldest',
      'Keep the oldest link and trash the rest'
    );

    const trashAllBtn = createEl('button', {
      className: 'container-action-btn container-delete-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
      title: 'Trash all duplicates',
      onClick: e => {
        e.stopPropagation();
        if (!confirm(`Trash all ${group.links.length} duplicate links?`))
          return;
        group.links.forEach(linkRef => {
          moveLinkToTrash(linkRef.tabId, linkRef.containerId, linkRef.linkId);
        });
        persist();
        render();
      },
    });
    attachTooltip(
      trashAllBtn,
      'Trash all',
      'Send all duplicates in this group to Trash'
    );

    headerActions.appendChild(keepNewestBtn);
    headerActions.appendChild(keepOldestBtn);
    headerActions.appendChild(trashAllBtn);
    header.appendChild(nameEl);
    header.appendChild(stats);
    header.appendChild(headerActions);

    const content = createEl('div', {
      className: 'container-content duplicate-links-content',
    });

    group.links
      .slice()
      .sort((a, b) => b.savedAt - a.savedAt)
      .forEach(linkRef => {
        const linkRow = createEl('div', { className: 'link duplicate-link' });

        const favicon = createEl('img', {
          className: 'link-favicon',
          attrs: {
            src: `https://www.google.com/s2/favicons?sz=32&domain=${
              new URL(linkRef.url).hostname
            }`,
            alt: '',
            loading: 'lazy',
          },
        });
        favicon.onerror = () => {
          favicon.style.display = 'none';
        };

        const linkInfo = createEl('div', { className: 'link-info-wrapper' });
        const anchor = createEl('a', {
          textContent: linkRef.title,
          attrs: { href: linkRef.url, target: '_blank' },
        });
        anchor.addEventListener('click', e => {
          e.preventDefault();
          chrome.tabs.create({ url: linkRef.url, active: false });
        });

        linkInfo.appendChild(anchor);

        // Add hover events for status overlay
        linkRow.addEventListener('mouseenter', () => {
          showStatusOverlay({
            title: linkRef.title,
            url: linkRef.url,
            savedAt: linkRef.savedAt,
            tabName: linkRef.tabName,
            containerName: linkRef.containerName,
            type: 'duplicate',
          });
        });
        linkRow.addEventListener('mouseleave', () => {
          hideStatusOverlay();
        });

        const actions = createEl('div', { className: 'container-actions' });
        const trashBtn = createEl('button', {
          className: 'btn btn-delete',
          html: '🗑️',
          onClick: () => {
            const removed = moveLinkToTrash(
              linkRef.tabId,
              linkRef.containerId,
              linkRef.linkId
            );
            if (removed) {
              persist();
              render();
            }
          },
        });
        attachTooltip(trashBtn, 'Trash link', 'Send this duplicate to Trash');

        actions.appendChild(trashBtn);
        linkRow.appendChild(favicon);
        linkRow.appendChild(linkInfo);
        linkRow.appendChild(actions);
        content.appendChild(linkRow);
      });

    containerEl.appendChild(header);
    containerEl.appendChild(content);
    containersGrid.appendChild(containerEl);
  });

  container.appendChild(containersGrid);
}

function render() {
  const duplicateGroups = collectDuplicateGroups();
  state.duplicateUrls = new Set(duplicateGroups.map(group => group.normalized));

  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = createEl('div', { className: 'header' });
  const headerLeft = createEl('div', { className: 'header-left' });
  const titleEl = createEl('h1', { textContent: 'LaterList' });

  // Total links (excluding Trash)
  const totalLinks = (state.data?.tabs || []).reduce((sum, tab) => {
    return (
      sum +
      (tab.containers || []).reduce((acc, c) => acc + (c.links?.length || 0), 0)
    );
  }, 0);
  const totalEl = createEl('span', {
    className: 'total-links',
    textContent: `Total: ${totalLinks}`,
    title: 'Total saved links (excluding Trash)',
  });

  headerLeft.appendChild(titleEl);
  headerLeft.appendChild(totalEl);
  header.appendChild(headerLeft);

  // Import/Export buttons
  const toolsDiv = createEl('div', { className: 'header-tools' });

  const exportBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '⬇ Export',
    onClick: exportToJSON,
    title: 'Export backup as JSON',
  });

  const importJsonBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '⬆ Import JSON',
    onClick: () => showImportModal('json'),
    title: 'Import from JSON backup',
  });

  const importOnetabBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: '⬆ Import OneTab',
    onClick: () => showImportModal('onetab'),
    title: 'Import from OneTab text format',
  });

  const settingsBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: '⚙️ Settings',
    onClick: () => chrome.tabs.create({ url: 'settings.html' }),
    title: 'Open settings',
  });

  // Bulk selection toggle and actions
  const bulkToggleBtn = createEl('button', {
    className: state.bulkMode ? 'btn btn-primary' : 'btn btn-secondary',
    textContent: state.bulkMode ? 'Bulk: On' : 'Bulk: Off',
    onClick: toggleBulkMode,
    title: 'Toggle bulk selection mode',
  });

  const bulkMoveBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Move Selected',
    onClick: bulkMoveSelected,
    title: 'Move selected links to another container',
  });
  const bulkTrashBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Trash Selected',
    onClick: bulkTrashSelected,
    title: 'Trash selected links',
  });
  const bulkClearBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: 'Clear Selection',
    onClick: clearSelection,
    title: 'Clear current selection',
  });

  // Disable action buttons when nothing selected or not in bulk mode
  [bulkMoveBtn, bulkTrashBtn, bulkClearBtn].forEach(btn => {
    btn.disabled = !state.bulkMode || state.selectedLinks.size === 0;
  });

  attachTooltip(exportBtn, 'Export', 'Download a JSON backup');
  attachTooltip(importJsonBtn, 'Import JSON', 'Import a LaterList JSON backup');
  attachTooltip(importOnetabBtn, 'Import OneTab', 'Import a OneTab export');
  attachTooltip(settingsBtn, 'Settings', 'Open LaterList settings');
  attachTooltip(
    bulkToggleBtn,
    'Bulk mode',
    'Select multiple links to move or trash'
  );
  attachTooltip(
    bulkMoveBtn,
    'Move selected',
    'Move selected links to a container'
  );
  attachTooltip(bulkTrashBtn, 'Trash selected', 'Move selected links to Trash');
  attachTooltip(bulkClearBtn, 'Clear selection', 'Clear the current selection');

  toolsDiv.appendChild(exportBtn);
  toolsDiv.appendChild(importJsonBtn);
  toolsDiv.appendChild(importOnetabBtn);
  toolsDiv.appendChild(bulkToggleBtn);
  toolsDiv.appendChild(bulkMoveBtn);
  toolsDiv.appendChild(bulkTrashBtn);
  toolsDiv.appendChild(bulkClearBtn);
  toolsDiv.appendChild(settingsBtn);
  header.appendChild(toolsDiv);

  app.appendChild(header);

  const tabsContainer = createEl('div');
  renderTabs(tabsContainer);
  app.appendChild(tabsContainer);

  const activeArea = createEl('div');
  if (state.activeTabId === 'duplicates') {
    renderDuplicates(activeArea, duplicateGroups);
  } else {
    renderActiveTab(activeArea);
  }
  app.appendChild(activeArea);

  // Now that the active area is attached to the document, initialize Sortable.
  initSortable(activeArea);
}

async function init() {
  await loadData();
  render();
}

document.addEventListener('DOMContentLoaded', init);

function initSortable(rootEl) {
  if (!window.Sortable) return;
  if (!rootEl) return;

  // Links
  rootEl.querySelectorAll('.container-content').forEach(listEl => {
    if (listEl._laterlistSortable) {
      listEl._laterlistSortable.destroy();
      listEl._laterlistSortable = null;
    }

    listEl._laterlistSortable = new Sortable(listEl, {
      group: { name: 'links', pull: true, put: true },
      animation: 150,
      draggable: '.link',
      swapThreshold: 0.4,
      fallbackOnBody: true,
      fallbackTolerance: 6,
      onMove: evt => {
        // Only allow dropping links into container-content lists
        return evt.to?.classList.contains('container-content') || false;
      },
      onStart: () => setDragHoverActive(true),
      onEnd: evt => {
        try {
          const fromContainerId = evt.from.dataset.containerId;
          const toContainerId = evt.to.dataset.containerId;
          const fromTabId = evt.from.dataset.tabId;
          const toTabId = evt.to.dataset.tabId;
          const fromTab = state.data.tabs.find(t => t.id === fromTabId);
          const toTab = state.data.tabs.find(t => t.id === toTabId);
          const fromContainer = fromTab?.containers.find(
            c => c.id === fromContainerId
          );
          const toContainer = toTab?.containers.find(
            c => c.id === toContainerId
          );
          if (!fromContainer || !toContainer) return;
          const [moved] = fromContainer.links.splice(evt.oldIndex, 1);
          toContainer.links.splice(evt.newIndex, 0, moved);
          persist();
          render();
        } finally {
          setDragHoverActive(false);
        }
      },
    });
  });

  // Containers
  rootEl.querySelectorAll('.containers').forEach(listEl => {
    if (listEl._laterlistSortable) {
      listEl._laterlistSortable.destroy();
      listEl._laterlistSortable = null;
    }

    listEl._laterlistSortable = new Sortable(listEl, {
      group: { name: 'containers', pull: true, put: true },
      animation: 150,
      handle: '.container-header',
      draggable: '.container',
      onMove: evt => {
        // Only allow dropping containers into container grids
        return evt.to?.classList.contains('containers') || false;
      },
      onStart: () => setDragHoverActive(true),
      onEnd: evt => {
        try {
          const fromTabId = evt.from.dataset.tabId;
          const toTabId = evt.to.dataset.tabId;
          const fromTab = state.data.tabs.find(t => t.id === fromTabId);
          const toTab = state.data.tabs.find(t => t.id === toTabId);
          if (!fromTab || !toTab) return;
          const [moved] = fromTab.containers.splice(evt.oldIndex, 1);
          toTab.containers.splice(evt.newIndex, 0, moved);
          persist();
          render();
        } finally {
          setDragHoverActive(false);
        }
      },
    });
  });
}
