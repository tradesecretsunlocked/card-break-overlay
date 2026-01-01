// script.js
//
// Handles switching between the different break layouts.  Each section
// corresponding to a layout has an id of the form `layout-<name>` and
// shares the class `layout-section`.  Selecting a new layout hides the
// others and reveals the chosen section.

document.addEventListener('DOMContentLoaded', () => {
  const selector = document.getElementById('layoutSelector');
  const sections = Array.from(document.querySelectorAll('.layout-section'));

  function showLayout(name) {
    sections.forEach(section => {
      section.classList.add('hidden');
    });
    const target = document.getElementById('layout-' + name);
    if (target) {
      target.classList.remove('hidden');
    }
  }

  // initial load
  showLayout(selector.value);

  selector.addEventListener('change', () => {
    showLayout(selector.value);
  });
});