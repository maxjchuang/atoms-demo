/** Deterministic source only for the explicitly selected Fake adapter. */
export const fakeCalculatorFiles: Record<string, string> = {
  'src/App.tsx': `import { useState } from 'react';
import { Keypad } from './components/Keypad';
export default function App(){
 const [display,setDisplay]=useState('0');const [left,setLeft]=useState<number|null>(null);const [op,setOp]=useState('');const [fresh,setFresh]=useState(true);
 const press=(key:string)=>{if(key==='C'){setDisplay('0');setLeft(null);setOp('');setFresh(true);return;}if(['+','−','×','÷'].includes(key)){setLeft(Number(display));setOp(key);setFresh(true);return;}if(key==='='){if(left!==null){const right=Number(display);const value=op==='+'?left+right:op==='−'?left-right:op==='×'?left*right:op==='÷'?left/right:right;setDisplay(Number.isFinite(value)?String(value):'Error');setLeft(null);setOp('');setFresh(true);}return;}setDisplay(previous=>fresh||previous==='0'?key:previous+key);setFresh(false);};
 return <main><h1>简洁计算器</h1><output data-testid="result">{display}</output><Keypad onPress={press}/></main>;
}
`,
  'src/components/Keypad.tsx': `export function Keypad({onPress}:{onPress:(key:string)=>void}){return <section>{['C','7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+'].map(key=><button key={key} onClick={()=>onPress(key)}>{key}</button>)}</section>}`,
  'src/style.css': '*{box-sizing:border-box}body{font-family:system-ui;background:#f1f3ed;color:#243020}main{width:360px;margin:60px auto}output{display:block;background:#fff;padding:24px;border-radius:16px;font-size:36px;text-align:right}section{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:20px}button{font-size:20px;border:0;padding:20px;border-radius:12px;background:#dae4cf;cursor:pointer}',
};
