// view.js
// Lightweight view page to browse and manage saved links. Drag/drop and advanced
// features will be added in later iterations.

let state = {
  data: null,
  activeTabId: null,
};

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
  return el;
}

function renderTabs(container) {
  container.innerHTML = '';
  const tabsWrapper = createEl('div', { className: 'tabs' });

  state.data.tabs.forEach(tab => {
    const tabEl = createEl('div', {
      className: `tab${tab.id === state.activeTabId ? ' active' : ''}`,
      textContent: tab.name,
      onClick: () => setActiveTab(tab.id),
    });
    const count = tab.containers.reduce((acc, c) => acc + c.links.length, 0);
    const countEl = createEl('span', {
      className: 'tab-count',
      textContent: count,
    });
    tabEl.appendChild(countEl);
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
  tab.containers.forEach(containerData => {
    const containerEl = createEl('div', { className: 'container' });
    const header = createEl('div', { className: 'container-header' });
    const nameEl = createEl('div', { textContent: containerData.name });
    const stats = createEl('div', {
      className: 'link-count',
      textContent: `${containerData.links.length} links`,
    });
    header.appendChild(nameEl);
    header.appendChild(stats);

    const content = createEl('div', { className: 'container-content' });
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
