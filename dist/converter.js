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
