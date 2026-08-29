FAIL

- Unit acceptance: `npm test` passed (91 tests, 0 failures).
- Browser acceptance attempt 1: local production-CSP server could not bind port 8080 (`listen EPERM`).
- Browser acceptance attempt 2: portless Playwright harness could not keep headless Google Chrome running (`Target page, context or browser has been closed`).
- Browser acceptance attempt 3: connected Chrome reached `net::ERR_CONNECTION_REFUSED` at `http://127.0.0.1:8080/?demo=1` because no local server was permitted.
- Final `data-e2e="pass"` was not observed in a real browser, so the task remains blocked.
