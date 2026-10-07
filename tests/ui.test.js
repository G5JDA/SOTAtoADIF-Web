// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readLog,makeOutputs,validLocator,filterByDate,proposeMerge,makeMergedOutputs} from '../dist/converter.js';
class Element{
  constructor(){this.children=[];this.attributes={};this.listeners={};this.checked=true;this.style={setProperty(){}};this.dataset={};this.classList={add(){},remove(){}};}
  setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,fn){this.listeners[k]=fn;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
  click(){this.clicked=true;this.onclick?.();}
}
function app(lookup=async()=>({locator:'IO81XW',name:'Test summit'})){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={getElementById:get,createElement:()=>new Element(),documentElement:new Element(),querySelectorAll:selector=>selector==='#mergeRows input'?get('mergeRows').children.flatMap(row=>[row.children[0].children[0],row.children[2]]):get('summitRows').children.map(row=>row.children[1].children[0])};
 document.documentElement.dataset.theme='light';get('mergeEnabled').checked=false;
 const downloads=[];const saved=new Map();
 const context={document,readLog,makeOutputs,validLocator,filterByDate,proposeMerge,makeMergedOutputs,lookupSummit:lookup,createSummitLookup:fn=>fn,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},matchMedia:()=>({matches:false,addEventListener(){}}),Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},setTimeout:fn=>fn()};
 vm.runInNewContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;$/gm,''),context);
 return {get,downloads,document,upload:async text=>get('file').listeners.change({target:{files:[{name:'test.csv',text:async()=>text}]}})};
}
const row='V2,DEMO-STATION,G/CE-001,06/10/2026,10:15,144MHz,FM,DEMO-CONTACT,,,\n';
test('partial exports announce excluded input rows and expose warnings',async()=>{const ui=app();await ui.upload(row+'V2,bad\n');await ui.get('convert').onclick();assert.match(ui.get('resultBadge').textContent,/PARTIAL/);assert.match(ui.get('status').textContent,/partial export/);assert.equal(ui.get('warningBox').open,true);});
test('complete exports produce accessible downloadable ADIF',async()=>{const ui=app();await ui.upload(row);await ui.get('convert').onclick();assert.equal(ui.get('resultBadge').textContent,'ALL CONTACTS EXPORTED');const button=ui.get('downloads').children[0].children[1];assert.equal(button.getAttribute('aria-label'),'Download ADIF for DEMO-STATION');button.click();assert.match(await ui.downloads[0].text(),/<EOR>/);});
test('file read failures clear stale results and give recovery instructions',async()=>{const ui=app();await ui.get('file').listeners.change({target:{files:[{name:'broken.csv',text:async()=>{throw Error('Denied');}}]}});assert.match(ui.get('status').textContent,/Could not read broken.csv/);assert.equal(ui.get('convert').disabled,true);assert.equal(ui.get('results').hidden,true);assert.equal(ui.get('file').disabled,false);});
test('conversion locks input and rejects dropped replacement files until lookup completes',async()=>{let finish;const ui=app(()=>new Promise(resolve=>finish=resolve));await ui.upload(row);const conversion=ui.get('convert').onclick();assert.equal(ui.get('file').disabled,true);assert.equal(ui.get('enrich').disabled,true);assert.equal(ui.get('startDate').disabled,true);assert.equal(ui.get('mergeEnabled').disabled,true);let read=false;await ui.get('drop').listeners.drop({preventDefault(){},dataTransfer:{files:[{text:async()=>{read=true;return row;}}]}});assert.equal(read,false);finish({locator:'IO81XW'});await conversion;assert.equal(ui.get('file').disabled,false);assert.equal(ui.get('enrich').disabled,false);});
test('theme and contrast controls have independent accessible states',()=>{const ui=app();ui.get('themeToggle').listeners.click();ui.get('contrastToggle').listeners.click();assert.equal(ui.document.documentElement.dataset.theme,'dark');assert.equal(ui.document.documentElement.dataset.contrast,'high');assert.equal(ui.get('themeToggle').textContent,'Dark mode');assert.equal(ui.get('themeToggle').getAttribute('aria-pressed'),'true');ui.get('themeToggle').listeners.click();assert.equal(ui.document.documentElement.dataset.contrast,'high');});

test('date selection avoids lookups for old summits and does not flag a partial export',async()=>{
 const refs=[];const ui=app(async ref=>{refs.push(ref);return {locator:'IO81XW'};});
 await ui.upload(row+row.replace('06/10/2026','05/10/2026').replace('G/CE-001','G/CE-002'));
 ui.get('startDate').value='2026-10-06';await ui.get('startDate').listeners.change();
 await ui.get('convert').onclick();assert.deepEqual(refs,['G/CE-001']);
 assert.equal(ui.get('resultBadge').textContent,'ALL SELECTED CONTACTS EXPORTED');assert.match(ui.get('status').textContent,/1 QSOs excluded by date/);
 ui.get('startDate').value='2026-10-07';await ui.get('startDate').listeners.change();await ui.get('convert').onclick();
 assert.equal(ui.get('results').hidden,true);assert.match(ui.get('status').textContent,/Clear or change the date/);
 ui.get('startDate').value='';await ui.get('startDate').listeners.change();await ui.get('convert').onclick();assert.equal(ui.get('resultBadge').textContent,'ALL CONTACTS EXPORTED');
});

test('merging is opt-in and produces separately labelled downloads without inflating contact counts',async()=>{
 const ui=app();await ui.upload(row.replace('DEMO-STATION','G1ABC/P'));
 assert.equal(ui.get('mergePanel').hidden,true);
 await ui.get('convert').onclick();assert.equal(ui.get('downloads').children.length,1);
 ui.get('mergeEnabled').checked=true;ui.get('mergeEnabled').listeners.change();
 const mapping=ui.get('mergeRows').children[0];const check=mapping.children[0].children[0];check.checked=true;check.listeners.change();
 await ui.get('convert').onclick();assert.equal(ui.get('downloads').children.length,2);
 assert.equal(ui.get('stats').children[0].children[0].textContent,1);
 assert.equal(ui.get('mergeDownloadWarning').hidden,false);
 assert.equal(ui.get('downloads').children[1].children[1].getAttribute('aria-label'),'Download merged ADIF for G1ABC');
});

test('invalid mappings block conversion and disabling merging restores original-only exports',async()=>{
 const ui=app();await ui.upload(row.replace('DEMO-STATION','G1ABC/P'));
 ui.get('mergeEnabled').checked=true;ui.get('mergeEnabled').listeners.change();
 const mapping=ui.get('mergeRows').children[0];const check=mapping.children[0].children[0];const target=mapping.children[2];
 check.checked=true;target.value='';check.listeners.change();await ui.get('convert').onclick();
 assert.match(ui.get('status').textContent,/Review the destination/);assert.equal(ui.get('results').hidden,true);
 ui.get('mergeEnabled').checked=false;ui.get('mergeEnabled').listeners.change();await ui.get('convert').onclick();assert.equal(ui.get('downloads').children.length,1);
});

test('mixed home and overseas merge controls have labels, lock during lookup, and respect date filtering',async()=>{
 let finish;const ui=app(()=>new Promise(resolve=>finish=resolve));
 await ui.upload(row.replace('DEMO-STATION','G1ABC/P')+row.replace('DEMO-STATION','EA/G1ABC/QRP').replace('06/10/2026','05/10/2026'));
 ui.get('mergeEnabled').checked=true;ui.get('mergeEnabled').listeners.change();
 const mappings=ui.get('mergeRows').children;
 for(const mapping of mappings){const check=mapping.children[0].children[0];check.checked=true;check.listeners.change();}
 assert.equal(mappings[1].children[2].getAttribute('aria-label'),'Destination for EA/G1ABC/QRP');
 assert.equal(mappings[1].children[2].value,'EA/G1ABC');
 ui.get('startDate').value='2026-10-06';ui.get('startDate').listeners.change();
 const conversion=ui.get('convert').onclick();
 for(const mapping of mappings){assert.equal(mapping.children[0].children[0].disabled,true);assert.equal(mapping.children[2].disabled,true);}
 finish({locator:'IO81XW'});await conversion;
 for(const mapping of mappings)assert.equal(mapping.children[2].disabled,false);
 assert.equal(ui.get('downloads').children.length,2);
 assert.equal(ui.get('downloads').children[1].children[1].getAttribute('aria-label'),'Download merged ADIF for G1ABC');
});
