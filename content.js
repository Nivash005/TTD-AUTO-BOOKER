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
    try {
      chrome.runtime.sendMessage({ type: "STATUS", phase, message });
    } catch (_) {}
  }

  function visible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      s.display !== "none" &&
      s.visibility !== "hidden" &&
      s.opacity !== "0" &&
      r.width > 0 &&
      r.height > 0
    );
  }

  function enabled(el) {
    return (
      visible(el) &&
      !el.disabled &&
      el.getAttribute("disabled") === null &&
      el.getAttribute("aria-disabled") !== "true" &&
      getComputedStyle(el).pointerEvents !== "none"
    );
  }

  function txt(el) {
    return (el?.innerText || el?.value || el?.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function button(words, { includeDisabled = false } = {}) {
    for (const el of document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], [role="button"]'
    )) {
      if (!visible(el)) continue;
      if (!includeDisabled && !enabled(el)) continue;
      const t = txt(el);
      if (words.some((w) => t === w || t.includes(w))) return el;
    }
    return null;
  }

  function normalClick(el) {
    if (!el || !visible(el)) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (_) {}
    if (el.type === "radio" || el.type === "checkbox") {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, opts));
    });
    return true;
  }

  function trustedClick(el) {
    return new Promise((resolve) => {
      if (!el || !visible(el)) return resolve(false);
      try {
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      } catch (_) {}
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      chrome.runtime.sendMessage({ type: "TRUSTED_CLICK", x, y }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          normalClick(el);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  function forceAngularIcici(now = performance.now()) {
    if (now - lastForceIciciAt < 250) return;
    lastForceIciciAt = now;
    try {
      chrome.runtime.sendMessage({ type: "FORCE_ICICI" });
    } catch (_) {}
  }

  function getIciciRadio() {
    return (
      document.querySelector('input[name="iciciBank"]') ||
      document.querySelector('input[value="11"][ng-model="ecspc.bankValue"]')
    );
  }

  function selectIcici() {
    const radio = getIciciRadio();
    if (!radio || !visible(radio)) return false;
    if (!radio.checked) {
      normalClick(radio);
      radio.checked = true;
    }
    lastForceIciciAt = 0;
    forceAngularIcici();
    return true;
  }

  function getPayNowButton() {
    const byId = document.getElementById("edonation_paynow");
    if (byId && visible(byId)) return byId;
    return button(["pay now", "paynow", "proceed to payment"], { includeDisabled: true });
  }

  function getCaptchaInput() {
    return (
      [...document.querySelectorAll("input, textarea")].find((el) => {
        if (!visible(el)) return false;
        const h = [el.id, el.name, el.placeholder, el.getAttribute("aria-label")]
          .join(" ")
          .toLowerCase();
        return h.includes("captcha");
      }) || null
    );
  }

  function recentlyClicked(el, now) {
    return Boolean(el && el === lastClickedEl && now - lastClickedAt < 2000);
  }

  function stopWatch() {
    continueWatchUntil = 0;
    if (watchTimer !== null) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  function watchUntil(ms) {
    const targetUntil = performance.now() + ms;
    if (targetUntil > continueWatchUntil) continueWatchUntil = targetUntil;
    if (watchTimer !== null) return;

    watchTimer = setInterval(() => {
      if (!running || performance.now() > continueWatchUntil) {
        stopWatch();
        return;
      }
      schedule();
    }, 50);
  }

  function run() {
    scheduled = false;
    if (!running || clickInFlight) return;

    const now = performance.now();
    const inFastWindow =
      (iciciSelectedAt && now - iciciSelectedAt < 4000) ||
      (continueWatchUntil && now < continueWatchUntil);
    const minGap = inFastWindow ? 40 : 140;
    if (now - lastAction < minGap) {
      schedule();
      return;
    }

    // 1. Select ICICI Bank
    const iciciRadio = getIciciRadio();
    if (iciciRadio && visible(iciciRadio) && !iciciRadio.checked) {
      selectIcici();
      lastAction = now;
      lastClickedEl = iciciRadio;
      lastClickedAt = now;
      iciciSelectedAt = now;
      status("ICICI Bank selected. Waiting for Pay Now...", "Bank selected");
      watchUntil(4000);
      return;
    }

    // 2. Pay Now
    const pay = getPayNowButton();
    if (pay) {
      if (iciciRadio && visible(iciciRadio) && !iciciRadio.checked) {
        selectIcici();
        iciciSelectedAt = now;
        lastAction = now;
        watchUntil(4000);
        return;
      }

      if (!enabled(pay)) {
        forceAngularIcici(now);
        if (!iciciSelectedAt) {
          selectIcici();
          iciciSelectedAt = now;
        }
        status("ICICI selected – waiting for Pay Now to enable...", "Waiting enable");
        watchUntil(4000);
        return;
      }

      if (!recentlyClicked(pay, now)) {
        clickInFlight = true;
        lastAction = now;
        lastClickedEl = pay;
        lastClickedAt = now;
        stopWatch();
        status("Trusted-clicking Pay Now...", "Payment");

        trustedClick(pay).then((ok) => {
          clickInFlight = false;
          status(
            ok
              ? "Pay Now clicked (trusted). Waiting for payment gateway..."
              : "Pay Now clicked (fallback). Waiting for payment gateway...",
            "Payment"
          );
        });
      }
      return;
    }

    // 3. Continue / Proceed
    const cont = button(["continue", "proceed"], { includeDisabled: true });
    if (cont) {
      const captcha = getCaptchaInput();
      const captchaFilled = captcha ? captcha.value.trim().length > 0 : true;

      if (captcha && !captchaFilled) {
        status("Enter CAPTCHA manually – will trusted-click Continue when unlocked.", "CAPTCHA");
        watchUntil(5000);
        return;
      }

      if (!enabled(cont)) {
        status("CAPTCHA done – waiting for Continue to unlock...", "Waiting Continue");
        watchUntil(5000);
        return;
      }

      if (!recentlyClicked(cont, now)) {
        clickInFlight = true;
        lastAction = now;
        lastClickedEl = cont;
        lastClickedAt = now;
        stopWatch();
        status("Trusted-clicking Continue...", "Continue");

        trustedClick(cont).then((ok) => {
          clickInFlight = false;
          status(
            ok
              ? "Continue clicked (trusted). Waiting for next step..."
              : "Continue clicked (fallback). Waiting for next step...",
            "Continue"
          );
        });
      }
      return;
    }

    const bodyText = (document.body?.innerText || "").toLowerCase();
    if (
      (bodyText.includes("paytm") || bodyText.includes("upi") || bodyText.includes("payment options")) &&
      bodyText.includes("payment")
    ) {
      stopWatch();
      status("Payment gateway reached. Complete payment manually.", "Payment gateway");
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
    try {
      chrome.runtime.sendMessage({ type: "SET_ACTIVE", active });
    } catch (_) {}
  }

  function onInput(e) {
    const t = e.target;
    if (!t) return;
    const h = [t.id, t.name, t.placeholder, t.getAttribute("aria-label")]
      .join(" ")
      .toLowerCase();
    if (h.includes("captcha")) {
      watchUntil(8000);
      schedule();
    }
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
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "disabled",
          "aria-disabled",
          "checked",
          "class",
          "style",
          "value",
          "ng-disabled"
        ]
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
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    document.removeEventListener("input", onInput, true);
    status("Automation stopped.", "Stopped");
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "START") {
      start(false);
      reply({ ok: true, phase, message, running });
    } else if (msg?.type === "STOP") {
      stop();
      reply({ ok: true, phase, message, running });
    } else if (msg?.type === "GET_STATUS") {
      reply({ ok: true, phase, message, running });
    } else if (msg?.type === "RESUME") {
      start(true);
      reply({ ok: true, phase, message, running });
    }
    return true;
  });

  status("Ready. Continue + Pay Now use trusted Debugger clicks.", "Ready");
})();
