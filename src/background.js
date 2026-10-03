// Clears the unlocked session when the auto-lock timer fires, even if the
// popup is closed.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autolock') chrome.storage.session.remove('unlocked');
});

chrome.runtime.onInstalled.addListener(() => {
  // Earlier versions cached a remotely fetched wordlist; it now ships with the extension.
  chrome.storage.local.remove('bip39English');
});
