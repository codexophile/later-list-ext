// background.js
// Core data store and background services for LaterList.

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
            },
            {
              id: 'link-2',
              title: 'MDN: WebExtensions',
              url: 'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions',
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

function ensureFirstContainer(data) {
  if (!data.tabs.length) {
    data.tabs.push({
      id: `tab-${Date.now()}`,
      name: 'Saved',
      containers: [],
    });
  }
  const firstTab = data.tabs[0];
  if (!firstTab.containers.length) {
    firstTab.containers.push({
      id: `container-${Date.now()}`,
      name: 'Links',
      links: [],
    });
  }
  return firstTab.containers[0];
}

async function addLink({ url, title, tabId, containerId }) {
  const data = await getData();
  const targetTab = tabId ? data.tabs.find(t => t.id === tabId) : data.tabs[0];
  const tab = targetTab || data.tabs[0];
  let container = tab.containers.find(c => c.id === containerId);
  if (!container) {
    container = ensureFirstContainer(data);
  }

  const newLink = {
    id: `link-${Date.now()}`,
    title: title || url,
    url,
  };

  container.links.push(newLink);
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
  console.log('LaterList installed and initialized.');
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
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
  return false;
});
