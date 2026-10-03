'use strict';
const net=require('net');
const KEY='asian:catalog:v0150';
function command(args){
 const host=process.env.CATALOG_REDIS_HOST;
 if(!host)return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  let buffer=Buffer.alloc(0),done=false;
  const socket=net.createConnection({host,port:Number(process.env.CATALOG_REDIS_PORT||6379)});
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value)}
  const timer=setTimeout(()=>finish(new Error('Redis timeout')),5000);
  socket.on('error',e=>finish(e));
  socket.on('end',()=>finish(new Error('Redis closed before response')));
  socket.on('connect',()=>socket.write('*'+args.length+'\r\n'+args.map(x=>{x=String(x);return '$'+Buffer.byteLength(x)+'\r\n'+x+'\r\n'}).join('')));
  socket.on('data',data=>{
   buffer=Buffer.concat([buffer,data]);if(buffer.length>16*1024*1024)return finish(new Error('Redis response too large'));
   const i=buffer.indexOf('\r\n');if(i<0)return;
   const type=String.fromCharCode(buffer[0]),value=buffer.subarray(1,i).toString();
   if(type==='-')return finish(new Error(value));
   if(type==='+')return finish(null,value);
   if(type==='$'){
    const n=Number(value);if(n===-1)return finish(null,null);
    if(!Number.isSafeInteger(n)||n<0||n>16*1024*1024)return finish(new Error('Invalid Redis response'));
    if(buffer.length>=i+2+n+2)return finish(null,buffer.subarray(i+2,i+2+n).toString());
   }
  });
 });
}
module.exports={redisGet:()=>command(['GET',KEY]),redisSet:async body=>process.env.CATALOG_REDIS_HOST?await command(['SET',KEY,body])==='OK':false};
