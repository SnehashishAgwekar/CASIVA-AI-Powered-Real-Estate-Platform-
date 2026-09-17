const APP_VERIFY_URL = "http://localhost:5173/verify";

// Mirrors backend/app/services/link_verifier.py's MAX_SCRAPED_CHARS.
// Deliberately duplicated (this file can't import across that boundary) —
// this is a payload-size cap, not a correctness requirement, since the
// backend truncates independently anyway.
const MAX_CAPTURE_CHARS = 12000;

const NEW_TAB_LOAD_TIMEOUT_MS = 20000;

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n…[truncated by Casiva extension]";
}

function flashBadge(text, color, ms = 2500) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  if (ms) setTimeout(() => chrome.action.setBadgeText({ text: "" }), ms);
}

async function captureListingFromTab(tabId) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      description: document.body ? document.body.innerText : "",
    }),
  });

  const result = injectionResults && injectionResults[0] && injectionResults[0].result;
  if (!result) throw new Error("No result from injected capture script.");

  return {
    url: result.url,
    description: truncate((result.description || "").trim(), MAX_CAPTURE_CHARS),
  };
}

function openVerifyTabAndPrefill(captured) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: APP_VERIFY_URL }, (newTab) => {
      const newTabId = newTab.id;

      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Timed out waiting for the new tab to finish loading."));
      }, NEW_TAB_LOAD_TIMEOUT_MS);

      function listener(tabId, changeInfo) {
        if (tabId !== newTabId || changeInfo.status !== "complete") return;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting
          .executeScript({
            target: { tabId: newTabId },
            func: (payload) => {
              sessionStorage.setItem("verify_link_prefill", JSON.stringify(payload));
            },
            args: [{ url: captured.url, description: captured.description }],
          })
          .then(() => resolve())
          .catch(reject);
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) {
    flashBadge("!", "#C62828");
    return;
  }

  let captured;
  try {
    captured = await captureListingFromTab(tab.id);
  } catch (err) {
    console.error("[Casiva extension] capture failed:", err);
    flashBadge("!", "#C62828");
    return;
  }

  if (!captured || !captured.description || !captured.description.trim()) {
    console.warn("[Casiva extension] captured page had no usable text.");
    flashBadge("!", "#C62828");
    return;
  }

  flashBadge("✓", "#2E7D32");

  try {
    await openVerifyTabAndPrefill(captured);
  } catch (err) {
    console.error("[Casiva extension] failed to open/prefill app tab:", err);
    flashBadge("!", "#C62828");
  }
});
