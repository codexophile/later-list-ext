// background.js
// Core data store and background services for LaterList.

const DEFAULT_SETTINGS = {
  containerNameFormat: 'ddd, MMM DD, YYYY at HHmm Hrs',
  sendAllTabsDestination: '', // Empty means first tab
};

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
  return { ...DEFAULT_SETTINGS, ...(stored.laterlistSettings || {}) };
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

    // Convert browser tabs to links
    const savedTabIds = [];
    tabsToSave.forEach(tab => {
      if (tab.url && tab.id !== undefined) {
        newContainer.links.push({
          id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          title: tab.title || tab.url,
          url: tab.url,
          savedAt: Date.now(),
        });
        savedTabIds.push(tab.id);
      }
    });

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

async function addLink({ url, title, tabId, containerId, imageUrl }) {
  console.log('[LaterList Background] addLink called with:', {
    url,
    title,
    tabId,
    containerId,
    imageUrl,
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

  const newLink = {
    id: `link-${Date.now()}`,
    title: title || url,
    url,
    savedAt: Date.now(),
  };

  if (imageUrl) {
    newLink.imageUrl = imageUrl;
    console.log('[LaterList Background] Image URL saved:', imageUrl);
  } else {
    console.log('[LaterList Background] No image URL provided');
  }

  container.links.push(newLink);
  console.log('[LaterList Background] Link saved:', newLink);
  await saveData(data);
  return newLink;
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
  await addLink({ url, title });
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
      .then(link => sendResponse({ link }))
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
  return false;
});

// Keyboard command handler
chrome.commands.onCommand.addListener(command => {
  if (command === 'send-all-tabs') {
    sendAllBrowserTabsToLaterList().then(result => {
      if (result.success) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'LaterList',
          message: `${result.count} tabs saved to "${result.containerName}"`,
        });
      } else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'LaterList Error',
          message: result.error || 'Failed to save tabs',
        });
      }
    });
  }
});
