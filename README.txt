# Ticket Auto Flow — Fast

A Chrome Manifest V3 helper for the TTD ticket page and localhost testing.

## What it does
- Waits for you to enter and submit CAPTCHA; CAPTCHA solving remains manual.
- Clicks Continue after the page enables it.
- Selects ICICI Bank when its radio option or associated label is present.
- Clicks Pay Now when enabled, then stops at the payment gateway.
- OTP and final payment authorization remain manual.

The extension responds to page changes and checks briefly while waiting for a control to become enabled. Navigation still depends on the TTD site and its server response; the extension cannot make that happen instantly or skip site validation.

## Supported pages
- `https://tirupatibalaji.ap.gov.in/*`
- `http://localhost:3000/*` and `http://127.0.0.1:3000/*`

## Install
1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this repository folder.
3. Open or reload a supported ticket page, then click the extension icon and **Start Automation**.
4. Enter CAPTCHA manually. Complete OTP and payment manually.

The extension uses Chrome's Debugger API for trusted page clicks. Chrome displays its debugging banner while attached; use **Stop Automation** to detach.
