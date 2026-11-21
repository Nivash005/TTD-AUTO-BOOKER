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
  return (await getActiveTabs()).has(Number(tabId));
}

async function injectAndResume(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
    try { await chrome.tabs.sendMessage(tabId, { type: "RESUME" }, { frameId }); } catch (_) {}
  } catch (_) {}
}

async function forceIciciInPage(tabId, frameId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: typeof frameId === "number" ? [frameId] : undefined },
      world: "MAIN",
      func: () => {
        try {
          let radio = document.querySelector('input[name="iciciBank"], input[value="11"][ng-model="ecspc.bankValue"]');
          if (!radio) {
            for (const label of document.querySelectorAll("label")) {
              if (!/\\bicici\\b/i.test((label.innerText || label.textContent || "").replace(/\\s+/g, " "))) continue;
              radio = label.control || (label.htmlFor && document.getElementById(label.htmlFor)) || label.querySelector('input[type="radio"]');
              if (radio) break;
            }
          }
          if (!radio || !radio.matches('input[type="radio"]')) return;
          if (!radio.checked) radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event("input", { bubbles: true }));
          radio.dispatchEvent(new Event("change", { bubbles: true }));
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
    const text = String(e || "");
    if (text.includes("Already attached")) { attached.add(tabId); return true; }
    console.warn("debugger attach failed", e);
    return false;
  }
}

async function detachDebugger(tabId) {
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
}

async function getFrameOffset(tabId, frameId) {
  if (!frameId || frameId === 0) return { dx: 0, dy: 0 };
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames?.length) return { dx: 0, dy: 0 };
    const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
    let child = byId.get(frameId);
    let dx = 0;
    let dy = 0;
    // Add each iframe's viewport offset, including nested frames.
    while (child && child.frameId !== 0) {
      const parentId = child.parentFrameId;
      const parent = byId.get(parentId);
      if (!parent) break;
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [parentId] },
        func: (targetUrl) => {
          const normalize = (value) => {
            try { const u = new URL(value, location.href); return u.origin + u.pathname; }
            catch (_) { return String(value || "").split("?")[0]; }
          };
          const target = normalize(targetUrl);
          const frame = [...document.querySelectorAll("iframe, frame")].find((el) => {
            try {
              if (normalize(el.contentWindow.location.href) === target) return true;
            } catch (_) {}
            return normalize(el.src) === target;
          });
          if (!frame) return null;
          const rect = frame.getBoundingClientRect();
          return { x: rect.left + frame.clientLeft, y: rect.top + frame.clientTop };
        },
        args: [child.url]
      });
      if (!result) break;
      dx += result.x;
      dy += result.y;
      child = parent;
    }
    return { dx, dy };
  } catch (_) { return { dx: 0, dy: 0 }; }
}

async function trustedClick(tabId, frameId, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "invalid_coordinates" };
  if (!(await ensureDebugger(tabId))) return { ok: false, error: "debugger_unavailable" };
  const { dx, dy } = await getFrameOffset(tabId, frameId);
  const cx = Math.round(x + dx);
  const cy = Math.round(y + dy);
  try {
    const target = { tabId };
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none", buttons: 0, pointerType: "mouse" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    return { ok: true };
  } catch (e) {
    console.warn("trustedClick failed", e);
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg?.type === "SET_ACTIVE" && tabId != null) {
    setTabActive(tabId, !!msg.active).then(async () => {
      if (!msg.active) await detachDebugger(tabId);
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "FORCE_ICICI" && tabId != null) {
    forceIciciInPage(tabId, sender.frameId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "TRUSTED_CLICK" && tabId != null) {
    trustedClick(tabId, sender.frameId, msg.x, msg.y).then(sendResponse);
    return true;
  }
  return false;
});

chrome.debugger.onDetach.addListener(({ tabId }) => { if (tabId != null) attached.delete(tabId); });

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!(await isTabActive(details.tabId))) return;
  if (!details.url || !(details.url.startsWith("http://") || details.url.startsWith("https://"))) return;
  await injectAndResume(details.tabId, details.frameId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete" && await isTabActive(tabId)) await injectAndResume(tabId, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setTabActive(tabId, false).catch(() => {});
  detachDebugger(tabId);
});
