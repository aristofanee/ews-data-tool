import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='shots/export-actions-review';mkdirSync(dir,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('ews-presentation','true'));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(async()=>{
  window.saved=[];window.legendPositions=[];window.texts=[];window.copied=[];window.chooser=[];window.progress=[];window.renders=0;window.downloads=0;window.cancelFolder=false;
  const writer=name=>({write:async data=>{await new Promise(r=>setTimeout(r,30));const blob=data instanceof Blob?data:new Blob([data]);const url=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});window.saved.push({name,url,size:blob.size});},close:async()=>{},abort:async()=>{}});
  const file=name=>({name,createWritable:async()=>writer(name)});
  window.showDirectoryPicker=async()=>{window.chooser.push({kind:'folder',renders:window.renders,time:performance.now()});await new Promise(r=>setTimeout(r,250));if(window.cancelFolder)throw new DOMException('Cancelled','AbortError');return {name:'EWS-output',getFileHandle:async name=>file(name),getDirectoryHandle:async(name,options)=>{if(!options?.create)throw new DOMException('Missing','NotFoundError');return {getFileHandle:async name=>file(name),removeEntry:async()=>{}};}};};
  window.showSaveFilePicker=async options=>{window.chooser.push({kind:'file',renders:window.renders,name:options.suggestedName,time:performance.now()});return file(options.suggestedName);};
  HTMLAnchorElement.prototype.click=function(){window.downloads++;};
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t,x,y,...rest){if([2400,4800].includes(this.canvas.width))window.texts.push(String(t));if(this.canvas.width===2400&&["HBIN","SBIN"].includes(String(t)))window.legendPositions.push({x,y,width:this.canvas.width});return fill.call(this,t,x,y,...rest);};
  const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?')).name;const P=(await import(url)).default,original=P.newPlot;
  P.newPlot=async function(h,...args){if(h.style.left==='-30000px')window.renders++;return original.call(this,h,...args);};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{const blob=await items[0].getType('image/png');const url=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});const im=new Image();im.src=url;await im.decode();window.copied.push({url,width:im.width,height:im.height,text:[...window.texts]});}}});
  new MutationObserver(()=>{const p=document.querySelector('.overlay [role=progressbar]');if(p)window.progress.push({value:Number(p.getAttribute('aria-valuenow')),max:Number(p.getAttribute('aria-valuemax')),text:p.closest('.overlay-card').textContent});}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
  const {useStore}=await import('/src/store.ts');useStore.setState({filters:{...useStore.getState().filters,wafers:[0,1,2]}});
 });
 assert.equal(await page.getByText('Slide-sized fonts',{exact:true}).count(),0);assert.equal(await page.evaluate(async()=>(await import('/src/store.ts')).useStore.getState().presentation),false);
 const set=async(type)=>{await page.evaluate(async type=>{const{useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({xAxis:'site',groupBy:type==='binmap'?'none':'wafer',splitPlots:type!=='binmap'});useStore.getState().setReportOpen(false);},type);await page.waitForTimeout(350);};
 const clear=()=>page.evaluate(()=>{window.saved=[];window.legendPositions=[];window.chooser=[];window.progress=[];window.texts=[];window.renders=0;window.copied=[];});
 const save=async(expected,batch)=>{
  await clear();await page.getByTitle('Save as JPG',{exact:true}).click();
  if(batch){await page.waitForFunction(()=>window.chooser.length===1);assert.equal(await page.evaluate(()=>window.renders),0,'no rendering before folder selection');}
  await page.waitForFunction(n=>window.saved.length===n,expected,{timeout:60000});await page.waitForFunction(()=>!document.querySelector('.overlay'));
  const result=await page.evaluate(()=>({files:window.saved.map(s=>s.name),chooser:window.chooser,progress:window.progress,downloads:window.downloads}));
  assert.equal(result.chooser.length,1);assert.equal(result.chooser[0].kind,batch?'folder':'file');assert.equal(result.downloads,0);assert.equal(new Set(result.files).size,expected);
  if(batch)assert.ok(result.progress.some(p=>p.max===100));else assert.equal(result.progress.length,0,'no progress for a single save');return result;
 };
 const checks=[];
 for(const type of ['box','hist','scatter','trend','pareto','map','binmap']){
  await set(type);await page.waitForSelector(type==='map'||type==='binmap'?'.binmap-open':'.facet-card');
  const copy=page.getByTitle('Copy image to clipboard',{exact:true});if(type==='binmap')assert.ok(await copy.isEnabled());else assert.ok(await copy.isDisabled());
  const batch=await save(type==='binmap'?4:3,true);assert.ok(batch.files.every(name=>name.startsWith('[')));checks.push({type,batch:batch.files.length,folderPickers:batch.chooser.length});
  const open=page.locator(type==='map'||type==='binmap'?'.binmap-open':'.facet-card').nth(2);await open.click();
  await page.waitForFunction(()=>!document.querySelector('button[title="Copy image to clipboard"]').disabled);
  const selected=await page.evaluate(async()=>(await import('/src/store.ts')).useStore.getState().plotSelection);assert.ok(selected.label.endsWith('/ 03'));
  console.log(`Verified batch ${type}`);const single=await save(1,false);assert.ok(single.files[0].includes('03'));if(type==='binmap')assert.ok(await page.evaluate(()=>window.legendPositions.some(p=>p.x>600)),'single-wafer bin legend is on the right');
  await page.evaluate(()=>{window.texts=[];window.copied=[];window.progress=[];});await copy.click();await page.waitForFunction(()=>window.copied.length===1);assert.ok(await page.evaluate(()=>window.copied[0].text.some(t=>t.includes('/ 03'))));assert.equal(await page.evaluate(()=>window.progress.length),0,'no progress for copying');
  await page.getByRole('button',{name:'Add to report',exact:true}).click();assert.equal(await page.locator('.drawer').count(),0,'Add preserves the closed builder');const item=await page.evaluate(async()=>(await import('/src/store.ts')).useStore.getState().report.at(-1));assert.equal(item.selection.label,selected.label);
  await page.evaluate(async()=>{const {useStore}=await import('/src/store.ts');useStore.getState().setReportOpen(false);});
 }
 // A report item for an opened split generates exactly one image, and templates retain that split.
 const report=await page.evaluate(async()=>{const{useStore}=await import('/src/store.ts'),{generateReport}=await import('/src/lib/report.ts');const s=useStore.getState();window.saved=[];const result=await generateReport({items:s.report,info:s.info,theme:'light',folder:'EWS-output',templateName:'Selected plots',onProgress:()=>{}});const saved=window.saved;const json=saved.find(f=>f.name==='report.json');const template=JSON.parse(await(await fetch(json.url)).text());useStore.getState().applyTemplate(template);return {files:result.files,templateSelections:template.plots.map(p=>p.selection?.label),restored:useStore.getState().report.map(p=>p.selection?.label),images:saved.filter(f=>f.name.endsWith('.jpg'))};});
 assert.equal(report.files.length,7);assert.ok(report.templateSelections.every(s=>s.endsWith('/ 03')));assert.deepEqual(report.restored,report.templateSelections);for(const f of report.images)writeFileSync(`${dir}/${f.name}`,Buffer.from(f.url.split(',')[1],'base64'));delete report.images;
 // Only the bin-map grid supports global Copy, at the higher resolution and without a total footer.
 await set('binmap');await page.getByTitle('Back to all maps',{exact:true}).click().catch(()=>{});await page.waitForSelector('.binmap-open');await clear();await page.getByTitle('Copy image to clipboard',{exact:true}).click();await page.waitForFunction(()=>window.copied.length===1);
 const global=await page.evaluate(()=>window.copied[0]);assert.equal(global.width,4800);assert.equal(global.height,2700);assert.ok(!global.text.some(t=>t.startsWith('Total:')));writeFileSync(`${dir}/overview.png`,Buffer.from(global.url.split(',')[1],'base64'));
 // Cancelling a folder choice does no rendering or writes and leaves the UI usable.
 await set('box');if(await page.getByRole('button',{name:'All plots',exact:true}).count())await page.getByRole('button',{name:'All plots',exact:true}).click();await page.waitForSelector('.facet-card');await clear();await page.evaluate(()=>window.cancelFolder=true);await page.getByTitle('Save as JPG',{exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.overlay'));assert.equal(await page.evaluate(()=>window.saved.length),0);assert.equal(await page.evaluate(()=>window.renders),0);
 assert.deepEqual(errors,[]);writeFileSync(`${dir}/result.json`,JSON.stringify({checks,report,globalDimensions:[global.width,global.height],cancel:true,errors},null,2));console.log(JSON.stringify({checks,report,globalDimensions:[global.width,global.height],cancel:true,errors},null,2));
}finally{await browser?.close();server.kill();}
