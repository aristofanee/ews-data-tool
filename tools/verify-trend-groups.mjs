import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], {stdio:"ignore", windowsHide:true});
let browser;
try {
  for (let i=0;i<80;i++) { try { if ((await fetch("http://127.0.0.1:1421")).ok) break; } catch {} await new Promise(r=>setTimeout(r,250)); }
  browser = await chromium.launch({channel:"msedge",headless:true});
  const page = await browser.newPage({viewport:{width:1536,height:960}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:1421"); await page.getByText("Load demo data").click(); await page.waitForSelector(".boxlayer path.box");
  const result = await page.evaluate(async () => {
    const api = await import("/src/lib/api.ts"), {useStore} = await import("/src/store.ts");
    const {figureTrend} = await import("/src/charts/figures.ts"), {binColor} = await import("/src/lib/theme.ts");
    const info = await api.addCustomColumn("Split", useStore.getState().info.wafers.map((_,wafer)=>({wafer,label:wafer%2 ? "B" : "A"})));
    useStore.setState({info});
    const state=useStore.getState(), checks=[];
    for (const [by,groupBy] of [["site","wafer"],["wafer","lot"],["hbin","site"],["site","none"],["site",state.info.customColumns[0].name]]) {
      const t=await api.trend({test:0,by,groupBy,filter:state.filters});
      const b=await api.boxPlot({test:0,xAxis:by,groupBy,filter:state.filters});
      if (t.points.length!==b.groups.length || !t.points.every(p=>b.groups.some(g=>g.xLabel===p.label&&g.groupLabel===p.groupLabel&&g.summary.mean===p.mean&&g.summary.sd===p.sd&&g.summary.n===p.n))) throw Error("Trend summary mismatch");
      const spec={...state.spec,type:"trend",xAxis:by,groupBy,splitPlots:false,showBand:true};
      const f=figureTrend(t,{spec,theme:"light"});
      const lines=f.data.filter(t=>t.mode==="lines+markers");
      if (f.layout.showlegend || lines.reduce((n,t)=>n+t.x.length,0)!==t.points.length) throw Error("Missing points or wrong legend");
      if (new Set(lines.flatMap(t=>t.x)).size!==t.points.length) throw Error("Overlapping categories");
      if (lines.some(t=>new Set(t.customdata.map(d=>d[3])).size!==1)) throw Error("Line crosses groups");
      const labels=[...new Set(t.points.map(p=>p.groupLabel).filter(Boolean))];
      if(groupBy!=="none"&&labels.some(l=>!f.layout.annotations.some(a=>a.text===l||a.text===l.split(" / ").at(-1)))) throw Error("Missing heading");
      if(labels.length) {
        const preview=figureTrend(t,{spec,theme:"light",preview:true,facetLabel:labels[0]});
        if(!preview.layout.xaxis.title.text||!preview.layout.yaxis.title.text) throw Error("Missing preview axis labels");
      }
      checks.push({by,groupBy,points:t.points.length,groups:lines.length});
    }
    return {checks,colors:Object.fromEntries([1,2,3,5,8,65535].map(c=>[c,binColor(c)]))};
  });
  assert.equal(new Set(Object.values(result.colors)).size,6);
  await page.locator(".tab").filter({hasText:"Trend"}).click();
  const section=page.locator(".insp-section").filter({has:page.locator(".insp-title",{hasText:/^Trend$/})});
  await section.locator(".field").filter({hasText:"X axis"}).locator("select").selectOption("site");
  await section.locator(".field").filter({hasText:"Group by"}).locator("select").selectOption("wafer");
  await page.waitForFunction(()=>document.querySelector(".chart-body .js-plotly-plot")?.data?.filter(t=>t.mode==="lines+markers").length===50);
  await section.getByText("Split into different plots",{exact:true}).click();
  await page.waitForSelector(".facet-card .js-plotly-plot");
  assert.equal(await page.locator(".facet-card").count(),50);
  await page.locator(".facet-card").first().click(); await page.waitForSelector(".facet-detail .js-plotly-plot");
  await page.waitForFunction(()=>document.querySelector(".facet-detail .js-plotly-plot")?.data?.some(t=>t.mode==="lines+markers"&&t.x.length===4));
  const selected=await page.locator(".facet-detail-title").textContent();
  const exportSize=await page.evaluate(async()=>{
    const url=performance.getEntriesByType("resource").find(r=>r.name.includes("/deps/plotly__js-dist-min.js?"))?.name;
    const Plotly=(await import(url)).default;
    return (await Plotly.toImage(document.querySelector(".facet-detail .js-plotly-plot"),{format:"png",width:1000,height:650})).length;
  });
  assert.ok(exportSize>10000);
  await page.locator(".tab").filter({hasText:"Histogram"}).click();
  await page.locator(".tab").filter({hasText:"Trend"}).click();
  await page.waitForSelector(".facet-detail .js-plotly-plot");
  assert.equal(await page.locator(".facet-detail-title").textContent(),selected);
  await page.getByRole("button",{name:"All plots",exact:true}).click(); await page.waitForSelector(".facet-card .js-plotly-plot");
  await page.screenshot({path:"shots/trend-grouped-previews.png"});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...result,facets:50,selectedRestored:selected,exportSize,errors},null,2));
} finally { await browser?.close(); server.kill(); }
