import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const checks=await page.evaluate(async()=>{
  const api=await import('/src/lib/api.ts'),{useStore}=await import('/src/store.ts');window.S=useStore;const filter=useStore.getState().filters,results=[];
  for(const [test,f]of [[0,filter],[1,filter],[3,{...filter,wafers:[0,1,25],hbins:[1]}],[0,{...filter,wafers:[0,1,25],stat:{kind:'sigma',k:2,perWafer:true}}],[2,{...filter,wafers:[0,1,25],stat:{kind:'sigma',k:2,perWafer:false}}]]){
   const req={test,wafer:null,mode:'value',filter:f},all=await api.waferMap(req),single=await api.waferMaps(req),expected=new Map();
   for(const m of single)for(const d of m.dice){const key=`${d.x},${d.y}`,a=expected.get(key)??{sum:0,n:0};a.sum+=d.v;a.n++;expected.set(key,a);}
   if(all.dice.length!==expected.size)throw new Error('Mean lost coordinates');let maxRelativeError=0;
   for(const d of all.dice){const a=expected.get(`${d.x},${d.y}`),v=a.sum/a.n,error=Math.abs(d.v-v)/Math.max(Math.abs(v),1e-30);maxRelativeError=Math.max(maxRelativeError,error);if(error>1e-12)throw new Error(`Incorrect mean at ${d.x},${d.y}: ${d.v} vs ${v}`);}
   results.push({test,wafers:single.length,coordinates:all.dice.length,maxRelativeError});
  }
  useStore.getState().setPlotType('map');useStore.getState().patchSpec({groupBy:'none'});return results;
 });
 await page.waitForSelector('.map-canvas');
 const hover=async()=>{const canvas=page.locator('.map-canvas').first(),b=await canvas.boundingBox();for(let dx=0;dx<40;dx+=4){await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+3);if(await page.locator('.map-tip').count())return page.locator('.map-tip').innerText();}throw new Error('No die tooltip found');};
 assert.doesNotMatch(await hover(),/HBIN|SBIN/);
 await page.evaluate(()=>window.S.getState().patchSpec({groupBy:'wafer'}));await page.waitForSelector('.binmap-open');await page.locator('.binmap-open').first().click();await page.getByRole('button',{name:'All maps',exact:true}).waitFor();assert.match(await hover(),/HBIN/);
 console.log(JSON.stringify({checks,meanHoverOmitsBins:true,singleWaferHoverKeepsBins:true},null,2));
}finally{await browser?.close();server.kill();}
