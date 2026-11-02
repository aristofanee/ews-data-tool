import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='shots/image-style-review';mkdirSync(dir,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 await page.evaluate(async()=>{
  window.outputs=[];window.drawn=[];window.plots=[];
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t,x,y,...rest){if(this.canvas.width===2400&&[1350,1500,2100].includes(this.canvas.height))window.drawn.push({text:String(t),x,y,color:this.fillStyle,font:this.font});return fill.call(this,t,x,y,...rest);};
  const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?')).name;const P=(await import(url)).default;const original=P.newPlot;
  P.newPlot=async function(h,...args){const r=await original.call(this,h,...args);if(h.style.left==='-30000px')window.plots.push({annotations:h._fullLayout.annotations.map(a=>({text:a.text,y:a.y,yshift:a.yshift})),color:h._fullLayout.xaxis.tickfont.color,weight:h._fullLayout.xaxis.tickfont.weight});return r;};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items)=>{for(const item of items){const b=await item.getType('image/png');const url=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b);});const im=new Image();im.src=url;await im.decode();window.outputs.push({url,width:im.width,height:im.height,text:[...window.drawn],plot:window.plots.at(-1)});}}}});
 });
 const set=async(type,patch={})=>{await page.evaluate(async({type,patch})=>{const{useStore}=await import('/src/store.ts');useStore.getState().setPlotType(type);useStore.getState().patchSpec({groupBy:'none',splitPlots:false,...patch});},{type,patch});await page.waitForTimeout(450);};
 const copy=async(name)=>{const n=await page.evaluate(()=>{window.drawn=[];return window.outputs.length;});await page.getByTitle('Copy image to clipboard',{exact:true}).click();await page.waitForFunction(n=>window.outputs.length>n,n,{timeout:60000});const r=await page.evaluate(()=>window.outputs.at(-1));writeFileSync(`${dir}/${name}.png`,Buffer.from(r.url.split(',')[1],'base64'));return r;};
 const outputs=[];
 for(const type of ['box','hist','scatter','trend','pareto','map','binmap']){
  await set(type,{xAxis:type==='pareto'?'wafer':'wafer'});const r=await copy(type);
  assert.equal(r.width,2400);assert.equal(r.height,type==='binmap'?1350:['scatter','map'].includes(type)?2100:1500);
  assert.match(r.text[0].text,/ vs .* · /);assert.ok(r.text.some(t=>/^Total: /.test(t.text)));
  assert.ok(!r.text.some(t=>t.text.includes('Input scope')||t.text.includes('Sampled display')||t.text.includes('considered measurements')));
  if(!['map','binmap'].includes(type)){assert.equal(r.plot.color,'#000000');assert.equal(r.plot.weight,400);}
  outputs.push({type,title:r.text[0].text,footer:r.text.findLast(t=>t.text.startsWith('Total:')).text,width:r.width,height:r.height});
 }
 await set('box',{groupBy:'lot',xAxis:'wafer'});const grouped=await copy('box-group-lot');
 assert.ok(grouped.plot.annotations.some(a=>a.text==='Lot'));assert.ok(grouped.plot.annotations.some(a=>a.text==='L24-0417'));
 await set('map',{groupBy:'lot'});await page.waitForSelector('.binmap-open');await page.locator('.binmap-open').first().click();await page.waitForSelector('.map-detail-title');const lot=await copy('map-group-lot');assert.match(lot.text[0].text,/^\[Lot L24-0417\] 1001 - Vt nch \[V\] vs WaferID · Map$/);
 await set('box',{xAxis:'site',groupBy:'wafer',splitPlots:true});await page.waitForSelector('.facet-card .js-plotly-plot');await page.locator('.facet-card').nth(2).click();await page.waitForSelector('.facet-detail-title');const split=await copy('box-third');assert.ok(split.text[0].text.startsWith('[WaferID L24-0417 / 03]'));
 const counts=await page.evaluate(async()=>{const api=await import('/src/lib/api.ts'),{useStore}=await import('/src/store.ts');const filter=useStore.getState().filters;const b=await api.boxPlot({test:0,xAxis:'site',groupBy:'wafer',filter});const g=b.groups.filter(g=>g.groupLabel==='L24-0417 / 03');const vals=g.flatMap(g=>g.values);return {n:vals.length,inside:vals.filter(v=>v>=b.test.loSpec&&v<=b.test.hiSpec).length};});
 assert.ok(split.text.some(t=>t.text===`Total: ${counts.n.toLocaleString('en-US')} - In Limits: ${counts.n.toLocaleString('en-US')}`));
 // Unknown limits are explicit, never an inferred yield from sampled points.
 await set('box',{showLimits:false});const noLimits=await copy('box-no-limits');assert.ok(noLimits.text.some(t=>t.text.startsWith('Total:')&&t.text.includes('In Limits:')&&!t.text.includes('Limits Used:')));
 assert.deepEqual(errors,[]);writeFileSync(`${dir}/result.json`,JSON.stringify({outputs,groupedTitle:lot.text[0].text,splitCounts:counts,errors},null,2));
 console.log(JSON.stringify({outputs,groupedTitle:lot.text[0].text,splitCounts:counts,errors},null,2));
}finally{await browser?.close();server.kill();}
