// SPDX-License-Identifier: AGPL-3.0-or-later
import {validLocator} from './converter.js';
export const CACHE_TTL=24*60*60*1000;
const PREFIX='sotatoadif-summit:';
export function createSummitLookup(fetchSummit,storage,now=Date.now){
  const memory=new Map(),pending=new Map();
  function valid(entry){const age=now()-entry?.savedAt;return Number.isFinite(age)&&age>=0&&age<CACHE_TTL&&validLocator(entry?.data?.locator||'');}
  return async function lookup(ref){
    ref=ref.trim().toUpperCase();
    let entry=memory.get(ref);
    if(!valid(entry)){
      try{entry=JSON.parse(storage?.getItem(PREFIX+ref)||'null');if(!valid(entry))storage?.removeItem(PREFIX+ref);}catch{entry=null;}
    }
    if(valid(entry)){memory.set(ref,entry);return {...entry.data};}
    if(pending.has(ref))return pending.get(ref);
    const request=(async()=>{
      const data=await fetchSummit(ref);
      if(!validLocator(data?.locator||''))throw new Error('No valid locator returned');
      // Keep only summit information used by the converter and its UI.
      const cached={locator:data.locator.toUpperCase(),name:typeof data.name==='string'?data.name:''};
      const entry={savedAt:now(),data:cached};memory.set(ref,entry);
      try{storage?.setItem(PREFIX+ref,JSON.stringify(entry));}catch{}
      return {...cached};
    })();
    pending.set(ref,request);
    try{return await request;}finally{pending.delete(ref);}
  };
}
