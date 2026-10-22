import {productDisplay} from '@/lib/finding-display.mjs';
export default function ProductDescription({original,code}){
 const d=productDisplay({item:original,evidence:code?[{product_code:code}]:[]});
 return <div className="break-words"><p className="font-semibold">{d.english}</p>{d.original&&<p lang="el" className="mt-1 text-sm whitespace-pre-wrap">{d.original}</p>}{d.uncertain&&<p className="text-xs mt-1 text-muted-foreground">{d.uncertainty||'Technical translation is unconfirmed; use the original description.'}</p>}</div>;
}
