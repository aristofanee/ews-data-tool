import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:2278,height:1109}});await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(async()=>{const {useStore}=await import('/src/store.ts');window.S=useStore;useStore.getState().setPlotType('scatter');useStore.getState().selectTest(2);useStore.getState().patchSpec({scatterY:1,scatterZTest:1});});await page.waitForFunction(()=>document.querySelector('.plotly-host')?._fullData?.some(t=>t.mode==='markers'));
 const sizes=[];for(const changes of [{groupBy:'wafer'},{scatterZMode:'continuous'},{scatterZMode:'none'},{scatterZMode:'continuous'},{groupBy:'none'},{groupBy:'wafer'},{groupBy:'none'},{groupBy:'wafer'}]){
  await page.evaluate(p=>window.S.getState().patchSpec(p),changes);await page.waitForTimeout(1000);
  sizes.push(await page.locator('.plotly-host').first().evaluate(el=>({height:el.clientHeight,size:el._fullLayout?._size,bars:[...el.querySelectorAll('.colorbar')].map(b=>({class:b.getAttribute('class'),rect:b.getBoundingClientRect().toJSON()})),scale:el._fullData?.filter(t=>t.marker?.showscale).length})));
 }
 mkdirSync('shots/scatter-layout',{recursive:true});await page.screenshot({path:'shots/scatter-layout/grouped-z.png'});
 for(const s of sizes){assert.ok(s.size.h>s.height*.45,`Plot collapsed to ${s.size.h}/${s.height}`);assert.equal(s.bars.length,s.scale);assert.ok(s.size.r<250,'Stale vertical colourbar consumed the right margin');for(const bar of s.bars)assert.ok(bar.rect.height<800,'Stale colourbar axes remain');}
 console.log(JSON.stringify({transitions:sizes.length,plotHeights:sizes.map(s=>s.size.h),singleColourbar:true,stableMargins:true},null,2));
}finally{await browser?.close();server.kill();}
