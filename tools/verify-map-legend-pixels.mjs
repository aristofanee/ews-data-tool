import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const checks=[];
 for(const scale of [1,1.25,1.5,2]){
  const context=await browser.newContext({viewport:{width:1536,height:960},deviceScaleFactor:scale}),page=await context.newPage();await page.goto('http://127.0.0.1:1421');
  checks.push(...await page.evaluate(async()=>{
   const api=await import('/src/lib/api.ts'),{emptyFilter}=await import('/src/types.ts'),{WaferMapRenderer}=await import('/src/charts/waferMap.ts');
   const data=await api.waferMap({test:0,wafer:0,mode:'value',filter:emptyFilter()}),results=[];
   for(const mode of ['value','bin']){
    const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:1103.75px;height:701.25px';document.body.appendChild(canvas);
    const renderer=new WaferMapRenderer(canvas);renderer.resize();renderer.setData(data,{theme:'light',palette:'brand',mode,binCategory:'hard',lsl:null,usl:null});
    const legend=renderer.legendCanvas,box=renderer.legendBox,pixels=renderer.dpr*renderer.scale,left=Math.max(0,Math.floor(box.left*pixels)),top=Math.max(0,Math.floor(box.top*pixels)),right=Math.min(canvas.width,Math.ceil(box.right*pixels)),bottom=Math.min(canvas.height,Math.ceil(box.bottom*pixels)),width=right-left,height=bottom-top;
    const reference=document.createElement('canvas');reference.width=canvas.width;reference.height=canvas.height;const ctx=reference.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,reference.width,reference.height);ctx.drawImage(legend,0,0);
    const actual=canvas.getContext('2d').getImageData(left,top,width,height).data,expected=ctx.getImageData(left,top,width,height).data;
    const legacy=document.createElement('canvas');legacy.width=canvas.width;legacy.height=canvas.height;const old=legacy.getContext('2d');old.fillStyle='white';old.fillRect(0,0,legacy.width,legacy.height);old.setTransform(pixels,0,0,pixels,0,0);old.drawImage(legend,0,0,renderer.w,renderer.h);const previous=old.getImageData(left,top,width,height).data;
    let changed=0,legacyChanged=0;for(let i=0;i<actual.length;i++){if(actual[i]!==expected[i])changed++;if(previous[i]!==expected[i])legacyChanged++;}
    results.push({scale:devicePixelRatio,mode,changedChannels:changed,legacyResampledChannels:legacyChanged});renderer.dispose();canvas.remove();
   }return results;
  }));
  await page.evaluate(async()=>{const {getDatasetInfo}=await import('/src/lib/mock.ts'),{useStore}=await import('/src/store.ts');useStore.getState().setInfo(getDatasetInfo(),{reset:true});useStore.getState().setPlotType('map');useStore.getState().patchSpec({groupBy:'wafer'});});
  await page.waitForFunction(()=>{const c=document.querySelector('.binmap-canvas');return c&&c.width===Math.round(c.getBoundingClientRect().width*Math.min(2,devicePixelRatio));});
  const preview=await page.locator('.binmap-canvas').first().evaluate(c=>{const b=c.getBoundingClientRect();return {width:c.width,height:c.height,expectedWidth:Math.round(b.width*Math.min(2,devicePixelRatio)),expectedHeight:Math.round(b.height*Math.min(2,devicePixelRatio))};});assert.equal(preview.width,preview.expectedWidth);assert.equal(preview.height,preview.expectedHeight);
  await context.close();
 }
 for(const c of checks)assert.equal(c.changedChannels,0,`${c.scale}/${c.mode}: legend text was resampled`);
 assert.ok(checks.filter(c=>c.scale===1.25).every(c=>c.legacyResampledChannels>0),'Fractional-scaling case did not reproduce the previous resampling');console.log(JSON.stringify(checks,null,2));
}finally{await browser?.close();server.kill();}
