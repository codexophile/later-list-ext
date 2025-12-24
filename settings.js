// settings.js
// Settings page for LaterList

const DEFAULT_SETTINGS = {
  containerNameFormat: 'ddd, MMM DD, YYYY at HHmm Hrs',
  sendAllTabsDestination: '', // Empty means first tab
};

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
  return { ...DEFAULT_SETTINGS, ...(stored.laterlistSettings || {}) };
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

async function populateDestinationTabs() {
  const select = document.getElementById('destination-tab');
  if (!select) return;

  const data = await loadData();
  const settings = await loadSettings();

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

  await populateDestinationTabs();
  updatePreview();
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
  };

  try {
    saveButton.disabled = true;
    await saveSettings(settings);
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
});
