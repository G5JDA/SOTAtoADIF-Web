// SPDX-License-Identifier: AGPL-3.0-or-later
import {readLog,lookupSummit,makeOutputs,validLocator,filterByDate,proposeMerge,makeMergedOutputs,readS2S,joinS2S,detectLogType,readChaser,joinChaser} from './converter.js';
import {createSummitLookup} from './summit-cache.js';
let summitStorage;
try{summitStorage=localStorage;}catch{}
const cachedSummitLookup=createSummitLookup(lookupSummit,summitStorage);
const $=id=>document.getElementById(id);let loaded=null,summits=new Map(),failedLookups=new Set(),loadId=0,busy=false,mergeMappings=new Map(),mainLog=null,s2sLog=null,mainName='',s2sName='',chaserLog=null,chaserName='';
function setBusy(value){busy=value;$('convert').setAttribute('aria-disabled',String(value));$('file').disabled=value;$('clearChaser').disabled=value||!chaserLog;$('clearMain').disabled=value||!mainLog;$('clearS2S').disabled=value||!s2sLog;$('enrich').disabled=value;$('startDate').disabled=value;$('mergeEnabled').disabled=value;for(const input of document.querySelectorAll('#mergeRows input'))input.disabled=value;for(const input of document.querySelectorAll('#summitRows input'))input.disabled=value;$('drop').setAttribute('aria-disabled',String(value));}
async function readFiles(files){
  if(busy||!files?.length)return;setBusy(true);$('results').hidden=true;
  const pending=new Map();let currentName='CSV';
  try {
    for(const file of Array.from(files)){
      currentName=file.name;const text=await file.text();const type=detectLogType(text,file.name);
      if(pending.has(type))throw new Error(`Select only one ${type} log at a time. No files from this selection were applied.`);
      pending.set(type,{name:file.name,log:type==='s2s'?readS2S(text):type==='chaser'?readChaser(text):readLog(text)});
    }
    if(pending.has('activator')){mainLog=pending.get('activator').log;mainName=pending.get('activator').name;}
    if(pending.has('s2s')){s2sLog=pending.get('s2s').log;s2sName=pending.get('s2s').name;}
    if(pending.has('chaser')){chaserLog=pending.get('chaser').log;chaserName=pending.get('chaser').name;}
    rebuildLog();
  }catch(e){
    rebuildLog();$('resultBadge').textContent='FILE READ FAILED';
    $('status').textContent=`Could not read ${currentName}. Select the file again or export a new CSV. ${e.message} Previously loaded files were retained.`;
  }finally{setBusy(false);$('file').value='';}
}
$('clearS2S').addEventListener('click',()=>{if(busy)return;s2sLog=null;s2sName='';rebuildLog();setBusy(false);});
$('clearMain').addEventListener('click',()=>{if(busy)return;mainLog=null;mainName='';rebuildLog();setBusy(false);});
$('clearChaser').addEventListener('click',()=>{if(busy)return;chaserLog=null;chaserName='';rebuildLog();setBusy(false);});
function warn(messages){$('warningBox').hidden=!messages.length;$('warningBox').open=!!messages.length;$('warningTitle').textContent=`${messages.length} warning${messages.length===1?'':'s'} · review excluded rows and lookups`;$('warnings').replaceChildren(...messages.map(message=>{const li=document.createElement('li');li.textContent=message;return li;}));}
function rebuildLog(){
  $('fileLabel').textContent='Drop your SOTA CSV files here';$('mainName').textContent=mainLog?`Activator: ${mainName}`:'';$('s2sName').textContent=s2sLog?`S2S: ${s2sName}`:'';$('loadedFiles').hidden=!mainLog&&!s2sLog&&!chaserLog;$('chaserFileRow').hidden=!chaserLog;$('chaserName').textContent=chaserLog?`Chaser: ${chaserName}`:'';$('mainFileRow').hidden=!mainLog;$('s2sFileRow').hidden=!s2sLog;
  loaded=mainLog||s2sLog||chaserLog;
  const joined=mainLog&&s2sLog?joinS2S(mainLog.qsos,s2sLog.qsos):null;
  if(joined)loaded={qsos:joined.qsos,warnings:mainLog.warnings,lookupWarnings:[...s2sLog.warnings,...joined.warnings]};
  $('s2sSummary').hidden=!s2sLog;
  $('s2sSummary').textContent=joined?`${joined.enriched} S2S contacts matched; ${joined.unmatched} unmatched, ${joined.ambiguous} ambiguous, ${joined.conflicts} conflicting. S2S-only unmatched contacts are not appended.`:s2sLog?`${s2sLog.qsos.length} S2S contacts available for standalone conversion.`:'';
  const combined=chaserLog&&(mainLog||s2sLog)?joinChaser(loaded.qsos,chaserLog.qsos):null;
  if(combined)loaded={qsos:combined.qsos,warnings:[...loaded.warnings,...chaserLog.warnings],lookupWarnings:[...(loaded.lookupWarnings||[]),...combined.warnings]};
  $('chaserSummary').hidden=!chaserLog;
  $('chaserSummary').textContent=combined?`${combined.enriched} chaser contacts matched; ${combined.added} additional contacts; ${combined.ambiguous} ambiguous, ${combined.conflicts} conflicting. Chaser-only contacts have no own summit or locator.`:chaserLog?`${chaserLog.qsos.length} chaser contacts. Own summit and locator are omitted; worked summit locators can be looked up.`:'';
  loadId++;summits=new Map();failedLookups=new Set();mergeMappings=new Map();renderMergeOptions();
  $('results').hidden=true;$('empty').hidden=false;$('resultBadge').textContent=loaded?'READY TO CONVERT':'WAITING FOR LOG';
  $('status').textContent=loaded?`${loaded.qsos.length} valid QSOs found. Times are UTC. Review any warning details below.`:'Choose an activator, S2S or chaser CSV file to get started.';
  $('convert').disabled=!loaded?.qsos.length;warn([...(loaded?.warnings||[]),...(loaded?.lookupWarnings||[])]);renderSummits();
}
function invalidateMerge(){ $('results').hidden=true;$('empty').hidden=false;$('resultBadge').textContent='RECONVERT TO UPDATE';$('status').textContent='Export options changed. Convert again to update downloads.'; }
function renderMergeOptions(){
  $('mergePanel').hidden=!$('mergeEnabled').checked;
  const stations=[...new Set((loaded?.qsos||[]).map(q=>q.station))].filter(s=>s.includes('/'));
  $('mergeEmpty').hidden=!!stations.length;
  $('mergeRows').replaceChildren(...stations.map((station,index)=>{
    const row=document.createElement('div');row.className='merge-row';
    const label=document.createElement('label');label.className='check';
    const check=document.createElement('input');check.type='checkbox';check.checked=mergeMappings.has(station);
    const name=document.createElement('span');name.textContent=`Include ${station}`;label.append(check,name);
    const targetLabel=document.createElement('label');targetLabel.textContent=`Destination for ${station}`;
    const input=document.createElement('input');input.type='text';input.value=mergeMappings.get(station)||proposeMerge(station);input.id=`merge-target-${index}`;targetLabel.htmlFor=input.id;
    input.setAttribute('aria-label',`Destination for ${station}`);input.placeholder='Operating callsign';
    const update=()=>{if(busy)return;const target=input.value.trim().toUpperCase();if(check.checked)mergeMappings.set(station,target);else mergeMappings.delete(station);invalidateMerge();};
    check.addEventListener('change',update);input.addEventListener('input',update);row.append(label,targetLabel,input);return row;
  }));
}
$('mergeEnabled').addEventListener('change',()=>{if(busy)return;renderMergeOptions();invalidateMerge();});
renderMergeOptions();
function selectedContacts(){return filterByDate(loaded?.qsos||[], $('startDate').value||'');}
$('startDate').addEventListener('change',()=>{if(busy)return;$('results').hidden=true;$('empty').hidden=false;try{const selection=selectedContacts();$('startDate').setAttribute('aria-invalid','false');$('status').textContent=`${selection.qsos.length} valid QSOs in date selection. ${selection.filtered} QSOs excluded by date. Convert to update the export.`;$('resultBadge').textContent='RECONVERT TO UPDATE';renderSummits();}catch(e){$('startDate').setAttribute('aria-invalid','true');$('locators').hidden=true;$('status').textContent=e.message;}});
function renderSummits(){const refs=[...new Set(selectedContacts().qsos.flatMap(q=>[q.summit,q.other]).filter(Boolean))].filter(ref=>!$('enrich').checked||failedLookups.has(ref));$('locators').hidden=!refs.length;$('summitRows').replaceChildren(...refs.map((ref,index)=>{const row=document.createElement('label');row.className='summit';const text=document.createElement('span');text.id=`locator-label-${index}`;text.textContent=ref+(summits.get(ref)?.name?` · ${summits.get(ref).name}`:'');const input=document.createElement('input');input.placeholder='Locator';input.value=summits.get(ref)?.locator||'';input.setAttribute('aria-labelledby',text.id);input.pattern='[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2}([0-9]{2})?)?';const error=document.createElement('span');error.id=`locator-error-${index}`;error.className='locator-error';input.setAttribute('aria-describedby',error.id);function validate(){const value=input.value.trim();const required=selectedContacts().qsos.some(q=>q.summit===ref);const invalid=value?!validLocator(value):required;input.setAttribute('aria-invalid',String(invalid));error.textContent=invalid?(value?'Invalid locator. Use a Maidenhead locator such as IO81XW.':'Enter a Maidenhead locator, such as IO81XW.'):' ';error.hidden=!invalid;}validate();input.addEventListener('input',()=>{summits.set(ref,{locator:input.value.trim().toUpperCase()});validate();$('results').hidden=true;$('empty').hidden=false;$('resultBadge').textContent='RECONVERT TO UPDATE';});const field=document.createElement('span');field.className='locator-field';field.append(input,error);row.append(text,field);return row;}));}
$('enrich').addEventListener('change',()=>{if(!busy)renderSummits();});
$('file').addEventListener('change',async e=>{await readFiles(e.target.files);});
$('drop').addEventListener('dragover',e=>{e.preventDefault();if(!busy)$('drop').classList.add('drag');});$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('drag'));$('drop').addEventListener('drop',async e=>{e.preventDefault();$('drop').classList.remove('drag');await readFiles(e.dataTransfer.files);});
$('convert').onclick=async()=>{if(!loaded||$('convert').getAttribute('aria-disabled')==='true')return;const id=loadId;const current=loaded;const warnings=[...current.warnings,...(current.lookupWarnings||[])];setBusy(true);$('results').hidden=true;$('status').textContent='Preparing summit data…';try{
  const {qsos,filtered}=selectedContacts();
  if($('mergeEnabled').checked)for(const [source,target] of mergeMappings){if(!/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(target)||!/[A-Z]/.test(target)||!/[0-9]/.test(target)||target===source)throw new Error(`Review the destination for ${source}: enter a different operating callsign or deselect this mapping.`);}
  if(!qsos.length){$('empty').hidden=false;$('resultBadge').textContent='NO CONTACTS IN DATE SELECTION';$('status').textContent=`No valid QSOs match the date selection. ${filtered} QSOs excluded by date. Clear or change the date to include contacts. ${current.warnings.length} invalid rows; review warnings.`;warn(warnings);return;}
  if($('enrich').checked){const refs=[...new Set(qsos.flatMap(q=>[q.summit,q.other]).filter(Boolean))];for(let i=0;i<refs.length;i++){const ref=refs[i];if(validLocator(summits.get(ref)?.locator||'')&&!summits.get(ref)?.automatic){failedLookups.delete(ref);continue;}$('status').textContent=`Looking up ${ref} (${i+1}/${refs.length})…`;try{const data=await cachedSummitLookup(ref);if(id!==loadId)return;summits.set(ref,{...data,automatic:true});failedLookups.delete(ref);}catch(e){summits.delete(ref);failedLookups.add(ref);warnings.push(`${ref}: lookup failed (${e.message}). Enter its locator manually.`);}}}
  if(id!==loadId)return;renderSummits();const {files,skipped}=makeOutputs(qsos,summits);warn([...warnings,...skipped]);$('empty').hidden=!!files.length;$('results').hidden=!files.length;$('resultBadge').textContent=files.length?(current.warnings.length||skipped.length?'PARTIAL EXPORT — CONTACTS EXCLUDED':(filtered?'ALL SELECTED CONTACTS EXPORTED':'ALL CONTACTS EXPORTED')):'NO CONTACTS EXPORTED';
  const count=files.reduce((n,f)=>n+f.count,0);$('stats').replaceChildren(...[[count,'QSOs exported'],[files.length,'Original ADIF files'],[filtered,'QSOs excluded by date'],[qsos.length-count+current.warnings.length,'Rows / QSOs excluded due to errors']].map(([n,label])=>{const div=document.createElement('div');const strong=document.createElement('strong');strong.textContent=n;const span=document.createElement('span');span.textContent=label;div.append(strong,span);return div;}));
  const mergedFiles=$('mergeEnabled').checked?makeMergedOutputs(qsos,summits,mergeMappings):[];const downloadFiles=[...files,...mergedFiles];$('mergeDownloadWarning').hidden=!mergedFiles.length;$('mergeDownloadWarning').textContent=`${mergedFiles.length} additional merged files. These repeat contacts in the original files. Import one set per destination to avoid duplicates.`;
  $('downloads').replaceChildren(...downloadFiles.map(file=>{const div=document.createElement('div');div.className='download';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=file.station;const small=document.createElement('small');small.textContent=`${file.count} QSOs · ${file.merged?'Additional merged export':'Original export'} · .adi`;text.append(title,small);const button=document.createElement('button');button.textContent='Download ↓';button.setAttribute('aria-label',`Download ${file.merged?'merged ADIF':'ADIF'} for ${file.station}`);button.onclick=()=>{const url=URL.createObjectURL(new Blob([file.text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};div.append(text,button);return div;}));$('preview').textContent=downloadFiles.map(f=>f.text).join('\n');$('status').textContent=files.length?`${count} QSOs exported. ${filtered} QSOs excluded by date. ${current.warnings.length+skipped.length?`${current.warnings.length+skipped.length} rows / QSOs excluded: this is a partial export. Correct the CSV rows or enter missing summit locators and convert again.`:(filtered?'All selected contacts exported.':'All contacts exported.')} ${warnings.length+skipped.length} warnings; review details before importing.`:`No QSOs exported. ${warnings.length+skipped.length} warnings; review warning details below. Add valid summit locators and try again.`;
}catch(e){$('status').textContent=e.message;}finally{setBusy(false);$('convert').disabled=!loaded?.qsos.length;}};

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
