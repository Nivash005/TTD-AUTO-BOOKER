const phase = document.getElementById("phase");
const message = document.getElementById("message");

function show(d) {
  if (!d) return;
  phase.textContent = d.phase || "Unknown";
  message.textContent = d.message || "";
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function allowed(url) {
  return (
    /^https:\/\/tirupatibalaji\.ap\.gov\.in\//.test(url || "") ||
    /^http:\/\/(localhost|127\.0\.0\.1):3000\//.test(url || "")
  );
}

async function queryAllFrames(tabId, type) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames || frames.length === 0) return null;
    const responses = [];
    for (const f of frames) {
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type }, { frameId: f.frameId });
        if (res && res.ok) responses.push(res);
      } catch (_) {}
    }
    if (responses.length === 0) return null;
    return (
      responses.find((r) => r.running) ||
      responses.find((r) => r.phase && r.phase !== "Ready" && r.phase !== "Stopped") ||
      responses[0]
    );
  } catch (_) {
    return null;
  }
}

async function send(type) {
  const tab = await activeTab();
  if (!tab?.id) return show({ phase: "Error", message: "No active tab." });
  if (!allowed(tab.url || "")) {
    return show({
      phase: "Wrong page",
      message: "Open the TTD ticket page or your localhost:3000 test page."
    });
  }

  const best = await queryAllFrames(tab.id, type);
  if (best) {
    show(best);
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type }, (response) => {
    if (chrome.runtime.lastError || !response) {
      show({
        phase: "Reload required",
        message: "Reload the ticket page, then click Start Automation."
      });
      return;
    }
    show(response);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "STATUS") {
    show(msg);
  }
});

document.getElementById("start").addEventListener("click", () => send("START"));
document.getElementById("stop").addEventListener("click", () => send("STOP"));

send("GET_STATUS");
