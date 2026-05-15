// TherapAI Meet Launcher — popup script

(async () => {
  const sync = await chrome.storage.sync.get(['apiBase']);
  const apiBase = sync.apiBase || 'https://therapai-one.vercel.app';
  document.getElementById('api').textContent = apiBase.replace(/^https?:\/\//, '');

  const local = await chrome.storage.local.get(['launched']);
  const launched = local.launched || {};
  document.getElementById('count').textContent = Object.keys(launched).length;
})();

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ launched: {} });
  document.getElementById('count').textContent = '0';
});
