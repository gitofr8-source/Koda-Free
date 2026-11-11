// Koda ChatGPT Mirror Companion Background Service Worker
const KODA_SERVER = 'http://localhost:3000';
let isPolling = false;

console.log('[Koda Companion] Service worker initialized');

async function pollKodaServer() {
  if (isPolling) return;
  isPolling = true;

  while (true) {
    try {
      const res = await fetch(`${KODA_SERVER}/api/chatgpt/companion/poll`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.prompt && data.requestId) {
          await executePromptInTab(data.prompt, data.requestId, data.conversationId);
        }
      }
    } catch (err) {
      // Server might be temporarily restarting or offline; backoff
      await new Promise(r => setTimeout(r, 2000));
    }
    await new Promise(r => setTimeout(r, 600));
  }
}

async function getChatGptTab() {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  if (tabs && tabs.length > 0) return tabs[0];
  return null;
}

async function executePromptInTab(promptText, requestId, conversationId) {
  let tab = await getChatGptTab();
  if (!tab) {
    // Open a pinned or background tab
    tab = await chrome.tabs.create({ url: 'https://chatgpt.com', active: false, pinned: true });
    // Wait for it to load
    await new Promise(r => setTimeout(r, 4000));
  }

  // Navigate to conversation if specified
  if (conversationId && !tab.url.includes(conversationId)) {
    await chrome.tabs.update(tab.id, { url: `https://chatgpt.com/c/${conversationId}` });
    await new Promise(r => setTimeout(r, 3000));
  }

  chrome.tabs.sendMessage(tab.id, {
    action: 'SEND_PROMPT',
    prompt: promptText,
    requestId
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'STREAM_CHUNK') {
    fetch(`${KODA_SERVER}/api/chatgpt/companion/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: message.requestId,
        delta: message.delta,
        text: message.text,
        done: false
      })
    }).catch(() => {});
  } else if (message.action === 'STREAM_DONE') {
    fetch(`${KODA_SERVER}/api/chatgpt/companion/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: message.requestId,
        fullText: message.fullText,
        url: message.url,
        done: true
      })
    }).catch(() => {});
  } else if (message.action === 'STREAM_ERROR') {
    fetch(`${KODA_SERVER}/api/chatgpt/companion/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: message.requestId,
        error: message.error,
        done: true
      })
    }).catch(() => {});
  }
});

// Start polling
pollKodaServer();
