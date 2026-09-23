/** Inline image pairs: geometry only, shared by all four existing glass themes. */
export const INLINE_GLASS_STYLES = `
.pre-glass .role-card {grid-template-columns:minmax(170px,.55fr) minmax(0,1.45fr);}
.pre-glass .role-identity {position:relative;}
.pre-glass .role-identity>.pre-help {margin-left:-8px;position:static;}
.pre-glass .role-identity .help-popover {left:0;right:auto;}
.pre-glass .model-controls {flex-wrap:nowrap;}
.pre-glass .model-controls>.route-pair {flex:1;}
.pre-glass .route-pair {min-width:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr);align-items:center;gap:8px;}
.pre-glass .route-pair[data-paired=true] {grid-template-columns:minmax(0,1fr) 16px minmax(0,1.25fr);}
.pre-glass .route-pair>.pre-select {width:100%;min-width:0;height:46px;min-height:46px;}
.pre-glass select.companion-picker {display:block;grid-column:auto;margin:0;padding:10px 14px;font-size:13px;}
.pre-glass .route-link {display:grid;place-items:center;color:var(--muted);}
.pre-glass .route-link .pre-icon {width:16px;height:16px;stroke-width:1.5;}
.pre-glass .fallback-row {grid-template-columns:minmax(0,1fr) auto;}
.pre-glass .fallback-name {overflow:hidden;white-space:nowrap;}
.pre-glass .fallback-route-name {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.pre-glass .fallback-actions {flex-wrap:nowrap;gap:3px;}
@container (max-width:1040px) {.pre-glass .role-card {grid-template-columns:180px minmax(0,1fr);gap:18px;}}
@container (max-width:780px) {.pre-glass .role-card {grid-template-columns:1fr;}}
@container (max-width:480px) {
  .pre-glass .pre-stage {padding:12px 6px;}.pre-glass .workspace-body {padding:0 10px 12px;}.pre-glass .settings {padding:9px;}.pre-glass .role-card {padding:13px;}
  .pre-glass .model-controls {gap:6px;}.pre-glass .route-pair {gap:5px;}.pre-glass .route-pair[data-paired=true] {grid-template-columns:minmax(0,1fr) 12px minmax(0,1.25fr);}
  .pre-glass .route-pair>.pre-select {font-size:12px;padding:8px 7px;height:42px;min-height:42px;}.pre-glass .route-link .pre-icon {width:12px;height:12px;}
  .pre-glass .fallback-actions {gap:0;}.pre-glass .fallback-actions .icon-action {width:24px;}.pre-glass .fallback-row {gap:5px;}
  .pre-glass .fallback-number {width:16px;height:18px;border:0;font-size:10px;}.pre-glass .fallback-name {gap:4px;font-size:12px;}
}
`
