import { createHash } from 'node:crypto'

const PROTOTYPE_STYLES = `
:root{color-scheme:light dark;--background:#fff;--foreground:#0a0a0a;--card:#fff;--card-foreground:#0a0a0a;--muted:#f5f5f5;--muted-foreground:#737373;--accent:#f5f5f5;--accent-foreground:#171717;--border:#e5e5e5;--ring:#a1a1a1;--status-success:#15803d;--status-error:#dc2626}
@media(prefers-color-scheme:dark){:root{--background:#0a0a0a;--foreground:#fafafa;--card:#171717;--card-foreground:#fafafa;--muted:#262626;--muted-foreground:#a1a1a1;--accent:#404040;--accent-foreground:#fafafa;--border:rgb(255 255 255/.07);--ring:#737373;--status-success:#86efac;--status-error:#fca5a5}}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5}
.shell{min-height:100dvh;padding:max(18px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}
.eyebrow{margin:0 0 6px;color:var(--muted-foreground);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
h1{margin:0;font-size:20px;line-height:1.2}
.subhead{margin:8px 0 18px;color:var(--muted-foreground);font-size:12px}
.status{display:flex;align-items:center;gap:7px;margin-bottom:16px;color:var(--muted-foreground);font-size:12px}
.dot{width:8px;height:8px;border-radius:999px;background:var(--ring)}
.dot.connected{background:var(--status-success)}
.list{display:grid;gap:8px}
.row{width:100%;padding:13px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--card-foreground);font:inherit;text-align:left}
.row:active,.row:focus-visible{background:var(--accent);outline:2px solid var(--ring);outline-offset:1px}
.row-title{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:600}
.branch,.empty,.error{margin-top:4px;color:var(--muted-foreground);font-size:12px}
.badge{flex:none;color:var(--muted-foreground);font-size:11px;font-weight:500}
.empty,.error{padding:18px;border:1px solid var(--border);border-radius:8px;background:var(--card)}
.error{color:var(--foreground)}
.probe{margin-top:18px;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--card)}
.probe-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.probe-title{margin:0;font-size:13px;font-weight:600}
.probe-copy{margin:3px 0 0;color:var(--muted-foreground);font-size:11px}
.probe-button{flex:none;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--foreground);color:var(--background);font:inherit;font-size:12px;font-weight:600}
.probe-button:disabled{opacity:.55}
.probe-result{margin-top:12px;padding:10px;border-radius:6px;background:var(--muted);font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.probe-stage{display:grid;grid-template-rows:120px 180px;gap:8px;margin-top:10px}
.terminal-probe,.diff-probe{overflow:auto;margin:0;border:1px solid var(--border);border-radius:6px;background:var(--background);font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
.terminal-probe{padding:8px;white-space:pre}
.diff-line{min-width:max-content;padding:0 8px;white-space:pre}
.diff-line.added{background:color-mix(in srgb,var(--status-success) 14%,transparent)}
.diff-line.deleted{background:color-mix(in srgb,var(--status-error) 13%,transparent)}
`.trim()

const PROTOTYPE_SCRIPT = `
(()=>{"use strict";
const root=document.getElementById("workspace-list");
const host=document.getElementById("host");
const connection=document.getElementById("connection");
const dot=document.getElementById("dot");
const probeButton=document.getElementById("run-probe");
const probeResult=document.getElementById("probe-result");
const terminalProbe=document.getElementById("terminal-probe");
const diffProbe=document.getElementById("diff-probe");
const packageKiB=Number("000000");
let sequence=0;
const send=(message)=>window.ReactNativeWebView.postMessage(JSON.stringify({v:1,...message}));
const text=(value,fallback="")=>typeof value==="string"?value:fallback;
const renderError=(message)=>{root.replaceChildren();const node=document.createElement("div");node.className="error";node.textContent=message;root.append(node)};
const renderWorkspaces=(items)=>{root.replaceChildren();if(!Array.isArray(items)||items.length===0){const empty=document.createElement("div");empty.className="empty";empty.textContent="No workspaces returned by this host.";root.append(empty);return}for(const item of items){const row=document.createElement("button");row.type="button";row.className="row";const title=document.createElement("div");title.className="row-title";const name=document.createElement("span");name.textContent=text(item.name,"Workspace");const badge=document.createElement("span");badge.className="badge";badge.textContent=item.isActive?"Active":String(Number(item.liveTerminalCount)||0)+" live";title.append(name,badge);const branch=document.createElement("div");branch.className="branch";branch.textContent=text(item.repo,"Repository")+" · "+text(item.branch,"No branch");row.append(title,branch);row.addEventListener("click",()=>send({type:"haptic.selection",id:"haptic-"+(++sequence)}));root.append(row)}};
const setConnection=(state)=>{const value=text(state,"disconnected");connection.textContent=value;dot.classList.toggle("connected",value==="connected")};
const nextFrame=()=>new Promise((resolve)=>requestAnimationFrame(resolve));
const terminalLine=(frame,line)=>"["+String(frame).padStart(3,"0")+"] task-"+String(line%24).padStart(2,"0")+" | building mobile web surface | "+"#".repeat((line+frame)%48);
const runTerminalProbe=async()=>{const lines=[];const frameTimes=[];const started=performance.now();for(let frame=0;frame<120;frame++){const frameStarted=performance.now();for(let line=0;line<8;line++)lines.push(terminalLine(frame,line));if(lines.length>640)lines.splice(0,lines.length-640);terminalProbe.textContent=lines.join("\\n");await nextFrame();frameTimes.push(performance.now()-frameStarted)}return{total:performance.now()-started,max:Math.max(...frameTimes),slow:frameTimes.filter((value)=>value>24).length}};
const runDiffProbe=async()=>{diffProbe.replaceChildren();const fragment=document.createDocumentFragment();const started=performance.now();for(let index=0;index<4000;index++){const line=document.createElement("div");const kind=index%11===0?"deleted":index%7===0?"added":"context";line.className="diff-line "+kind;line.textContent=(kind==="added"?"+":kind==="deleted"?"-":" ")+String(index+1).padStart(5," ")+"  const workspace_"+index+" = reconcileHostCapability(manifest, pairedIdentity, cachedDocument);";fragment.append(line)}diffProbe.append(fragment);await nextFrame();return{total:performance.now()-started,height:diffProbe.scrollHeight}};
const runProbe=async()=>{probeButton.disabled=true;probeButton.textContent="Running...";probeResult.hidden=false;probeResult.textContent="Running 120 terminal frames...";terminalProbe.textContent="";diffProbe.replaceChildren();try{const terminal=await runTerminalProbe();probeResult.textContent="Rendering 4,000 diff rows...";const diff=await runDiffProbe();probeResult.textContent="terminal  120 frames / "+terminal.total.toFixed(0)+" ms\\nlongest   "+terminal.max.toFixed(1)+" ms / "+terminal.slow+" over 24 ms\\ndiff      4,000 rows / "+diff.total.toFixed(0)+" ms\\nlayout    "+diff.height.toLocaleString()+" px\\npackage   "+packageKiB+" KiB"}catch{probeResult.textContent="The performance probe did not complete."}finally{probeButton.disabled=false;probeButton.textContent="Run probe"}};
probeButton.addEventListener("click",()=>void runProbe());
const receive=(event)=>{let message;try{message=JSON.parse(event.data)}catch{return}if(!message||message.v!==1)return;if(message.type==="init"){host.textContent=text(message.host?.name,"Paired host");setConnection(message.connection);send({type:"workspace.list",id:"workspace-"+(++sequence)});return}if(message.type==="connection"){setConnection(message.state);return}if(message.type==="response"&&typeof message.id==="string"&&message.id.startsWith("workspace-")){if(message.ok)renderWorkspaces(message.result?.workspaces);else renderError(text(message.error,"Workspace request failed."))}};
window.addEventListener("message",receive);
document.addEventListener("message",receive);
send({type:"ready"})})();
`.trim()

const PROTOTYPE_PACKAGE_PADDING = 'x'.repeat(320 * 1024)
const PACKAGE_KIB_PLACEHOLDER = '000000'

function contentHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

export function buildMobileWebPrototypeDocument(): string {
  const placeholderDocument = renderDocument(PROTOTYPE_SCRIPT)
  const packageKiB = Math.ceil(Buffer.byteLength(placeholderDocument, 'utf8') / 1024)
  const script = PROTOTYPE_SCRIPT.replace(
    PACKAGE_KIB_PLACEHOLDER,
    String(packageKiB).padStart(PACKAGE_KIB_PLACEHOLDER.length, '0')
  )
  return renderDocument(script)
}

function renderDocument(script: string): string {
  const styleHash = contentHash(PROTOTYPE_STYLES)
  const scriptHash = contentHash(script)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${styleHash}'; script-src 'sha256-${scriptHash}'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'">
<title>Orca Hybrid Prototype</title>
<style>${PROTOTYPE_STYLES}</style>
</head>
<body>
<main class="shell">
<p class="eyebrow">Desktop-served prototype</p>
<h1 id="host">Paired host</h1>
<p class="subhead">This workspace list is rendered by web code delivered through the paired Orca connection.</p>
<div class="status"><span id="dot" class="dot"></span><span id="connection">Connecting</span></div>
<div id="workspace-list" class="list"><div class="empty">Waiting for the native bridge...</div></div>
<section class="probe">
<div class="probe-head"><div><p class="probe-title">Performance lab</p><p class="probe-copy">Synthetic terminal churn and a large diff, isolated from host data.</p></div><button id="run-probe" class="probe-button" type="button">Run probe</button></div>
<div id="probe-result" class="probe-result" hidden></div>
<div class="probe-stage"><pre id="terminal-probe" class="terminal-probe"></pre><div id="diff-probe" class="diff-probe"></div></div>
</section>
</main>
<script>${script}</script>
<!-- Package-transfer padding for the bounded multi-chunk prototype: ${PROTOTYPE_PACKAGE_PADDING} -->
</body>
</html>`
}
