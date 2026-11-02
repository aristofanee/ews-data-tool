import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='shots/image-export-fixed';mkdirSync(dir,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try {
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(()=>{
  window.exported=[];window.imageText=[];window.encoding=[];
  const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(this.canvas.width===2400&&[1350,1500,2100].includes(this.canvas.height))window.imageText.push({text:String(text),x,y,width:this.measureText(text).width,font:this.font});return fill.call(this,text,x,y,...rest);};
  const encode=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(...args){if(this.width===2400&&[1350,1500,2100].includes(this.height))window.encoding.push(args);return encode.apply(this,args);};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items)=>{for(const item of items){const b=await item.getType('image/png');const url=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b);});const img=new Image();img.src=url;await img.decode();window.exported.push({url,width:img.width,height:img.height,text:[...window.imageText]});}}}});
 });
 const set=async(type,patch={})=>{await page.evaluate(async({type,patch})=>{const {useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({groupBy:'none',splitPlots:false,...patch});},{type,patch});await page.waitForTimeout(450);};
 const copy=async(name)=>{const n=await page.evaluate(()=>{window.imageText=[];return window.exported.length;});await page.getByTitle('Copy image to clipboard',{exact:true}).click();await page.waitForFunction(n=>window.exported.length>n,n,{timeout:60000});const r=await page.evaluate(()=>window.exported.at(-1));assert.equal(r.width,2400);assert.equal(r.height,await page.evaluate(async()=>{const {useStore}=await import("/src/store.ts");return useStore.getState().spec.type==="binmap"?1350:["map","scatter"].includes(useStore.getState().spec.type)?2100:1500;}));writeFileSync(`${dir}/${name}.png`,Buffer.from(r.url.split(',')[1],'base64'));return r;};
 const images=[];
 for(const type of ['box','hist','scatter','trend','pareto','map','binmap']){
  await set(type);if(type==='binmap')await page.waitForSelector('.binmap-open');const r=await copy(type);images.push({type,text:r.text.map(t=>t.text)});
  if(type==='box'){assert.ok(r.text.some(t=>t.text.startsWith('Total:')));assert.ok(await page.evaluate(()=>document.querySelector('.chart-body .plotly-host')._fullLayout.annotations.some(a=>a.text==='L24-0417')));}
  if(type==='scatter')assert.ok(r.text.some(t=>t.text.includes('In Limits:')));
  if(type==='binmap'){assert.ok(r.text.some(t=>t.text==='HBIN'));assert.ok(r.text.some(t=>t.text==='20'));}
 }
 for(const type of ['box','hist','scatter','trend','pareto','map']){
  await set(type,{xAxis:'site',groupBy:'wafer',splitPlots:true});
  if(type==='map'){await page.waitForSelector('.binmap-open');await page.locator('.binmap-open').nth(2).click();await page.waitForSelector('.map-detail-title');}
  else{await page.waitForSelector('.facet-card .js-plotly-plot');await page.locator('.facet-card').nth(2).click();await page.waitForSelector('.facet-detail-title');}
  const r=await copy(`${type}-third`);assert.ok(r.text[0].text.includes('03'),`${type}: copies selected wafer 03`);assert.ok(!r.text[0].text.includes('/ 01'));
  if(type==='map')assert.equal(r.text.filter(t=>t.text.startsWith('[WaferID')).length,1,'render only one selected map');
 }
 const long=await page.evaluate(async()=>{
  const {imageFrame,encodeImage}=await import('/src/charts/imageExport.ts');window.imageText=[];
  const frame=imageFrame(2400,1500,'LONG '+('leakage current under an unusually long condition / '.repeat(8)));
  return {url:encodeImage(frame.canvas,'png'),text:window.imageText};
 });
 writeFileSync(`${dir}/long-title.png`,Buffer.from(long.url.split(',')[1],'base64'));
 assert.ok(long.text.length>1);assert.ok(long.text.every(t=>t.x+t.width<1201),'header and footer fit');
 await set('hist');
 const quality=await page.evaluate(async()=>{
  const {renderExportFigure,splitImageName}=await import('/src/charts/imageExport.ts');
  const {figureHist}=await import('/src/charts/figures.ts');const api=await import('/src/lib/api.ts');const {useStore}=await import('/src/store.ts');
  const state=useStore.getState();const d=await api.histogram({test:0,filter:state.filters});const f=figureHist(d,{spec:state.spec,theme:'light',title:'JPEG quality'});
  const before=JSON.stringify(f);const url=await renderExportFigure(f,'jpeg');const unchanged=before===JSON.stringify(f);
  const img=new Image();img.src=url;await img.decode();const {safeName}=await import('/src/lib/format.ts');
  const names=['A/B','A:B','測定','測試'].map((label,i)=>splitImageName('Test',label,i,safeName));
  return {width:img.width,height:img.height,unchanged,names,encoding:window.encoding.at(-1),url};
 });
 assert.equal(quality.width,2400);assert.equal(quality.height,1500);assert.ok(quality.unchanged);assert.equal(new Set(quality.names).size,4);assert.deepEqual(quality.encoding,['image/jpeg',0.96]);writeFileSync(`${dir}/histogram.jpg`,Buffer.from(quality.url.split(',')[1],'base64'));delete quality.url;
 const dense=await page.evaluate(async()=>{
  const api=await import('/src/lib/api.ts');const {useStore}=await import('/src/store.ts');const {renderMapImage}=await import('/src/charts/waferMap.ts');const state=useStore.getState();
  const data=await api.waferMap({wafer:0,test:0,mode:'value',filter:state.filters});const dice=data.dice.map((d,i)=>({...d,sbin:i%20+1}));
  window.imageText=[];const url=renderMapImage({...data,dice},{theme:'light',palette:'viridis',mode:'bin',binCategory:'soft',binNames:Object.fromEntries(Array.from({length:20},(_,i)=>[i+1,`Failure description ${i+1} with conditions and extra long text`])),lsl:null,usl:null},2400,1500,'Full bin legend','Twenty categories','png');
  return {url,text:window.imageText.map(t=>t.text)};
 });
 assert.ok(dense.text.some(t=>t==='SBIN'));for(let code=1;code<=20;code++)assert.ok(dense.text.some(t=>t.includes(`${code} ·`)),`legend bin ${code}`);assert.ok(!dense.text.some(t=>t.includes('more bins')));writeFileSync(`${dir}/twenty-bins.png`,Buffer.from(dense.url.split(',')[1],'base64'));
 assert.equal(await page.locator('.modebar-btn[data-title*="Download plot"]').count(),0,'no conflicting built-in export');
 await page.evaluate(()=>{window.saved=[];window.savedTexts=[];HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('data:image/'))window.saved.push({name:this.download,url:this.href});else if(this.href.startsWith('blob:'))window.savedTexts.push(fetch(this.href).then(r=>r.text()));};});
 const batch=await page.evaluate(async()=>{
  const api=await import('/src/lib/api.ts'),{useStore}=await import('/src/store.ts');
  const info=await api.addCustomColumn('Collision',useStore.getState().info.wafers.map((_,wafer)=>({wafer,label:wafer%2?'A/B':'A:B'})));useStore.setState({info});
  useStore.getState().setPlotType('hist');useStore.getState().patchSpec({groupBy:'Collision',splitPlots:true,title:'Batch collision test'});
 });
 await page.waitForSelector('.facet-card .js-plotly-plot');await page.getByTitle('Save as JPG',{exact:true}).click();
 await page.waitForFunction(()=>window.saved.length===2);const saved=await page.evaluate(()=>window.saved.map(x=>x.name));assert.equal(new Set(saved).size,2);
 await set('map',{groupBy:'wafer'});await page.waitForSelector('.binmap-open');
 const readiness=await page.evaluate(async()=>{
  const {useStore}=await import('/src/store.ts');const before=window.exported.length;
  useStore.getState().selectTest(1);await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  document.querySelector('button[title="Copy image to clipboard"]').click();
  return {before,after:window.exported.length};
 });
 assert.equal(readiness.after,readiness.before,'no immediate stale image');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.exported.length),readiness.before,'no stale export completes after loading');
 await page.evaluate(()=>{window.saved=[];window.encoding=[];});
 const report=await page.evaluate(async()=>{
  const {generateReport}=await import('/src/lib/report.ts'),{defaultSpec}=await import('/src/types.ts'),{useStore}=await import('/src/store.ts');
  const state=useStore.getState();const items=['box','hist','scatter','trend','pareto','map','binmap'].map(type=>({id:type,spec:{...defaultSpec(type,0,`Report ${type}`),scatterX:0,scatterY:1},filters:state.filters}));
  const result=await generateReport({items,info:state.info,theme:'dark',folder:'audit',templateName:'Image export verification',onProgress:()=>{}});
  const images=await Promise.all(window.saved.map(async f=>{const i=new Image();i.src=f.url;await i.decode();return {...f,width:i.width,height:i.height};}));
  return {files:result.files,images,encodings:window.encoding.filter(a=>a[0]==='image/jpeg')};
 });
 assert.equal(report.files.length,8);assert.equal(report.images.length,8);assert.ok(report.images.every(i=>i.width===2400&&[1350,1500,2100].includes(i.height)));assert.ok(report.encodings.every(e=>e[1]===0.96));
 for(const image of report.images)writeFileSync(`${dir}/${image.name}`,Buffer.from(image.url.split(',')[1],'base64'));
 const slides=await page.evaluate(async()=>{
  const {generateReport}=await import('/src/lib/report.ts'),{defaultSpec}=await import('/src/types.ts'),{useStore}=await import('/src/store.ts');
  const state=useStore.getState();window.saved=[];
  const items=['box','hist','scatter','trend','pareto','map','binmap'].map(type=>({id:type,spec:{...defaultSpec(type,0,`Slide ${type}`),presentation:true,scatterX:0,scatterY:1},filters:state.filters}));
  await generateReport({items,info:state.info,theme:'light',folder:'audit',templateName:'Slide-sized verification',onProgress:()=>{}});
  return Promise.all(window.saved.map(async f=>{const i=new Image();i.src=f.url;await i.decode();return {...f,width:i.width,height:i.height};}));
 });
 assert.equal(slides.length,8);assert.ok(slides.every(i=>i.width===2400&&[1350,1500,2100].includes(i.height)));
 for(const image of slides)writeFileSync(`${dir}/${image.name}`,Buffer.from(image.url.split(',')[1],'base64'));

 assert.deepEqual(errors,[]);console.log(JSON.stringify({dimensions:[2400,1500],selectedSplitTypes:6,longTitleWrapped:true,quality,allTwentyBins:true,batchNames:saved,loadingGuard:true,reportImages:report.files.length,slideImages:slides.length,images:images.map(i=>i.type),errors},null,2));
}finally{await browser?.close();server.kill();}
