window.Renderers = window.Renderers || {};

Renderers.directional = function renderDirectional(state) {
  const panels = [
    "assignmentPanel-top-left",
    "assignmentPanel-top-right",
    "assignmentPanel-mid-left",
    "assignmentPanel-mid-right"
  ];

  panels.forEach(id => {
    const panel = document.getElementById(id);
    if (!panel) return;

    panel.innerHTML = "";

    state.spots.forEach(spot => {
      const tile = document.createElement("div");
      tile.className = "assignment-tile" + (spot.sold ? " sold" : "");

      tile.innerHTML = `
        <div class="assignment-direction">${spot.id}</div>
        <div class="assignment-buyer">
          ${spot.sold ? spot.buyer : "AVAILABLE"}
        </div>
      `;

      panel.appendChild(tile);
    });
  });

  document.getElementById("soldCount").textContent = state.getSold().length;
  document.getElementById("remainingCount").textContent = state.getAvailable().length;
  document.getElementById("soldCountMid").textContent = state.getSold().length;
  document.getElementById("remainingCountMid").textContent = state.getAvailable().length;
};
