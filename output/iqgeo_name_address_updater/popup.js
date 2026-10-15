document.getElementById('open').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['namerules.js', 'content.js'] });
  window.close();
});
