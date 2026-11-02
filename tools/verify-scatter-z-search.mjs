import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1421')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1536,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1421');await page.getByText('Load demo data').click();await page.waitForSelector('.boxlayer path.box');await page.getByRole('button',{name:'Scatter',exact:true}).click();await page.getByRole('button',{name:'Value',exact:true}).click();
 const z=page.getByRole('combobox',{name:'Z test',exact:true}),y=page.getByRole('combobox',{name:'Y test',exact:true});await z.fill('rds ohm');const matches=page.getByRole('listbox',{name:'Z test matches',exact:true});await matches.waitFor();assert.equal(await matches.getByRole('option').count(),1);mkdirSync('shots/scatter-z-search',{recursive:true});await page.screenshot({path:'shots/scatter-z-search/search.png'});await z.press('Enter');
 const spec=()=>page.evaluate(async()=>{const s=(await import('/src/store.ts')).useStore.getState().spec;return {main:s.test,x:s.scatterX,y:s.scatterY,z:s.scatterZTest};});assert.deepEqual(await spec(),{main:0,x:0,y:1,z:2});
 await y.fill('Ioff');await y.press('Enter');assert.deepEqual(await spec(),{main:0,x:0,y:3,z:2});
 await z.fill('1005');assert.equal(await matches.getByRole('option').count(),1);await z.press('Enter');assert.equal((await spec()).z,4);
 await z.fill('mS/mm');assert.equal(await matches.getByRole('option').count(),1);await z.press('Enter');assert.equal((await spec()).z,5);
 await z.fill('zz_no_such_parameter');await page.getByText('No matching tests',{exact:true}).waitFor();await z.press('Escape');assert.deepEqual(await spec(),{main:0,x:0,y:3,z:5});assert.ok((await z.inputValue()).includes('Gm'));assert.deepEqual(errors,[]);const result={nameAndUnitSearch:true,numberSearch:true,unitSearch:true,noMatchEscape:true,independentSelections:await spec(),errors};writeFileSync('shots/scatter-z-search/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
