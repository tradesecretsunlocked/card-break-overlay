function boot() {
  Renderers.directional(AppState);

  // fake interaction test
  setTimeout(() => {
    AppState.markSold("EAST", "TikTokUser123");
    Renderers.directional(AppState);
  }, 1500);
}

document.addEventListener("DOMContentLoaded", boot);
