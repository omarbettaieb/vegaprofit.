// VegaProfit design system. One stylesheet, every class prefixed "vp-" and scoped under ".vp".
// Idea: what Meta CLAIMS is drawn hatched, what Shopify PROVES is drawn solid. Everything else stays quiet.

export const CSS = `
.vp{
  --ground:#F1F5F3; --surface:#FFFFFF; --ink:#10231F; --ink2:#34453F; --mute:#62736E; --faint:#8C9B96;
  --line:#DCE4E1; --line2:#EBF0EE; --teal:#0E7C86; --teal-d:#0A5F67; --teal-soft:#DCEFF0;
  --claim:#9AA8A4; --claim-soft:#E3E9E7;
  --red:#B3382C; --red-soft:#FBE8E5; --amber:#8F5200; --amber-soft:#FCEED2; --green:#17744A; --green-soft:#DDF2E6;
  --blue:#2A52C0; --blue-soft:#E3EAFB; --grey:#4E5F5A; --grey-soft:#E7ECEA;
  --radius:12px;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-feature-settings:"tnum" 1,"cv11" 1,"ss03" 1;
  color:var(--ink); background:var(--ground); font-size:14px; line-height:1.5;
  min-height:100vh; -webkit-font-smoothing:antialiased;
}
.vp *,.vp *::before,.vp *::after{box-sizing:border-box}
.vp a{color:var(--teal-d);text-decoration:none;text-underline-offset:3px}
.vp a:hover{text-decoration:underline}
.vp :focus-visible{outline:2px solid var(--teal);outline-offset:2px;border-radius:6px}

/* ---- shell ---- */
.vp-app{display:block}
.vp-app.vp-standalone{display:grid;grid-template-columns:236px minmax(0,1fr)}
.vp-side{background:var(--ink);color:#C9D8D3;padding:22px 14px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:22px}
.vp-brand{display:flex;align-items:center;gap:10px;padding:2px 10px;color:#fff;font-weight:650;font-size:16px;letter-spacing:-.01em}
.vp-mark{width:26px;height:26px;border-radius:8px;background:var(--teal);display:grid;place-items:center}
.vp-nav{display:flex;flex-direction:column;gap:2px}
.vp-nav a{color:#C9D8D3;padding:8px 10px;border-radius:8px;font-weight:500;display:flex;align-items:center;gap:10px}
.vp-nav a:hover{background:rgba(255,255,255,.07);text-decoration:none;color:#fff}
.vp-nav a[aria-current="page"]{background:rgba(255,255,255,.12);color:#fff}
.vp-nav svg{opacity:.8;flex:none}
.vp-demo-tag{margin-top:auto;font-size:12.5px;line-height:1.45;color:#9FB3AD;padding:12px;border:1px solid rgba(255,255,255,.14);border-radius:10px}
.vp-demo-tag b{color:#fff;font-weight:600}
.vp-main{padding:30px clamp(16px,3.2vw,40px) 72px;min-width:0}
.vp-wrap{max-width:1180px;margin:0 auto}

/* ---- page header ---- */
.vp-head{display:flex;gap:20px;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;margin-bottom:22px}
.vp-head h1{margin:0;font-size:clamp(24px,3vw,30px);line-height:1.15;font-weight:680;letter-spacing:-.028em}
.vp-lede{margin:6px 0 0;color:var(--mute);max-width:64ch;font-size:14.5px}

/* ---- surfaces ---- */
.vp-sec{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin-bottom:18px}
.vp-sec-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:14px}
.vp-sec h2{margin:0;font-size:15.5px;font-weight:650;letter-spacing:-.012em}
.vp-note{color:var(--mute);font-size:13px;margin:0 0 14px;max-width:80ch}
.vp-p{margin:0 0 10px;max-width:80ch}
.vp-cols{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:18px;align-items:start}
.vp-cols>.vp-sec,.vp-stack>.vp-sec{margin-bottom:0}
.vp-stack{display:grid;gap:18px;min-width:0}
@media (max-width:1000px){.vp-cols{grid-template-columns:1fr;gap:0}.vp-cols>.vp-sec,.vp-cols>.vp-stack{margin-bottom:18px}}

/* ---- notices ---- */
.vp-notice{border:1px solid var(--line);border-left-width:4px;border-radius:10px;background:var(--surface);padding:11px 14px;margin-bottom:14px;font-size:13.5px}
.vp-notice.warn{border-left-color:#D98A00;background:#FFFAF0}
.vp-notice.bad{border-left-color:var(--red);background:#FFF6F5}
.vp-notice.good{border-left-color:var(--green);background:#F5FCF8}
.vp-notice.info{border-left-color:var(--teal)}

/* ---- KPI strip ---- */
.vp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:18px;overflow:hidden}
.vp-kpi{padding:16px 20px;border-left:1px solid var(--line2);min-width:0}
.vp-kpi:first-child{border-left:0}
@media (max-width:620px){.vp-kpi{border-left:0;border-top:1px solid var(--line2)}.vp-kpi:first-child{border-top:0}}
.vp-kpi-l{font-size:12.5px;color:var(--mute);font-weight:500}
.vp-kpi-v{font-size:26px;line-height:1.2;font-weight:680;letter-spacing:-.03em;margin-top:2px;white-space:nowrap}
.vp-kpi-v small{font-size:13px;font-weight:550;color:var(--mute);letter-spacing:0;margin-left:3px}
.vp-kpi-s{font-size:12.5px;color:var(--mute);margin-top:1px}
.vp-kpi.pos .vp-kpi-v{color:var(--green)}
.vp-kpi.neg .vp-kpi-v{color:var(--red)}

/* ---- the gap (home headline) ---- */
.vp-gap{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:26px 28px 24px;margin-bottom:18px}
.vp-gap h2{margin:0 0 4px;font-size:clamp(23px,3.1vw,34px);line-height:1.18;font-weight:700;letter-spacing:-.032em;max-width:26ch}
.vp-gap .vp-n-claim{color:var(--faint)}
.vp-gap .vp-n-proof{color:var(--teal)}
.vp-gap-sub{color:var(--mute);margin:0 0 22px;max-width:62ch}

/* ---- claimed vs proven ---- */
.vp-cp{display:flex;flex-direction:column;gap:14px}
.vp-cp-row{display:grid;grid-template-columns:minmax(120px,210px) minmax(0,1fr);gap:6px 18px;align-items:center}
@media (max-width:640px){.vp-cp-row{grid-template-columns:1fr}}
.vp-cp-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vp-cp-name span{display:block;font-weight:400;font-size:12.5px;color:var(--mute);white-space:normal}
.vp-cp-bars{display:flex;flex-direction:column;gap:5px;min-width:0}
.vp-bar{display:flex;align-items:center;gap:10px;height:16px}
.vp-bar-fill{height:100%;border-radius:4px;transform-origin:left center;animation:vp-draw .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:var(--d,0ms);min-width:2px}
.vp-bar-fill.claim{background:repeating-linear-gradient(135deg,var(--claim) 0 3px,var(--claim-soft) 3px 7px);border:1px solid var(--claim)}
.vp-bar-fill.proof{background:var(--teal)}
.vp-bar-v{font-size:12.5px;font-weight:600;color:var(--ink2);white-space:nowrap}
.vp-bar-v.claim{color:var(--mute);font-weight:500}
.vp-legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--mute);font-size:12.5px;margin-bottom:14px}
.vp-legend i{display:inline-block;width:22px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}
.vp-legend i.claim{background:repeating-linear-gradient(135deg,var(--claim) 0 3px,var(--claim-soft) 3px 7px);border:1px solid var(--claim)}
.vp-legend i.proof{background:var(--teal)}
@keyframes vp-draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}

/* ---- badges ---- */
.vp-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 8px;border-radius:999px;font-size:12px;font-weight:620;white-space:nowrap}
.vp-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.vp-badge.red{background:var(--red-soft);color:var(--red)}
.vp-badge.amber{background:var(--amber-soft);color:var(--amber)}
.vp-badge.green{background:var(--green-soft);color:var(--green)}
.vp-badge.blue{background:var(--blue-soft);color:var(--blue)}
.vp-badge.grey{background:var(--grey-soft);color:var(--grey)}

/* ---- tables ---- */
.vp-tw{overflow-x:auto;margin:0 -22px;padding:0 22px}
.vp table{border-collapse:collapse;width:100%}
.vp th{font-size:12px;font-weight:560;color:var(--mute);padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;background:transparent}
.vp td{padding:10px 10px;border-bottom:1px solid var(--line2);vertical-align:top;white-space:nowrap}
.vp td:first-child,.vp td.wrap{white-space:normal}
.vp td:first-child{min-width:130px}
.vp tr:last-child td{border-bottom:0}
.vp td:first-child,.vp th:first-child{padding-left:0}
.vp td:last-child,.vp th:last-child{padding-right:0}
.vp tfoot td{border-top:1px solid var(--line);font-weight:650}
.vp .vp-sub{display:block;color:var(--mute);font-size:12.5px;font-weight:400}
.vp .vp-strong{font-weight:650}
.vp .vp-neg{color:var(--red)}
.vp .vp-pos{color:var(--green)}
.vp .vp-dim{color:var(--faint)}

/* ---- controls ---- */
.vp-bar-tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.vp-seg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px}
.vp-seg a{padding:5px 12px;border-radius:7px;color:var(--ink2);font-weight:520;font-size:13px}
.vp-seg a:hover{background:var(--line2);text-decoration:none}
.vp-seg a[aria-current="true"]{background:var(--ink);color:#fff}
.vp-details{position:relative}
.vp-details summary{list-style:none;cursor:pointer;padding:6px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:13px;font-weight:520}
.vp-details summary::-webkit-details-marker{display:none}
.vp-details[open] summary{border-color:var(--teal)}
.vp-pop{position:absolute;right:0;z-index:5;margin-top:6px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:10px;min-width:240px;box-shadow:0 8px 24px rgba(16,35,31,.12)}
.vp input,.vp select,.vp textarea{font:inherit;color:var(--ink);background:var(--surface);border:1px solid #BFCBC7;border-radius:8px;padding:6px 10px;min-height:34px}
.vp input:focus,.vp select:focus,.vp textarea:focus{border-color:var(--teal);outline:2px solid var(--teal-soft);outline-offset:0}
.vp button,.vp .vp-btn{font:inherit;font-weight:560;color:var(--ink);background:var(--surface);border:1px solid #BFCBC7;border-radius:8px;padding:6px 14px;min-height:34px;cursor:pointer}
.vp button:hover{border-color:var(--ink2)}
.vp button:disabled{opacity:.5;cursor:default}
.vp .vp-primary{background:var(--teal);border-color:var(--teal);color:#fff}
.vp .vp-primary:hover{background:var(--teal-d);border-color:var(--teal-d)}
.vp label{color:var(--ink2)}
.vp-formgrid{display:grid;gap:8px;max-width:680px}
.vp-formgrid label{display:flex;justify-content:space-between;gap:16px;align-items:center}
.vp-formgrid input{width:96px;text-align:right}

/* ---- charts ---- */
.vp-chart{width:100%;height:auto;display:block}
.vp-chart text{font-family:inherit;font-size:9.5px;fill:var(--mute)}
.vp-chart .grid{stroke:var(--line2)}
.vp-chart .zero{stroke:var(--faint)}
.vp-chart .pos{fill:var(--teal)}
.vp-chart .neg{fill:var(--red)}
.vp-chart .line{fill:none;stroke:var(--ink);stroke-width:1.6}

/* ---- verdict list ---- */
.vp-vlist{display:flex;flex-direction:column}
.vp-vrow{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:11px 0;border-bottom:1px solid var(--line2);align-items:start}
.vp-vrow:last-child{border-bottom:0}
.vp-vrow b{font-weight:600}
.vp-vrow small{display:block;color:var(--mute);font-size:12.5px;font-weight:400}

/* ---- empty ---- */
.vp-empty{border:1px dashed var(--line);border-radius:10px;padding:22px;color:var(--mute);text-align:center}

/* ---- health ---- */
.vp-check{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;padding:13px 0;border-bottom:1px solid var(--line2)}
.vp-check:last-child{border-bottom:0}
.vp-dot{width:12px;height:12px;border-radius:50%;margin-top:5px}
.vp-dot.ok{background:var(--green)}.vp-dot.warn{background:#D98A00}.vp-dot.fail{background:var(--red)}
.vp-fix{color:var(--amber);font-weight:520;margin-top:2px}

/* ---- mobile shell ---- */
@media (max-width:860px){
  .vp-app.vp-standalone{display:block}
  .vp-side{position:static;height:auto;flex-direction:row;align-items:center;gap:12px;padding:10px 12px;overflow-x:auto}
  .vp-nav{flex-direction:row}
  .vp-nav a{white-space:nowrap}
  .vp-demo-tag{display:none}
  .vp-brand{flex:none}
}
@media (prefers-reduced-motion:reduce){.vp-bar-fill{animation:none}}
`;
