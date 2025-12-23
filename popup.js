// popup.js

let currentPage = {
  url: '',
  title: '',
};

function setStatus(text) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text || '';
  if (text) setTimeout(() => (el.textContent = ''), 2000);
}

function setBusy(isBusy) {
  const saveBtn = document.getElementById('save-current');
  const openBtn = document.getElementById('open-view');
  if (saveBtn) saveBtn.disabled = isBusy;
  if (openBtn) openBtn.disabled = isBusy;
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

async function saveCurrentToSelection() {
  if (!currentPage.url) return setStatus('No active tab URL found');

  const tabSelect = document.getElementById('tab-select');
  const containerSelect = document.getElementById('container-select');
  const tabId = tabSelect?.value || undefined;
  const containerId = containerSelect?.value || undefined;

  setBusy(true);
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'laterlist:addLink',
      payload: {
        url: currentPage.url,
        title: currentPage.title,
        tabId,
        containerId,
      },
    });

    if (result?.error) {
      setStatus(result.error);
      return;
    }
    setStatus('Saved');
  } catch {
    setStatus('Save failed');
  } finally {
    setBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('open-view')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document
    .getElementById('save-current')
    ?.addEventListener('click', saveCurrentToSelection);

  try {
    await loadCurrentTab();
    await loadDataAndPopulatePickers();
  } catch {
    setStatus('Failed to load');
  }
});
