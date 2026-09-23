/** Scoped in the client JS bundle: no global reset and no separate CSS request. */
export const GLASS_STYLES = `
.pre-glass { --ink:#24283f;--muted:#565f7b;--faint:#727d99;--accent:#6458ce;--surface:rgba(255,255,255,.31);--control:rgba(252,253,255,.84);--line:rgba(255,255,255,.67);--shine:rgb(255 255 255 / calc(var(--gloss) * .94));--rim:rgba(177,221,255,.55);--shadow:68,79,126;--warn:#945b11;--error:#b13c52;--success:#237754;--panel:#edeffa;--blur:21px;--gloss:.86;--lift:24px;--hover:-3px;--thickness:5px; color:var(--ink);color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.6;height:100%;overflow:auto;position:relative;isolation:isolate;container-type:inline-size; background:radial-gradient(ellipse at 0% 0%,#fff3e4,transparent 54%),radial-gradient(ellipse at 98% 83%,#a9bcea,transparent 56%),linear-gradient(115deg,#f1e4e4,#d2d7f0 60%,#b1c4e2); }
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
.pre-glass .titlebar {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;padding:20px 25px;}
.pre-glass .brand {display:flex;align-items:center;gap:12px;min-width:0;}
.pre-glass .brand-mark {width:30px;height:34px;background:linear-gradient(125deg,#68d3fc,#816af0);clip-path:polygon(0 0,100% 50%,0 100%,0 68%,48% 50%,0 32%);filter:drop-shadow(0 2px 3px #ffffff70);}
.pre-glass .brand strong {font-size:17px;letter-spacing:-.4px;}
.pre-glass .brand small {display:block;color:var(--faint);font-size:10px;letter-spacing:.3px;}
.pre-glass .version {font-size:10px;padding:2px 8px;border:1px solid var(--line);border-radius:20px;white-space:nowrap;color:var(--muted);}
.pre-glass .theme-switch {display:flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:30px;padding:4px;box-shadow:inset 0 1px 2px var(--shine);}
.pre-glass .theme-switch button {border:1px solid transparent;border-radius:24px;background:transparent;color:var(--muted);min-width:36px;padding:6px 9px;font-size:11px;}
.pre-glass .theme-switch button[aria-pressed=true] {color:var(--ink);background:var(--control);border-color:var(--line);box-shadow:inset 0 1px 2px var(--shine),0 4px 8px rgba(var(--shadow),.16);}
.pre-glass .theme-switch b {color:var(--accent);margin-right:5px;}
.pre-glass .appearance-trigger {display:flex;gap:6px;align-items:center;}
.pre-glass .workspace-body {padding:0 23px 18px;display:grid;gap:20px;}
.pre-glass .project-card, .pre-glass .role-card {border:1px solid var(--line);border-radius:22px;background:var(--surface);position:relative;box-shadow:inset 0 1.6px 2px var(--shine),inset 1px 0 2px var(--line),inset 0 calc(var(--thickness) * -1) calc(var(--thickness) + 2px) var(--rim),0 var(--lift) calc(var(--lift) + 12px) -12px rgba(var(--shadow),.3);backdrop-filter:blur(var(--blur)) saturate(1.14);-webkit-backdrop-filter:blur(var(--blur)) saturate(1.14);}
.pre-glass .project-card::before, .pre-glass .role-card::before {content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;padding:1.3px;background:linear-gradient(135deg,var(--shine),transparent 35%,var(--line) 65%,var(--shine));mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude;opacity:var(--gloss);}
.pre-glass .project-card::after, .pre-glass .role-card::after {content:'';position:absolute;inset:var(--thickness);border-radius:16px;box-shadow:0 1px 1px var(--line),inset 0 1px 1px rgba(var(--shadow),.15);opacity:calc(var(--gloss) * .55);pointer-events:none;}
.pre-glass .project-card {display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.2fr);gap:28px;padding:29px;align-items:center;min-width:0;}
.pre-glass .project-identity {display:flex;gap:24px;align-items:center;min-width:0;}
.pre-glass .project-copy {min-width:0;}
.pre-glass .project-copy h1 {font-size:25px;letter-spacing:-.6px;}
.pre-glass .eyebrow {font-size:9px;letter-spacing:1.6px;color:var(--faint);margin-bottom:7px;}
.pre-glass .project-name {font-size:16px;font-weight:550;margin:5px 0 10px;overflow-wrap:anywhere;}
.pre-glass .project-path {font-size:11px;color:var(--muted);overflow-wrap:anywhere;}
.pre-glass .folder-tile {flex-shrink:0;width:108px;height:116px;border-radius:28px;display:grid;place-items:center;background:radial-gradient(circle at 10% 10%,#fff8,transparent 25%),radial-gradient(circle at 95% 95%,#b7fbff8c,transparent 35%),linear-gradient(130deg,#a6b8f860,#a18bd25c,#b7c6ff40);border:1px solid var(--line);box-shadow:inset 3px 3px 4px var(--shine),inset -4px -5px 8px var(--rim),0 var(--lift) 26px -8px rgba(var(--shadow),.4);}
.pre-glass .folder-tile .pre-icon {width:56px;height:56px;stroke-width:1.05;color:var(--shine);filter:drop-shadow(0 4px 5px #756acf55);}
.pre-glass .project-right {display:grid;gap:14px;min-width:0;}
.pre-glass .project-notice {display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--line);border-radius:17px;background:var(--surface);box-shadow:inset 0 1px 1px var(--shine),0 6px 12px -9px rgba(var(--shadow),.4);}
.pre-glass .notice-icon {display:grid;place-items:center;width:33px;height:33px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#79adff,#8177e8);color:#fff;}
.pre-glass .project-notice strong {display:block;font-size:12px;}
.pre-glass .project-notice p {font-size:11px;color:var(--muted);margin-top:4px;}
.pre-glass .project-actions {display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.pre-glass .pre-button {border:1px solid var(--line);border-radius:13px;padding:8px 13px;background:radial-gradient(ellipse 90px 40px at var(--px,25%) var(--py,0%),rgb(255 255 255 / calc(var(--gloss) * .18)),transparent),var(--control);box-shadow:inset 0 1.5px 2px var(--shine),inset 0 -1.5px 2px var(--rim),0 6px 10px -6px rgba(var(--shadow),.4);display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;transition:transform .2s ease;}
.pre-glass .pre-primary {color:#fff;background:radial-gradient(ellipse 110px 40px at var(--px,25%) var(--py,0%),#ffffff55,transparent),radial-gradient(ellipse at 100% 100%,#97f1ffb8,transparent 48%),linear-gradient(110deg,#8064ea,#6660d5 56%,#719fea);box-shadow:inset 0 2px 3px #ffffffb3,inset 0 -3px 4px #a7e8ffba,0 14px 22px -8px rgba(var(--shadow),.46);}
.pre-glass .project-actions .pre-button {border-radius:24px;min-height:47px;font-size:13px;font-weight:600;padding:9px 12px;}
.pre-glass .project-version {grid-column:1/-1;text-align:center;font-size:10px;color:var(--faint);}
.pre-glass .project-version small {opacity:1!important;}
.pre-glass .settings {border:1px solid var(--line);border-radius:24px;padding:18px;background:rgba(255,255,255,.04);min-width:0;}
.pre-glass .settings-heading {display:flex;align-items:flex-start;gap:14px;padding:4px 4px 19px;}
.pre-glass .section-icon {display:grid;place-items:center;flex-shrink:0;width:44px;height:46px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:inset 0 1.5px 2px var(--shine);}
.pre-glass .section-icon .pre-icon {width:24px;height:24px;}
.pre-glass .settings-heading h2 {font-size:20px;letter-spacing:-.5px;}
.pre-glass .settings-heading p {font-size:11px;margin-top:5px;color:var(--muted);line-height:1.85;}
.pre-glass .role-list {display:grid;gap:14px;}
.pre-glass .role-card {display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.3fr);gap:22px;padding:22px 20px;min-width:0;transition:transform .24s ease;}
.pre-glass .role-identity {display:flex;align-items:flex-start;gap:16px;min-width:0;}
.pre-glass .role-identity label {display:block;margin-top:2px;font-size:15px;font-weight:650;}
.pre-glass .role-description {font-size:11px;color:var(--muted);margin-top:4px;line-height:1.8;}
.pre-glass .role-icon {flex-shrink:0;display:grid;place-items:center;width:50px;height:54px;border-radius:16px;border:1px solid var(--line);color:#8071db;background:linear-gradient(135deg,#fff6,#bca2f53b);box-shadow:inset 1px 2px 2px var(--shine),inset 0 -2px 3px var(--line),0 8px 12px -4px rgba(var(--shadow),.22);}
.pre-glass .role-icon .pre-icon {width:27px;height:27px;}
.pre-glass [data-kind=web] .role-icon {color:#298f9d;background:linear-gradient(135deg,#fff4,#91ddd555);}
.pre-glass [data-kind=review] .role-icon {color:#d78169;background:linear-gradient(135deg,#fff4,#ffa7823a);}
.pre-glass[data-theme=dark] .role-icon {color:#c7bbff;background:linear-gradient(135deg,#7e79cc33,#9972e43d);}
.pre-glass[data-theme=dark] [data-kind=web] .role-icon {color:#90dfec;background:#488b9440;}
.pre-glass[data-theme=dark] [data-kind=review] .role-icon {color:#ffc1a6;background:#d77b5533;}
.pre-glass .model-area {display:grid;gap:8px;min-width:0;align-content:center;}
.pre-glass .model-controls {display:flex;align-items:center;gap:10px;min-width:0;}
.pre-glass .model-controls>.pre-select {flex:1;width:0;min-width:0;}
.pre-glass .pre-select {border:1px solid var(--line);border-radius:13px;width:100%;max-width:100%;padding:10px 12px;background:var(--control);color:var(--ink);box-shadow:inset 0 1px 2px var(--shine),inset 0 -1px 2px rgba(var(--shadow),.18);font-size:12px;text-overflow:ellipsis;min-height:40px;}
.pre-glass option,.pre-glass optgroup {background:var(--panel);color:var(--ink);}
.pre-glass .add-backup {white-space:nowrap;font-size:11px;}
.pre-glass .model-hint,.pre-glass .fallback-policy {color:var(--muted);font-size:10px;line-height:1.85;}
.pre-glass .companion-picker {display:grid;gap:5px;font-size:11px;}
.pre-glass .companion-picker small {color:var(--muted);font-size:10px;}
.pre-glass .fallback-row {border-top:1px solid var(--line);padding-top:10px;display:grid;gap:8px;min-width:0;}
.pre-glass .fallback-name {font-size:11px;overflow-wrap:anywhere;}
.pre-glass .fallback-actions {display:flex;gap:6px;flex-wrap:wrap;}
.pre-glass .fallback-actions button {font-size:10px;min-height:29px;padding:4px 9px;}
.pre-glass .fallback-picker {display:flex;gap:8px;align-items:center;}
.pre-glass .fallback-picker select {min-width:0;flex:1;width:0;}
.pre-glass .fallback-policy {display:block;padding:17px 5px 10px;}
.pre-glass .provider-details {font-size:11px;color:var(--muted);margin:8px 5px;}
.pre-glass .provider-details small {display:block;overflow-wrap:anywhere;}
.pre-glass .save-bar {display:flex;align-items:center;flex-wrap:wrap;gap:10px;border:1px solid var(--line);border-radius:16px;background:var(--control);padding:12px;margin-top:12px;position:sticky;bottom:10px;z-index:6;box-shadow:0 9px 20px -12px rgba(var(--shadow),.35);}
.pre-glass .save-state {font-size:11px;color:var(--muted);margin-right:auto;}
.pre-glass .save-state[data-dirty=true] {color:var(--warn);}
.pre-glass .pre-alert,.pre-glass .pre-feedback {font-size:12px;border:1px solid var(--line);padding:11px 13px;margin:9px 0;border-radius:13px;overflow-wrap:anywhere;background:var(--surface);}
.pre-glass .pre-alert {color:var(--error);}
.pre-glass .pre-feedback {color:var(--success);}
.pre-glass .pre-warning {color:var(--warn);font-size:11px;}
.pre-glass .pre-muted,.pre-glass .pre-empty {color:var(--muted);font-size:12px;}
.pre-glass .pre-error {color:var(--error);}
.pre-glass .execution-panel {padding:20px 4px 0;display:grid;gap:11px;margin-top:14px;border-top:1px solid var(--line);}
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
@media (hover:hover) and (pointer:fine) {.pre-glass[data-motion=on] .role-card:hover {transform:translateY(var(--hover));z-index:2;}.pre-glass[data-motion=on] .pre-button:hover:enabled {transform:translateY(calc(var(--hover) * .6));}.pre-glass .pre-button:active:enabled {transform:translateY(1px)!important;}}
@media (prefers-reduced-motion:reduce) {.pre-glass *, .pre-glass *::before,.pre-glass *::after {animation:none!important;transition:none!important;transform:none!important;}}
@container (max-width:1040px) {.pre-glass .theme-switch span {display:none;}.pre-glass .titlebar {gap:10px;}.pre-glass .project-card {gap:20px;padding:24px;}.pre-glass .folder-tile {width:84px;height:96px;}.pre-glass .project-identity {gap:17px;}.pre-glass .role-card {grid-template-columns:minmax(0,.75fr) minmax(0,1.3fr);gap:16px;}}
@container (max-width:780px) {.pre-glass .pre-stage {padding:15px 12px;}.pre-glass .workspace {border-radius:24px;}.pre-glass .workspace-body {padding:0 15px 15px;}.pre-glass .project-card {grid-template-columns:1fr;padding:23px;}.pre-glass .role-card {grid-template-columns:1fr;gap:15px;padding:20px;}.pre-glass .settings {padding:12px;}.pre-glass .titlebar {padding:16px 18px;}.pre-glass .brand strong {font-size:15px;}.pre-glass .version {display:none;}.pre-glass .theme-switch {margin-left:auto;}.pre-glass .theme-switch button {min-width:29px;padding:5px 6px;}.pre-glass .theme-switch b {margin:0;}.pre-glass .settings-heading h2 {font-size:17px;}}
@container (max-width:480px) {.pre-glass .brand-mark {width:22px;height:27px;}.pre-glass .brand {gap:8px;}.pre-glass .brand small {display:none;}.pre-glass .titlebar {gap:8px;}.pre-glass .appearance-trigger {padding:7px;}.pre-glass .appearance-trigger span {display:none;}.pre-glass .project-actions {grid-template-columns:1fr;}.pre-glass .project-copy h1 {font-size:23px;}.pre-glass .project-identity {gap:14px;}.pre-glass .folder-tile {width:64px;height:75px;border-radius:20px;}.pre-glass .folder-tile .pre-icon {width:39px;height:39px;}.pre-glass .model-controls {flex-wrap:wrap;}.pre-glass .model-controls>.pre-select {width:100%;flex-basis:100%;}.pre-glass .add-backup {justify-self:start;}.pre-glass .pre-bottom {flex-direction:column;gap:4px;}.pre-glass .save-bar {bottom:3px;}.pre-glass .save-state {width:100%;}.pre-glass .role-card {padding:17px;}.pre-glass .section-icon {display:none;}}
@supports not (backdrop-filter:blur(1px)) {.pre-glass .workspace,.pre-glass .role-card,.pre-glass .project-card {background:var(--panel);}}
`
