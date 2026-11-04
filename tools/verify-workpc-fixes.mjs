import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.25});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const checks=await page.evaluate(async()=>{
  const api=await import('/src/lib/api.ts'),{useStore}=await import('/src/store.ts'),{defaultSpec}=await import('/src/types.ts'),{WaferMapRenderer,mapExportFooter}=await import('/src/charts/waferMap.ts');window.S=useStore;
  const base=await api.waferMap({test:0,wafer:0,mode:'value',filter:useStore.getState().filters});
  const mean={...base,isMean:true,testTotal:200,testPass:0,testFail:200,vmin:15,vmax:15,dice:[{x:0,y:0,v:15,hbin:1,sbin:1}]};
  const spec={...defaultSpec('map',0,''),limitMode:'manual',yMin:14,yMax:16},opts={theme:'light',palette:'brand',mode:'value',lsl:null,usl:null,vmin:14,vmax:16,exportSpec:spec};
  const footer=await mapExportFooter(mean,opts,useStore.getState().filters);if(footer!=='Total: 1 - In Limits: 1')throw new Error(footer);
  const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:1000px;height:800px;pointer-events:none';document.body.appendChild(canvas);const renderer=new WaferMapRenderer(canvas);renderer.setSize(1000,800);
  const dice=[];for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)dice.push({x,y,v:1,hbin:x===1&&y===1?2:1,sbin:1});
  const data={...base,dice,wafer:{...base.wafer,centerX:null,centerY:null,dieWMm:null,dieHMm:null,diameterMm:null,flat:'D',posX:'L',posY:'D'}},binOpts={...opts,mode:'bin',showLegend:false};renderer.setData(data,binOpts);
  const px=renderer.cx-renderer.cellW,py=renderer.cy+renderer.cellH,hit=renderer.hitTest(px,py);if(hit?.die.x!==1||hit?.die.y!==1)throw new Error('Mirrored coordinates are not hit-tested correctly');
  const pixel=Array.from(canvas.getContext('2d').getImageData(Math.round(px),Math.round(py),1,1).data);if(pixel[0]<150||pixel[1]>80)throw new Error('Die colour was not mirrored with orientation');
  const many=Array.from({length:50000},(_,i)=>({x:i%250,y:Math.floor(i/250),v:Math.sin(i*.019)+Math.cos(i*.007),hbin:i%10?1:2,sbin:1}));
  canvas.style.width='1920px';canvas.style.height='1000px';renderer.resize();renderer.setData({...base,dice:many,vmin:-2,vmax:2,wafer:{...base.wafer,dieWMm:null,dieHMm:null,diameterMm:null}}, {...opts,vmin:-2,vmax:2,showLegend:true});
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));renderer.zoomAt(700,450,2);await frame();
  const paths=renderer.paths,legend=renderer.legendCanvas,bounds=renderer.bounds;let redraws=0,frames=0;const draw=renderer.renderBase.bind(renderer),paint=renderer.draw.bind(renderer);renderer.renderBase=()=>{redraws++;draw();};renderer.draw=()=>{frames++;paint();};
  for(let i=0;i<30;i++)renderer.panBy(1,.5);await frame();if(redraws!==0||frames!==1)throw new Error(`30 pointer updates caused ${redraws} geometry redraws and ${frames} frames`);
  const panRedraws=redraws,panFrames=frames;
  if(renderer.paths!==paths||renderer.legendCanvas!==legend||renderer.bounds!==bounds||renderer.legendDirty)throw new Error('Pan rebuilt immutable drawing data');
  for(let i=0;i<3;i++){renderer.draw();canvas.getContext('2d').getImageData(0,0,1,1);}
  const bench=reset=>{let total=0;for(let i=0;i<3;i++){renderer.panBy(-2,-1);if(reset){renderer.baseDirty=true;renderer.paths=null;renderer.bounds=null;renderer.legendDirty=true;}const start=performance.now();renderer.draw();canvas.getContext('2d').getImageData(0,0,1,1);total+=performance.now()-start;renderer.dispose();}return total/3;};
  const cachedMs=bench(false),rebuildMs=bench(true);renderer.dispose();canvas.remove();
  return {meanFooter:footer,orientationAndHitTest:true,panUpdates:30,panRedraws,panFrames,cachedPanMs:cachedMs,rebuildingPanMs:rebuildMs};
 });
 // Repeated middle-button pan followed by native double-click, including a
 // re-render while panned. All Cartesian axes must return to their defaults.
 const resets=[];for(const type of ['box','hist','scatter','trend','pareto']){
  await page.evaluate(type=>{window.S.getState().setPlotType(type);window.S.getState().patchSpec({groupBy:'none',splitPlots:false,logY:type==='hist'});},type);
  await page.waitForFunction(()=>document.querySelector('.chart-body .plotly-host')?.style.visibility==='visible');await page.waitForTimeout(200);
  const ranges=()=>page.locator('.chart-body .plotly-host').evaluate(el=>Object.fromEntries(Object.entries(el._fullLayout).filter(([k,a])=>/^[xy]axis\d*$/.test(k)&&a.range).map(([k,a])=>[k,[...a.range]])));
  const baseline=await ranges();for(let i=0;i<2;i++){
   let rect=await page.locator('.chart-body .nsewdrag').first().boundingBox();await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.4);await page.mouse.down({button:'middle'});await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.6,{steps:8});await page.mouse.up({button:'middle'});await page.waitForTimeout(100);assert.notDeepEqual(await ranges(),baseline);
   if(i===1){await page.evaluate(()=>window.S.getState().patchSpec({showLimits:!window.S.getState().spec.showLimits}));await page.waitForTimeout(200);}
   rect=await page.locator('.chart-body .nsewdrag').first().boundingBox();await page.mouse.dblclick(rect.x+rect.width*.5,rect.y+rect.height*.5);await page.waitForTimeout(150);const result=await ranges();
   for(const [key,range]of Object.entries(baseline))for(let j=0;j<2;j++)assert.ok(Math.abs(result[key][j]-range[j])<1e-6,`${type}/${i} failed to reset ${key}: ${JSON.stringify(result)} vs ${JSON.stringify(baseline)}`);
  }
  if(type==='box'){
   // Reproduce the second zoom after a successful pan/double-click reset.
   for(const resetWithHome of [false,true,false]){
    const rect=await page.locator('.chart-body .nsewdrag').first().boundingBox();
    const x=rect.x+rect.width*.5,y=rect.y+rect.height*.5;
    await page.mouse.move(x,y);
    await page.mouse.wheel(0,-500);
    await page.waitForTimeout(400);
    assert.notDeepEqual(await ranges(),baseline);
    if(resetWithHome)await page.locator('.chart-body [data-title="Reset axes"]').click();
    else await page.mouse.dblclick(x,y);
    await page.waitForTimeout(150);
    const result=await ranges();
    for(const [key,range]of Object.entries(baseline))for(let j=0;j<2;j++)assert.ok(Math.abs(result[key][j]-range[j])<1e-6,`Zoom reset failed (${JSON.stringify(result)} vs ${JSON.stringify(baseline)}) for ${key} using ${resetWithHome?'Home':'double-click'}`);
   }
  }
  resets.push(type);
 }
 // Sort only the editor view; the checkbox must retain the original index.
 await page.evaluate(()=>{const s=window.S.getState();window.originalInfo=s.info;window.S.setState({info:{...s.info,wafers:s.info.wafers.slice(0,3).map((w,i)=>({...w,lot:0,name:['10','2','1'][i]}))}});});
 await page.getByRole('button',{name:'+ Add column',exact:true}).click();const rows=page.locator('.column-wafer-list .wafer-check');assert.deepEqual(await rows.locator('.wafer-check-name').allTextContents(),['L24-0417 / 1','L24-0417 / 2','L24-0417 / 10']);
 await rows.first().locator('input').check();await page.locator('.column-modal input[placeholder="e.g. Split"]').fill('Order test');await page.locator('.label-assign-row input').fill('Only wafer 1');await page.getByRole('button',{name:'Create column',exact:true}).click();
 await page.waitForFunction(()=>window.S.getState().info.customColumns.some(c=>c.name==='Order test'));
 assert.equal(await page.evaluate(()=>{const c=window.S.getState().info.customColumns.find(c=>c.name==='Order test');return c.categories[c.waferValues[2]];}),'Only wafer 1');assert.equal(await page.evaluate(()=>window.S.getState().info.customColumns.find(c=>c.name==='Order test').waferValues[0]),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({...checks,panReset:resets,naturalWaferOrder:true,originalAssignmentIndex:true,errors},null,2));
}finally{await browser?.close();server.kill();}
