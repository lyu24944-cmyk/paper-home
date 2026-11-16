import crypto from 'node:crypto'

export function createLocalSessions({isLoopback,lanEnabled,verifyPin}) {
  const sessions=new Map(), failures=new Map(), hour=3600_000
  const address=req=>req.socket?.remoteAddress || 'unknown'
  const limited=req=>{
    const entry=failures.get(address(req))
    if(entry && entry.until<=Date.now()){failures.delete(address(req));return false}
    return Boolean(entry && entry.count>=5)
  }
  const verify=(req,pin)=>{
    if(limited(req))return 429
    if(lanEnabled() && typeof pin==='string' && pin && verifyPin(pin)){failures.delete(address(req));return 200}
    if(failures.size>=1000)failures.delete(failures.keys().next().value)
    const old=failures.get(address(req))
    failures.set(address(req),{count:(old?.count||0)+1,until:old?.until||Date.now()+300_000})
    return 403
  }
  const token=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('paper-home-session='))?.slice('paper-home-session='.length)
  const cookie=(req,value,maxAge)=>`paper-home-session=${value}; Path=/__local-cms; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.socket?.encrypted?'; Secure':''}`
  return {
    authorized(req){
      if(isLoopback(req.socket?.remoteAddress))return true
      const id=token(req),expiry=id?sessions.get(id):null
      if(expiry && expiry>Date.now() && lanEnabled())return true
      if(id)sessions.delete(id)
      return req.headers['x-local-pin'] ? verify(req,req.headers['x-local-pin'])===200 : false
    },
    login(req,res,pin){
      const status=verify(req,pin)
      if(status!==200)return status
      for(const [id,expiry] of sessions)if(expiry<=Date.now())sessions.delete(id)
      if(sessions.size>=1000)sessions.delete(sessions.keys().next().value)
      const id=crypto.randomBytes(32).toString('base64url')
      sessions.set(id,Date.now()+hour)
      res.setHeader('Set-Cookie',cookie(req,id,3600))
      return 200
    },
    logout(req,res){sessions.delete(token(req));res.setHeader('Set-Cookie',cookie(req,'',0))},
  }
}
