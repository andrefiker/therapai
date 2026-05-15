// TherapAI Meet Launcher — options script

(async () => {
  const { apiBase } = await chrome.storage.sync.get(['apiBase']);
  document.getElementById('apiBase').value = apiBase || 'https://therapai-one.vercel.app';
})();

document.getElementById('save').addEventListener('click', async () => {
  const input = document.getElementById('apiBase');
  const val = input.value.trim().replace(/\/$/, '');

  if (!/^https:\/\//.test(val)) {
    alert('API base URL must start with https://');
    input.focus();
    return;
  }

  await chrome.storage.sync.set({ apiBase: val });
  const saved = document.getElementById('saved');
  saved.textContent = '✓ saved';
  setTimeout(() => (saved.textContent = ''), 2000);
});
