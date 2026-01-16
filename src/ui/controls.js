export function bindRangeLabels(ui) {
  function syncUI() {
    if (ui.radiusVal) ui.radiusVal.textContent = ui.radius.value;
    if (ui.damageVal) ui.damageVal.textContent = ui.damage.value;
    if (ui.bondWeakenVal) ui.bondWeakenVal.textContent = ui.bondWeaken.value;
    if (ui.relaxItersVal) ui.relaxItersVal.textContent = ui.relaxIters.value;
  }

  ["input", "change"].forEach((ev) => {
    ui.radius?.addEventListener(ev, syncUI);
    ui.damage?.addEventListener(ev, syncUI);
    ui.bondWeaken?.addEventListener(ev, syncUI);
    ui.relaxIters?.addEventListener(ev, syncUI);
  });

  syncUI();
  return syncUI;
}
