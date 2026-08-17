/** Composer-only visual layer for the whale thumb and model popover. */

import whaleRunnerSprite from '../../assets/chibi-runner-strip.png'

export const composerStyles = `
.dpr-composer-root {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.dpr-composer-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 230px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: 24px;
  outline: none;
  color: var(--dsw-alias-label-secondary, #686c75);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}
.dpr-composer-trigger:hover:not(:disabled),
.dpr-composer-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(120,125,140,.1));
}
.dpr-composer-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3, rgba(77,112,255,.35));
}
.dpr-composer-trigger:disabled {
  color: var(--dsw-alias-label-dimmed, #a3a6ae);
  cursor: default;
}
.dpr-composer-trigger-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpr-composer-trigger-effort {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption, #9296a0);
}
.dpr-composer-trigger-chevron {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption, #9296a0);
  transition: transform 120ms ease;
}
.dpr-composer-trigger-chevron.is-open { transform: rotate(180deg); }
.dpr-composer-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 1200;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(312px, calc(100vw - 16px));
  max-height: min(440px, calc(100vh - 96px));
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-inverted, rgba(121,126,145,.2));
  border-radius: 12px;
  color: var(--dsw-alias-label-primary, #15171b);
  background: var(--dsw-specific-menu, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 14px 42px rgba(18,24,42,.18));
  animation: dpr-composer-menu-in 150ms cubic-bezier(.22,1,.36,1);
}
.dpr-composer-effort-area {
  min-height: 70px;
  padding: 7px 10px 7px;
}
.dpr-composer-effort {
  display: flex;
  align-items: center;
  width: 100%;
  height: 56px;
  min-width: 0;
  box-sizing: border-box;
  color: var(--dsw-alias-label-secondary, #686c75);
  user-select: none;
}
.dpr-composer-slider {
  --dpr-composer-progress: 50%;
  position: relative;
  width: 100%;
  height: 30px;
  flex: 1 1 auto;
  border-radius: 999px;
  isolation: isolate;
  transition: filter 180ms ease;
}
.dpr-composer-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(100deg, #03040a 0%, #071126 22%, #101d4c 45%, #302262 70%, #5d35a0 100%);
  box-shadow:
    inset 0 1px 0 rgba(189,199,255,.15),
    inset 0 -1px 0 rgba(0,0,0,.55),
    0 3px 10px rgba(12,17,55,.34);
}
.dpr-composer-track::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 18% 45%, rgba(82,130,255,.12), transparent 24%),
    linear-gradient(90deg, rgba(0,0,0,.28), transparent 42%, rgba(168,113,255,.12));
  pointer-events: none;
}
.dpr-composer-fx {
  position: absolute;
  z-index: 1;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}
.dpr-composer-canvas {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 1;
  image-rendering: pixelated;
  mix-blend-mode: screen;
  transition: filter 140ms ease;
}
.dpr-composer-flare {
  position: absolute;
  z-index: 3;
  top: 50%;
  left: var(--dpr-composer-progress);
  width: 78px;
  height: 46px;
  border-radius: 50%;
  background: radial-gradient(ellipse at 100% 50%, rgba(255,255,255,.96) 0 4%, rgba(188,189,255,.8) 11%, rgba(106,87,255,.5) 28%, rgba(105,31,255,.2) 49%, transparent 74%);
  filter: blur(2px) saturate(1.25);
  mix-blend-mode: screen;
  transform: translate(-100%, -50%);
  transition: left 190ms ease-out, filter 140ms ease;
  pointer-events: none;
}
.dpr-composer-flare::before,
.dpr-composer-flare::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 100%;
  border-radius: 999px;
  transform: translate(-50%, -50%);
}
.dpr-composer-flare::before {
  width: 52px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(100,160,255,.42), #f1ecff, rgba(193,82,255,.65), transparent);
  box-shadow: 0 0 7px #9b7cff, 0 0 13px rgba(72,132,255,.64);
}
.dpr-composer-flare::after {
  width: 1px;
  height: 20px;
  background: linear-gradient(180deg, transparent, rgba(196,190,255,.84), transparent);
  box-shadow: 0 0 7px #9c7cff;
}
.dpr-composer-whale {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: clamp(10px, var(--dpr-composer-progress), calc(100% - 10px));
  width: 40px;
  height: 55px;
  border-radius: 8px;
  background-color: transparent;
  background-image: url("${whaleRunnerSprite}");
  background-repeat: no-repeat;
  background-position: 0 0;
  background-size: 800% 100%;
  filter:
    drop-shadow(0 1px 1px rgba(0,0,0,.28))
    drop-shadow(0 0 5px rgba(92,105,255,.34));
  transition: left 190ms ease-out, filter 140ms ease, transform 140ms ease;
  transform: translate(-50%, -50%);
  transform-origin: 50% 68%;
  pointer-events: none;
}
.dpr-composer-effort.is-dragging .dpr-composer-canvas {
  filter: saturate(1.45) brightness(1.28) contrast(1.06);
}
.dpr-composer-effort.is-dragging .dpr-composer-flare {
  filter: blur(1.5px) saturate(1.6) brightness(1.42);
  transition: none;
}
.dpr-composer-effort.is-dragging .dpr-composer-whale {
  transition: none;
  filter:
    drop-shadow(0 2px 1px rgba(0,0,0,.28))
    drop-shadow(0 0 8px rgba(87,137,255,.68));
}
.dpr-composer-effort.is-dragging .dpr-composer-slider {
  filter: saturate(1.08) brightness(1.03);
}
.dpr-composer-range {
  position: absolute;
  z-index: 5;
  inset: -5px 0;
  width: 100%;
  height: calc(100% + 10px);
  margin: 0;
  opacity: 0;
  cursor: grab;
  touch-action: none;
}
.dpr-composer-range:active { cursor: grabbing; }
.dpr-composer-range:focus-visible + .dpr-composer-whale {
  outline: 2px solid var(--dsw-static-blue-400, #5d83ff);
  outline-offset: 2px;
}
.dpr-composer-slider[data-top] .dpr-composer-track {
  animation: dpr-composer-dark-breathe 1.9s ease-in-out infinite;
}
.dpr-composer-slider[data-top] .dpr-composer-whale {
  filter:
    drop-shadow(0 1px 1px rgba(0,0,0,.28))
    drop-shadow(0 0 8px rgba(111,88,255,.58));
}
.dpr-composer-effort.is-dragging .dpr-composer-whale {
  transform: translate(-50%, -50%) scale(1.04);
}
.dpr-composer-effort.is-busy { opacity: .72; }
.dpr-composer-effort.is-error .dpr-composer-slider {
  outline: 1px solid var(--dsw-alias-state-error-secondary, #c83e4d);
  outline-offset: 2px;
}
.dpr-composer-sr {
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
.dpr-composer-separator {
  height: 1px;
  margin: 0 4px;
  background: var(--dsw-alias-border-inverted, rgba(121,126,145,.16));
}
.dpr-composer-current-model,
.dpr-composer-model-option,
.dpr-composer-back {
  width: 100%;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.dpr-composer-current-model {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 45px;
  padding: 0 10px;
  border-radius: 8px;
  text-align: left;
}
.dpr-composer-current-model:hover:not(:disabled),
.dpr-composer-current-model:focus-visible,
.dpr-composer-model-option:hover:not(:disabled),
.dpr-composer-model-option:focus-visible,
.dpr-composer-back:hover:not(:disabled),
.dpr-composer-back:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(120,125,140,.09));
}
.dpr-composer-current-model:focus-visible,
.dpr-composer-model-option:focus-visible,
.dpr-composer-back:focus-visible {
  outline: none;
}
.dpr-composer-current-model:disabled,
.dpr-composer-model-option:disabled,
.dpr-composer-back:disabled {
  cursor: default;
  opacity: .62;
}
.dpr-composer-current-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.dpr-composer-current-effort {
  color: var(--dsw-static-deepseek-500, #4d70ff);
  font-size: 12px;
}
.dpr-composer-model-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dpr-composer-back {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 6px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #686c75);
  font-size: 12px;
  text-align: left;
}
.dpr-composer-model-scroll {
  max-height: min(350px, 56vh);
  overflow-y: auto;
  padding: 2px 0;
  overscroll-behavior: contain;
}
.dpr-composer-model-group + .dpr-composer-model-group { margin-top: 4px; }
.dpr-composer-model-group-title {
  padding: 7px 8px 4px;
  color: var(--dsw-alias-label-tertiary, #9296a0);
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
}
.dpr-composer-model-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 6px 8px;
  border-radius: 8px;
  text-align: left;
}
.dpr-composer-model-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.dpr-composer-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
}
.dpr-composer-model-description {
  overflow: hidden;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary, #9296a0);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpr-composer-model-check {
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-primary, #15171b);
}
.dpr-composer-status {
  padding: 14px 8px;
  color: var(--dsw-alias-label-tertiary, #9296a0);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}
.dpr-composer-error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 0 0;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary, #c83e4d);
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(220,55,70,.08));
  font-size: 11px;
  line-height: 17px;
}
.dpr-composer-error button {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
body[data-ds-dark-theme] .dpr-composer-menu {
  border-color: rgba(136,145,180,.2);
  color: var(--dsw-alias-label-primary, #f2f4f8);
  background: var(--dsw-specific-menu, #202126);
  box-shadow: 0 18px 46px rgba(0,0,0,.48), 0 3px 12px rgba(0,0,0,.32);
}
body[data-ds-dark-theme] .dpr-composer-track {
  background: linear-gradient(100deg, #03040a 0%, #071126 22%, #101d4c 45%, #302262 70%, #5d35a0 100%);
}
body:not([data-ds-dark-theme]) .dpr-composer-track {
  background: var(--dsw-static-blue-75, #e5f0ff);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.9),
    inset 0 0 0 1px rgba(80,133,194,.14),
    0 3px 10px rgba(48,101,165,.13);
}
body:not([data-ds-dark-theme]) .dpr-composer-track::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0 auto 0 0;
  width: var(--dpr-composer-progress);
  border-radius: inherit;
  background: linear-gradient(90deg, #fff 0%, #e2f0ff 20%, #a8d0fb 57%, #438fdf 100%);
  transition: width 190ms cubic-bezier(.22,1,.36,1);
}
body:not([data-ds-dark-theme]) .dpr-composer-effort.is-dragging .dpr-composer-track::before {
  transition: none;
}
body:not([data-ds-dark-theme]) .dpr-composer-slider[data-top] .dpr-composer-track::before {
  background: linear-gradient(90deg, #fff 0%, #d7eaff 18%, #75afea 54%, #0751ad 100%);
}
body:not([data-ds-dark-theme]) .dpr-composer-canvas {
  opacity: .78;
  mix-blend-mode: multiply;
}
body:not([data-ds-dark-theme]) .dpr-composer-flare {
  background: radial-gradient(ellipse at 100% 50%, rgba(255,255,255,.98) 0 5%, rgba(204,231,255,.88) 13%, rgba(91,162,241,.48) 31%, rgba(37,111,207,.16) 53%, transparent 75%);
  filter: blur(2px) saturate(1.12);
}
body:not([data-ds-dark-theme]) .dpr-composer-flare::before {
  background: linear-gradient(90deg, transparent, rgba(116,177,244,.34), #fff, rgba(66,139,225,.58), transparent);
  box-shadow: 0 0 7px rgba(58,133,222,.5), 0 0 13px rgba(104,176,255,.38);
}
body:not([data-ds-dark-theme]) .dpr-composer-flare::after {
  background: linear-gradient(180deg, transparent, rgba(255,255,255,.94), transparent);
  box-shadow: 0 0 7px rgba(64,137,224,.44);
}
body:not([data-ds-dark-theme]) .dpr-composer-slider[data-top] .dpr-composer-track {
  animation-name: dpr-composer-light-breathe;
}
@keyframes dpr-composer-menu-in {
  from { opacity: 0; transform: translateY(5px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dpr-composer-dark-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(196,204,255,.16), 0 3px 10px rgba(18,25,72,.4); }
  50% { box-shadow: inset 0 1px 0 rgba(220,214,255,.24), 0 0 21px rgba(111,66,255,.5); }
}
@keyframes dpr-composer-light-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(67,124,193,.16), 0 3px 10px rgba(48,101,165,.13); }
  50% { box-shadow: inset 0 1px 0 rgba(255,255,255,.96), inset 0 0 0 1px rgba(31,102,190,.22), 0 0 19px rgba(31,105,201,.24); }
}
@media (max-width: 480px) {
  .dpr-composer-menu { width: min(312px, calc(100vw - 16px)); }
}
@media (prefers-reduced-motion: reduce) {
  .dpr-composer-trigger-chevron,
  .dpr-composer-range:focus-visible + .dpr-composer-whale,
  .dpr-composer-track::before { transition: none; }
  .dpr-composer-slider[data-top] .dpr-composer-track,
  .dpr-composer-menu { animation: none; }
  .dpr-composer-whale { transition: none; }
}
`
