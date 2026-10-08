// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024 Jack G5JDA. Browser port licensed AGPL-3.0-or-later.
import {modes} from './modes.js';
export function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[]; let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"'){value+='"';i++;}else if(quoted || value==='') quoted=!quoted; else throw new Error('Unexpected quote in CSV.');}
    else if(c===',' && !quoted){row.push(value);value='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted)throw new Error('CSV contains an unclosed quoted field.');
  if(value || row.length){row.push(value);rows.push(row);}return rows;
}
const bands=[[.1357,.1378,'2190m'],[.472,.479,'630m'],[.501,.504,'560m'],[1.8,2,'160m'],[3.5,4,'80m'],[5,5.45,'60m'],[7,7.3,'40m'],[10,10.15,'30m'],[14,14.35,'20m'],[18,18.168,'17m'],[21,21.45,'15m'],[24,24.99,'12m'],[28,29.7,'10m'],[40,45,'8m'],[50,54,'6m'],[54.000001,69.9,'5m'],[70,71,'4m'],[144,148,'2m'],[222,225,'1.25m'],[420,450,'70cm'],[902,928,'33cm'],[1240,1300,'23cm'],[2300,2450,'13cm'],[3300,3500,'9cm'],[5650,5925,'6cm'],[10000,10500,'3cm'],[24000,24250,'1.25cm'],[47000,47200,'6mm'],[75500,81000,'4mm'],[119980,123000,'2.5mm'],[134000,149000,'2mm'],[241000,250000,'1mm'],[300000,7500000,'submm']];
export function frequencyToBand(s){const m=s.match(/^(\d+(?:\.\d+)?)\s*MHz$/i);return m?bands.find(([a,b])=>+m[1]>=a&&+m[1]<=b)?.[2]||'':'';}
export function modeFor(s){s=s.toUpperCase();if(s==='DV')s='DIGITALVOICE';if(s in modes)return {mode:s};for(const [mode,subs] of Object.entries(modes))if(subs?.includes(s))return {mode,submode:s};return null;}
export function readLog(text){const warnings=[],qsos=[];parseCSV(text).forEach((r,index)=>{const line=index+1;if(r.every(x=>!x.trim())||r[0]==='Version')return;
  if(r[0]!=='V2'||r.length<10){warnings.push(`Row ${line}: expected a SOTA V2 record with 10 columns.`);return;}
  const [version,station,summit,date,time,frequency,mode,call,other,comment]=r.map(x=>x.trim());
  const d=date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),t=time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const dt=d?new Date(Date.UTC(+d[3],+d[2]-1,+d[1])):null;
  if(!d||dt.getUTCFullYear()!==+d[3]||dt.getUTCMonth()!==+d[2]-1||dt.getUTCDate()!==+d[1]||!t||+t[1]>23||+t[2]>59||+(t[3]||0)>59){warnings.push(`Row ${line}: invalid date or UTC time.`);return;}
  const band=frequencyToBand(frequency),mapped=modeFor(mode);
  if(!station||!call||!summit||!band||!mapped){warnings.push(`Row ${line}: missing callsign/summit, unsupported frequency, or unknown mode (${frequency}, ${mode}).`);return;}
  qsos.push({line,station:station.toUpperCase(),summit:summit.toUpperCase(),date:d[3]+d[2]+d[1],time:t[1]+t[2]+(t[3]||''),band,...mapped,call:call.toUpperCase(),other:other.toUpperCase(),comment});
});return {qsos,warnings};}
export const validLocator=s=>/^[A-R]{2}\d{2}([A-X]{2}(\d{2})?)?$/i.test(s);
export async function lookupSummit(ref){const response=await fetch('https://api2.sota.org.uk/api/summits/'+ref,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok||response.status===204)throw new Error('Summit not found');const data=await response.json();if(!validLocator(data.locator||''))throw new Error('No valid locator returned');return {...data,locator:data.locator.toUpperCase()};}
const field=(key,value)=>value?`<${key}:${Array.from(value).length}>${value}`:'';
export function makeOutputs(qsos,summits,now=new Date()){const groups=new Map(),skipped=[];
  for(const q of qsos){const grid=summits.get(q.summit)?.locator;if(!validLocator(grid||'')){skipped.push(`Row ${q.line}: ${q.summit} has no locator; QSO excluded.`);continue;}
    const comment=`My SOTA Ref: ${q.summit}.`+(q.other?` THX S2S, Your SOTA Ref: ${q.other}.`:'')+(q.comment?` ${q.comment}`:'');
    const record=field('CALL',q.call)+field('STATION_CALLSIGN',q.station)+field('QSO_DATE',q.date)+field('TIME_ON',q.time)+field('MODE',q.mode)+field('SUBMODE',q.submode)+field('BAND',q.band)+field('MY_SOTA_REF',q.summit)+field('MY_GRIDSQUARE',grid)+field('SOTA_REF',q.other)+field('GRIDSQUARE',summits.get(q.other)?.locator)+field('COMMENT',comment)+'<EOR>\n';
    if(!groups.has(q.station))groups.set(q.station,[]);groups.get(q.station).push(record);
  }
  const timestamp=now.toISOString().slice(0,19),stamp=timestamp.replace(/[-:]/g,'').replace('T',' ');
  const files=[...groups].map(([station,records])=>({station,count:records.length,name:`${station.replace(/[^A-Z0-9-]/g,'-')}_SOTAtoADIF_${timestamp.replace('T','_').replace(/:/g,'-')}.adi`,text:`# SOTAtoADIF browser edition. Copyright Jack G5JDA. AGPL-3.0-or-later.\n`+field('ADIF_VER','3.1.4')+'\n'+field('PROGRAMID','SOTAtoADIF')+'\n'+field('PROGRAMVERSION','web-1.0.0')+'\n'+field('CREATED_TIMESTAMP',stamp)+'\n<EOH>\n'+records.join('')}));return {files,skipped};
}

// Dates are compared in the same UTC calendar format as QSO_DATE.
export function filterByDate(qsos, startDate='') {
  if (!startDate) return {qsos, filtered:0};
  const date = new Date(startDate+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==startDate) {
    throw new Error('Choose a valid start date or clear the date field.');
  }
  const cutoff = startDate.replaceAll('-', '');
  const included = qsos.filter(q=>q.date>=cutoff);
  return {qsos:included, filtered:qsos.length-included.length};
}

// Conservative proposals only: users review every source and destination.
export function proposeMerge(station) {
  const parts=station.toUpperCase().split('/');
  const indexes=parts.flatMap((part,index)=>/^[A-Z0-9]*[A-Z][0-9]+[A-Z]+$/.test(part)?[index]:[]);
  if(indexes.length!==1 || indexes[0]===parts.length-1) return '';
  return parts.slice(0,indexes[0]+1).join('/');
}
export function makeMergedOutputs(qsos,summits,mappings,now=new Date()) {
  const merged=qsos.filter(q=>mappings.has(q.station)&&mappings.get(q.station)!==q.station)
    .map(q=>({...q,station:mappings.get(q.station)}));
  return makeOutputs(merged,summits,now).files.map(file=>({...file,merged:true,
    name:file.name.replace('_SOTAtoADIF_','_suffixes-merged_SOTAtoADIF_')}));
}

export function readS2S(text) {
  const rows=parseCSV(text);
  const warnings=[];
  for(let index=0;index<rows.length;index++) {
    const row=rows[index];
    if(row.every(value=>!value.trim())||row[0]==='Version')continue;
    if(row.length<10||!row[8]?.trim())warnings.push(`S2S row ${index+1}: worked summit is required.`);
  }
  const log=readLog(text);
  return {qsos:log.qsos.filter(q=>q.other),warnings:[...log.warnings.map(w=>'S2S '+w),...warnings]};
}
export function joinS2S(activator,s2s) {
  const key=q=>JSON.stringify([q.station,q.summit,q.date,q.time.padEnd(6,'0'),q.band,q.mode,q.submode||'',q.call]);
  const groups=qsos=>{const map=new Map();for(const q of qsos){const k=key(q);if(!map.has(k))map.set(k,[]);map.get(k).push(q);}return map;};
  const main=groups(activator),extra=groups(s2s),warnings=[];
  let enriched=0,unmatched=0,ambiguous=0,conflicts=0;
  const additions=new Map();
  for(const [k,records] of extra) {
    const contacts=main.get(k)||[];
    if(!contacts.length){unmatched+=records.length;warnings.push(`S2S row ${records[0].line}: no matching activator contact; not added.`);continue;}
    if(contacts.length!==1||records.length!==1){ambiguous+=records.length;warnings.push(`S2S row ${records[0].line}: ambiguous repeated contact; no enrichment applied.`);continue;}
    const q=contacts[0],ref=records[0].other;
    if(q.other&&q.other!==ref){conflicts++;warnings.push(`S2S row ${records[0].line}: worked summit conflicts with activator row ${q.line}; original reference retained.`);continue;}
    additions.set(q,ref);enriched++;
  }
  return {qsos:activator.map(q=>additions.has(q)?{...q,other:additions.get(q)}:{...q}),warnings,enriched,unmatched,ambiguous,conflicts};
}
