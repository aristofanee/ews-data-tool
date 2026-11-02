import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='shots/export-ranges-review';mkdirSync(dir,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');
 const results=await page.evaluate(async()=>{
  const api=await import('/src/lib/api.ts'),{useStore}=await import('/src/store.ts'),{defaultSpec}=await import('/src/types.ts');
  const {figureBox,figureScatter}=await import('/src/charts/figures.ts'),{renderExportFigure}=await import('/src/charts/imageExport.ts');
  const {mapColorLimits,renderMapImage,mapExportFooter,renderBinOverviewImage}=await import('/src/charts/waferMap.ts');
  const state=useStore.getState(),filter=state.filters,box=await api.boxPlot({test:0,xAxis:'wafer',filter});
  const vals=box.groups.flatMap(g=>g.values),results=[];window.saved=[];window.texts=[];window.exportGraphs=[];
  const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(t,x,y,...rest){if(this.canvas.width===2400)window.texts.push({text:String(t),x,y,font:this.font,color:this.fillStyle});return fill.call(this,t,x,y,...rest);};
  const url=performance.getEntriesByType('resource').find(r=>r.name.includes('/deps/plotly__js-dist-min.js?')).name;const P=(await import(url)).default,original=P.newPlot;
  P.newPlot=async function(h,...args){const r=await original.call(this,h,...args);if(h.style.left==='-30000px')window.exportGraphs.push(h);return r;};
  for(const [mode,patch] of [['auto',{}],['manual',{yMin:.4,yMax:.42}],['sigma',{limitK:1}],['iqr',{limitK:.5}],['spec',{}]]){
   const spec={...defaultSpec('box',0,'ignored'),limitMode:mode,...patch};window.texts=[];
   const fig=figureBox(box,{theme:'light',spec,title:'ignored'});fig.exportFilter=filter;
   const image=await renderExportFigure(fig,'png');
   const footer=window.texts.findLast(t=>t.text.startsWith('Total:')).text;
   const summary=box.summary;const range=mode==='manual'?[.4,.42]:mode==='sigma'?[summary.mean-summary.sd,summary.mean+summary.sd]:mode==='iqr'?[summary.q1-.5*(summary.q3-summary.q1),summary.q3+.5*(summary.q3-summary.q1)]:mode==='spec'?[box.test.loSpec,box.test.hiSpec]:[-Infinity,Infinity];
   const inside=vals.filter(v=>v>=range[0]&&v<=range[1]).length;
   results.push({name:mode,image,footer,expected:`Total: ${vals.length.toLocaleString('en-US')} - In Limits: ${inside.toLocaleString('en-US')}`,text:[...window.texts]});
  }
  const scatter=await api.scatter({xTest:0,yTest:1,zMode:'none',filter,maxPoints:Number.MAX_SAFE_INTEGER});
  const spec={...defaultSpec('scatter',0,'ignored'),scatterX:0,scatterY:1,limitMode:'manual',yMin:520,yMax:550};
  window.texts=[];const f=figureScatter(scatter,{theme:'light',spec,title:'ignored'});f.exportFilter=filter;const image=await renderExportFigure(f,'png');
  const paired=scatter.series.flatMap(s=>s.points),inside=paired.filter(p=>p.y>=520&&p.y<=550).length;
  results.push({name:'scatter-custom',image,footer:window.texts.findLast(t=>t.text.startsWith('Total:')).text,expected:`Total: ${paired.length.toLocaleString('en-US')} - In Limits: ${inside.toLocaleString('en-US')}`,text:[...window.texts]});
  const md=await api.waferMap({test:0,wafer:null,mode:'value',filter});
  const ms={...defaultSpec('map',0,'ignored'),limitMode:'manual',yMin:.4,yMax:.42};const opts={theme:'light',palette:'brand',mode:'value',lsl:md.lsl,usl:md.usl,exportSpec:ms,...mapColorLimits(ms,md)};
  opts.exportFooter=await mapExportFooter(md,opts,filter);window.texts=[];
  results.push({name:'map-custom',image:renderMapImage(md,opts,2400,2100,'ignored','','png'),footer:opts.exportFooter,expected:results[1].expected,text:[...window.texts]});
  HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('data:image/'))window.saved.push({name:this.download,url:this.href});};
  const {generateReport}=await import('/src/lib/report.ts');window.texts=[];
  const dirs=new Set(['audit']);const directory=path=>({name:path.split('\\').at(-1),getDirectoryHandle:async(name,options)=>{const next=path+'\\'+name;if(!dirs.has(next)&&!options?.create)throw new DOMException('Missing','NotFoundError');dirs.add(next);return directory(next);},getFileHandle:async name=>({createWritable:async()=>({write:async value=>{if(value instanceof Blob&&value.type.startsWith('image/')){const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(value);});window.saved.push({name,url});}},close:async()=>{},abort:async()=>{}})})});window.showDirectoryPicker=async()=>directory('audit');await api.pickFolder();
  await generateReport({items:[{id:'bins',spec:defaultSpec('binmap',null,'Bin map'),filters:filter}],info:state.info,theme:'light',folder:'audit',templateName:'Lots',onProgress:()=>{}});
  const report=await Promise.all(window.saved.map(async f=>{const im=new Image();im.src=f.url;await im.decode();return {...f,width:im.width,height:im.height};}));
  const overview=await api.binOverview({category:'hard',filter});const w=overview.wafers[0];
  const dice=Array.from({length:121},(_,i)=>({x:i%11-5,y:Math.floor(i/11)-5,v:0,hbin:1,sbin:1}));
  const synthetic={...w,dice,pass:dice.length,fail:0,wafer:{...w.wafer,dieWMm:null,dieHMm:null,diameterMm:null,flat:null}};
  window.texts=[];const seam=renderBinOverviewImage([synthetic],{theme:'light',palette:'brand',mode:'bin',lsl:null,usl:null,exportSpec:defaultSpec('binmap',null,'ignored')},2400,1350,'Seam test','','png');
  const im=new Image();im.src=seam;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);let longest={span:0,nonGreen:0};
  for(let y=250;y<1100;y+=20){const d=ctx.getImageData(0,y,1800,1).data;const greens=[];for(let x=0;x<1800;x++)if(d[x*4]===22&&d[x*4+1]===197&&d[x*4+2]===94)greens.push(x);if(greens.length){const a=greens[0],b=greens.at(-1);if(b-a>longest.span){let nonGreen=0;for(let x=a;x<=b;x++)if(d[x*4]!==22||d[x*4+1]!==197||d[x*4+2]!==94)nonGreen++;longest={span:b-a,nonGreen};}}}
  return {results,report,seam,longest,legendTexts:[...window.texts]};
 });
 for(const r of results.results){assert.ok(r.footer.startsWith(r.expected),`${r.name}: ${r.footer} expected ${r.expected}`);if(['auto','manual','scatter-custom','map-custom'].includes(r.name))assert.equal(r.footer,r.expected);assert.ok(r.text.every(t=>!/(?:bold|^[67]00)/.test(t.font)),r.name+' regular fonts');writeFileSync(`${dir}/${r.name}.png`,Buffer.from(r.image.split(',')[1],'base64'));delete r.image;delete r.text;}
 assert.match(results.results.find(r=>r.name==='sigma').footer,/Mean ±1σ$/);assert.match(results.results.find(r=>r.name==='iqr').footer,/Q1\/Q3 ±0.5 IQR$/);assert.match(results.results.find(r=>r.name==='spec').footer,/USL\/LSL$/);
 assert.equal(results.report.length,2);for(const r of results.report){assert.equal(r.width,4800);assert.equal(r.height,2700);writeFileSync(`${dir}/${r.name}`,Buffer.from(r.url.split(',')[1],'base64'));delete r.url;}
 assert.equal(results.longest.nonGreen,0);assert.ok(results.longest.span>500);assert.ok(results.legendTexts.some(t=>t.text==='HBIN'&&t.x>900));writeFileSync(`${dir}/no-grid.png`,Buffer.from(results.seam.split(',')[1],'base64'));delete results.seam;delete results.legendTexts;
 assert.deepEqual(errors,[]);writeFileSync(`${dir}/result.json`,JSON.stringify({...results,errors},null,2));console.log(JSON.stringify({...results,errors},null,2));
}finally{await browser?.close();server.kill();}
