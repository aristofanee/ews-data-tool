import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const result=await page.evaluate(async()=>{
  const {useStore}=await import('/src/store.ts'),api=await import('/src/lib/api.ts'),F=await import('/src/charts/figures.ts'),{keepMask,summarize}=await import('/src/lib/stats.ts');
  const s=useStore.getState(),filter={...s.filters,wafers:[0,1,25]},req={xTest:0,yTest:1,zMode:'continuous',zTest:2,groupBy:'wafer',filter};
  const sparse=await api.scatter({...req,maxPoints:1}),full=await api.scatter({...req,maxPoints:100000});
  if(JSON.stringify(sparse.statistics)!==JSON.stringify(full.statistics)||JSON.stringify(sparse.groupStatistics)!==JSON.stringify(full.groupStatistics))throw new Error('Sampling changed scatter statistics');
  if(sparse.zMin!==full.zMin||sparse.zMax!==full.zMax)throw new Error('Sampling changed Z colour limits');
  const spec={...s.spec,type:'scatter',scatterX:0,scatterY:1,scatterZMode:'continuous',scatterFit:true,limitMode:'sigma',limitK:2,groupBy:'wafer'},fig=F.figureScatter(sparse,{theme:'light',spec});
  const fit=fig.layout.shapes.find(s=>s.type==='line'&&s.line.dash!=='dash'),stats=sparse.statistics;
  if(Math.abs((fit.y1-fit.y0)/(fit.x1-fit.x0)-stats.fit.slope)>1e-8)throw new Error('Fit did not use full statistics');
  const mean=stats.summary.mean,sd=stats.summary.sd;if(Math.abs(fig.layout.yaxis.range[0]-(mean-2*sd))>1e-9)throw new Error('Range did not use full statistics');
  const group=sparse.series[1],groupStats=sparse.groupStatistics[group.name],facet=F.figureScatter(sparse,{theme:'light',spec,facetKey:group.key});
  if(!facet.layout.annotations.some(a=>a.text===`R² = ${(groupStats.fit.r**2).toFixed(3)}`))throw new Error('Facet R² used the global population');
  const sf={kind:'sigma',k:1,perWafer:true},filtered=await api.scatter({...req,filter:{...filter,stat:sf},maxPoints:100000});
  let expected=0;for(const series of full.series){const a=keepMask(series.points.map(p=>p.x),'sigma',1),b=keepMask(series.points.map(p=>p.y),'sigma',1);expected+=a.filter((v,i)=>v&&b[i]).length;}
  if(filtered.total!==expected)throw new Error(`Per-wafer filtering differs: ${filtered.total} vs ${expected}`);
  const trend=await api.trend({test:0,by:'wafer',groupBy:'none',filter}),m=summarize(trend.points.map(p=>p.mean));
  for(const mode of ['sigma','iqr']){const t=F.figureTrend(trend,{theme:'light',spec:{...s.spec,type:'trend',groupBy:'none',limitMode:mode,limitK:2}});const lo=mode==='sigma'?m.mean-2*m.sd:m.q1-2*(m.q3-m.q1);if(Math.abs(t.layout.yaxis.range[0]-lo)>1e-10)throw new Error(`Trend ${mode} statistics are wrong`);}
  return {sampleMarkers:sparse.series.reduce((n,s)=>n+s.points.length,0),fullPopulation:full.total,fullStatistics:true,groupStatistics:true,zRange:true,perWaferFiltered:filtered.total,trendRanges:true};
 });
 await page.evaluate(async()=>{window.S=(await import('/src/store.ts')).useStore;const s=window.S.getState();s.patchFilters({wafers:[0,1,25]});s.patchSpec({groupBy:'wafer',splitPlots:true,limitMode:'sigma',limitK:1});});
 await page.waitForSelector('.facet-card');await page.locator('.facet-card').first().click();await page.getByRole('button',{name:'All plots',exact:true}).waitFor();
 const before=await page.locator('.plotly-host').first().evaluate(el=>el._fullLayout.yaxis.range);
 await page.evaluate(()=>window.S.getState().patchSpec({limitK:4}));await page.waitForTimeout(500);assert.equal(await page.getByRole('button',{name:'All plots',exact:true}).count(),1,'Changing range closed the selected group');
 const after=await page.locator('.plotly-host').first().evaluate(el=>el._fullLayout.yaxis.range);assert.notDeepEqual(after,before);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,rangeKeepsOpenedGroup:true,errors},null,2));
}finally{await browser?.close();server.kill();}
