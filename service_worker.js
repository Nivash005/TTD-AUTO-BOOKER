const KEY = "activeTabs";
const attached = new Set();

async function getActiveTabs() {
  const data = await chrome.storage.local.get(KEY);
  return new Set((data[KEY] || []).map(Number));
}

async function setTabActive(tabId, active) {
  const tabs = await getActiveTabs();
  if (active) tabs.add(Number(tabId));
  else tabs.delete(Number(tabId));
  await chrome.storage.local.set({ [KEY]: [...tabs] });
}

async function isTabActive(tabId) {
  const tabs = await getActiveTabs();
  return tabs.has(Number(tabId));
}

async function injectAndResume(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content.js"]
    });
    try {
      await chrome.tabs.sendMessage(tabId, { type: "RESUME" }, { frameId });
    } catch (_) {}
  } catch (_) {}
}

async function forceIciciInPage(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: typeof frameId === "number" ? [frameId] : undefined },
      world: "MAIN",
      func: () => {
        try {
          const radio =
            document.querySelector('input[name="iciciBank"]') ||
            document.querySelector('input[value="11"][ng-model="ecspc.bankValue"]');
          if (!radio) return;
          if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event("input", { bubbles: true }));
            radio.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (typeof angular !== "undefined" && angular.element) {
            const scope = angular.element(radio).scope();
            if (scope) {
              if (scope.ecspc) scope.ecspc.bankValue = "11";
              if (typeof scope.selectedBank === "function") scope.selectedBank("11");
              if (typeof scope.$applyAsync === "function") scope.$applyAsync();
              else if (typeof scope.$apply === "function" && !scope.$$phase) scope.$apply();
            }
          }
        } catch (_) {}
      }
    });
  } catch (_) {}
}

async function ensureDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
    return true;
  } catch (e) {
    const msg = String(e || "");
    if (msg.includes("Already attached") || msg.includes("Another debugger")) {
      attached.add(tabId);
      return !msg.includes("Another debugger");
    }
    console.warn("debugger attach failed", e);
    return false;
  }
}

async function detachDebugger(tabId) {
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {}
}

async function getFrameOffset(tabId, frameId) {
  if (!frameId || frameId === 0) return { dx: 0, dy: 0 };
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) return { dx: 0, dy: 0 };
    const frameInfo = frames.find((f) => f.frameId === frameId);
    if (!frameInfo || !frameInfo.url) return { dx: 0, dy: 0 };

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (targetUrl) => {
        const iframes = [...document.querySelectorAll("iframe, frame")];
        const match = iframes.find((el) => {
          try {
            return el.contentWindow && el.contentWindow.location.href === targetUrl;
          } catch (_) {
            return el.src && targetUrl.startsWith(el.src.split("?")[0]);
          }
        });
        if (!match) return { dx: 0, dy: 0 };
        const r = match.getBoundingClientRect();
        return { dx: r.left, dy: r.top };
      },
      args: [frameInfo.url]
    });
    return result || { dx: 0, dy: 0 };
  } catch (_) {
    return { dx: 0, dy: 0 };
  }
}

async function trustedClick(tabId, frameId, x, y) {
  const ok = await ensureDebugger(tabId);
  if (!ok) return { ok: false, error: "attach_failed" };

  const { dx, dy } = await getFrameOffset(tabId, frameId);
  const cx = Math.round(x + dx);
  const cy = Math.round(y + dy);

  const target = { tabId };
  try {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: cx,
      y: cy,
      button: "none",
      buttons: 0,
      pointerType: "mouse"
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: cx,
      y: cy,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse"
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: cx,
      y: cy,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse"
    });
    return { ok: true };
  } catch (e) {
    console.warn("trustedClick failed", e);
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SET_ACTIVE" && sender.tab?.id != null) {
    setTabActive(sender.tab.id, !!msg.active).then(async () => {
      if (!msg.active) await detachDebugger(sender.tab.id);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg?.type === "FORCE_ICICI" && sender.tab?.id != null) {
    forceIciciInPage(sender.tab.id, sender.frameId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "TRUSTED_CLICK" && sender.tab?.id != null) {
    const { x, y } = msg;
    trustedClick(sender.tab.id, sender.frameId, x, y).then(sendResponse);
    return true;
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!(await isTabActive(details.tabId))) return;
  if (!details.url || !(details.url.startsWith("http://") || details.url.startsWith("https://"))) return;
  await injectAndResume(details.tabId, details.frameId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!(await isTabActive(tabId))) return;
  await injectAndResume(tabId, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setTabActive(tabId, false);
  detachDebugger(tabId);
});
