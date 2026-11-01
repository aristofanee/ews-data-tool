import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});
let browser;
try {
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const results=[];
 for(const type of ['box','hist','scatter','trend','pareto']) {
  await page.evaluate(async(type)=>{const {useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({splitPlots:false,groupBy:'none',logY:type==='hist'});},type);
  await page.waitForFunction(()=>{const g=document.querySelector('.chart-body .plotly-host');return g?.style.visibility==='visible'&&g?._fullLayout&&g.data?.length;});await page.waitForTimeout(200);
  const before=await page.evaluate(()=>{const l=document.querySelector('.chart-body .plotly-host')._fullLayout;return {x:[...l.xaxis.range],y:[...l.yaxis.range],mode:l.dragmode,y2:l.yaxis2?.range};});
  const r=await page.locator('.chart-body .nsewdrag').first().boundingBox();
  await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down({button:'middle'});await page.mouse.move(r.x+r.width*.6,r.y+r.height*.6,{steps:8});await page.mouse.up({button:'middle'});await page.waitForTimeout(150);
  const after=await page.evaluate(()=>{const l=document.querySelector('.chart-body .plotly-host')._fullLayout;return {x:[...l.xaxis.range],y:[...l.yaxis.range],mode:l.dragmode,y2:l.yaxis2?.range};});
  assert.notDeepEqual(after.x,before.x,type+' x panned');assert.notDeepEqual(after.y,before.y,type+' y panned');assert.equal(after.mode,before.mode);
  for(const key of ['x','y'])assert.ok(Math.abs((after[key][1]-after[key][0])-(before[key][1]-before[key][0]))<1e-6,type+' preserves zoom');
  if(before.y2)assert.notDeepEqual(after.y2,before.y2);
  results.push({type,panned:true,modeUnchanged:true});
 }
 const zoomBefore=await page.evaluate(()=>[...document.querySelector('.chart-body .plotly-host')._fullLayout.xaxis.range]);
 const drag=await page.locator('.chart-body .nsewdrag').first().boundingBox();
 await page.mouse.move(drag.x+drag.width*.2,drag.y+drag.height*.2);await page.mouse.down();await page.mouse.move(drag.x+drag.width*.7,drag.y+drag.height*.7,{steps:8});await page.mouse.up();await page.waitForTimeout(150);
 const zoomAfter=await page.evaluate(()=>[...document.querySelector('.chart-body .plotly-host')._fullLayout.xaxis.range]);
 assert.ok(zoomAfter[1]-zoomAfter[0]<zoomBefore[1]-zoomBefore[0], 'left drag still zooms');
 for(const type of ['map','binmap']) {
  await page.evaluate(async(type)=>{const {useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({groupBy:'none',splitPlots:false});},type);
  if(type==='binmap'){await page.waitForSelector('.binmap-open');await page.locator('.binmap-open').first().click();}
  const canvas=page.locator('.map-canvas:not(.preview)');await canvas.waitFor();await page.waitForTimeout(200);
  const r=await canvas.boundingBox();await page.mouse.move(r.x+r.width*.35,r.y+r.height*.5);await page.mouse.wheel(0,-500);await page.waitForTimeout(150);
  const before=await canvas.evaluate(c=>c.toDataURL());
  await page.mouse.down({button:'middle'});await page.mouse.move(r.x+r.width*.45,r.y+r.height*.6,{steps:8});await page.mouse.up({button:'middle'});await page.waitForTimeout(150);
  assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),before,type+' middle pan');
  results.push({type,panned:true});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors},null,2));
}finally{await browser?.close();server.kill();}
