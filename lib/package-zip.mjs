import {MD5_K,MD5_S} from './content-metadata.mjs';
export const CHUNK=5*1024*1024,MAX_PACKAGE=200*1024*1024;
const enc=new TextEncoder();
export function md5Start(){return {words:[0x67452301,0xefcdab89,0x98badcfe,0x10325476],length:0,tail:[]};}
export function md5Update(state,bytes){
 const s={words:[...state.words],length:state.length+bytes.length,tail:[]};
 const data=new Uint8Array(state.tail.length+bytes.length);data.set(state.tail);data.set(bytes,state.tail.length);
 const dv=new DataView(data.buffer);let off=0;
 for(;off+64<=data.length;off+=64){let [A,B,C,D]=s.words;const original=[A,B,C,D];for(let i=0;i<64;i++){let F,g;if(i<16){F=(B&C)|(~B&D);g=i;}else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)&15;}else if(i<48){F=B^C^D;g=(3*i+5)&15;}else{F=C^(B|~D);g=(7*i)&15;}const x=(F+A+MD5_K[i]+dv.getUint32(off+g*4,true))>>>0;[A,B,C,D]=[D,(B+((x<<MD5_S[i])|(x>>>(32-MD5_S[i]))))>>>0,B,C];}s.words=[A,B,C,D].map((n,i)=>(n+original[i])>>>0);}
 s.tail=Array.from(data.subarray(off));return s;
}
export function md5Finish(state){const n=state.tail.length, padding=new Uint8Array(n<56?64-n:128-n);padding[0]=128;const v=new DataView(padding.buffer);v.setUint32(padding.length-8,(state.length*8)>>>0,true);v.setUint32(padding.length-4,Math.floor(state.length*8/4294967296),true);const s=md5Update(state,padding);const out=new Uint8Array(16),dv=new DataView(out.buffer);s.words.forEach((w,i)=>dv.setUint32(i*4,w,true));return Array.from(out,b=>b.toString(16).padStart(2,'0')).join('');}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function joinBytes(...parts){const result=new Uint8Array(parts.reduce((s,b)=>s+b.length,0));let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;}
export function packageManifest(files){
 if(!Array.isArray(files)||!files.length||files.length>1000)throw Error('Choose 1–1,000 PDFs.');
 const ids=new Set(),counts=new Map();for(const f of files){if(!f.id||ids.has(f.id))throw Error('Duplicate source selection.');ids.add(f.id);if(!Number.isSafeInteger(f.size)||f.size<=0||f.size>10*1024*1024||(! /^[a-f0-9]{32}$/i.test(f.md5||'')&&! /^[a-f0-9]{64}$/i.test(f.hash||'')))throw Error('Each PDF needs a verified size/checksum and must be 10 MB or smaller: '+f.name);if(typeof f.name!=='string'||!f.name.length||f.name==='.'||f.name==='..'||/[\x00-\x1f/\\]/.test(f.name)||enc.encode(f.name).length>600)throw Error('Rename the source PDF to a safe filename: '+f.name);counts.set(f.name.toLowerCase(),(counts.get(f.name.toLowerCase())||0)+1);}
 const manifest=files.map((f,i)=>({...f,zip_name:counts.get(f.name.toLowerCase())>1?String(i+1).padStart(4,'0')+'/'+f.name:f.name}));
 const total=manifest.reduce((n,f)=>n+f.size+30+enc.encode(f.zip_name).length+16+46+enc.encode(f.zip_name).length,22);
 if(total>MAX_PACKAGE)throw Error('Choose PDFs totaling less than 200 MB for this package.');return {manifest,total};
}
export function zipEntry(file,bytes,offset){const name=enc.encode(file.zip_name),crc=crc32(bytes),h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x808,true);v.setUint16(12,33,true);v.setUint16(26,name.length,true);h.set(name,30);const d=new Uint8Array(16),dv=new DataView(d.buffer);dv.setUint32(0,0x08074b50,true);dv.setUint32(4,crc,true);dv.setUint32(8,bytes.length,true);dv.setUint32(12,bytes.length,true);return {bytes:joinBytes(h,bytes,d),entry:{name:file.zip_name,size:bytes.length,crc,offset}};}
export function zipEnd(entries,offset){const parts=entries.map(e=>{const name=enc.encode(e.name),b=new Uint8Array(46+name.length),v=new DataView(b.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x808,true);v.setUint16(14,33,true);v.setUint32(16,e.crc,true);v.setUint32(20,e.size,true);v.setUint32(24,e.size,true);v.setUint16(28,name.length,true);v.setUint32(42,e.offset,true);b.set(name,46);return b;});const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,parts.reduce((n,b)=>n+b.length,0),true);v.setUint32(16,offset,true);return joinBytes(...parts,end);}
