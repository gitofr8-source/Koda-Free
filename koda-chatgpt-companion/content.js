// Koda ChatGPT Mirror Companion Content Script
// Runs inside chatgpt.com tabs

console.log('[Koda Companion] Injected into ChatGPT web tab');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    const textarea = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
    sendResponse({
      ok: true,
      url: window.location.href,
      ready: !!textarea
    });
    return true;
  }

  if (request.action === 'SEND_PROMPT') {
    handleSendPrompt(request.prompt, request.requestId);
    sendResponse({ ok: true });
    return true;
  }
});

function handleSendPrompt(promptText, requestId) {
  const el = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
  if (!el) {
    chrome.runtime.sendMessage({
      action: 'STREAM_ERROR',
      requestId,
      error: 'Prompt textarea not found in ChatGPT tab'
    });
    return;
  }

  el.focus();
  if (el.getAttribute('contenteditable') === 'true') {
    el.innerHTML = '';
    document.execCommand('insertText', false, promptText);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.value = promptText;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setTimeout(() => {
    const sendBtn = document.querySelector('button[data-testid="send-button"]')
                 || document.querySelector('button[aria-label="Send prompt"]')
                 || document.querySelector('button[aria-label="Send message"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    startObservingResponse(requestId);
  }, 200);
}

function startObservingResponse(requestId) {
  let lastLength = 0;
  let checks = 0;
  const maxChecks = 600;

  const interval = setInterval(() => {
    checks++;
    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!assistants.length) return;

    const last = assistants[assistants.length - 1];
    const stopBtn = document.querySelector('button[data-testid="stop-button"]') || document.querySelector('button[aria-label="Stop generating"]');
    const text = (last.innerText || last.textContent || '').trim();

    if (text.length > lastLength) {
      const delta = text.slice(lastLength);
      lastLength = text.length;
      chrome.runtime.sendMessage({
        action: 'STREAM_CHUNK',
        requestId,
        delta,
        text
      });
    }

    if (!stopBtn && checks > 8) {
      clearInterval(interval);
      chrome.runtime.sendMessage({
        action: 'STREAM_DONE',
        requestId,
        fullText: text,
        url: window.location.href
      });
    }

    if (checks >= maxChecks) {
      clearInterval(interval);
      chrome.runtime.sendMessage({
        action: 'STREAM_DONE',
        requestId,
        fullText: text,
        url: window.location.href
      });
    }
  }, 100);
}
