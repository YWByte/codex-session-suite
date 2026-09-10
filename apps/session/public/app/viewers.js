export function installViewers({ actions, ARCH_VIEWER_ORIGIN, PLAN_VIEWER_ORIGIN }) {
  function openArchViewer() {
    window.open(ARCH_VIEWER_ORIGIN, "_blank", "noopener");
  }

  function openPlanViewer() {
    window.open(PLAN_VIEWER_ORIGIN, "_blank", "noopener");
  }

  Object.assign(actions, { openArchViewer, openPlanViewer });
}
