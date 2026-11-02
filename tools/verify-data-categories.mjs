import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 assert.equal(await page.locator('.data-categories-panel').count(),0);
 const option=page.locator('select option[value="data:text:Probe mode"]').first();assert.equal(await option.count(),1);assert.equal(await option.evaluate(el=>el.parentElement.tagName),'SELECT');
 const result=await page.evaluate(async()=>{
  const {useStore}=await import('/src/store.ts'),api=await import('/src/lib/api.ts'),R=await import('/src/lib/reportReferences.ts'),{dataGroups}=await import('/src/lib/grouping.ts');window.S=useStore;
  const s=useStore.getState(),info=s.info,filter=s.filters,id='data:text:Probe mode';
  const groups=dataGroups(info,filter,id);if(groups.length!==3)throw new Error('Expected three category facets');
  const box=await api.boxPlot({test:0,xAxis:id,groupBy:id,filter,maxPoints:10});
  const hist=await api.histogram({test:0,groupBy:id,filter});const trend=await api.trend({test:0,by:id,groupBy:id,filter});const scatter=await api.scatter({xTest:0,yTest:1,zMode:'none',groupBy:id,filter,maxPoints:5});const pareto=await api.pareto({category:'hard',groupBy:id,filter});
  for(const [name,count]of Object.entries({box:box.groups.length,histogram:hist.groups.length,scatter:scatter.series.length,pareto:pareto.groups.length})){if(count!==3)throw new Error(`${name} lost categories: ${count}`);}
  if(!trend.points.length)throw new Error('Missing trend groups');
  const counts=await Promise.all(groups.map(g=>api.limitCounts({test:0,filter:g.filter,lsl:null,usl:null})));const full=await api.limitCounts({test:0,filter,lsl:null,usl:null});if(counts.reduce((n,c)=>n+c.total,0)!==full.total)throw new Error('Category filters lost or duplicated dice');
  const maps=await Promise.all(groups.map(g=>api.waferMap({test:0,wafer:0,mode:'value',filter:g.filter})));if(maps.some(m=>!m.dice.length))throw new Error('Missing category map');
  const item={id:'category-report',spec:{...s.spec,groupBy:id,splitPlots:true},filters:groups[0].filter,selection:{label:groups[0].label}};item.references=R.captureReferences(item,info);if(R.bindReportItem(item,info).issues.length)throw new Error('Valid report failed binding');
  const removed={...info,dataCategories:info.dataCategories.filter(c=>c.id!==id)};if(!R.bindReportItem(item,removed).issues.some(i=>i.kind==='category'))throw new Error('Missing category was not flagged');
  const changed={...info,dataCategories:info.dataCategories.map(c=>c.id===id?{...c,values:c.values.map(v=>v==='A'?'Other A':v),labels:c.labels.map(v=>v==='A'?'Other A':v)}:c)};if(!R.bindReportItem(item,changed).issues.some(i=>i.kind==='split'))throw new Error('Missing value was not flagged');
  const template={app:'EWS Data Tool',version:2,name:'Categories',created:new Date().toISOString(),filters:item.filters,plots:R.templatePlots([item],info),customColumns:[]};R.validateTemplate(template);if(JSON.stringify(template).includes('"codes"'))throw new Error('Template contains die assignments');
  useStore.getState().patchSpec({xAxis:'site',groupBy:id,splitPlots:true});return {counts:counts.map(c=>c.total),total:full.total,groups:box.groups.length,reportReferences:item.references.length};
 });
 await page.waitForFunction(()=>document.querySelectorAll('.facet-card').length===3);await page.locator('.facet-card').first().click();await page.getByRole('button',{name:'All plots',exact:true}).waitFor();
 for(const tab of ['Histogram','Trend']){await page.getByRole('button',{name:tab,exact:true}).click();await page.evaluate(()=>window.S.getState().patchSpec({groupBy:'data:text:Probe mode',splitPlots:true}));await page.waitForSelector('.facet-card');}
 assert.equal(await page.evaluate(()=>window.S.getState().info.tests.length),6);assert.deepEqual(errors,[]);console.log(JSON.stringify({...result,automaticFlatChoices:true,errors},null,2));
}finally{await browser?.close();server.kill();}
