import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';

// Reveal only an explicit action's destination, after React has mounted it.
export function useResultReveal(){
 const {pathname}=useLocation();
 const pending=useRef(null),route=useRef(pathname),[sequence,setSequence]=useState(0);
 const reveal=useCallback(target=>{pending.current={target,path:route.current};setSequence(n=>n+1);},[]);
 useEffect(()=>{route.current=pathname;pending.current=null;},[pathname]);
 useEffect(()=>{
  const request=pending.current;if(!request||request.path!==pathname)return;
  const frame=requestAnimationFrame(()=>{
   if(pending.current!==request)return;
   const node=typeof request.target==='function'?request.target():request.target.current;
   pending.current=null;if(!node||!node.isConnected||!node.textContent.trim())return;
   node.style.scrollMarginTop=window.matchMedia('(min-width: 1024px)').matches?'16px':'72px';
   if(!node.hasAttribute('tabindex'))node.setAttribute('tabindex','-1');
   node.focus({preventScroll:true});
   node.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  });
  return()=>cancelAnimationFrame(frame);
 },[sequence,pathname]);
 return reveal;
}
