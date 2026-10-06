// SPDX-License-Identifier: AGPL-3.0-or-later
import {readLog,lookupSummit,makeOutputs,validLocator} from './converter.js';
import {createSummitLookup} from './summit-cache.js';
let summitStorage;
try{summitStorage=localStorage;}catch{}
const cachedSummitLookup=createSummitLookup(lookupSummit,summitStorage);
const $=id=>document.getElementById(id);let loaded=null,summits=new Map(),failedLookups=new Set(),loadId=0;
function warn(messages){$('warningBox').hidden=!messages.length;$('warningTitle').textContent=`${messages.length} warning${messages.length===1?'':'s'} · review excluded rows and lookups`;$('warnings').replaceChildren(...messages.map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));}
function load(text,name){try{loaded=readLog(text);loadId++;summits=new Map();failedLookups=new Set();$('fileLabel').textContent=name;$('results').hidden=true;$('empty').hidden=false;$('resultBadge').textContent='READY TO CONVERT';$('status').textContent=`${loaded.qsos.length} valid QSOs found. ${loaded.warnings.length} warnings; review warning details below. Times are UTC.`;$('convert').disabled=!loaded.qsos.length;warn(loaded.warnings);renderSummits();}catch(e){loaded=null;$('convert').disabled=true;$('results').hidden=true;$('empty').hidden=false;$('locators').hidden=true;$('fileLabel').textContent=name;$('status').textContent=e.message;warn([]);}}
function renderSummits(){const refs=[...new Set((loaded?.qsos||[]).flatMap(q=>[q.summit,q.other]).filter(Boolean))].filter(ref=>!$('enrich').checked||failedLookups.has(ref));$('locators').hidden=!refs.length;$('summitRows').replaceChildren(...refs.map((ref,index)=>{const row=document.createElement('label');row.className='summit';const text=document.createElement('span');text.id=`locator-label-${index}`;text.textContent=ref+(summits.get(ref)?.name?` · ${summits.get(ref).name}`:'');const input=document.createElement('input');input.placeholder='Locator';input.value=summits.get(ref)?.locator||'';input.setAttribute('aria-labelledby',text.id);input.pattern='[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2}([0-9]{2})?)?';const error=document.createElement('span');error.id=`locator-error-${index}`;error.className='locator-error';input.setAttribute('aria-describedby',error.id);function validate(){const value=input.value.trim();const invalid=!validLocator(value);input.setAttribute('aria-invalid',String(invalid));error.textContent=invalid?(value?'Invalid locator. Use a Maidenhead locator such as IO81XW.':'Enter a Maidenhead locator, such as IO81XW.'):' ';error.hidden=!invalid;}validate();input.addEventListener('input',()=>{summits.set(ref,{locator:input.value.trim().toUpperCase()});validate();$('results').hidden=true;$('empty').hidden=false;$('resultBadge').textContent='RECONVERT TO UPDATE';});const field=document.createElement('span');field.className='locator-field';field.append(input,error);row.append(text,field);return row;}));}
$('enrich').addEventListener('change',renderSummits);
$('file').addEventListener('change',async e=>{const file=e.target.files[0];if(file)load(await file.text(),file.name);});
$('drop').addEventListener('dragover',e=>{e.preventDefault();$('drop').classList.add('drag');});$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('drag'));$('drop').addEventListener('drop',async e=>{e.preventDefault();$('drop').classList.remove('drag');if(e.dataTransfer.files[0])load(await e.dataTransfer.files[0].text(),e.dataTransfer.files[0].name);});
$('convert').onclick=async()=>{if(!loaded||$('convert').getAttribute('aria-disabled')==='true')return;const id=loadId;const current=loaded;const warnings=[...current.warnings];$('convert').setAttribute('aria-disabled','true');$('file').disabled=true;$('status').textContent='Preparing summit data…';try{
  if($('enrich').checked){const refs=[...new Set(current.qsos.flatMap(q=>[q.summit,q.other]).filter(Boolean))];for(let i=0;i<refs.length;i++){const ref=refs[i];if(validLocator(summits.get(ref)?.locator||'')&&!summits.get(ref)?.automatic){failedLookups.delete(ref);continue;}$('status').textContent=`Looking up ${ref} (${i+1}/${refs.length})…`;try{const data=await cachedSummitLookup(ref);if(id!==loadId)return;summits.set(ref,{...data,automatic:true});failedLookups.delete(ref);}catch(e){summits.delete(ref);failedLookups.add(ref);warnings.push(`${ref}: lookup failed (${e.message}). Enter its locator manually.`);}}}
  if(id!==loadId)return;renderSummits();const {files,skipped}=makeOutputs(current.qsos,summits);warn([...warnings,...skipped]);$('empty').hidden=!!files.length;$('results').hidden=!files.length;$('resultBadge').textContent=files.length?'CONVERSION COMPLETE':'LOCATORS NEEDED';
  const count=files.reduce((n,f)=>n+f.count,0);$('stats').replaceChildren(...[[count,'QSOs exported'],[files.length,'ADIF files'],[current.qsos.length-count,'QSOs excluded']].map(([n,label])=>{const div=document.createElement('div');const strong=document.createElement('strong');strong.textContent=n;const span=document.createElement('span');span.textContent=label;div.append(strong,span);return div;}));
  $('downloads').replaceChildren(...files.map(file=>{const div=document.createElement('div');div.className='download';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=file.station;const small=document.createElement('small');small.textContent=`${file.count} QSOs · .adi`;text.append(title,small);const button=document.createElement('button');button.textContent='Download ↓';button.setAttribute('aria-label',`Download ADIF for ${file.station}`);button.onclick=()=>{const url=URL.createObjectURL(new Blob([file.text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};div.append(text,button);return div;}));$('preview').textContent=files.map(f=>f.text).join('\n');$('status').textContent=files.length?`${count} QSOs ready. ${warnings.length+skipped.length} warnings; review warning details below before importing.`:`No QSOs exported. ${warnings.length+skipped.length} warnings; review warning details below. Add valid summit locators and try again.`;
}catch(e){$('status').textContent=e.message;}finally{$('convert').removeAttribute('aria-disabled');$('convert').disabled=!loaded?.qsos.length;$('file').disabled=false;}};

const themeToggle=$('themeToggle');
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
let chosenTheme=null;
try{chosenTheme=localStorage.getItem('sotatoadif-theme');}catch{}
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  themeToggle.setAttribute('aria-pressed',String(theme==='dark'));
  themeToggle.textContent='Dark mode';
  themeToggle.setAttribute('aria-label',themeToggle.textContent);
}
applyTheme(document.documentElement.dataset.theme||'light');
themeToggle.addEventListener('click',()=>{
  chosenTheme=document.documentElement.dataset.theme==='dark'?'light':'dark';
  applyTheme(chosenTheme);
  try{localStorage.setItem('sotatoadif-theme',chosenTheme);}catch{}
});
systemTheme.addEventListener('change',event=>{
  if(chosenTheme!=='dark'&&chosenTheme!=='light')applyTheme(event.matches?'dark':'light');
});

const contrastToggle=$('contrastToggle');
function applyContrast(high){
  document.documentElement.dataset.contrast=high?'high':'normal';
  contrastToggle.setAttribute('aria-pressed',String(high));
}
applyContrast(document.documentElement.dataset.contrast==='high');
contrastToggle.addEventListener('click',()=>{
  const high=document.documentElement.dataset.contrast!=='high';
  applyContrast(high);
  try{localStorage.setItem('sotatoadif-contrast',high?'high':'normal');}catch{}
});

const readingDefaults={size:'100',width:'80',text:'#163d38',background:'#f4f6f2',custom:false};
let reading={...readingDefaults};
try{const saved=JSON.parse(localStorage.getItem('sotatoadif-reading')||'null');if(saved){
  if(['100','150','200'].includes(saved.size))reading.size=saved.size;
  if(['40','60','80'].includes(saved.width))reading.width=saved.width;
  if(/^#[0-9a-f]{6}$/i.test(saved.text))reading.text=saved.text;
  if(/^#[0-9a-f]{6}$/i.test(saved.background))reading.background=saved.background;
  reading.custom=saved.custom===true;
}}catch{}
function applyReading(){
  const root=document.documentElement;
  root.style.setProperty('--reading-scale',Number(reading.size)/100);
  root.style.setProperty('--reading-width',reading.width+'ch');
  root.style.setProperty('--reading-text',reading.text);
  root.style.setProperty('--reading-bg',reading.background);
  root.dataset.readingCustom=String(reading.custom);
  $('readingSize').value=reading.size;$('readingWidth').value=reading.width;
  $('readingText').value=reading.text;$('readingBackground').value=reading.background;
  $('readingCustom').checked=reading.custom;
}
for(const [id,key] of [['readingSize','size'],['readingWidth','width'],['readingText','text'],['readingBackground','background'],['readingCustom','custom']]){
  $(id).addEventListener('change',()=>{reading[key]=key==='custom'?$(id).checked:$(id).value;applyReading();try{localStorage.setItem('sotatoadif-reading',JSON.stringify(reading));}catch{}});
}
$('readingReset').addEventListener('click',()=>{reading={...readingDefaults};applyReading();try{localStorage.removeItem('sotatoadif-reading');}catch{}});
applyReading();
