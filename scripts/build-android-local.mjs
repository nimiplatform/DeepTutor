import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { MOBILE_UI_ORIGIN } from './mobile-config.mjs';
const root=path.resolve(import.meta.dirname,'..');
if(!process.env.ANDROID_HOME || !process.env.JAVA_HOME)throw new Error('Set ANDROID_HOME and JAVA_HOME to the installed Android SDK and JDK 21.');
const manifest=parse(await readFile(path.join(root,'nimi.app.yaml'),'utf8'));
if(manifest.local_development?.web?.local?.origin!==MOBILE_UI_ORIGIN)throw new Error('The local Android renderer must match the exact declared DeepTutor HTTPS origin.');
const env={...process.env,NIMI_DEV_REALM:'local'};
const require=createRequire(import.meta.url), cap=path.join(path.dirname(require.resolve('@capacitor/cli/package.json')),'bin/capacitor');
async function run(command,args,cwd=root,shell=false){
  await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env,stdio:'inherit',windowsHide:true,shell});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Android build command exited ${code}`)));});
}
await run(process.execPath,[cap,'sync','android']);
await run(process.platform==='win32'?'gradlew.bat':'./gradlew',[':app:assembleDebug','--console=plain'],path.join(root,'android'),process.platform==='win32');
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const directory=path.join(root,'.nimi/local/android-candidates',stamp);await mkdir(directory,{recursive:true});
const filename=`deeptutor-${manifest.version}-android-local.apk`;
await copyFile(path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),path.join(directory,filename),constants.COPYFILE_EXCL);
console.log(`Android development candidate: ${path.join(directory,filename)}`);
console.log(`Requires ${MOBILE_UI_ORIGIN}, the original PC App, local source admission, and real Android acceptance. Not an offline distribution.`);
