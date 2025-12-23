// view.js
// Lightweight view page to browse and manage saved links. Drag/drop and advanced
// features will be added in later iterations.

let state = {
  data: null,
  activeTabId: null,
};

const id = prefix =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

async function loadData() {
  const response = await chrome.runtime.sendMessage({
    type: 'laterlist:getData',
  });
  state.data = response?.data;
  if (!state.data.tabs?.length) {
    state.data.tabs = [];
  }
  state.activeTabId = state.activeTabId || state.data.tabs[0]?.id || 'trash';
}

async function persist() {
  await chrome.runtime.sendMessage({
    type: 'laterlist:setData',
    payload: state.data,
  });
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
  if (opts.textContent) el.textContent = opts.textContent;
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
      textContent: tab.name,
      onClick: e => {
        if (e.shiftKey) {
          e.stopPropagation();
          makeEditable(tabEl, newName => renameTab(tab.id, newName));
        } else {
          setActiveTab(tab.id);
        }
      },
      title: 'Shift+click to rename',
    });
    const count = tab.containers.reduce((acc, c) => acc + c.links.length, 0);
    const countEl = createEl('span', {
      className: 'tab-count',
      textContent: count,
    });
    const removeBtn = createEl('button', {
      className: 'btn btn-delete',
      textContent: '×',
      onClick: e => {
        e.stopPropagation();
        deleteTab(tab.id);
      },
    });
    tabEl.appendChild(countEl);
    if (state.data.tabs.length > 1) tabEl.appendChild(removeBtn);
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

function handleOpenLink(url, sendToArchive) {
  chrome.tabs.create({ url, active: false });
  if (!sendToArchive) return;
  // TODO: move opened link to an archive container when archive feature is added.
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
        const anchor = createEl('a', {
          textContent: link.title,
          attrs: { href: link.url, target: '_blank' },
        });
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
      const linkRow = createEl('div', { className: 'link' });
      const anchor = createEl('a', {
        textContent: link.title,
        attrs: { href: link.url, target: '_blank' },
      });
      anchor.addEventListener('click', e => {
        e.preventDefault();
        handleOpenLink(link.url, true);
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
      const deleteBtn = createEl('button', {
        className: 'btn btn-delete',
        textContent: 'Trash',
        onClick: () => deleteLink(tab.id, containerData.id, link.id),
      });
      actions.appendChild(deleteBtn);
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

  initSortable();
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = createEl('div', { className: 'header' });
  header.appendChild(createEl('h1', { textContent: 'LaterList' }));
  app.appendChild(header);

  const tabsContainer = createEl('div');
  renderTabs(tabsContainer);
  app.appendChild(tabsContainer);

  const activeArea = createEl('div');
  renderActiveTab(activeArea);
  app.appendChild(activeArea);
}

async function init() {
  await loadData();
  render();
}

document.addEventListener('DOMContentLoaded', init);

function initSortable() {
  if (!window.Sortable) return;
  // Links
  document.querySelectorAll('.container-content').forEach(listEl => {
    new Sortable(listEl, {
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
  document.querySelectorAll('.containers').forEach(listEl => {
    new Sortable(listEl, {
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
