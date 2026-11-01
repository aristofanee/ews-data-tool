import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","1421"],{stdio:"ignore",windowsHide:true});
let browser;
try {
  for(let i=0;i<80;i++){try{if((await fetch("http://127.0.0.1:1421")).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");await page.getByText("Load demo data").click();await page.waitForSelector(".boxlayer path.box");
  const result=await page.evaluate(async()=>{
    const api=await import("/src/lib/api.ts"),{figureBox}=await import("/src/charts/figures.ts"),{useStore}=await import("/src/store.ts");
    const url=performance.getEntriesByType("resource").find(r=>r.name.includes("/deps/plotly__js-dist-min.js?"))?.name,Plotly=(await import(url)).default;
    const d=await api.boxPlot({test:0,xAxis:"wafer",filter:useStore.getState().filters});
    const spec={...useStore.getState().spec,presentation:false},fig=figureBox(d,{spec,theme:"light"});
    const boxes=fig.data.filter(t=>t.type==="box"),points=fig.data.filter(t=>t.mode==="markers");
    const expected=d.groups.map(g=>g.summary),stats=boxes.every((b,i)=>b.q1[0]===expected[i].q1&&b.q3[0]===expected[i].q3&&b.median[0]===expected[i].median&&b.lowerfence[0]===expected[i].whiskerLo&&b.upperfence[0]===expected[i].whiskerHi);
    const reference=[];
    for(const t of fig.data){
      if(t.type==="box")reference.push(t);
      else for(let x=0;x<50;x++){const indexes=t.x.flatMap((v,i)=>Math.round(v)===x?[i]:[]);if(indexes.length){const copy={...t};for(const key of ["x","y","customdata"])copy[key]=indexes.map(i=>t[key][i]);reference.push(copy);}}
    }
    const host=document.createElement("div");host.style.cssText="position:fixed;inset:0;width:1000px;height:650px;z-index:1000;background:white";document.body.append(host);
    const times={};let calculated;
    for(const [name,data] of [["separate",reference],["batched",fig.data]]){
      const start=performance.now();await Plotly.newPlot(host,structuredClone(data),structuredClone(fig.layout),{displayModeBar:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));times[name]=performance.now()-start;
      if(name==="batched"){
        calculated=host.calcdata.slice(0,boxes.length).flatMap(cd=>cd.map(p=>({median:p.med,q1:p.q1,q3:p.q3})));
        Plotly.Fx.hover(host,[{curveNumber:3,pointNumber:0}]);
        await new Promise(r=>setTimeout(r,50));
        times.hoverLabel=host.querySelector(".hoverlayer")?.textContent ?? "";
      }
      Plotly.purge(host);
    }
    host.remove();return {times,stats,calculated,expected:expected.map(s=>({median:s.median,q1:s.q1,q3:s.q3})),traces:fig.data.length,boxes:boxes.length,points:points.reduce((n,t)=>n+t.y.length,0),pointRows:points.reduce((n,t)=>n+t.customdata.length,0)};
  });
  assert.ok(result.stats);assert.deepEqual(result.calculated,result.expected);assert.equal(result.boxes,50);assert.equal(result.traces,51);assert.equal(result.points,result.pointRows);assert.match(result.times.hoverLabel,/L24-0417 \/ 04/);
  await page.evaluate(()=>{window.originalBoxHost=document.querySelector(".chart-body .plotly-host");});
  await page.keyboard.press("ArrowDown");await page.waitForFunction(()=>document.querySelector(".chart-title")?.value.includes("Idsat"));
  await page.waitForFunction(()=>document.querySelectorAll(".boxlayer path.box").length===50&&document.querySelector(".plotly-host").style.visibility==="visible");
  assert.ok(await page.evaluate(()=>window.originalBoxHost===document.querySelector(".chart-body .plotly-host")));
  await page.locator(".tab").filter({hasText:"Scatter"}).click();await page.getByRole("combobox",{name:"Y test"}).click();
  const dropdown=await page.getByRole("listbox",{name:"Y test matches"}).boundingBox();
  const field = await page.getByRole("combobox",{name:"Y test"}).boundingBox();
  assert.ok(dropdown.width>=field.width&&dropdown.width<400);assert.ok(dropdown.x>=0&&dropdown.x+dropdown.width<=1536);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({times:result.times,traces:result.traces,boxes:result.boxes,points:result.points,statsMatch:true,hostReused:true,dropdown,errors},null,2));
}finally{await browser?.close();server.kill();}
