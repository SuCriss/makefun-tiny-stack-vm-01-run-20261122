import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Fixed-path batch VM driver for the tiny stack ISA.
const I=process.env.MAKEFUN_INPUT_DIR??'/input', O=process.env.MAKEFUN_OUTPUT_DIR??'/output';
const enc=new TextEncoder();
// run executes one program and returns its written bytes and exit code.
function run(p,inp){
  const n=p.length;
  // D is the 256-value int32 data stack.
  const D=new Int32Array(256);let sp=0;
  // C holds up to 64 return addresses.
  const C=new Int32Array(64);let csp=0;
  const M=new Int32Array(256);
  // out holds at most 65536 written bytes.
  const out=new Uint8Array(65536);let olen=0;
  let ip=0,pc=0,steps=0;
  const done=(exit)=>({stdout:out.subarray(0,olen),exit,steps});
  const trap=(c)=>done(c);
  for(;;){
    // Ten trap codes end the run with their own exit code.
    if(steps===1000000)return trap(10);
    if(pc<0||pc>=n)return trap(9);
    const op=p[pc];let imm=0,pops=0,pushes=0,name=0;
    if(op===0x00)name=1;
    else if(op===0x01){name=2;imm=1;pushes=1}
    else if(op===0x02){name=3;imm=4;pushes=1}
    else if(op===0x03){name=4;pops=1}
    else if(op===0x04){name=5;pops=1;pushes=2}
    else if(op===0x05){name=6;pops=2;pushes=2}
    else if(op===0x06){name=7;pops=2;pushes=3}
    else if(op===0x07){name=8;pops=3;pushes=3}
    else if(op>=0x10&&op<=0x22){name=op;pops=(op>=0x17&&op<=0x1b)?1:2;pushes=1}
    else if(op===0x30){name=0x30;imm=2}
    else if(op===0x31||op===0x32){name=op;imm=2;pops=1}
    else if(op===0x33){name=0x33;imm=2}
    else if(op===0x34)name=0x34;
    else if(op===0x40){name=0x40;pops=1;pushes=1}
    else if(op===0x41){name=0x41;pops=2}
    else if(op===0x50||op===0x51||op===0x53){name=op;pops=1}
    else if(op===0x52){name=0x52;pushes=1}
    else return trap(5);
    if(pc+imm>=n)return trap(9);
    steps++;
    const next=pc+1+imm;
    if(sp<pops)return trap(2);
    if(sp-pops+pushes>256)return trap(3);
    pc=next;
    switch(name){
      case 1:return done(0);
      case 2:D[sp++]=(p[next-1]<<24)>>24;break;
      case 3:D[sp++]=p[next-4]|(p[next-3]<<8)|(p[next-2]<<16)|(p[next-1]<<24);break;
      case 4:sp--;break;
      case 5:D[sp]=D[sp-1];sp++;break;
      case 6:{const t=D[sp-1];D[sp-1]=D[sp-2];D[sp-2]=t;break}
      case 7:D[sp]=D[sp-2];sp++;break;
      case 8:{const a=D[sp-3];D[sp-3]=D[sp-2];D[sp-2]=D[sp-1];D[sp-1]=a;break}
      case 0x17:D[sp-1]=-D[sp-1]|0;break;
      case 0x1b:D[sp-1]=~D[sp-1];break;
      case 0x10:case 0x11:case 0x12:case 0x13:case 0x14:case 0x15:case 0x16:case 0x18:case 0x19:case 0x1a:case 0x1c:case 0x1d:case 0x1e:case 0x20:case 0x21:case 0x22:{
        const b=D[sp-1],a=D[sp-2];let r=0;
        if(name===0x10)r=(a+b)|0;
        else if(name===0x11)r=(a-b)|0;
        else if(name===0x12)r=Math.imul(a,b);
        else if(name===0x13){if(b===0)return trap(4);r=a===-2147483648&&b===-1?a:(a/b)|0}
        else if(name===0x14){if(b===0)return trap(4);r=b===-1?0:a%b|0}
        else if(name===0x15){if(b===0)return trap(4);r=Math.floor((a>>>0)/(b>>>0))|0}
        else if(name===0x16){if(b===0)return trap(4);r=(a>>>0)%(b>>>0)|0}
        else if(name===0x18)r=a&b;
        else if(name===0x19)r=a|b;
        else if(name===0x1a)r=a^b;
        else if(name===0x1c)r=a<<(b&31);
        else if(name===0x1d)r=a>>(b&31);
        else if(name===0x1e)r=(a>>>(b&31))|0;
        else if(name===0x20)r=a===b?1:0;
        else if(name===0x21)r=a<b?1:0;
        else if(name===0x22)r=(a>>>0)<(b>>>0)?1:0;
        sp-=2;D[sp++]=r;break;
      }
      case 0x30:case 0x31:case 0x32:{
        const rel=((p[next-2]|(p[next-1]<<8))<<16)>>16;
        let take=true;
        if(name!==0x30){const v=D[--sp];take=name===0x31?v===0:v!==0}
        if(take)pc=next+rel;break;
      }
      case 0x33:{if(csp===64)return trap(7);C[csp++]=next;pc=p[next-2]|(p[next-1]<<8);break}
      case 0x34:{if(csp===0)return trap(8);pc=C[--csp];break}
      case 0x40:{const a=D[sp-1];if(a<0||a>=256)return trap(6);D[sp-1]=M[a];break}
      case 0x41:{const a=D[sp-1],v=D[sp-2];if(a<0||a>=256)return trap(6);sp-=2;M[a]=v;break}
      case 0x50:{const b=enc.encode(String(D[sp-1]));if(olen+b.length>65536)return trap(11);sp--;out.set(b,olen);olen+=b.length;break}
      case 0x51:{if(olen+1>65536)return trap(11);out[olen++]=D[--sp]&255;break}
      case 0x52:D[sp++]=ip<inp.length?inp[ip++]:-1;break;
      case 0x53:return done(D[--sp]&255);
    }
  }
}
// Each instance directory is read once and answered in a fixed output path.
for(const id of readdirSync(I).sort()){
  const p=readFileSync(join(I,id,'program.bin'));
  const inp=readFileSync(join(I,id,'input.bin'));
  const r=run(p,inp);
  mkdirSync(join(O,id),{recursive:true});
  writeFileSync(join(O,id,'stdout.bin'),r.stdout);
  writeFileSync(join(O,id,'exit.txt'),String(r.exit)+'\n');
}
