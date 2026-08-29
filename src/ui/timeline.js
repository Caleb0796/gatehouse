const EVENT_TYPES = ["surface", "run", "draft", "staged", "signed"];

const EVENT_LABELS = {
  surface: "Tool surface",
  run: "Differential run",
  draft: "Repro draft",
  staged: "Report staged",
  signed: "Report signed",
};

function shortHash(value) {
  return typeof value === "string" && value ? value.slice(0, 12) : "unknown";
}

function describe(type, detail = {}) {
  if (type === "surface") {
    return `${detail.tool || "tool"} ${detail.change || "changed"}${detail.reason ? ` · ${detail.reason}` : ""}`;
  }
  if (type === "run") {
    const verdict = detail.verdict || {};
    return verdict.green ? "Regression demonstrated · green" : `Not green · ${verdict.reason || "unknown verdict"}`;
  }
  if (type === "draft") {
    return `${detail.length ?? 0} characters · sha256 ${shortHash(detail.reproSha256)}`;
  }
  if (type === "staged") {
    return `Artifact ready · ${detail.artifactDraft?.targetId || "unknown target"}`;
  }
  return `Submission recorded · ${detail.artifact?.targetId || "unknown target"}`;
}

function eventTime(type, detail, now) {
  const value = type === "surface" ? detail?.at : undefined;
  const date = new Date(Number.isFinite(value) ? value : now());
  return {
    dateTime: date.toISOString(),
    label: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

export function init(rootEl, deps = {}) {
  const doc = deps.document || document;
  const eventBus = deps.bus;
  const now = deps.now || Date.now;

  if (!eventBus || typeof eventBus.on !== "function") {
    throw new TypeError("timeline init requires deps.bus");
  }

  rootEl.replaceChildren();
  rootEl.className = "timeline";
  rootEl.setAttribute("aria-label", "Gatehouse activity timeline");

  const heading = doc.createElement("h2");
  heading.className = "timeline__heading";
  heading.textContent = "Activity";

  const list = doc.createElement("ol");
  list.className = "timeline__list";
  list.setAttribute("aria-live", "polite");
  rootEl.append(heading, list);

  const unsubscribe = EVENT_TYPES.map(type => eventBus.on(type, detail => {
    const item = doc.createElement("li");
    item.className = `timeline__item timeline__item--${type}`;
    item.dataset.event = type;

    if (type === "surface" && detail?.change === "registered" && detail.tool === "submit_report") {
      item.classList.add("timeline__item--gate-opened");
      item.setAttribute("aria-label", "Gate opened: submit_report registered");
    }

    const marker = doc.createElement("span");
    marker.className = "timeline__marker";
    marker.setAttribute("aria-hidden", "true");

    const body = doc.createElement("div");
    body.className = "timeline__body";

    const title = doc.createElement("strong");
    title.className = "timeline__title";
    title.textContent = EVENT_LABELS[type];

    const summary = doc.createElement("span");
    summary.className = "timeline__summary";
    summary.textContent = describe(type, detail);

    const time = doc.createElement("time");
    const timestamp = eventTime(type, detail, now);
    time.className = "timeline__time";
    time.dateTime = timestamp.dateTime;
    time.textContent = timestamp.label;

    body.append(title, summary, time);
    item.append(marker, body);
    list.append(item);
  }));

  return () => unsubscribe.forEach(off => off());
}
