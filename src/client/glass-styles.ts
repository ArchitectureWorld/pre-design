/** Scoped in the client JS bundle: no global reset and no separate CSS request. */
export const GLASS_STYLES = `
.pre-glass { --ink:#24283f;--muted:#565f7b;--faint:#727d99;--accent:#6458ce;--surface:rgba(255,255,255,.31);--control:rgba(252,253,255,.84);--line:rgba(255,255,255,.67);--shine:rgb(255 255 255 / calc(var(--gloss) * .94));--rim:rgba(177,221,255,.55);--shadow:68,79,126;--warn:#945b11;--error:#b13c52;--success:#237754;--panel:#edeffa;--blur:21px;--gloss:.86;--lift:24px;--hover:-3px;--thickness:5px; color:var(--ink);color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.5;height:100%;overflow:auto;position:relative;isolation:isolate;container-type:inline-size; background:radial-gradient(ellipse at 0% 0%,#fff3e4,transparent 54%),radial-gradient(ellipse at 98% 83%,#a9bcea,transparent 56%),linear-gradient(115deg,#f1e4e4,#d2d7f0 60%,#b1c4e2); }
.pre-glass[data-theme=dark] {--ink:#eef2ff;--muted:#bac7e1;--faint:#97a8ce;--accent:#b8b4ff;--surface:rgba(37,51,84,.35);--control:rgba(30,44,75,.88);--line:rgba(183,213,255,.34);--shine:rgb(220 239 255 / calc(var(--gloss) * .65));--rim:rgba(97,172,250,.31);--shadow:0,5,21;--warn:#ffd38e;--error:#ffb0bf;--success:#8de0b4;--panel:#182643;color-scheme:dark; background:radial-gradient(ellipse at 0% 0%,#39405c,transparent 56%),radial-gradient(ellipse at 98% 83%,#1c3457,transparent 57%),linear-gradient(115deg,#121b30,#18263f 60%,#10223a);}
.pre-glass *, .pre-glass *::before, .pre-glass *::after {box-sizing:border-box;}
.pre-glass :where(h1,h2,h3,p) {margin:0;}
.pre-glass :where(button,input,select) {font:inherit;color:inherit;}
.pre-glass :where(button,select,summary,input[type=range]) {cursor:pointer;}
.pre-glass button {touch-action:manipulation;}
.pre-glass button:disabled {cursor:not-allowed;opacity:.52;}
.pre-glass :where(button,input,select,summary):focus-visible {outline:3px solid var(--accent);outline-offset:3px;}
.pre-glass .pre-icon {display:inline-block;width:20px;height:20px;flex-shrink:0;vertical-align:middle;}
.pre-glass .pre-stage {padding:28px 22px;position:relative;min-height:100%;}
.pre-glass .pre-ambient {position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:-1;}
.pre-glass .pre-ambient::before {content:'';position:absolute;width:170%;height:28px;left:-35%;top:40%;background:linear-gradient(0deg,transparent,#ffffff70,transparent);filter:blur(12px);transform:rotate(-37deg);}
.pre-glass .pre-ambient::after {content:'';position:absolute;right:-55px;top:70%;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle at 30% 20%,#fffffff0,transparent 13%),radial-gradient(circle at 70% 83%,#b6b3fa90,transparent 45%);border:2px solid var(--line);box-shadow:inset 2px 4px 7px var(--shine),inset -5px -5px 14px var(--rim),12px 22px 40px rgba(var(--shadow),.3);}
.pre-glass .workspace {max-width:1180px;margin:auto;border-radius:30px;border:1px solid var(--line);background:var(--surface);box-shadow:inset 0 2px 3px var(--shine),inset 0 -3px 5px var(--rim),0 42px 70px -18px rgba(var(--shadow),.4);position:relative;}
.pre-glass .titlebar {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;padding:22px 25px;}
.pre-glass .brand {display:flex;align-items:center;gap:12px;min-width:0;}
.pre-glass .brand-mark {width:27px;height:30px;background:linear-gradient(125deg,#68d3fc,#816af0);clip-path:polygon(10% 0,95% 43%,100% 50%,95% 57%,10% 100%,0 94%,0 6%,10% 0,28% 27%,28% 73%,70% 50%,28% 27%);filter:drop-shadow(0 2px 3px #ffffff70);}
.pre-glass .brand strong {font-size:18px;letter-spacing:-.45px;font-weight:600;}
.pre-glass .brand small {display:block;color:var(--faint);font-size:10px;letter-spacing:.3px;}
.pre-glass .version {font-size:10px;padding:2px 8px;border:1px solid var(--line);border-radius:20px;white-space:nowrap;color:var(--muted);}
.pre-glass .theme-switch {margin-left:auto;display:flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:30px;padding:4px;box-shadow:inset 0 1px 2px var(--shine);}
.pre-glass .theme-switch button {border:1px solid transparent;border-radius:24px;background:transparent;color:var(--muted);min-width:38px;height:34px;padding:4px 9px;font-size:12px;}
.pre-glass .theme-switch button[aria-pressed=true] {color:var(--ink);background:var(--control);border-color:var(--line);box-shadow:inset 0 1px 2px var(--shine),0 4px 8px rgba(var(--shadow),.16);}
.pre-glass .theme-switch b {color:inherit;font-weight:600;}
.pre-glass .appearance-trigger {display:flex;gap:6px;align-items:center;}
.pre-glass .workspace-body {padding:0 23px 18px;display:grid;gap:20px;}
.pre-glass .project-card, .pre-glass .role-card {border:1px solid var(--line);border-radius:22px;background:var(--surface);position:relative;box-shadow:inset 0 1.6px 2px var(--shine),inset 1px 0 2px var(--line),inset 0 calc(var(--thickness) * -1) calc(var(--thickness) + 2px) var(--rim),0 var(--lift) calc(var(--lift) + 12px) -12px rgba(var(--shadow),.3);backdrop-filter:blur(var(--blur)) saturate(1.14);-webkit-backdrop-filter:blur(var(--blur)) saturate(1.14);}
.pre-glass .project-card::before, .pre-glass .role-card::before {content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;padding:1.3px;background:linear-gradient(135deg,var(--shine),transparent 35%,var(--line) 65%,var(--shine));mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;opacity:var(--gloss);}
.pre-glass .project-card::after, .pre-glass .role-card::after {content:'';position:absolute;inset:var(--thickness);border-radius:16px;box-shadow:0 1px 1px var(--line),inset 0 1px 1px rgba(var(--shadow),.15);opacity:calc(var(--gloss) * .55);pointer-events:none;}
.pre-glass .project-card {display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.2fr);gap:28px;padding:30px;min-height:192px;align-items:center;min-width:0;}
.pre-glass .project-identity {display:flex;gap:24px;align-items:center;min-width:0;}
.pre-glass .project-copy {min-width:0;}
.pre-glass .project-copy h1 {font-size:29px;letter-spacing:-.9px;font-weight:650;line-height:1.24;}
.pre-glass .eyebrow {font-size:9px;letter-spacing:1.6px;color:var(--faint);margin-bottom:7px;}
.pre-glass .project-name {font-size:16px;font-weight:450;margin:8px 0 12px;overflow-wrap:anywhere;}
.pre-glass .project-path {font-size:12px;color:var(--muted);overflow-wrap:anywhere;}
.pre-glass .folder-tile {flex-shrink:0;width:108px;height:116px;border-radius:28px;display:grid;place-items:center;background:radial-gradient(circle at 10% 10%,#fff8,transparent 25%),radial-gradient(circle at 95% 95%,#b7fbff8c,transparent 35%),linear-gradient(130deg,#a6b8f860,#a18bd25c,#b7c6ff40);border:1px solid var(--line);box-shadow:inset 3px 3px 4px var(--shine),inset -4px -5px 8px var(--rim),0 var(--lift) 26px -8px rgba(var(--shadow),.4);}
.pre-glass .folder-tile .pre-icon {width:56px;height:56px;stroke-width:1.2;fill:#a7b4ed55;color:#e1eaff;filter:drop-shadow(0 4px 5px #756acf55);}
.pre-glass .project-right {display:grid;gap:14px;min-width:0;}
.pre-glass .project-notice {display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--line);border-radius:17px;background:var(--surface);box-shadow:inset 0 1px 1px var(--shine),0 6px 12px -9px rgba(var(--shadow),.4);}
.pre-glass .notice-icon {display:grid;place-items:center;width:33px;height:33px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#79adff,#8177e8);color:#fff;}
.pre-glass .project-notice strong {display:block;font-size:12px;}
.pre-glass .project-notice p {font-size:11px;color:var(--muted);margin-top:4px;}
.pre-glass .project-actions {display:flex;align-items:center;justify-content:flex-end;gap:12px;}
.pre-glass .pre-button {border:1px solid var(--line);border-radius:13px;padding:8px 13px;background:radial-gradient(ellipse 90px 40px at var(--px,25%) var(--py,0%),rgb(255 255 255 / calc(var(--gloss) * .18)),transparent),var(--control);box-shadow:inset 0 1.5px 2px var(--shine),inset 0 -1.5px 2px var(--rim),0 6px 10px -6px rgba(var(--shadow),.4);display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;transition:transform .2s ease;}
.pre-glass .pre-primary {color:#fff;background:radial-gradient(ellipse 110px 40px at var(--px,25%) var(--py,0%),#ffffff55,transparent),radial-gradient(ellipse at 100% 100%,#97f1ffb8,transparent 48%),linear-gradient(110deg,#8064ea,#6660d5 56%,#719fea);box-shadow:inset 0 2px 3px #ffffffb3,inset 0 -3px 4px #a7e8ffba,0 14px 22px -8px rgba(var(--shadow),.46);}
.pre-glass .project-actions .pre-primary {min-width:200px;min-height:50px;border-radius:26px;font-size:14px;font-weight:550;padding:12px 24px;}
.pre-glass .project-actions .icon-action {width:50px;height:50px;border-radius:50%;}
.pre-glass .pre-linked:disabled {opacity:1;cursor:default;}
.pre-glass .project-version {grid-column:1/-1;text-align:center;font-size:10px;color:var(--faint);}
.pre-glass .project-version small {opacity:1!important;}
.pre-glass .settings {border:1px solid var(--line);border-radius:24px;padding:18px;background:rgba(255,255,255,.04);min-width:0;}
.pre-glass .settings-heading {display:flex;align-items:center;justify-content:space-between;gap:14px;padding:7px 9px 21px;}
.pre-glass .settings-heading>div:first-child {display:flex;align-items:baseline;gap:12px;}
.pre-glass .section-icon {display:grid;place-items:center;flex-shrink:0;width:44px;height:46px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:inset 0 1.5px 2px var(--shine);}
.pre-glass .section-icon .pre-icon {width:24px;height:24px;}
.pre-glass .settings-heading h2 {font-size:20px;letter-spacing:-.4px;font-weight:600;}
.pre-glass .settings-heading p {font-size:11px;margin-top:5px;color:var(--muted);line-height:1.85;}
.pre-glass .role-list {display:grid;gap:14px;}
.pre-glass .role-card {display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1fr);align-items:center;gap:22px;padding:20px;min-height:96px;min-width:0;transition:transform .24s ease;}
.pre-glass .role-identity {display:flex;align-items:center;gap:16px;min-width:0;}
.pre-glass .role-identity label {display:block;font-size:16px;font-weight:600;letter-spacing:-.15px;}
.pre-glass .role-description {font-size:11px;color:var(--muted);margin-top:4px;line-height:1.8;}
.pre-glass .role-icon {flex-shrink:0;display:grid;place-items:center;width:52px;height:56px;border-radius:16px;border:1px solid var(--line);color:#8071db;background:linear-gradient(135deg,#fff6,#bca2f53b);box-shadow:inset 1px 2px 2px var(--shine),inset 0 -2px 3px var(--line),0 8px 12px -4px rgba(var(--shadow),.22);}
.pre-glass .role-icon .pre-icon {width:27px;height:27px;}
.pre-glass [data-kind=web] .role-icon {color:#298f9d;background:linear-gradient(135deg,#fff4,#91ddd555);}
.pre-glass [data-kind=review] .role-icon {color:#d78169;background:linear-gradient(135deg,#fff4,#ffa7823a);}
.pre-glass[data-theme=dark] .role-icon {color:#c7bbff;background:linear-gradient(135deg,#7e79cc33,#9972e43d);}
.pre-glass[data-theme=dark] [data-kind=web] .role-icon {color:#90dfec;background:#488b9440;}
.pre-glass[data-theme=dark] [data-kind=review] .role-icon {color:#ffc1a6;background:#d77b5533;}
.pre-glass .model-area {display:grid;gap:8px;min-width:0;align-content:center;}
.pre-glass .model-controls {display:flex;align-items:center;gap:10px;min-width:0;}
.pre-glass .model-controls>.pre-select {flex:1;width:0;min-width:0;}
.pre-glass .pre-select {border:1px solid var(--line);border-radius:15px;width:100%;max-width:100%;padding:12px 14px;background:var(--control);color:var(--ink);box-shadow:inset 0 1px 2px var(--shine),inset 0 -1px 2px rgba(var(--shadow),.18);font-size:13px;font-weight:500;text-overflow:ellipsis;min-height:48px;}
.pre-glass option,.pre-glass optgroup {background:var(--panel);color:var(--ink);}
.pre-glass .add-backup {white-space:nowrap;font-size:11px;}
.pre-glass .model-hint,.pre-glass .fallback-policy {color:var(--muted);font-size:10px;line-height:1.85;}
.pre-glass .companion-picker {display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;grid-column:1/-1;margin:3px 84px 0 0;font-size:12px;}
.pre-glass .companion-picker small {color:var(--muted);font-size:10px;}
.pre-glass .fallback-row {border-top:1px solid var(--line);padding-top:12px;margin-top:5px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0;}
.pre-glass .fallback-name {display:flex;gap:9px;align-items:center;font-size:13px;overflow-wrap:anywhere;min-width:0;}
.pre-glass .fallback-actions {display:flex;gap:6px;flex-wrap:wrap;}
.pre-glass .fallback-actions button {font-size:10px;min-height:29px;padding:4px 9px;}
.pre-glass .fallback-picker {display:flex;gap:8px;align-items:center;}
.pre-glass .fallback-picker select {min-width:0;flex:1;width:0;}
.pre-glass .fallback-policy {display:block;padding:17px 5px 10px;}
.pre-glass .provider-details {font-size:11px;color:var(--muted);margin:8px 5px;}
.pre-glass .provider-details small {display:block;overflow-wrap:anywhere;}
.pre-glass .save-bar {display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:18px 5px 2px;margin-top:4px;}
.pre-glass .save-state {font-size:12px;color:var(--muted);margin-right:auto;}
.pre-glass .save-state[data-dirty=true] {color:var(--warn);}
.pre-glass .pre-alert,.pre-glass .pre-feedback {font-size:12px;border:1px solid var(--line);padding:11px 13px;margin:9px 0;border-radius:13px;overflow-wrap:anywhere;background:var(--surface);}
.pre-glass .pre-alert {color:var(--error);}
.pre-glass .pre-feedback {color:var(--success);}
.pre-glass .pre-warning {color:var(--warn);font-size:11px;}
.pre-glass .pre-muted,.pre-glass .pre-empty {color:var(--muted);font-size:12px;}
.pre-glass .pre-error {color:var(--error);}
.pre-glass .execution-panel {padding:0 4px;display:grid;gap:11px;margin-top:20px;border-top:1px solid var(--line);}
.pre-glass .execution-panel>header {display:flex;gap:12px;justify-content:space-between;align-items:center;}
.pre-glass .execution-panel h3 {font-size:15px;}
.pre-glass .execution-panel p {font-size:11px;color:var(--muted);}
.pre-glass .execution-row {background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 15px;overflow-wrap:anywhere;}
.pre-glass .execution-summary {display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;}
.pre-glass .execution-row details {font-size:11px;color:var(--muted);margin-top:6px;}
.pre-glass .execution-row dl {display:grid;grid-template-columns:90px minmax(0,1fr);gap:4px;margin:10px 0;}
.pre-glass .execution-row dd {margin:0;}
.pre-glass .pre-tag {font-size:10px;padding:3px 9px;border:1px solid var(--line);border-radius:20px;white-space:nowrap;color:var(--muted);}
.pre-glass [data-outcome=completed] {color:var(--success);}
.pre-glass [data-outcome=failed] {color:var(--error);}
.pre-glass [data-outcome=recovery_required] {color:var(--warn);}
.pre-glass .appearance-panel {position:absolute;top:73px;right:17px;z-index:30;width:300px;max-width:calc(100% - 34px);max-height:min(660px,75vh);overflow:auto;padding:20px;border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:inset 0 1px 2px var(--shine),0 25px 65px rgba(var(--shadow),.38);}
.pre-glass .appearance-heading {display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:15px;}
.pre-glass .appearance-note {font-size:10px;color:var(--muted);margin:8px 0 18px;}
.pre-glass .appearance-row {display:block;margin:16px 0;font-size:12px;}
.pre-glass .appearance-row>span {display:flex;justify-content:space-between;}
.pre-glass .appearance-row output {color:var(--faint);font-size:11px;font-variant-numeric:tabular-nums;}
.pre-glass input[type=range] {width:100%;accent-color:#9a87e8;display:block;margin-top:12px;}
.pre-glass .appearance-motion {display:flex;justify-content:space-between;align-items:center;padding:12px 0;gap:10px;border-top:1px solid var(--line);}
.pre-glass .appearance-footer {display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.pre-glass .pre-bottom {display:flex;justify-content:space-between;gap:14px;color:var(--faint);font-size:10px;margin:16px auto 0;max-width:1180px;}
.pre-glass .pre-bottom span:first-child {letter-spacing:1.3px;}
.pre-glass[data-depth=strong] {--thickness:8px;}
.pre-glass[data-depth=strong] .workspace {box-shadow:inset 0 3px 4px var(--shine),inset -2px 0 3px var(--line),inset 0 -5px 7px var(--rim),0 55px 76px -14px rgba(var(--shadow),.5);}
.pre-glass[data-depth=strong] .role-card::before {padding:1.8px;}
.pre-glass[data-grid=on] .pre-ambient {background:repeating-linear-gradient(0deg,transparent 0 39px,#8899cc66 39px 40px),repeating-linear-gradient(90deg,transparent 0 39px,#8899cc66 39px 40px);}
.pre-glass [hidden] {display:none!important;}

/* R2: information is layered, rather than removed or reduced to tiny text. */
.pre-glass .settings-tools {display:flex;align-items:center;gap:10px;}
.pre-glass .settings-tools .icon-action {background:transparent;box-shadow:none;border-color:transparent;width:30px;}
.pre-glass .section-scope {font-size:12px;color:var(--muted);font-weight:400;}
.pre-glass .icon-action {flex-shrink:0;width:40px;height:40px;min-height:40px;padding:0;border-radius:13px;}
.pre-glass .icon-action .pre-icon {width:18px;height:18px;}
.pre-glass .fallback-actions .icon-action {width:30px;height:30px;min-height:30px;padding:0;border-radius:9px;}
.pre-glass .fallback-actions .pre-icon {width:15px;height:15px;}
.pre-glass .companion-label {display:flex;align-items:center;gap:6px;white-space:nowrap;color:var(--muted);}
.pre-glass .companion-label .pre-icon {width:17px;height:17px;}
.pre-glass .required-marker {color:var(--warn);font-size:14px;}
.pre-glass .companion-picker .pre-select {font-size:12px;min-height:42px;border-radius:12px;}
.pre-glass .pre-select[aria-invalid=true] {border-color:var(--warn);}
.pre-glass .fallback-number {flex-shrink:0;display:grid;place-items:center;width:23px;height:23px;border:1px solid var(--line);border-radius:50%;color:var(--muted);font-size:11px;}
.pre-glass .route-kind {font-size:10px;color:var(--muted);font-weight:400;}
.pre-glass .pre-help {position:relative;flex-shrink:0;display:flex;align-items:center;}
.pre-glass .help-trigger {display:grid;place-items:center;border:0;background:transparent;color:var(--muted);padding:0;width:30px;height:36px;border-radius:10px;cursor:pointer;}
.pre-glass .help-trigger .pre-icon {width:17px;height:17px;stroke-width:1.5;}
.pre-glass .help-trigger:hover,.pre-glass .help-trigger[aria-expanded=true] {color:var(--ink);background:var(--surface);}
.pre-glass .help-popover {position:absolute;right:0;top:calc(100% + 10px);width:min(310px,calc(100cqw - 96px));padding:18px;border:1px solid var(--line);border-radius:17px;background:var(--panel);box-shadow:0 16px 44px rgba(var(--shadow),.35),inset 0 1px 1px var(--shine);color:var(--ink);font-size:12px;line-height:1.8;z-index:60;text-align:left;font-weight:400;max-height:var(--help-max-height,380px);overflow:auto;overscroll-behavior:contain;}
.pre-glass .pre-help[data-above=true] .help-popover {top:auto;bottom:calc(100% + 10px);}
.pre-glass .help-popover p+p {margin-top:12px;}
.pre-glass .help-popover .route-identifier {font-size:11px;color:var(--muted);overflow-wrap:anywhere;}
.pre-glass .role-card:has(.help-popover),.pre-glass .project-card:has(.help-popover) {z-index:25;}
.pre-glass .pre-help:has(.help-popover) {z-index:35;}
.pre-glass .role-card:has(.help-popover):hover {transform:none;}
.pre-glass .workspace-footer {padding:0 29px 21px;color:var(--faint);font-size:10px;}
.pre-glass .appearance-context {display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);margin-top:12px;}
.pre-glass .appearance-panel {overflow-y:auto;scrollbar-width:thin;}
.pre-glass .appearance-context .help-popover {width:232px;}
.pre-glass .execution-history>summary {display:flex;align-items:center;gap:9px;list-style:none;padding:17px 2px 4px;font-size:13px;color:var(--muted);}
.pre-glass .execution-history>summary::-webkit-details-marker {display:none;}
.pre-glass .execution-history>summary>.pre-icon {width:17px;height:17px;}
.pre-glass .execution-history>summary>.pre-icon:last-child {margin-left:auto;transition:transform .2s;}
.pre-glass .execution-history[open]>summary>.pre-icon:last-child {transform:rotate(180deg);}
.pre-glass .history-count {font-variant-numeric:tabular-nums;color:var(--faint);font-size:11px;}
.pre-glass .pending-count {margin-left:auto;color:var(--warn);font-size:11px;}
.pre-glass .execution-explainer {display:flex;justify-content:flex-end;padding:3px;}
.pre-glass .execution-row {margin-bottom:9px;}
.pre-glass .execution-row dl {grid-template-columns:110px minmax(0,1fr);}
.pre-glass .execution-chain ol {padding-left:20px;}
.pre-glass .folder-tile {position:relative;}
.pre-glass .folder-tile::after {content:'';position:absolute;inset:5px;border-radius:inherit;box-shadow:inset -2px -3px 8px var(--rim);border-right:1px solid var(--line);border-bottom:1px solid var(--line);pointer-events:none;}

@media (hover:hover) and (pointer:fine) {.pre-glass[data-motion=on] .role-card:hover {transform:translateY(var(--hover));z-index:2;}.pre-glass[data-motion=on] .pre-button:hover:enabled {transform:translateY(calc(var(--hover) * .6));}.pre-glass .pre-button:active:enabled {transform:translateY(1px)!important;}}
@media (prefers-reduced-motion:reduce) {.pre-glass *, .pre-glass *::before,.pre-glass *::after {animation:none!important;transition:none!important;transform:none!important;}}
@container (max-width:1040px) {.pre-glass .project-card {gap:20px;padding:25px;}.pre-glass .folder-tile {width:92px;height:104px;}.pre-glass .project-identity {gap:20px;}.pre-glass .role-card {grid-template-columns:minmax(0,.65fr) minmax(0,1fr);gap:18px;}.pre-glass .project-actions .pre-primary {min-width:160px;}}
@container (max-width:780px) {.pre-glass .pre-stage {padding:15px 12px;}.pre-glass .workspace {border-radius:24px;}.pre-glass .workspace-body {padding:0 15px 15px;}.pre-glass .project-card {grid-template-columns:1fr;padding:25px;}.pre-glass .project-actions {justify-content:flex-start;}.pre-glass .project-actions .pre-primary {flex:1;}.pre-glass .role-card {grid-template-columns:1fr;gap:18px;padding:20px;}.pre-glass .settings {padding:12px;}.pre-glass .titlebar {padding:18px;gap:10px;}.pre-glass .brand strong {font-size:16px;}.pre-glass .theme-switch button {min-width:32px;padding:5px 6px;}.pre-glass .settings-heading {padding:7px 7px 19px;}.pre-glass .settings-heading h2 {font-size:19px;}.pre-glass .role-icon {width:46px;height:49px;border-radius:15px;}.pre-glass .role-icon .pre-icon {width:25px;height:25px;}}
@container (max-width:480px) {.pre-glass .brand-mark {width:23px;height:26px;}.pre-glass .brand {gap:9px;}.pre-glass .brand strong {font-size:15px;}.pre-glass .titlebar {gap:8px;padding:18px 16px;}.pre-glass .theme-switch {order:3;margin:3px 0 0;width:100%;justify-content:space-between;}.pre-glass .theme-switch button {flex:1;}.pre-glass .appearance-trigger {margin-left:auto;}.pre-glass .project-copy h1 {font-size:26px;}.pre-glass .project-identity {gap:18px;}.pre-glass .project-card {padding:22px;gap:22px;}.pre-glass .folder-tile {width:73px;height:82px;border-radius:22px;}.pre-glass .folder-tile .pre-icon {width:42px;height:42px;}.pre-glass .project-name {font-size:15px;}.pre-glass .project-actions {gap:9px;}.pre-glass .project-actions .pre-primary {min-width:0;padding:10px 13px;font-size:13px;}.pre-glass .role-card {padding:17px;gap:16px;}.pre-glass .model-controls {gap:8px;}.pre-glass .pre-select {font-size:13px;min-height:46px;padding:10px;}.pre-glass .companion-picker {margin-right:0;gap:8px;}.pre-glass .companion-picker .pre-select {min-height:42px;}.pre-glass .save-bar {gap:8px;}.pre-glass .workspace-footer {padding:2px 22px 18px;}.pre-glass .fallback-row {grid-template-columns:1fr;}.pre-glass .fallback-actions {justify-content:flex-end;}.pre-glass .fallback-name {font-size:12px;}}
@supports not (backdrop-filter:blur(1px)) {.pre-glass .workspace,.pre-glass .role-card,.pre-glass .project-card {background:var(--panel);}}
`
