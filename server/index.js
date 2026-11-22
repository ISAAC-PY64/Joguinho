import express from "express";
import {createServer} from "node:http";
import {attachSocket} from "./socket.js";
import backupStore from "./backups.js";

const app=express();
app.use("/api", (req,res,next)=>{
  const allowedOrigins=(process.env.ALLOWED_ORIGINS||"http://localhost:5173,http://127.0.0.1:5173")
    .split(",").map((origin)=>origin.trim()).filter(Boolean);
  const origin=req.get("Origin");
  res.vary("Origin");
  if(origin&&!allowedOrigins.includes(origin))return res.status(403).json({error:"Esta origem não está autorizada."});
  if(origin)res.set("Access-Control-Allow-Origin",origin);
  res.set("Access-Control-Allow-Methods","POST, OPTIONS");
  res.set("Access-Control-Allow-Headers","Content-Type");
  res.set("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.sendStatus(204);
  next();
});
app.use(express.json({limit:"2mb"}));
app.get("/health",(_req,res)=>res.json({ok:true,name:"Monster Haven server",time:Date.now()}));

function sendBackupError(res,error,operation){
  const status=Number.isInteger(error.statusCode)?error.statusCode:500;
  if(status>=500)console.error(`Não foi possível ${operation}:`,error);
  res.status(status).json({error:status>=500?"O servidor não conseguiu processar o backup.":error.message});
}

app.post("/api/backups",async(req,res)=>{
  try{
    const saved=await backupStore.save(req.body);
    res.json({ok:true,...saved});
  }catch(error){sendBackupError(res,error,"salvar o perfil");}
});
app.post("/api/backups/list",async(req,res)=>{
  try{
    const backups=await backupStore.list(req.body);
    res.json({backups});
  }catch(error){sendBackupError(res,error,"listar os backups");}
});
app.post("/api/backups/restore",async(req,res)=>{
  try{
    const backup=await backupStore.restore(req.body);
    res.json(backup);
  }catch(error){sendBackupError(res,error,"restaurar o perfil");}
});

app.use((error,_req,res,_next)=>{
  const status=error.status===413?413:error instanceof SyntaxError&&error.status===400?400:500;
  if(status===500)console.error("Erro ao processar requisição HTTP:",error);
  res.status(status).json({error:status===413?"A requisição excede o limite de tamanho.":status===400?"O JSON enviado é inválido.":"Erro interno do servidor."});
});

const server=createServer(app);
await attachSocket(server);
const PORT=Number(process.env.PORT||3001);
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error("PORT precisa ser um número entre 1 e 65535.");
server.listen(PORT,"0.0.0.0",()=>console.log(`Monster Haven multiplayer server listening on port ${PORT}`));