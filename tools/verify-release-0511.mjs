import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Native IPC/packaged-UI regression using synthetic, non-confidential data.
const out=resolve('shots/release-0511');mkdirSync(out,{recursive:true});
const cn=value=>{const b=Buffer.from(value);return Buffer.concat([Buffer.from([b.length]),b]);};
const records=[];
function record(type,sub,body){const h=Buffer.alloc(4);h.writeUInt16LE(body.length);h[2]=type;h[3]=sub;records.push(h,body);}
record(0,10,Buffer.from([2,4]));
const mir=Buffer.alloc(15);mir.writeUInt32LE(1704067200,4);
const fields=Array(30).fill('');
for(const [i,value] of [[0,'LOT42'],[1,'000450'],[2,'ATE-A'],[3,'Tester-model'],[4,'Program-A'],[5,'001'],[11,'25'],[23,'Flow-A'],[28,'000123']])fields[i]=value;
record(1,10,Buffer.concat([mir,...fields.map(cn)]));
record(1,80,Buffer.concat([Buffer.from([1,1,1,0]),...['','','','PC-01'].map(cn)]));
for(const [wi,name] of ['LOT42-03A4','LOT42-04B7','Nonstandard OCR'].entries()){
 const wir=Buffer.alloc(6);wir.set([1,1]);wir.writeUInt32LE(1704157200,2);record(2,10,Buffer.concat([wir,cn(name)]));
 for(let x=0;x<2;x++){
  record(5,10,Buffer.from([1,0]));
  const ptr=Buffer.alloc(12);ptr.writeUInt32LE(1001);ptr[4]=1;ptr.writeFloatLE(0.4+wi*0.01+x*0.001,8);
  // Optional scaling omitted; no units avoids depending on optional PTR tails.
  record(15,10,Buffer.concat([ptr,cn('Voltage'),cn('')]));
  const prr=Buffer.alloc(17);prr.set([1,0,0]);prr.writeUInt16LE(1,3);prr.writeUInt16LE(x?2:1,5);prr.writeUInt16LE(x?7:1,7);prr.writeInt16LE(x,9);prr.writeUInt32LE(1234,13);
  record(5,20,Buffer.concat([prr,cn(String(wi*2+x+1).padStart(4,'0'))]));
 }
}
const source=resolve(out,'context.stdf'),csv=resolve(out,'roundtrip.csv');writeFileSync(source,Buffer.concat(records));
const exe=resolve(process.argv[2]??'src-tauri/target/release/ews-data-tool.exe');
const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9351'}});
let browser;
try{
 for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:9351/json/version')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().startsWith('devtools:'));assert.ok(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByText('v0.5.11',{exact:true}).waitFor();
 for(const title of ['Open the report builder','Load template','Save template (all report plots + settings)'])assert.ok(await page.getByTitle(title,{exact:true}).isDisabled());
 assert.equal(await page.getByRole('button',{name:'Metadata',exact:true}).locator('svg').count(),1);
 assert.equal(await page.locator('#demo-ui-font').count(),0);
 const result=await page.evaluate(async({source,csv})=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const info=await invoke('open_paths',{paths:[source]});
  const value=info.tests.findIndex(t=>t.name==='Voltage');
  const box=await invoke('box_plot',{req:{test:value,xAxis:'waferNumber',filter:{}}});
  const trend=await invoke('trend',{req:{test:value,by:'waferNumber',filter:{}}});
  const hist=await invoke('histogram',{req:{test:value,groupBy:'waferNumber',filter:{}}});
  const pareto=await invoke('pareto',{req:{category:'hard',groupBy:'waferNumber',filter:{}}});
  await invoke('export_csv',{path:csv,filter:{}});
  const loaded=await invoke('open_paths',{paths:[csv]});
  return {info,loaded,box:box.groups.map(g=>g.xLabel),trend:trend.points.length,hist:hist.groups.length,pareto:pareto.groups.length};
 },{source,csv});
 assert.equal(result.info.rows,6);assert.deepEqual(result.info.wafers.map(w=>w.number),['03','04',null]);
 assert.deepEqual(result.loaded.wafers.map(w=>w.number),['03','04',null]);
 assert.equal(result.info.tests[0].name,'Test time');assert.equal(result.info.tests[1].name,'PartID');
 assert.ok(result.loaded.tests.some(t=>t.name==='PartID'));
 for(const [name,value] of [['Product','000450'],['Tester Name','ATE-A'],['Tester Type','Tester-model'],['Job Name','Program-A'],['Job Revision','001'],['Temperature','25'],['Flow ID','Flow-A'],['Tester Serial Number','000123'],['Probecard ID','PC-01'],['Date','2024-01-02'],['Time','01:00:00']]){
  for(const info of [result.info,result.loaded]){const col=info.customColumns.find(c=>c.name===name);assert.ok(col,name);assert.equal(col.categories[col.waferValues[0]],value,name);}
 }
 assert.equal(result.box.length,3);assert.equal(result.trend,3);assert.equal(result.hist,3);assert.equal(result.pareto,3);
 const header=readFileSync(csv,'utf8').split(/\r?\n/)[0];assert.ok(header.startsWith('Lot,OCR,Wafer,'));assert.ok(header.includes(',X,Y,HBIN,SBIN,Site,'));
 await page.reload();await page.getByRole('button',{name:'Box plot',exact:true}).waitFor();
 for(const title of ['Open the report builder','Load template','Save template (all report plots + settings)'])assert.ok(await page.getByTitle(title,{exact:true}).isEnabled());
 await page.getByRole('button',{name:'Pareto',exact:true}).click();const check=page.getByRole('checkbox',{name:'Show bin label',exact:true});assert.ok(!await check.isChecked());
 await check.check();await page.getByRole('button',{name:'SBIN',exact:true}).click();assert.ok(await check.isChecked());await check.uncheck();await page.getByRole('button',{name:'HBIN',exact:true}).click();assert.ok(await check.isChecked());
 await page.screenshot({path:resolve(out,'pareto.png')});
 await page.getByRole('button',{name:'Bin map',exact:true}).click();assert.ok(!await check.isChecked());await check.check();
 await page.screenshot({path:resolve(out,'binmap.png')});
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2));
 console.log('Native v0.5.11 smoke passed: metadata, OCR/Wafer, PartID, CSV, four plot queries, UI actions, bin-label defaults and persistence.');
}finally{await browser?.close();child.kill();}
