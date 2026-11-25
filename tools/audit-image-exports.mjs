// Audit the actual clipboard image path without touching the system clipboard.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const folder='shots/image-export-audit';mkdirSync(folder,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try {
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(async()=>{
  const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?'))?.name;
  const P=(await import(url)).default;window.auditPlotly=P;window.auditExports=[];window.auditImages=[];window.auditCanvasCalls=[];window.auditMaps=[];
  const original=P.newPlot;
  P.newPlot=async function(host,data,layout,config){
   const result=await original.call(this,host,data,layout,config);
   if(host.style.left==='-30000px')window.auditExports.push({title:layout.title?.text,width:host._fullLayout.width,height:host._fullLayout.height,points:data.reduce((n,t)=>n+(t.x?.length??0),0),range:host._fullLayout.xaxis.range,annotations:host._fullLayout.annotations.map(a=>a.text),titleRight:host.querySelector(".gtitle")?.getBoundingClientRect().right-host.getBoundingClientRect().left,visible:data.map(t=>t.visible??true)});
   return result;
  };
  const fillText=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.width===2400&&this.canvas.height===1500){this.canvas.auditTexts??=[];this.canvas.auditTexts.push(String(text));}return fillText.call(this,text,...args);};
  const toDataURL=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...args){if(args[0]==='image/jpeg')window.auditCanvasCalls.push(args);if(this.width===2400&&this.height===1500&&this.auditTexts)window.auditMaps.push([...this.auditTexts]);return toDataURL.apply(this,args);};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items)=>{
   for(const item of items){const blob=await item.getType('image/png');const url=await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.readAsDataURL(blob);});
    const img=new Image();img.src=url;await img.decode();window.auditImages.push({url,width:img.width,height:img.height});}
  }}});
 });
 const results=[];
 const set=async(type,patch={})=>{
  await page.evaluate(async({type,patch})=>{const {useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({splitPlots:false,groupBy:'none',...patch});},{type,patch});
  await page.waitForTimeout(450);
 };
 const copy=async(name)=>{
  const n=await page.evaluate(()=>window.auditImages.length);const counts=await page.evaluate(()=>({plots:window.auditExports.length,maps:window.auditMaps.length}));await page.getByTitle('Copy image to clipboard',{exact:true}).click();
  await page.waitForFunction(n=>window.auditImages.length>n,n,{timeout:60000});
  const image=await page.evaluate(()=>window.auditImages.at(-1));writeFileSync(`${folder}/${name}.png`,Buffer.from(image.url.split(',')[1],'base64'));
  const meta=await page.evaluate(c=>({plotly:window.auditExports.length>c.plots?window.auditExports.at(-1):null,mapHeaders:window.auditMaps.slice(c.maps).map(t=>t.slice(0,2))}),counts);return {name,width:image.width,height:image.height,...meta};
 };
 for(const type of ['box','hist','scatter','trend','pareto','map','binmap']){
  await set(type,type==='box'?{showPoints:'all'}:{});if(type==='binmap')await page.waitForSelector('.binmap-open');
  results.push(await copy(type));
 }
 await set('box',{xAxis:'site',groupBy:'wafer',splitPlots:true});await page.waitForSelector('.facet-card .js-plotly-plot');
 await page.locator('.facet-card').nth(2).click();await page.waitForSelector('.facet-detail .js-plotly-plot');
 const selected=await page.locator('.facet-detail-title').textContent();const split=await copy('box-selected-third');
 results.push({...split,selected,exportedTitle:split.plotly.title});
 await set('pareto',{groupBy:'wafer'});await page.waitForSelector('.facet-card .js-plotly-plot');await page.locator('.facet-card').nth(2).click();await page.waitForSelector('.facet-detail .js-plotly-plot');
 const selectedPareto=await page.locator('.facet-detail-title').textContent();const pareto=await copy('pareto-selected-third');results.push({...pareto,selected:selectedPareto,exportedTitle:pareto.plotly.title});
 await set('map',{groupBy:'wafer'});await page.waitForSelector('.binmap-open');await page.locator('.binmap-open').nth(2).click();await page.waitForSelector('.map-canvas:not(.preview)');
 const selectedMap=await page.locator('.map-detail-title').textContent();const map=await copy('map-selected-third');results.push({...map,selected:selectedMap});
 await set('box',{xAxis:'wafer',title:'LONG '+('leakage current under extremely long test condition description / '.repeat(7))});
 results.push(await copy('box-long-title'));
 await set('box',{title:'Zoomed and hidden trace audit',xAxis:'wafer'});
 await page.evaluate(async()=>{const g=document.querySelector('.chart-body .plotly-host');await window.auditPlotly.relayout(g,{'xaxis.range':[10,15],'xaxis.autorange':false});await window.auditPlotly.restyle(g,{visible:'legendonly'},[0]);});
 const visible=await page.evaluate(()=>{const g=document.querySelector('.chart-body .plotly-host');return {range:g._fullLayout.xaxis.range,firstVisible:g.data[0].visible};});
 const reset=await copy('box-zoomed-hidden');results.push({...reset,onScreen:visible});
 const encoding=await page.evaluate(async()=>{
  const P=window.auditPlotly,g=document.querySelector('.chart-body .plotly-host');window.auditCanvasCalls=[];
  const a=await P.toImage(g,{format:'jpeg',width:800,height:500,scale:1,quality:0.1});
  const b=await P.toImage(g,{format:'jpeg',width:800,height:500,scale:1,quality:0.96});
  return {qualityArgumentsChangeOutput:a!==b,canvasCalls:window.auditCanvasCalls};
 });
 const toolbar=await page.evaluate(async()=>{
  const {useStore}=await import('/src/store.ts');if(useStore.getState().theme==='light')useStore.getState().toggleTheme();
  await new Promise(r=>setTimeout(r,300));const g=document.querySelector('.chart-body .plotly-host');
  return {title:g._fullLayout.title.text,background:g._fullLayout.paper_bgcolor,options:g._context.toImageButtonOptions};
 });
 const filenames=await page.evaluate(async()=>{const {safeName}=await import('/src/lib/format.ts');return ['A/B','A:B'].map(v=>safeName(v));});
 writeFileSync(`${folder}/result.json`,JSON.stringify({results,encoding,filenames,toolbar,errors},null,2));
 writeFileSync(`${folder}/gallery.html`,'<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;background:#eee}figure{background:white;margin:16px;padding:12px}img{width:100%;max-width:1100px}figcaption{padding:8px}</style>'+results.map(r=>`<figure><figcaption>${r.name}: ${r.width} × ${r.height}</figcaption><img src="${r.name}.png"></figure>`).join(''));
 console.log(JSON.stringify({results,encoding,filenames,toolbar,errors},null,2));
 assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();}
