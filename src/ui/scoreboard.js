function scoreboardText({ runs, green, gates }) {
  return `${runs} runs · ${green} green · gate opened ${gates} · per-session`;
}

export function init(rootEl, deps = {}) {
  const eventBus = deps.bus;
  if (!eventBus || typeof eventBus.on !== "function") {
    throw new TypeError("scoreboard init requires deps.bus");
  }

  const counts = { runs: 0, green: 0, gates: 0 };
  const render = () => {
    rootEl.textContent = scoreboardText(counts);
  };

  rootEl.replaceChildren();
  rootEl.className = "scoreboard";
  rootEl.setAttribute("role", "status");
  rootEl.setAttribute("aria-live", "polite");
  render();

  const offRun = eventBus.on("run", detail => {
    counts.runs += 1;
    if (detail?.verdict?.green === true) counts.green += 1;
    render();
  });
  const offSurface = eventBus.on("surface", detail => {
    if (detail?.change === "registered" && detail.tool === "submit_report") {
      counts.gates += 1;
      render();
    }
  });

  return () => {
    offRun();
    offSurface();
  };
}
