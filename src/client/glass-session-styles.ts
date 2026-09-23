/** R4 behavior layers; preserve main and R3.1 inline geometry and optical parameters. */
export const SESSION_GLASS_STYLES = `
.pre-glass .role-card,.pre-glass .role-card:hover,.pre-glass .role-card:focus-within {transform:none!important;}
/* User-selected local raster sits behind the existing glass, never behind its text only. */
.pre-glass .pre-background {position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;pointer-events:none;z-index:-2;}
.pre-glass[data-background=custom] .pre-ambient {background:rgba(247,249,255,.14);}
.pre-glass[data-background=custom][data-theme=dark] .pre-ambient {background:rgba(8,18,36,.22);}
.pre-glass[data-background=custom] .pre-ambient::before,.pre-glass[data-background=custom] .pre-ambient::after {display:none;}
.pre-glass .background-control {display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:15px;margin-top:16px;}
.pre-glass .background-thumb {width:42px;height:42px;display:grid;place-items:center;flex-shrink:0;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--surface);color:var(--muted);}
.pre-glass .background-thumb img {width:100%;height:100%;object-fit:cover;}
.pre-glass .background-label {min-width:0;flex:1;font-size:12px;}
.pre-glass .background-label small {display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--faint);}
.pre-glass .background-control .icon-action {width:32px;height:36px;min-height:36px;border-radius:10px;}
.pre-glass .background-note {font-size:10px;color:var(--faint);margin:8px 0 12px;}
.pre-glass .visually-hidden {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}

/* R4: top-layer history, bounded height and its own scrollport. */
.pre-glass .history-trigger {display:flex;align-items:center;gap:9px;width:100%;padding:17px 2px 4px;border:0;background:transparent;color:var(--muted);font-size:13px;text-align:left;}
.pre-glass .history-trigger>.pre-icon {width:17px;height:17px;}
.pre-glass .history-trigger>.pre-icon:last-child {margin-left:auto;}
.pre-glass .pre-dialog {padding:0;margin:auto;width:min(820px,calc(100vw - 32px));height:min(700px,80vh);height:min(700px,80dvh);max-height:calc(100dvh - 32px);border:1px solid var(--line);border-radius:24px;background:var(--panel);color:var(--ink);box-shadow:inset 0 2px 3px var(--shine),inset 0 -2px 4px var(--rim),0 32px 100px #0006;overflow:hidden;}
.pre-glass .pre-dialog[open] {display:flex;flex-direction:column;}
.pre-glass .pre-dialog::backdrop {background:rgba(8,15,30,.42);backdrop-filter:blur(5px);}
.pre-glass .dialog-heading {display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid var(--line);flex-shrink:0;}
.pre-glass .dialog-heading h3 {font-size:18px;font-weight:600;}
.pre-glass .dialog-heading .history-count {display:block;margin-top:4px;}
.pre-glass .execution-scroll {flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;padding:20px 22px;}
.pre-glass .execution-scroll:focus-visible {outline:2px solid var(--accent);outline-offset:-4px;}
.pre-glass .execution-meta {display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px;}
.pre-glass .execution-meta time {font-variant-numeric:tabular-nums;color:var(--faint);}
.pre-glass .execution-row {font-size:13px;}
.pre-glass .execution-row .pre-error {color:var(--error);}
.pre-glass .execution-scroll .pre-empty {padding:35px 0;text-align:center;}

`
