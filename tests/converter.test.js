// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';import assert from 'node:assert/strict';import {parseCSV,readLog,frequencyToBand,modeFor,makeOutputs,filterByDate,proposeMerge,makeMergedOutputs,readS2S,joinS2S,detectLogType,readChaser,joinChaser} from '../dist/converter.js';
const row='V2,G5JDA/P,G/CE-001,06/10/2026,10:15,144MHz,FM,M1HAX,G/WB-001,"Hello, summit"';
test('CSV handles BOM, CRLF, embedded newlines, escaped quotes',()=>{assert.deepEqual(parseCSV('\uFEFFa,"b,b","say ""hi""\nnext"\r\n'),[['a','b,b','say "hi"\nnext']]);assert.throws(()=>parseCSV('"unfinished'));});
test('validates rows without losing valid contacts',()=>{const {qsos,warnings}=readLog(row+'\nV2,too,short\n'+row.replace('06/10/2026','31/02/2026'));assert.equal(qsos.length,1);assert.equal(warnings.length,2);assert.equal(qsos[0].date,'20261006');});
test('original frequency and submode mapping',()=>{assert.equal(frequencyToBand('5MHz'),'60m');assert.equal(frequencyToBand('18MHz'),'17m');assert.equal(frequencyToBand('999MHz'),'');assert.deepEqual(modeFor('USB'),{mode:'SSB',submode:'USB'});assert.deepEqual(modeFor('FT4'),{mode:'MFSK',submode:'FT4'});assert.deepEqual(modeFor('DV'),{mode:'DIGITALVOICE'});});
test('ADIF groups station callsigns and uses correct S2S fields',()=>{const {qsos}=readLog(row+'\n'+row.replace('G5JDA/P','GW5JDA/P'));const maps=new Map([['G/CE-001',{locator:'IO81XW'}],['G/WB-001',{locator:'IO82TB'}]]);const {files}=makeOutputs(qsos,maps,new Date('2026-10-06T12:00:00Z'));assert.equal(files.length,2);assert.match(files[0].text,/<MY_SOTA_REF:8>G\/CE-001/);assert.match(files[0].text,/<SOTA_REF:8>G\/WB-001/);assert.match(files[0].text,/<MY_GRIDSQUARE:6>IO81XW/);assert.match(files[0].text,/<GRIDSQUARE:6>IO82TB/);assert.equal((files[0].text.match(/<MY_SOTA_REF/g)||[]).length,1);assert.match(files[0].text,/Your SOTA Ref: G\/WB-001/);assert.ok(!files[0].name.includes('/'));});
test('missing locators exclude records with visible warnings',()=>{const {qsos}=readLog(row);const out=makeOutputs(qsos,new Map());assert.equal(out.files.length,0);assert.equal(out.skipped.length,1);});

test('date filter is inclusive, optional, and validates calendar dates',()=>{
 const qsos=readLog(row+'\n'+row.replace('06/10/2026','05/10/2026')).qsos;
 assert.equal(filterByDate(qsos).qsos.length,2);
 assert.equal(filterByDate(qsos,'2026-10-06').qsos.length,1);
 assert.equal(filterByDate(qsos,'2026-10-07').filtered,2);
 assert.throws(()=>filterByDate(qsos,'2026-02-30'),/valid start date/);
});

test('suffix proposals preserve overseas prefixes and leave ambiguous callsigns for review',()=>{
 assert.equal(proposeMerge('G1ABC/QRP'),'G1ABC');assert.equal(proposeMerge('EA/G1ABC/P'),'EA/G1ABC');
 assert.equal(proposeMerge('EA/G1ABC'),'');assert.equal(proposeMerge('G1ABC/F2XYZ/P'),'');
});
test('merged exports preserve operating groups and fields, exclude plain contacts, and have distinct names',()=>{
 const qsos=readLog(['G1ABC/P','G1ABC/QRP','G1ABC','EA/G1ABC/P','EA/G1ABC/M','EA/G1ABC'].map(s=>row.replace('G5JDA/P',s)).join('\n')).qsos;
 const mappings=new Map([['G1ABC/P','G1ABC'],['G1ABC/QRP','G1ABC'],['EA/G1ABC/P','EA/G1ABC'],['EA/G1ABC/M','EA/G1ABC']]);
 const files=makeMergedOutputs(qsos,new Map([['G/CE-001',{locator:'IO81XW'}]]),mappings);
 assert.deepEqual(files.map(f=>[f.station,f.count]),[['G1ABC',2],['EA/G1ABC',2]]);
 assert.match(files[1].text,/<STATION_CALLSIGN:8>EA\/G1ABC/);assert.match(files[1].text,/<MY_SOTA_REF:8>G\/CE-001/);
 assert.ok(files.every(f=>f.name.includes('suffixes-merged')&&f.merged));
});

test('merged ADIF changes only station callsign and never collides with original filenames',()=>{
 const qsos=readLog(row+'\n'+row.replace('G5JDA/P','G5JDA')).qsos;
 const summits=new Map([['G/CE-001',{locator:'IO81XW'}],['G/WB-001',{locator:'IO82TB'}]]);
 const now=new Date('2026-10-06T12:00:00Z');
 const original=makeOutputs(qsos,summits,now).files;
 const merged=makeMergedOutputs(qsos,summits,new Map([['G5JDA/P','G5JDA']]),now);
 assert.equal(merged.length,1);assert.equal(merged[0].count,1);
 assert.equal(merged[0].text,original[0].text.replace('<STATION_CALLSIGN:7>G5JDA/P','<STATION_CALLSIGN:5>G5JDA'));
 const names=[...original,...merged].map(f=>f.name);assert.equal(new Set(names).size,names.length);
});
test('date boundaries span UTC year changes and leap days',()=>{
 const qsos=[{date:'20231231'},{date:'20240101'},{date:'20240229'},{date:'20240301'}];
 assert.deepEqual(filterByDate(qsos,'2024-01-01').qsos,qsos.slice(1));
 assert.deepEqual(filterByDate(qsos,'2024-02-29').qsos,qsos.slice(2));
 assert.throws(()=>filterByDate(qsos,'2023-02-29'));
 assert.equal(makeMergedOutputs([],new Map(),new Map()).length,0);
});

test('S2S imports header and points columns, enriches without duplicates, and preserves original comments',()=>{
 const base=readLog(row.replace('G/WB-001','')).qsos;
 const s2s=readS2S('Version,YourCallsign,Your Summit,Date,Time,Band,Mode,OtherCallsign,OtherSummit,Comments,ChaserPoints,ActivatorPoints\n'+row+',1,1');
 assert.equal(s2s.qsos.length,1);assert.equal(s2s.warnings.length,0);
 const joined=joinS2S(base,s2s.qsos);assert.equal(joined.qsos.length,1);assert.equal(joined.enriched,1);assert.equal(joined.qsos[0].other,'G/WB-001');assert.equal(joinS2S(base,readS2S(row.replace('10:15','10:15:00')).qsos).enriched,1);assert.equal(joined.qsos[0].comment,base[0].comment);assert.equal(base[0].other,'');
});
test('S2S unmatched, ambiguous, and conflicting matches never add or overwrite contacts',()=>{
 const base=readLog(row).qsos,other=readLog(row.replace('G/WB-001','G/XX-999')).qsos;
 assert.equal(joinS2S(base,other).conflicts,1);
 assert.equal(joinS2S(base,[...other,...other]).ambiguous,2);
 assert.equal(joinS2S([...base,...base],other).ambiguous,1);
 assert.equal(joinS2S(base,readLog(row.replace('10:15','11:15')).qsos).unmatched,1);
 assert.equal(readS2S(row.replace('G/WB-001','')).qsos.length,0);
});

test('upload classification prefers S2S layout and supports filename fallback',()=>{
 assert.equal(detectLogType(row,'renamed.csv'),'activator');assert.equal(detectLogType(row+',0,0','wrong_activator.csv'),'s2s');
 assert.equal(detectLogType(row,'example_s2s.csv'),'s2s');assert.throws(()=>detectLogType('unrelated,data','unknown.csv'));
});

test('chaser standalone omits unknown own fields and joins add only nonmatching contacts',()=>{
 const text=row.replace('G/CE-001','');const chaser=readChaser(text).qsos;
 assert.equal(detectLogType(text,'renamed.csv'),'chaser');assert.equal(chaser.length,1);
 const out=makeOutputs(chaser,new Map([['G/WB-001',{locator:'IO82TB'}]])).files[0].text;
 assert.doesNotMatch(out,/<MY_SOTA_REF|<MY_GRIDSQUARE/);assert.match(out,/<SOTA_REF:8>G\/WB-001/);assert.match(out,/<GRIDSQUARE:6>IO82TB/);
 const main=readLog(row.replace('G/WB-001','')).qsos;
 const joined=joinChaser(main,[...chaser,{...chaser[0],time:'1215'}]);
 assert.equal(joined.qsos.length,2);assert.equal(joined.enriched,1);assert.equal(joined.added,1);assert.equal(joined.qsos[0].summit,'G/CE-001');assert.equal(joined.qsos[1].summit,'');
 assert.equal(joinChaser(main,[...chaser,...chaser]).ambiguous,2);
 assert.equal(joinChaser(readLog(row).qsos,[{...chaser[0],other:'G/ZZ-999'}]).conflicts,1);
});
