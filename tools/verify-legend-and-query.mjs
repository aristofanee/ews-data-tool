import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","1421"],{stdio:"ignore",windowsHide:true});
let browser;
try {
  for(let i=0;i<80;i++){try{if((await fetch("http://127.0.0.1:1421")).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage();
  await page.goto("http://127.0.0.1:1421");await page.getByText("Load demo data").click();await page.waitForSelector(".boxlayer path.box");
  const results=await page.evaluate(async()=>{
    const mock=await import("/src/lib/mock.ts"),api=await import("/src/lib/api.ts"),{useStore}=await import("/src/store.ts");
    const times=[];
    for(let test=0;test<6;test++){
      const start=performance.now();const data=await mock.boxPlot({test,xAxis:"wafer",filter:useStore.getState().filters});
      times.push({test,ms:performance.now()-start,n:data.summary.n,positiveIdentical:data.groups.every(g=>!g.values.every(v=>v>0)||JSON.stringify(g.summary)===JSON.stringify(g.positiveSummary))});
    }
    const {WaferMapRenderer}=await import("/src/charts/waferMap.ts");
    const data=await api.waferMap({wafer:0,test:1,mode:"value",filter:useStore.getState().filters});
    const canvas=document.createElement("canvas"),fills=[],original=CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.fillStyle==="#ffffff"&&w<900&&h<650)fills.push({x,y,w,h});return original.call(this,x,y,w,h);};
    const r=new WaferMapRenderer(canvas);r.setSize(900,650);r.setData(data,{theme:"dark",mode:"bin",palette:"brand",lsl:null,usl:null,showLegend:true,presentation:false});
    CanvasRenderingContext2D.prototype.fillRect=original;
    const panel=fills.at(-1);return {times,panel};
  });
  assert.ok(results.times.every(t=>t.positiveIdentical));assert.ok(results.panel.h<400,"bin panel must fit its short legend");assert.ok(results.panel.w<300);
  console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();server.kill();}
