(() => {
  if (window.__ticketAutoFastLoaded) return;
  window.__ticketAutoFastLoaded = true;

  let running = false;
  let observer = null;
  let scheduled = false;
  let watchTimer = null;
  let continueWatchUntil = 0;
  let lastAction = 0;
  let lastForceIciciAt = 0;
  let phase = "Stopped";
  let message = "Click Start in the extension popup.";
  let lastClickedEl = null;
  let lastClickedAt = 0;
  let iciciSelectedAt = 0;
  let clickInFlight = false;

  function status(m, p = phase) {
    message = m;
    phase = p;
    try { chrome.runtime.sendMessage({ type: "STATUS", phase, message }); } catch (_) {}
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" &&
      r.width > 0 && r.height > 0;
  }

  function enabled(el) {
    return visible(el) && !el.disabled && el.getAttribute("disabled") === null &&
      el.getAttribute("aria-disabled") !== "true" && getComputedStyle(el).pointerEvents !== "none";
  }

  function txt(el) {
    return (el?.innerText || el?.textContent || el?.value || el?.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  function button(words, { includeDisabled = false } = {}) {
    const selector = 'button, input[type="button"], input[type="submit"], [role="button"], a.btn, .btn';
    const candidates = [...document.querySelectorAll(selector)].filter((el) =>
      visible(el) && (includeDisabled || enabled(el)) && words.some((w) => txt(el).includes(w))
    );
    // Prefer a button whose complete label matches before accepting a longer label.
    return candidates.find((el) => words.includes(txt(el))) || candidates[0] || null;
  }

  function normalClick(el) {
    if (!el || !el.isConnected) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
    try {
      // Native click invokes the site's normal handlers (unlike manually dispatched MouseEvents).
      el.click();
      return true;
    } catch (_) { return false; }
  }

  function trustedClick(el) {
    return new Promise((resolve) => {
      if (!el || !visible(el)) return resolve(false);
      try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) {}
      const r = el.getBoundingClientRect();
      const x = Math.round(Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)));
      const y = Math.round(Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)));
      chrome.runtime.sendMessage({ type: "TRUSTED_CLICK", x, y }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          resolve(normalClick(el));
          return;
        }
        resolve(true);
      });
    });
  }

  function forceAngularIcici() {
    const now = performance.now();
    if (now - lastForceIciciAt < 250) return;
    lastForceIciciAt = now;
    try { chrome.runtime.sendMessage({ type: "FORCE_ICICI" }); } catch (_) {}
  }

  function getIciciRadio() {
    const explicit = document.querySelector('input[name="iciciBank"], input[value="11"][ng-model="ecspc.bankValue"]');
    if (explicit) return explicit;
    for (const label of document.querySelectorAll("label")) {
      if (!/\bicici\b/i.test(txt(label))) continue;
      const linked = label.control || (label.htmlFor && document.getElementById(label.htmlFor));
      if (linked?.matches('input[type="radio"]')) return linked;
      const nested = label.querySelector('input[type="radio"]');
      if (nested) return nested;
    }
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      const label = radio.labels && [...radio.labels].find((item) => /\bicici\b/i.test(txt(item)));
      const parentText = txt(radio.parentElement);
      if (label || /\bicici\b/i.test(parentText)) return radio;
    }
    return null;
  }

  function getIciciClickTarget(radio) {
    if (!radio) return null;
    const label = radio.labels && [...radio.labels].find(visible);
    if (label) return label;
    if (radio.id) {
      const explicitLabel = [...document.querySelectorAll("label")].find((el) => el.htmlFor === radio.id && visible(el));
      if (explicitLabel) return explicitLabel;
    }
    return visible(radio) ? radio : null;
  }

  function iciciAvailable(radio) {
    return Boolean(radio && (visible(radio) || getIciciClickTarget(radio)));
  }

  function selectIcici() {
    const radio = getIciciRadio();
    if (!iciciAvailable(radio)) return false;
    if (!radio.checked) {
      const target = getIciciClickTarget(radio) || radio;
      normalClick(target);
      // Some Angular/legacy forms don't update the radio from a label click alone.
      if (!radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("input", { bubbles: true }));
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    lastForceIciciAt = 0;
    forceAngularIcici();
    return radio.checked;
  }

  function getPayNowButton() {
    const byId = document.getElementById("edonation_paynow");
    if (byId && visible(byId)) return byId;
    return button(["pay now", "paynow", "proceed to payment"], { includeDisabled: true });
  }

  function getCaptchaInput() {
    return [...document.querySelectorAll("input, textarea")].find((el) => {
      if (!visible(el)) return false;
      const hint = [el.id, el.name, el.placeholder, el.getAttribute("aria-label")].join(" ").toLowerCase();
      return hint.includes("captcha");
    }) || null;
  }

  function recentlyClicked(el, now) {
    return Boolean(el && el === lastClickedEl && now - lastClickedAt < 2000);
  }

  function stopWatch() {
    continueWatchUntil = 0;
    if (watchTimer !== null) { clearInterval(watchTimer); watchTimer = null; }
  }

  function watchUntil(ms) {
    continueWatchUntil = Math.max(continueWatchUntil, performance.now() + ms);
    if (watchTimer !== null) return;
    watchTimer = setInterval(() => {
      if (!running || performance.now() > continueWatchUntil) { stopWatch(); return; }
      schedule();
    }, 75);
  }

  function run() {
    scheduled = false;
    if (!running || clickInFlight) return;
    const now = performance.now();
    const inFastWindow = (iciciSelectedAt && now - iciciSelectedAt < 4000) ||
      (continueWatchUntil && now < continueWatchUntil);
    const minGap = inFastWindow ? 40 : 140;
    if (now - lastAction < minGap) { schedule(); return; }

    const iciciRadio = getIciciRadio();
    if (iciciAvailable(iciciRadio) && !iciciRadio.checked) {
      if (selectIcici()) {
        lastAction = now;
        lastClickedEl = iciciRadio;
        lastClickedAt = now;
        iciciSelectedAt = now;
        status("ICICI Bank selected. Waiting for Pay Now...", "Bank selected");
        watchUntil(4000);
      }
      return;
    }

    const pay = getPayNowButton();
    if (pay) {
      if (iciciAvailable(iciciRadio) && !iciciRadio.checked) {
        selectIcici();
        iciciSelectedAt = now;
        lastAction = now;
        watchUntil(4000);
        return;
      }
      if (!enabled(pay)) {
        forceAngularIcici();
        status("ICICI selected — waiting for Pay Now to enable...", "Waiting enable");
        watchUntil(4000);
        return;
      }
      if (!recentlyClicked(pay, now)) {
        clickInFlight = true;
        lastAction = now;
        lastClickedEl = pay;
        lastClickedAt = now;
        stopWatch();
        status("Clicking Pay Now...", "Payment");
        trustedClick(pay).then((ok) => {
          clickInFlight = false;
          status(ok ? "Pay Now clicked. Waiting for the site..." : "Could not click Pay Now; check the page and try again.", "Payment");
        });
      }
      return;
    }

    const cont = button(["continue", "proceed"], { includeDisabled: true });
    if (cont) {
      const captcha = getCaptchaInput();
      // CAPTCHA entry/verification remains manual. Never infer or solve a CAPTCHA.
      if (captcha && !captcha.value.trim()) {
        status("Enter CAPTCHA manually — Continue will be clicked when enabled.", "CAPTCHA");
        watchUntil(5000);
        return;
      }
      if (!enabled(cont)) {
        status("Waiting for the site to enable Continue...", "Waiting Continue");
        watchUntil(5000);
        return;
      }
      if (!recentlyClicked(cont, now)) {
        clickInFlight = true;
        lastAction = now;
        lastClickedEl = cont;
        lastClickedAt = now;
        stopWatch();
        status("Clicking Continue...", "Continue");
        trustedClick(cont).then((ok) => {
          clickInFlight = false;
          status(ok ? "Continue clicked. Waiting for the next page..." : "Could not click Continue; check the page and try again.", "Continue");
        });
      }
      return;
    }

    const bodyText = (document.body?.innerText || "").toLowerCase();
    if ((bodyText.includes("paytm") || bodyText.includes("upi") || bodyText.includes("payment options")) && bodyText.includes("payment")) {
      stopWatch();
      status("Payment gateway reached. Complete payment and any OTP manually.", "Payment gateway");
      return;
    }
    status("Waiting for Continue / bank / Pay Now...", "Waiting");
  }

  function schedule() {
    if (!running || scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  }

  function setActive(active) {
    try { chrome.runtime.sendMessage({ type: "SET_ACTIVE", active }); } catch (_) {}
  }

  function onInput(e) {
    const t = e.target;
    if (!t) return;
    const hint = [t.id, t.name, t.placeholder, t.getAttribute("aria-label")].join(" ").toLowerCase();
    if (hint.includes("captcha")) { watchUntil(8000); schedule(); }
  }

  function start(isResume = false) {
    stopWatch();
    running = true;
    scheduled = false;
    lastClickedEl = null;
    lastClickedAt = 0;
    lastForceIciciAt = 0;
    if (!isResume) iciciSelectedAt = 0;
    clickInFlight = false;
    setActive(true);
    status(isResume ? "Automation resumed." : "Automation started.", "Running");
    if (!observer && document.documentElement) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "checked", "class", "style", "value", "ng-disabled"]
      });
    }
    document.removeEventListener("input", onInput, true);
    document.addEventListener("input", onInput, true);
    schedule();
  }

  function stop() {
    running = false;
    scheduled = false;
    stopWatch();
    lastClickedEl = null;
    iciciSelectedAt = 0;
    clickInFlight = false;
    setActive(false);
    if (observer) { observer.disconnect(); observer = null; }
    document.removeEventListener("input", onInput, true);
    status("Automation stopped.", "Stopped");
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "START") start(false);
    else if (msg?.type === "STOP") stop();
    else if (msg?.type === "GET_STATUS") { /* report status below */ }
    else if (msg?.type === "RESUME") start(true);
    else return false;
    reply({ ok: true, phase, message, running });
    return true;
  });

  status("Ready. CAPTCHA, OTP, and final payment remain manual.", "Ready");
})();
