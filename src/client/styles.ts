/** Inline client styles; the loader removes the attributed tag on unload. */

export const styles = `
.dpr-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}
.dpr-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  letter-spacing: 0;
}
.dpr-status,
.dpr-error,
.dpr-notice,
.dpr-empty {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}
.dpr-status { color: var(--dsw-alias-state-success-primary); }
.dpr-error { color: var(--dsw-alias-state-error-primary); }
.dpr-notice { color: var(--dsw-alias-state-warn-label); }
.dpr-empty { color: var(--dsw-alias-label-tertiary); }
.dpr-provider {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dpr-provider-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding-top: 4px;
}
.dpr-provider-name {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  letter-spacing: 0;
}
.dpr-provider-id,
.dpr-model-id {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dpr-model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dpr-model {
  box-sizing: border-box;
  min-width: 0;
  margin: 0;
  padding: 12px 14px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
}
.dpr-model-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dpr-model-toggle {
  appearance: none;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dpr-model-toggle:focus-visible {
  outline: 2px solid var(--dsw-static-blue-500);
  outline-offset: 3px;
  border-radius: 4px;
}
.dpr-model-identity {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.dpr-model-name {
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
}
.dpr-model-chevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-secondary);
  transition: transform 160ms ease;
}
.dpr-model-toggle[aria-expanded="true"] .dpr-model-chevron { transform: rotate(180deg); }
.dpr-switch-label,
.dpr-level-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dpr-switch-label { flex: none; }
.dpr-switch,
.dpr-checkbox {
  accent-color: var(--dsw-static-blue-500);
}
.dpr-switch:disabled,
.dpr-checkbox:disabled { opacity: 0.5; }
.dpr-efforts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dpr-effort-header,
.dpr-effort-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.8fr) minmax(160px, 1.2fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dpr-effort-header {
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dpr-wire,
.dpr-default-select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 32px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 0 9px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  letter-spacing: 0;
}
.dpr-wire:focus-visible,
.dpr-default-select:focus-visible {
  outline: none;
  border-color: var(--dsw-static-blue-500);
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}
.dpr-wire:disabled,
.dpr-default-select:disabled { opacity: 0.5; }
.dpr-off-wire {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dpr-default-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.8fr) minmax(160px, 1.2fr);
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.dpr-default-label {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dpr-row-errors {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}
.dpr-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0 2px;
  background: var(--dsw-alias-bg-layer-1);
}
.dpr-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 640px) {
  /* Give this dense editor the full dialog width while retaining every settings tab. */
  [role="dialog"]:has(.dpr-section) {
    flex-direction: column !important;
    width: calc(100vw - 16px) !important;
    max-width: none !important;
    height: calc(100vh - 16px) !important;
    max-height: none !important;
  }
  [role="dialog"]:has(.dpr-section) > nav {
    box-sizing: border-box !important;
    width: 100% !important;
    height: auto !important;
    padding: 8px 10px !important;
    border-right: 0 !important;
    border-bottom: 1px solid var(--dsw-alias-border-l2) !important;
  }
  [role="dialog"]:has(.dpr-section) > nav > :first-child { display: none !important; }
  [role="dialog"]:has(.dpr-section) > nav > :last-child {
    box-sizing: border-box !important;
    display: flex !important;
    flex-direction: row !important;
    width: 100% !important;
    gap: 4px !important;
    overflow-x: auto !important;
  }
  [role="dialog"]:has(.dpr-section) > nav > :last-child > button {
    flex: none !important;
    width: auto !important;
    min-width: max-content !important;
    padding: 8px 10px !important;
  }
  [role="dialog"]:has(.dpr-section) > :not(nav) {
    width: 100% !important;
    min-height: 0 !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dpr-model-chevron { transition: none; }
}
@media (max-width: 560px) {
  .dpr-model-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .dpr-effort-header { display: none; }
  .dpr-effort-row,
  .dpr-default-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
  }
  .dpr-actions { align-items: stretch; }
}
`
