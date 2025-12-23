// content.js
// Injects a Ctrl + right-click mini popup to save the clicked link or page to LaterList.

(() => {
  const POPUP_STYLES = `
    .laterlist-popup {
        position: fixed;
        background: linear-gradient(to bottom, #3b4252, #2e3440);
        border: 1px solid #4c566a;
        border-radius: 12px;
        padding: 16px;
        z-index: 2147483646;
        color: #eceff4;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1);
        max-width: 340px;
        width: 100%;
        transition: opacity 0.18s ease-in-out;
        opacity: 0;
    }
    .laterlist-popup__title {
        font-weight: 600;
        font-size: 1.05em;
        margin-bottom: 6px;
        color: #eceff4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .laterlist-popup__url {
        font-size: 0.9em;
        color: #88c0d0;
        margin-bottom: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.9;
    }
    .laterlist-popup__select-wrapper {
        display: grid;
        gap: 10px;
        margin-bottom: 12px;
    }
    .laterlist-popup__select {
        width: 100%;
        padding: 8px 12px;
        background: #4c566a;
        border: 1px solid #6c7a96;
        border-radius: 6px;
        color: #eceff4;
        font-size: 0.95em;
        cursor: pointer;
        outline: none;
    }
    .laterlist-popup__button-container {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }
    .laterlist-popup__button {
        padding: 8px 14px;
        border: none;
        border-radius: 6px;
        font-size: 0.95em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        background: #434c5e;
        color: #e5e9f0;
    }
    .laterlist-popup__button:hover {
        background: #4c566a;
    }
    .laterlist-popup__button--primary {
        background: #88c0d0;
        color: #2e3440;
    }
    .laterlist-popup__button--primary:hover {
        background: #8fcfdf;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = POPUP_STYLES;
  document.documentElement.appendChild(styleEl);

  let popupEl = null;

  function removePopup() {
    popupEl?.remove();
    popupEl = null;
    window.removeEventListener('keydown', handleKeydown, true);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      removePopup();
    }
  }

  function createSelect(options, selectedId) {
    const select = document.createElement('select');
    select.className = 'laterlist-popup__select';
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.textContent = opt.label;
      if (opt.id === selectedId) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  async function showPopup(event) {
    removePopup();

    const targetAnchor = event.target.closest('a');
    const url = targetAnchor?.href || window.location.href;
    const title = (targetAnchor?.textContent || document.title || url).trim();

    const { data } = await chrome.runtime.sendMessage({
      type: 'laterlist:getData',
    });
    const tabs = data?.tabs || [];
    if (!tabs.length) return;

    const tabOptions = tabs.map(tab => ({ id: tab.id, label: tab.name }));
    const defaultTabId = tabOptions[0].id;
    const firstTabContainers =
      tabs.find(t => t.id === defaultTabId)?.containers || [];
    const containerOptions = firstTabContainers.map(c => ({
      id: c.id,
      label: c.name,
    }));
    const defaultContainerId = containerOptions[0]?.id;

    popupEl = document.createElement('div');
    popupEl.className = 'laterlist-popup';
    popupEl.style.left = `${event.clientX}px`;
    popupEl.style.top = `${event.clientY}px`;

    const titleEl = document.createElement('div');
    titleEl.className = 'laterlist-popup__title';
    titleEl.textContent = title;

    const urlEl = document.createElement('div');
    urlEl.className = 'laterlist-popup__url';
    urlEl.textContent = url;

    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'laterlist-popup__select-wrapper';

    const tabSelect = createSelect(tabOptions, defaultTabId);
    let containerSelect = createSelect(containerOptions, defaultContainerId);

    tabSelect.addEventListener('change', () => {
      const selectedTab = tabs.find(t => t.id === tabSelect.value);
      const nextContainers = selectedTab?.containers || [];
      const opts = nextContainers.map(c => ({ id: c.id, label: c.name }));
      const newSelect = createSelect(opts, opts[0]?.id);
      selectWrapper.replaceChild(newSelect, containerSelect);
      containerSelect = newSelect;
    });

    selectWrapper.appendChild(tabSelect);
    selectWrapper.appendChild(containerSelect);

    const buttons = document.createElement('div');
    buttons.className = 'laterlist-popup__button-container';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'laterlist-popup__button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', removePopup);

    const saveBtn = document.createElement('button');
    saveBtn.className =
      'laterlist-popup__button laterlist-popup__button--primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'laterlist:addLink',
        payload: {
          url,
          title,
          tabId: tabSelect.value,
          containerId: containerSelect.value,
        },
      });
      removePopup();
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);

    popupEl.appendChild(titleEl);
    popupEl.appendChild(urlEl);
    popupEl.appendChild(selectWrapper);
    popupEl.appendChild(buttons);

    document.body.appendChild(popupEl);
    requestAnimationFrame(() => {
      popupEl.style.opacity = '1';
    });

    window.addEventListener('keydown', handleKeydown, true);
  }

  document.addEventListener('contextmenu', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    showPopup(event).catch(() => removePopup());
  });

  document.addEventListener('click', () => removePopup());
})();
