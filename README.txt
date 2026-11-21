Ticket Auto Flow - Fast v2.7.2

What it does
- After you enter the CAPTCHA, clicks Continue using a trusted Chrome Debugger mouse event
  (avoids isTrusted=false rejection / 403 that normal script clicks can trigger)
- Selects ICICI Bank (input[name="iciciBank"])
- Clicks #edonation_paynow
- Stops at the final payment page (OTP / UPI / card stay manual)

Important
- Chrome will show a banner: "Extension is debugging this browser"
  This is required for trusted clicks. It disappears when you Stop or close the tab.
- CAPTCHA, OTP and final payment authorization always stay manual.

Supported pages
- https://tirupatibalaji.ap.gov.in/*
- http://localhost:3000/* and http://127.0.0.1:3000/*

Install
1. Extract this ZIP
2. Chrome -> chrome://extensions -> enable Developer mode
3. Click "Load unpacked" and select the INNER folder named ticket_auto_extension_fast
4. Accept the debugger permission if Chrome asks
5. Open or reload your ticket page
6. Click the extension icon -> Start Automation
