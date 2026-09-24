/** Scoped plugin styling. Editor tokens are inherited; native DSH uses its own gray/accent scales. */
export const fusionClientStyles = `
.dsh-fusion-card{min-width:0;margin-block:var(--dsh-ui-space-3,12px);padding:var(--dsh-ui-space-3,12px);border:1px solid var(--dsh-ui-line,var(--dsw-alias-border-l1));border-radius:var(--dsh-ui-radius-md,12px);background:var(--dsh-ui-raised,var(--dsw-alias-bg-module-platform));color:var(--dsh-ui-text,var(--dsw-alias-label-primary));font:inherit;font-size:var(--dsh-ui-text-base,var(--dsh-content-font-size,14px));overflow-wrap:anywhere}
.dsh-fusion-card.is-native{margin-inline:var(--dsh-ui-space-3,12px)}
.dsh-fusion-head{display:flex;align-items:center;flex-wrap:wrap;gap:var(--dsh-ui-space-2,8px);min-width:0}
.dsh-fusion-head strong{min-width:0;flex:1 1 8rem;font-size:inherit;line-height:1.45}
.dsh-fusion-kicker,.dsh-fusion-state{white-space:nowrap;color:var(--dsh-ui-muted,var(--dsw-alias-label-tertiary))}
.dsh-fusion-kicker{font-weight:600}
.dsh-fusion-state{font-size:var(--dsh-ui-text-sm,var(--dsh-content-font-size-secondary,13px))}
.dsh-fusion-card p{margin:var(--dsh-ui-space-2,8px) 0 0;line-height:1.55}
.dsh-fusion-detail,.dsh-fusion-activity,.dsh-fusion-usage,.dsh-fusion-hint{color:var(--dsh-ui-muted,var(--dsw-alias-label-tertiary))}
.dsh-fusion-card button,.dsh-fusion-dialog button{min-height:32px;padding:var(--dsh-ui-space-1,4px) var(--dsh-ui-space-2,8px);border:1px solid var(--dsh-ui-line-strong,var(--dsw-alias-border-l3));border-radius:var(--dsh-ui-radius-sm,6px);background:var(--dsh-ui-bg,var(--dsw-alias-bg-base));color:inherit;font:inherit;cursor:pointer}
.dsh-fusion-card button:hover:not(:disabled),.dsh-fusion-dialog button:hover:not(:disabled){background:var(--dsh-ui-hover,var(--dsw-alias-interactive-bg-hover))}
.dsh-fusion-card button:focus-visible,.dsh-fusion-dialog button:focus-visible,.dsh-fusion-card textarea:focus-visible{outline:2px solid var(--dsh-ui-accent,var(--dsw-alias-button-info-fill));outline-offset:2px}
.dsh-fusion-card button:disabled,.dsh-fusion-dialog button:disabled{opacity:.55;cursor:not-allowed}
.dsh-fusion-details{margin-inline-start:auto}
.dsh-fusion-actions{display:flex;flex-wrap:wrap;gap:var(--dsh-ui-space-2,8px);margin-top:var(--dsh-ui-space-3,12px)}
.dsh-fusion-body{margin-top:var(--dsh-ui-space-3,12px);padding-top:var(--dsh-ui-space-3,12px);border-top:1px solid var(--dsh-ui-line,var(--dsw-alias-border-l1))}
.dsh-fusion-body details{margin-top:var(--dsh-ui-space-2,8px)}
.dsh-fusion-body summary{cursor:pointer;min-height:32px}
.dsh-fusion-body ul{margin:var(--dsh-ui-space-2,8px) 0;padding-inline-start:1.5em}
.dsh-fusion-report{white-space:pre-wrap}
.dsh-fusion-candidate{max-height:18rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;padding:var(--dsh-ui-space-2,8px);background:var(--dsh-ui-bg,var(--dsw-alias-bg-base));border:1px solid var(--dsh-ui-line,var(--dsw-alias-border-l1))}
.dsh-fusion-error,.dsh-fusion-warning{color:var(--dsh-ui-text,var(--dsw-alias-label-primary));font-weight:600}
.dsh-fusion-resume{display:grid;gap:var(--dsh-ui-space-2,8px);margin-top:var(--dsh-ui-space-3,12px)}
.dsh-fusion-resume textarea{box-sizing:border-box;width:100%;min-height:3.5rem;padding:var(--dsh-ui-space-2,8px);border:1px solid var(--dsh-ui-line-strong,var(--dsw-alias-border-l3));border-radius:var(--dsh-ui-radius-sm,6px);background:var(--dsh-ui-bg,var(--dsw-alias-bg-base));color:inherit;font:inherit;resize:vertical}
.dsh-fusion-resume button{justify-self:start}
.dsh-fusion-dialog{box-sizing:border-box;width:min(92vw,80rem);max-width:92vw;max-height:90vh;padding:var(--dsh-ui-space-4,16px);border:1px solid var(--dsh-ui-line-strong,var(--dsw-alias-border-l3));border-radius:var(--dsh-ui-radius-lg,16px);background:var(--dsh-ui-raised,var(--dsw-alias-bg-module-platform));color:var(--dsh-ui-text,var(--dsw-alias-label-primary));font:inherit;box-shadow:var(--dsh-ui-shadow-lg,var(--dsw-elevation-panel))}
.dsh-fusion-dialog::backdrop{background:var(--dsh-ui-scrim,var(--dsw-alias-bg-mask-drop))}
.dsh-fusion-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:var(--dsh-ui-space-3,12px)}
.dsh-fusion-dialog h3,.dsh-fusion-dialog h4{margin:0;font:inherit;font-weight:600}
.dsh-fusion-path{overflow-wrap:anywhere}
.dsh-fusion-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--dsh-ui-space-3,12px)}
.dsh-fusion-compare section{min-width:0}
.dsh-fusion-compare h4{margin-bottom:var(--dsh-ui-space-2,8px)}
.dsh-fusion-compare pre{box-sizing:border-box;max-height:55vh;min-height:12rem;overflow:auto;margin:0;padding:var(--dsh-ui-space-3,12px);border:1px solid var(--dsh-ui-line,var(--dsw-alias-border-l1));border-radius:var(--dsh-ui-radius-sm,6px);background:var(--dsh-ui-bg,var(--dsw-alias-bg-base));color:inherit;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-fusion-dialog .dsh-fusion-actions{justify-content:flex-end}
.dsh-fusion-dialog .dsh-fusion-primary{background:var(--dsh-ui-accent-solid,var(--dsw-alias-button-primary-fill));border-color:var(--dsh-ui-accent-solid,var(--dsw-alias-button-primary-fill));color:var(--dsh-ui-on-accent,var(--dsw-alias-label-primary-foreground))}
@media(max-width:700px){.dsh-fusion-compare{grid-template-columns:minmax(0,1fr)}.dsh-fusion-compare pre{max-height:30vh;min-height:6rem}.dsh-fusion-dialog{max-height:95vh}}
@media(forced-colors:active){.dsh-fusion-card,.dsh-fusion-dialog,.dsh-fusion-compare pre{border:1px solid CanvasText}.dsh-fusion-card button:focus-visible,.dsh-fusion-dialog button:focus-visible{outline:2px solid Highlight}}
`
