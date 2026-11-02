import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(async()=>{window.S=(await import('/src/store.ts')).useStore;});const results=[];
 for(const type of ['box','hist','scatter','trend'])for(const mode of ['sigma','iqr']){
  await page.evaluate(({type,mode})=>{const s=window.S.getState();s.setPlotType(type);s.patchSpec({limitMode:mode,limitK:1});},{type,mode});await page.waitForTimeout(500);
  const geometry=()=>page.locator('.chart-body .plotly-host').first().evaluate((el,axis)=>({actual:el._fullLayout[axis].range,requested:el.layout[axis].range}),type==='hist'?'xaxis':'yaxis');
  const a=await geometry();await page.evaluate(()=>window.S.getState().patchSpec({limitK:4}));await page.waitForTimeout(500);const b=await geometry();
  assert.notDeepEqual(a.actual,b.actual,`${type}/${mode}: k did not change the visible range`);
  for(const [i,v]of b.requested.entries())assert.ok(Math.abs(b.actual[i]-v)<1e-8,`${type}/${mode}: cached range overwrote the requested range`);
  assert.ok(b.actual[1]-b.actual[0]>a.actual[1]-a.actual[0],`${type}/${mode}: larger k did not widen range`);
  // The same configured view should still restore its range after a tab change.
  await page.evaluate(type=>{window.S.getState().setPlotType(type==='box'?'trend':'box');},type);await page.waitForTimeout(200);await page.evaluate(type=>window.S.getState().setPlotType(type),type);await page.waitForTimeout(300);assert.deepEqual((await geometry()).actual,b.actual);
  results.push({type,mode,initial:a.actual,updated:b.actual});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:results,errors},null,2));
}finally{await browser?.close();server.kill();}
