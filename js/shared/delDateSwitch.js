// shared/delDateSwitch.js
//
// Loading DEL / 2nd DEL is a single, shared calculation mode — switching
// it on All Styles changes what Changed Styles shows too, and vice versa,
// since it represents one "which delivery date do we currently trust"
// decision that should mean the same thing everywhere, not two separately
// configurable ones that could disagree with each other.

import { loadSettings, saveSettings } from '../settings/settingsManager.js';
import { getDeliveryCorrectionsMeta } from '../storage/deliveryCorrectionsRepo.js';
import { toast } from '../ui/shell.js';

export function renderDelDateSwitchHtml(mode) {
  const isSecond = mode === '2nd';
  return `
    <div class="del-date-switch" style="display:flex; align-items:center; gap:10px; padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--panel);">
      <span style="font-size:11px; color:var(--slate); font-weight:600;">Loading DEL</span>
      <button type="button" id="del-date-switch-toggle" role="switch" aria-checked="${isSecond}"
        style="position:relative; width:38px; height:20px; border-radius:10px; border:none; cursor:pointer; background:${isSecond ? 'var(--brand-blue)' : 'var(--line)'}; transition:background .15s;">
        <span style="position:absolute; top:2px; left:${isSecond ? '20px' : '2px'}; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s;"></span>
      </button>
      <span style="font-size:11px; color:var(--slate); font-weight:600;">2nd DEL</span>
      <span style="width:1px; height:16px; background:var(--line);"></span>
      <span style="font-size:11.5px; color:var(--ink);">Calculation Based On: <b>${isSecond ? '2nd DEL' : 'Loading DEL'}</b></span>
    </div>
  `;
}

/**
 * Wires the toggle's click handler, including the validation gate.
 * @param container   the element containing the switch markup
 * @param onModeChanged  called with the new mode after a successful,
 *                        validated switch — the caller re-renders itself
 */
export function wireDelDateSwitch(container, onModeChanged) {
  const btn = container.querySelector('#del-date-switch-toggle');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const settings = await loadSettings();
    const currentlySecond = settings.delDateCalcMode === '2nd';

    if (!currentlySecond) {
      // Switching TO 2nd DEL — validate corrections actually exist first.
      const meta = await getDeliveryCorrectionsMeta();
      if (!meta.count) {
        toast('2nd DEL data is not available. Please upload the delivery correction file before using 2nd DEL calculation mode.', 'error');
        return; // stays on Loading DEL, per spec
      }
      await saveSettings({ ...settings, delDateCalcMode: '2nd' });
      onModeChanged('2nd');
    } else {
      await saveSettings({ ...settings, delDateCalcMode: 'loading' });
      onModeChanged('loading');
    }
  });
}
