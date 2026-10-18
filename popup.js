const box = document.getElementById('enabled');
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => { box.checked = enabled; });
box.addEventListener('change', () => chrome.storage.sync.set({ enabled: box.checked }));
