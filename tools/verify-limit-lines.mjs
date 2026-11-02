import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const checks=[];
 for(const type of ['box','hist','trend']){
  await page.evaluate(async type=>{const{useStore}=await import('/src/store.ts');const s=useStore.getState();s.setPlotType(type);s.selectTest(0);s.patchSpec({groupBy:'none',splitPlots:false,limitMode:'spec',showLimits:true,lsl:0.38,usl:0.44,scatterY:0});},type);
  const axis=type==='hist'?'xaxis':'yaxis';
  await page.waitForFunction(axis=>{const g=document.querySelector('.js-plotly-plot');return Math.abs(g?._fullLayout?.[axis]?.range?.[0]-.38)<1e-10;},axis);
  const result=await page.evaluate(async axis=>{const g=document.querySelector('.js-plotly-plot');const shapes=()=>[...g.querySelectorAll('.shape-group')].filter(e=>g._fullLayout.shapes[Number(e.dataset.index)]?.name==='ews-spec-limit');const clips=()=>shapes().map(e=>e.getAttribute('clip-path'));const before=clips(),range=[...g._fullLayout[axis].range];const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?')).name;const P=(await import(url)).default;
   await P.relayout(g,{[axis+'.range']:[.39,.43]});const zoomed=clips();await P.relayout(g,{[axis+'.range']:[.38,.44]});const reset=clips();return {range,before,zoomed,reset};},axis);
  assert.equal(result.before.length,2);assert.ok(result.before.every(c=>c==='none'));assert.ok(result.zoomed.every(c=>c!=='none'));assert.ok(result.reset.every(c=>c==='none'));assert.deepEqual(result.range,[.38,.44]);checks.push({type,...result});
 }
 // Log axes retain raw limit values and use log10 only for boundary comparison.
 await page.evaluate(async()=>{const{useStore}=await import('/src/store.ts');useStore.getState().setPlotType('box');useStore.getState().patchSpec({logY:true,limitMode:'spec',lsl:.38,usl:.44});});
 await page.waitForFunction(()=>document.querySelector('.js-plotly-plot')?._fullLayout?.yaxis?.type==='log');
 assert.equal(await page.locator('.shape-group[clip-path="none"]').count(),2);
 // Capture export axis styling at the renderer boundary and write an actual image.
 await page.evaluate(async()=>{window.exports=[];window.copied=null;const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?')).name;const P=(await import(url)).default,original=P.newPlot;P.newPlot=async function(host,data,layout,...rest){if(host.style.left==='-30000px')window.exports.push(structuredClone(layout));return original.call(this,host,data,layout,...rest);};Object.defineProperty(navigator,'clipboard',{value:{write:async items=>{const blob=await items[0].getType('image/png');window.copied=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});}},configurable:true});const{useStore}=await import('/src/store.ts');useStore.getState().setPlotType('pareto');useStore.getState().patchSpec({xAxis:'wafer',groupBy:'none',splitPlots:false});});
 await page.waitForFunction(()=>!!document.querySelector('.js-plotly-plot')?._fullLayout?.yaxis2);await page.getByTitle('Copy image to clipboard',{exact:true}).click();await page.waitForFunction(()=>!!window.copied);
 const exported=await page.evaluate(()=>({layout:window.exports.at(-1),url:window.copied}));const y=exported.layout.yaxis2;assert.equal(y.tickfont.color,'#16c55e');assert.equal(y.title.font.color,y.tickfont.color);assert.equal(y.linecolor,y.tickfont.color);assert.equal(y.tickcolor,y.tickfont.color);assert.equal(exported.layout.yaxis.tickfont.color,'#000000');
 mkdirSync('shots/export-actions-review',{recursive:true});writeFileSync('shots/export-actions-review/pareto-green.png',Buffer.from(exported.url.split(',')[1],'base64'));assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,log:true,yieldColor:y.tickfont.color,errors},null,2));
}finally{await browser?.close();server.kill();}
