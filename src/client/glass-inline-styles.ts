/** Shared control sizes and compact layout at every panel width. */
export const INLINE_GLASS_STYLES = `
.pre-glass {
  .pre-stage{padding:12px 14px;}
  .workspace{max-width:1360px;}
  .titlebar{padding:10px 16px;}
  .workspace-body{padding:0 12px 10px;gap:10px;}
  .project-card{padding:12px 14px;gap:10px;min-height:0;}
  .project-identity{gap:12px;}
  .folder-tile{width:56px;height:56px;border-radius:16px;}
  .folder-tile .pre-icon{width:30px;height:30px;}
  .project-copy h1{font-size:22px;}
  .project-name{font-size:13px;margin:2px 0 3px;}
  .project-path{font-size:11px;}
  .project-right{gap:6px;}
  .project-actions{gap:6px;}
  .project-actions .pre-primary{min-width:154px;min-height:36px;height:36px;padding:6px 12px;font-size:12px;}
  .project-actions .icon-action{width:36px;height:36px;min-height:36px;}
  .project-right .pre-feedback{margin:0;padding:6px 9px;}
  .settings{padding:10px;}
  .settings-heading{padding:2px 4px 8px;}
  .settings-heading h2{font-size:17px;}
  .settings-tools .icon-action{height:30px;min-height:30px;}
  .role-list{gap:8px;}
  .role-card{--route-control-size:36px;grid-template-columns:148px minmax(0,1fr);padding:10px 12px;gap:12px;min-height:0;}
  .role-identity{position:relative;gap:8px;}
  .role-identity label{font-size:14px;}
  .role-identity>.pre-help{margin-left:0;position:static;}
  .role-identity .help-popover{left:0;right:auto;}
  .role-icon{width:32px;height:32px;border-radius:10px;}
  .role-icon .pre-icon{width:19px;height:19px;}
  .model-area{gap:4px;}
  .model-controls{gap:6px;flex-wrap:nowrap;}
  .model-controls>.route-pair{flex:1;}
  .route-pair{min-width:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr);align-items:center;gap:6px;}
  .route-pair[data-paired=true]{grid-template-columns:minmax(0,1fr) 14px minmax(0,1.25fr);}
  .route-pair>.pre-select,.reasoning-control .pre-select,.fallback-picker>.pre-select{height:var(--route-control-size);min-height:var(--route-control-size);padding:4px 9px;font-size:12px;border-radius:9px;}
  .route-pair>.pre-select{width:100%;min-width:0;}
  select.companion-picker{display:block;grid-column:auto;margin:0;}
  .route-link{display:grid;place-items:center;color:var(--muted);}
  .route-link .pre-icon{width:14px;height:14px;stroke-width:1.5;}
  .reasoning-control{display:flex;align-items:center;gap:4px;flex:0 0 auto;min-width:0;max-width:128px;margin:0;color:var(--muted);font-size:12px;}
  .reasoning-control .pre-select{width:96px;min-width:0;max-width:100%;}
  .reasoning-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
  .reasoning-control small{white-space:nowrap;}
  .reasoning-control .pre-warning{max-width:100%;white-space:normal;}
  .model-controls>.icon-action,.fallback-picker>.icon-action,.fallback-actions .icon-action{width:var(--route-control-size);height:var(--route-control-size);min-height:var(--route-control-size);padding:0;border-radius:9px;}
  .fallback-row{--route-control-size:28px;grid-template-columns:minmax(0,1fr) auto auto;gap:5px;padding-top:4px;margin-top:0;}
  .fallback-name{gap:6px;font-size:12px;overflow:hidden;white-space:nowrap;}
  .fallback-route-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
  .fallback-number{width:18px;height:18px;font-size:10px;}
  .fallback-actions{flex-wrap:nowrap;gap:3px;}
  .fallback-actions .pre-icon{width:15px;height:15px;}
  .fallback-picker{gap:6px;}
  .save-bar{padding:8px 4px 2px;gap:6px;}
  .execution-panel{margin-top:8px;}
  .execution-panel .history-trigger{padding:6px 2px 0;}
  .workspace-footer{padding:0 16px 8px;}
}
@container (max-width:780px){.pre-glass .role-card{grid-template-columns:minmax(0,1fr);gap:8px;}}
@container (max-width:480px){.pre-glass{
  .pre-stage{padding:8px 6px;}
  .workspace-body{padding:0 8px 8px;}
  .settings{padding:8px;}
  .role-card{padding:10px;}
  .reasoning-control .pre-select{width:76px;padding:4px 5px;font-size:11px;}
  .reasoning-control small{font-size:10px;}
  .route-pair{gap:4px;}
  .route-pair[data-paired=true]{grid-template-columns:minmax(0,1fr) 12px minmax(0,1.25fr);}
  .route-pair>.pre-select{padding:4px 7px;}
  .route-link .pre-icon{width:12px;height:12px;}
  .fallback-actions{gap:0;}
  .fallback-name{gap:4px;}
}}
@container (min-width:960px){.pre-glass{
  .project-card{grid-template-columns:minmax(0,1fr) auto;}
  .role-list{grid-template-columns:repeat(2,minmax(0,1fr));}
  .role-card{grid-template-columns:minmax(0,1fr);gap:8px;align-content:start;}
}}
`
