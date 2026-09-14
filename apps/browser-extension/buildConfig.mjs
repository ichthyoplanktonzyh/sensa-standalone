export function extensionBuildConfig(environment=process.env){
 const configuredWeb=environment.SENSA_EXTENSION_WEB_URL;
 const configuredApi=environment.SENSA_EXTENSION_API_URL;
 if(Boolean(configuredWeb)!==Boolean(configuredApi))throw new Error('Both extension target URLs are required');
 const targetless=!configuredWeb&&!configuredApi;
 return {
  targetless,
  web:configuredWeb||'https://extension-build.invalid',
  api:configuredApi||'https://api.extension-build.invalid',
  output:environment.SENSA_EXTENSION_OUT_DIR||(targetless?'../../.tmp/browser-extension-build':'dist'),
  name:environment.SENSA_EXTENSION_NAME||(targetless?'Sensa · Build check':'Sensa 阅读采集'),
 };
}
