// view.js
// Lightweight view page to browse and manage saved links. Drag/drop and advanced
// features will be added in later iterations.

let state = {
  data: null,
  activeTabId: null,
  duplicateUrls: new Set(),
};

const id = prefix =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

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
      });
    });
  });

  // Trash links
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
    return u.origin + u.pathname.replace(/\/$/, '') + u.search;
  } catch {
    return url.toLowerCase().trim();
  }
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
  tab.containers.forEach(c => state.data.trash.push(...c.links));
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
  tab.containers.push({ id: id('container'), name, links: [] });
  persist();
  render();
}

function deleteContainer(tabId, containerId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  if (!tab) return;
  const container = tab.containers.find(c => c.id === containerId);
  if (!container) return;
  if (!confirm('Delete container and send its links to trash?')) return;
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
  container.links.push({ id: id('link'), title, url });
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
    
    const removeBtn = createEl('button', {
      className: 'tab-action-btn tab-delete-btn',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      title: 'Delete tab',
      onClick: e => {
        e.stopPropagation();
        deleteTab(tab.id);
      },
    });
    
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
  tabsWrapper.appendChild(trashEl);

  const addTabBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '+ Tab',
    onClick: e => {
      e.stopPropagation();
      addTab();
    },
  });
  tabsWrapper.appendChild(addTabBtn);

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
    archiveLink(tabId, containerId, linkId);
  }
}

function deleteLink(tabId, containerId, linkId) {
  const tab = state.data.tabs.find(t => t.id === tabId);
  const container = tab?.containers.find(c => c.id === containerId);
  if (!container) return;
  const linkIndex = container.links.findIndex(l => l.id === linkId);
  if (linkIndex === -1) return;
  const [removed] = container.links.splice(linkIndex, 1);
  state.data.trash = state.data.trash || [];
  state.data.trash.push(removed);
  persist();
  render();
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
      state.data.trash.forEach(link => {
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
        const anchor = createEl('a', {
          textContent: link.title,
          attrs: { href: link.url, target: '_blank' },
        });
        anchor.addEventListener('click', e => {
          e.preventDefault();
          chrome.tabs.create({ url: link.url, active: false });
        });
        anchor.title = 'Click to open';
        const actions = createEl('div', { className: 'trash-actions' });
        const restoreBtn = createEl('button', {
          className: 'btn btn-restore',
          textContent: 'Restore',
          onClick: () => restoreLink(link.id),
        });
        const deleteBtn = createEl('button', {
          className: 'btn btn-delete',
          textContent: 'Delete',
          onClick: () => {
            state.data.trash = state.data.trash.filter(l => l.id !== link.id);
            persist();
            render();
          },
        });
        actions.appendChild(restoreBtn);
        actions.appendChild(deleteBtn);
        linkRow.appendChild(favicon);
        linkRow.appendChild(anchor);
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
    const nameEl = createEl('div', {
      textContent: containerData.name,
      onClick: e => {
        if (e.shiftKey) {
          e.stopPropagation();
          makeEditable(nameEl, newName =>
            renameContainer(tab.id, containerData.id, newName)
          );
        }
      },
      title: 'Shift+click to rename',
      style: 'cursor: default; flex: 1;',
    });
    const stats = createEl('div', {
      className: 'link-count',
      textContent: `${containerData.links.length} links`,
    });
    const headerActions = createEl('div', { className: 'container-actions' });
    const addLinkBtn = createEl('button', {
      className: 'btn btn-primary',
      textContent: '+ Link',
      onClick: e => {
        e.stopPropagation();
        addLink(tab.id, containerData.id);
      },
    });
    const delContainerBtn = createEl('button', {
      className: 'btn btn-delete',
      textContent: '×',
      onClick: e => {
        e.stopPropagation();
        deleteContainer(tab.id, containerData.id);
      },
    });
    headerActions.appendChild(addLinkBtn);
    headerActions.appendChild(delContainerBtn);
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
      const anchor = createEl('a', {
        textContent: link.title,
        attrs: { href: link.url, target: '_blank' },
      });
      anchor.addEventListener('click', e => {
        e.preventDefault();
        handleOpenLink(link.url, tab.id, containerData.id, link.id);
      });
      anchor.title = 'Click to open (will be archived)';
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
      const deleteBtn = createEl('button', {
        className: 'btn btn-delete',
        textContent: 'Trash',
        onClick: () => deleteLink(tab.id, containerData.id, link.id),
      });
      actions.appendChild(deleteBtn);
      linkRow.appendChild(favicon);
      linkRow.appendChild(anchor);
      linkRow.appendChild(actions);
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
  const blob = new Blob([json], { type: 'application/json' });
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
    try {
      const imported = JSON.parse(e.target.result);
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
  };
  reader.readAsText(file);
}

function importFromOneTab(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      const lines = text.trim().split('\n');
      const firstTab = state.data.tabs[0] || {
        id: id('tab'),
        name: 'Imported',
        containers: [],
      };
      const container = firstTab.containers[0] || {
        id: id('container'),
        name: 'Imported',
        links: [],
      };

      lines.forEach(line => {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith('http://localhost') ||
          trimmed === '(Archived)'
        )
          return;

        try {
          const url = new URL(trimmed);
          const title = url.hostname || url.toString();
          container.links.push({ id: id('link'), title, url: url.toString() });
        } catch {
          // Skip invalid URLs
        }
      });

      if (!firstTab.id) {
        firstTab.id = id('tab');
        state.data.tabs.push(firstTab);
      }
      if (!container.id) {
        container.id = id('container');
        firstTab.containers.push(container);
      }

      migrateAndFixData(state.data);

      persist();
      render();
      alert(`Imported ${container.links.length} links`);
    } catch (err) {
      alert('Error importing OneTab format: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function render() {
  // Calculate duplicates before rendering
  state.duplicateUrls = findAllDuplicates();

  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = createEl('div', { className: 'header' });
  header.appendChild(createEl('h1', { textContent: 'LaterList' }));

  // Import/Export buttons
  const toolsDiv = createEl('div', { className: 'header-tools' });

  const exportBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '⬇ Export',
    onClick: exportToJSON,
    title: 'Download backup as JSON',
  });

  const importJsonInput = document.createElement('input');
  importJsonInput.type = 'file';
  importJsonInput.accept = '.json';
  importJsonInput.style.display = 'none';
  importJsonInput.addEventListener('change', e => {
    if (e.target.files[0]) importFromJSON(e.target.files[0]);
    e.target.value = '';
  });

  const importJsonBtn = createEl('button', {
    className: 'btn btn-primary',
    textContent: '⬆ Import JSON',
    onClick: () => importJsonInput.click(),
    title: 'Restore from JSON backup',
  });

  const importOnetabInput = document.createElement('input');
  importOnetabInput.type = 'file';
  importOnetabInput.accept = '.txt';
  importOnetabInput.style.display = 'none';
  importOnetabInput.addEventListener('change', e => {
    if (e.target.files[0]) importFromOneTab(e.target.files[0]);
    e.target.value = '';
  });

  const importOnetabBtn = createEl('button', {
    className: 'btn btn-secondary',
    textContent: '⬆ Import OneTab',
    onClick: () => importOnetabInput.click(),
    title: 'Import from OneTab text format',
  });

  toolsDiv.appendChild(exportBtn);
  toolsDiv.appendChild(importJsonBtn);
  toolsDiv.appendChild(importOnetabBtn);
  toolsDiv.appendChild(importJsonInput);
  toolsDiv.appendChild(importOnetabInput);
  header.appendChild(toolsDiv);

  app.appendChild(header);

  const tabsContainer = createEl('div');
  renderTabs(tabsContainer);
  app.appendChild(tabsContainer);

  const activeArea = createEl('div');
  renderActiveTab(activeArea);
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
      group: 'links',
      animation: 150,
      onEnd: evt => {
        const fromContainerId = evt.from.dataset.containerId;
        const toContainerId = evt.to.dataset.containerId;
        const fromTabId = evt.from.dataset.tabId;
        const toTabId = evt.to.dataset.tabId;
        const fromTab = state.data.tabs.find(t => t.id === fromTabId);
        const toTab = state.data.tabs.find(t => t.id === toTabId);
        const fromContainer = fromTab?.containers.find(
          c => c.id === fromContainerId
        );
        const toContainer = toTab?.containers.find(c => c.id === toContainerId);
        if (!fromContainer || !toContainer) return;
        const [moved] = fromContainer.links.splice(evt.oldIndex, 1);
        toContainer.links.splice(evt.newIndex, 0, moved);
        persist();
        render();
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
      group: 'containers',
      animation: 150,
      handle: '.container-header',
      onEnd: evt => {
        const fromTabId = evt.from.dataset.tabId;
        const toTabId = evt.to.dataset.tabId;
        const fromTab = state.data.tabs.find(t => t.id === fromTabId);
        const toTab = state.data.tabs.find(t => t.id === toTabId);
        if (!fromTab || !toTab) return;
        const [moved] = fromTab.containers.splice(evt.oldIndex, 1);
        toTab.containers.splice(evt.newIndex, 0, moved);
        persist();
        render();
      },
    });
  });
}
