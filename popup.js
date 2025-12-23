// popup.js

async function saveCurrentTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab?.url) return setStatus('No active tab URL found');
  await chrome.runtime.sendMessage({
    type: 'laterlist:addLink',
    payload: {
      url: activeTab.url,
      title: activeTab.title,
    },
  });
  setStatus('Saved to LaterList');
}

function setStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  setTimeout(() => (el.textContent = ''), 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  document
    .getElementById('save-current')
    .addEventListener('click', saveCurrentTab);
  document.getElementById('open-view').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
