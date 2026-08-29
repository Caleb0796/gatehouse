const makeWorker = source => {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
};

const nextMessage = (worker, timeoutMs = 2_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`worker message exceeded ${timeoutMs}ms`)), timeoutMs);
  worker.addEventListener("message", event => {
    clearTimeout(timer);
    resolve(event.data);
  }, { once: true });
  worker.addEventListener("error", event => {
    clearTimeout(timer);
    reject(new Error(event.message || "worker error"));
  }, { once: true });
});

const runCheck = async (id, check) => {
  try {
    return { id, pass: true, evidence: await check() };
  } catch (error) {
    return { id, pass: false, evidence: String(error && error.message || error) };
  }
};

const testSpawn = async () => {
  const worker = makeWorker('self.postMessage("spawned")');
  const reply = await nextMessage(worker);
  worker.terminate();
  if (reply !== "spawned") throw new Error(`unexpected spawn reply: ${String(reply)}`);
  return "opaque srcdoc iframe created a Blob Worker and received its startup message";
};

const testRoundTrip = async () => {
  const token = `ping-${crypto.randomUUID()}`;
  const worker = makeWorker("self.onmessage = event => self.postMessage({ pong: event.data })");
  const replyPromise = nextMessage(worker);
  worker.postMessage(token);
  const reply = await replyPromise;
  worker.terminate();
  if (!reply || reply.pong !== token) throw new Error("postMessage token did not round-trip");
  return `postMessage round-trip preserved token ${token}`;
};

const testTerminate = async () => {
  const worker = makeWorker('self.postMessage("started"); while (true) {}');
  const started = await nextMessage(worker);
  if (started !== "started") throw new Error("busy worker did not start");

  const terminatedAt = performance.now();
  worker.terminate();

  const probe = makeWorker('self.postMessage("responsive")');
  const reply = await nextMessage(probe, 2_000);
  probe.terminate();
  const recoveryMs = Math.round(performance.now() - terminatedAt);
  if (reply !== "responsive" || recoveryMs >= 2_000) {
    throw new Error(`worker recovery took ${recoveryMs}ms`);
  }
  return `terminated a while(true) worker; a fresh worker replied after ${recoveryMs}ms (<2000ms)`;
};

const testUmd = async libraryText => {
  const worker = makeWorker(`${libraryText}\nself.postMessage({ exported: typeof self.dayjs, formatted: self.dayjs("2020-02-03").format("YYYY-MM-DD") });`);
  const reply = await nextMessage(worker);
  worker.terminate();
  if (!reply || reply.exported !== "function" || reply.formatted !== "2020-02-03") {
    throw new Error(`Day.js UMD did not expose a working global: ${JSON.stringify(reply)}`);
  }
  return "Day.js 1.11.13 UMD exported self.dayjs and formatted 2020-02-03 in the Worker";
};

window.addEventListener("message", async event => {
  if (event.source !== parent || !event.data || event.data.t !== "start") return;

  const checks = [];
  checks.push(await runCheck("spawn", testSpawn));
  checks.push(await runCheck("roundtrip", testRoundTrip));
  checks.push(await runCheck("terminate", testTerminate));
  checks.push(await runCheck("umd", () => testUmd(event.data.libraryText)));
  parent.postMessage({ t: "complete", checks }, "*");
}, { once: true });

parent.postMessage({ t: "ready" }, "*");
