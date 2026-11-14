import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { parse } from 'yaml';
import { readWebDevelopment, webOriginGuard } from '@nimiplatform/app-tools/web';
import { resolveDevelopmentRealm, developmentRealmEnvironment } from '@nimiplatform/app-tools/development';
import { readMobileAccess } from './mobile-config.mjs';

const root=path.resolve(import.meta.dirname,'..'),webRoot=path.join(root,'web');
const envFile=path.join(root,'.env.web.local');if(existsSync(envFile))process.loadEnvFile(envFile);
const flag=process.argv.indexOf('--realm'),selection=flag>=0?process.argv[flag+1]:undefined;
const realm=resolveDevelopmentRealm(selection);
const {site,config}=readWebDevelopment(parse(readFileSync(path.join(root,'nimi.app.yaml'),'utf8')),{realm:realm.name});
const mobile=realm.name==='local'?JSON.stringify(readMobileAccess(realm.name)):'';
const distDir='.next-web-build';
const manifestPath=path.join(webRoot,distDir,'required-server-files.json');
if(!existsSync(manifestPath))throw new Error('Build this editor first: pnpm build:web -- --realm local');
const builtConfig=JSON.parse(readFileSync(manifestPath,'utf8')).config;
if(builtConfig.output==='standalone')throw new Error('Build the local custom-server preview with DEEPTUTOR_OPTIMIZED_WEB=1 before starting it.');
const built=builtConfig.env;
if(built.NEXT_PUBLIC_NIMI_CARRIER!=='web'||built.NEXT_PUBLIC_NIMI_WEB_CONFIG!==JSON.stringify(config)||built.NEXT_PUBLIC_NIMI_MOBILE_CONFIG!==mobile)
  throw new Error('The built editor belongs to a different carrier or source. Rebuild it for the selected Realm.');
Object.assign(process.env,developmentRealmEnvironment(realm),{
  NODE_ENV:'production',NIMI_DEEPTUTOR_CARRIER:'web',DEEPTUTOR_NEXT_DIST_DIR:distDir,
  DEEPTUTOR_NIMI_WEB_CONFIG:JSON.stringify(config),DEEPTUTOR_NIMI_MOBILE_CONFIG:mobile,
});
const require=createRequire(path.join(root,'package.json'));
const next=require('next');
// Existing Next route handlers resolve App configuration from the web directory.
process.chdir(webRoot);
const app=next({dev:false,dir:webRoot,hostname:site.hostname,port:Number(site.port)});
await app.prepare();
const handle=app.getRequestHandler(),guard=webOriginGuard(site);
const server=https.createServer({key:readFileSync(process.env.NIMI_WEB_TLS_KEY),cert:readFileSync(process.env.NIMI_WEB_TLS_CERT)},
  (request,response)=>guard(request,response,()=>{
    const pathname=new URL(request.url||'/',site).pathname;
    if(/^\/files(?:\/|$)/.test(pathname)){
      response.writeHead(403,{'content-type':'text/plain; charset=utf-8'});
      response.end('Open this action from the connected DeepTutor workspace.');return;
    }
    void handle(request,response);
  }));
server.on('upgrade',app.getUpgradeHandler());
server.listen(Number(site.port),'127.0.0.1',()=>console.log(`DeepTutor optimized local editor: ${site.origin}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();void app.close().finally(()=>process.exit());});
