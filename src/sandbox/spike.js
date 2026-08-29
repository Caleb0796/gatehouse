document.open();
document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RUNNING · Gatehouse SYNC-0 spike</title>
</head>
<body>
  <main>
    <h1>Gatehouse SYNC-0 spike</h1>
    <p id="status">Running four CSP sandbox checks…</p>
    <ol id="results"></ol>
  </main>
</body>
</html>`);

const status = document.querySelector("#status");
const results = document.querySelector("#results");
const iframe = document.createElement("iframe");

iframe.hidden = true;
iframe.sandbox = "allow-scripts";
iframe.srcdoc = '<!doctype html><meta charset="utf-8"><script src="/src/sandbox/spike-inner.js"></script>';

const libraryText = await fetch("/tests/s1-spike-fixtures/dayjs-1.11.13.min.js").then(response => {
  if (!response.ok) throw new Error(`Day.js fixture fetch failed: ${response.status}`);
  return response.text();
});

let finish;
const finished = new Promise(resolve => {
  finish = () => {
    document.close();
    resolve();
  };
});

const fail = message => {
  status.textContent = `NO-GO · ${message}`;
  document.title = `NO-GO · ${message}`;
  finish();
};

const timer = setTimeout(() => fail("iframe did not finish within 10s"), 10_000);

window.addEventListener("message", event => {
  if (event.source !== iframe.contentWindow || !event.data || typeof event.data !== "object") return;

  if (event.data.t === "ready") {
    iframe.contentWindow.postMessage({ t: "start", libraryText }, "*");
    return;
  }

  if (event.data.t !== "complete" || !Array.isArray(event.data.checks)) return;

  clearTimeout(timer);
  for (const check of event.data.checks) {
    const item = document.createElement("li");
    item.dataset.check = check.id;
    item.dataset.pass = String(check.pass);
    item.textContent = `${check.pass ? "PASS" : "FAIL"} · ${check.evidence}`;
    results.append(item);
  }

  const go = event.data.checks.length === 4 && event.data.checks.every(check => check.pass);
  const summary = event.data.checks.map(check => `${check.id}:${check.pass ? "PASS" : "FAIL"}`).join(" · ");
  status.textContent = `${go ? "GO" : "NO-GO"} · ${summary}`;
  document.title = `${go ? "GO" : "NO-GO"} · ${summary}`;
  finish();
}, { once: false });

window.addEventListener("error", event => fail(event.message || "top-level error"), { once: true });

document.body.append(iframe);
await finished;
