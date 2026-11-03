export function launchEnvironment(environment, resolveProfile) {
 const result={...environment};
 if(!result.APPDATA||!result.LOCALAPPDATA) {
  const profile=resolveProfile();
  for(const key of ['APPDATA','LOCALAPPDATA']) {
   if(!result[key])result[key]=profile[key];
   if(typeof result[key]!=='string'||!result[key].trim())throw Error('WINDOWS_PROFILE_DIRECTORY_UNAVAILABLE: '+key);
  }
 }
 return result;
}
