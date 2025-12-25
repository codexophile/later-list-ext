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
  const settingsBtn = document.getElementById('open-settings');
  if (saveBtn) saveBtn.disabled = isBusy;
  if (saveCloseBtn) saveCloseBtn.disabled = isBusy;
  if (openBtn) openBtn.disabled = isBusy;
  if (sendAllBtn) sendAllBtn.disabled = isBusy;
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
    // Extract image from the current tab
    let imageUrl = null;
    if (typeof currentPage.tabId === 'number') {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: currentPage.tabId },
          function: () => {
            // Try Open Graph image first
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage?.content) return ogImage.content;

            // Try favicon
            const favicon = document.querySelector('link[rel*="icon"]');
            if (favicon?.href) return favicon.href;

            // Try first image on page
            const images = document.querySelectorAll('img');
            for (const img of images) {
              if (
                img.naturalWidth >= 100 &&
                img.naturalHeight >= 100 &&
                img.offsetParent !== null
              ) {
                return img.src;
              }
            }
            return null;
          },
        });
        imageUrl = results?.[0]?.result || null;
        console.log('[LaterList] Extracted image URL:', imageUrl);
      } catch (error) {
        // If extraction fails, continue without image
        console.log('[LaterList] Image extraction failed:', error);
        imageUrl = null;
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
      },
    });

    if (result?.error) {
      setStatus(result.error);
      return;
    }

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
