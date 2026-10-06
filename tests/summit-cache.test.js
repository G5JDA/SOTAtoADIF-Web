// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSummitLookup,CACHE_TTL} from '../dist/summit-cache.js';
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('deduplicates lookups and reuses persisted data until exactly 24 hours',async()=>{
  const saved=storage();let time=1000,calls=0;
  const fetcher=async()=>{calls++;return {name:'Summit',locator:'IO81xw',unused:'discard'};};
  let lookup=createSummitLookup(fetcher,saved,()=>time);
  const results=await Promise.all([lookup('g/ce-001'),lookup('G/CE-001')]);
  assert.equal(calls,1);assert.deepEqual(results[0],{name:'Summit',locator:'IO81XW'});
  lookup=createSummitLookup(fetcher,saved,()=>time);
  time+=CACHE_TTL-1;await lookup('G/CE-001');assert.equal(calls,1);
  time++;await lookup('G/CE-001');assert.equal(calls,2);
});
test('failed requests are retried and invalid locators are not cached',async()=>{
  let calls=0;const lookup=createSummitLookup(async()=>{calls++;if(calls===1)throw Error('Unavailable');if(calls===2)return {locator:'invalid'};return {locator:'IO81XW'};},storage());
  await assert.rejects(lookup('G/CE-001'));await assert.rejects(lookup('G/CE-001'));await lookup('G/CE-001');assert.equal(calls,3);
});
test('unavailable or corrupt storage does not prevent lookup',async()=>{
  let calls=0;const broken={getItem(){throw Error('Blocked');},setItem(){throw Error('Blocked');}};
  const lookup=createSummitLookup(async()=>{calls++;return {locator:'IO81XW'};},broken);
  await lookup('G/CE-001');await lookup('G/CE-001');assert.equal(calls,1);
  const corrupt=storage();corrupt.setItem('sotatoadif-summit:G/CE-001','{bad json');
  await createSummitLookup(async()=>({locator:'IO81XW'}),corrupt)('G/CE-001');
  assert.equal(JSON.parse(corrupt.getItem('sotatoadif-summit:G/CE-001')).data.locator,'IO81XW');
});
