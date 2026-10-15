// tool -> files to inject and the global its panel registers (used to hide the other panels)
const TOOLS = {
  design:  { files: ['tools/design_csv.js'], panel: '__iqgCsvPanel3' },
  address: { files: ['tools/address_csv.js'], panel: '__iqgAddrPanel' },
  wallbox: { files: ['tools/wallbox_address.js'], panel: '__iqgWbAddrPanel' },
  name:    { files: ['tools/namerules.js', 'tools/name_address.js'], panel: '__iqgNameAddrPanel' }
};

document.querySelectorAll('button[data-tool]').forEach(btn => btn.addEventListener('click', async () => {
  const tool = TOOLS[btn.dataset.tool];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const others = Object.values(TOOLS).map(t => t.panel).filter(p => p !== tool.panel);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: names => names.forEach(n => window[n] && window[n].hide && window[n].hide()),
    args: [others]
  });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: tool.files });
  window.close();
}));
