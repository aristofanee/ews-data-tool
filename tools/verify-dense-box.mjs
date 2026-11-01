import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","1421"],{stdio:"ignore",windowsHide:true});
let browser;
try {
  for(let i=0;i<80;i++){try{if((await fetch("http://127.0.0.1:1421")).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage({viewport:{width:1400,height:900}});
  await page.goto("http://127.0.0.1:1421");await page.getByText("Load demo data").click();await page.waitForSelector(".boxlayer path.box");
  const result=await page.evaluate(async()=>{
    const api=await import("/src/lib/api.ts"), {figureBox}=await import("/src/charts/figures.ts"),{useStore}=await import("/src/store.ts");
    const url=performance.getEntriesByType("resource").find(r=>r.name.includes("/deps/plotly__js-dist-min.js?"))?.name;
    const Plotly=(await import(url)).default;
    const data=structuredClone(await api.boxPlot({test:0,xAxis:"wafer",filter:useStore.getState().filters}));
    const g=data.groups[0],n=30000;
    const top=g.summary.q3+20*(g.summary.q3-g.summary.q1);
    g.values=Array.from({length:n},(_,i)=>top+i*0.000001);g.xs=Array.from({length:n},(_,i)=>i%100);g.ys=Array.from({length:n},(_,i)=>Math.floor(i/100));
    data.groups=[g];
    const spec={...useStore.getState().spec,showPoints:"outliers",presentation:false};
    const figure=figureBox(data,{spec,theme:"light"});
    const generated=figure.data.find(t=>t.mode==="markers");
    const originalValues=[...generated.y], originalHover=JSON.stringify(generated.customdata);
    const timings={};
    for(const mode of ["scatter","scattergl"]){
      const host=document.createElement("div");host.style.cssText="width:1000px;height:600px";document.body.replaceChildren(host);
      const copy=structuredClone(figure);for(const t of copy.data)if(t.mode==="markers")t.type=mode;
      const start=performance.now();await Plotly.newPlot(host,copy.data,copy.layout,{displayModeBar:false});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      timings[mode]=performance.now()-start;
      Plotly.purge(host);
    }
    return {timings,type:generated.type,count:generated.y.length,hoverCount:generated.customdata.length,
      unchanged:generated.y.every((v,i)=>v===originalValues[i])&&originalHover===JSON.stringify(generated.customdata),
      median:figure.data[0].median[0],expectedMedian:g.summary.median,symbol:generated.marker.symbol};
  });
  assert.equal(result.type,"scattergl");assert.equal(result.count,30000);assert.equal(result.hoverCount,30000);
  assert.ok(result.unchanged);assert.equal(result.median,result.expectedMedian);assert.equal(result.symbol,"cross-thin");
  console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
