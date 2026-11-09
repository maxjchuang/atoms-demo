/** Fresh official release verification, including public HTML checksum fallback for API limits. */
import{createHash}from'node:crypto';
import{CONNECTOR_VERSION,platformAssets}from'./m3-platform.mjs';
export const RELEASE_API='https://api.github.com/repos/cloudflare/cloudflared/releases/tags/'+CONNECTOR_VERSION;
export const RELEASE_PAGE='https://github.com/cloudflare/cloudflared/releases/tag/'+CONNECTOR_VERSION;
export function verifyReleaseMetadata(release,platform){
 const asset=platformAssets(platform),entry=release?.assets?.find(a=>a.name===asset.connectorName);
 if(release.html_url!==RELEASE_PAGE||release.tag_name!==CONNECTOR_VERSION||entry?.digest!=='sha256:'+asset.connectorSha||entry.browser_download_url!==asset.connectorUrl||entry.size!==asset.connectorBytes)throw new Error('Official release metadata differs from frozen platform asset');
 if(release.verificationSource!==undefined&&![RELEASE_API,RELEASE_PAGE].includes(release.verificationSource))throw new Error('Unreviewed release verification source');
 return entry;
}
export function releaseFromOfficialPage(html,platform){
 const asset=platformAssets(platform),escaped=asset.connectorName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const matches=[...html.matchAll(new RegExp(escaped+':\\s*([a-f0-9]{64})','g'))].map(m=>m[1]);
 if(!matches.length||matches.some(s=>s!==asset.connectorSha))throw new Error('Official release page does not match frozen checksum');
 return{tag_name:CONNECTOR_VERSION,html_url:RELEASE_PAGE,verificationSource:RELEASE_PAGE,verificationMethod:'official release HTML checksum matched frozen platform asset; byte count verified at download',assets:[{name:asset.connectorName,digest:'sha256:'+asset.connectorSha,size:asset.connectorBytes,browser_download_url:asset.connectorUrl}]};
}
export async function fetchOfficialRelease(platform,fetcher=fetch){
 platformAssets(platform);
 try{const r=await fetcher(RELEASE_API,{headers:{accept:'application/vnd.github+json','user-agent':'atoms-m3-release-verifier'},signal:AbortSignal.timeout(30000)});if(r.ok){const value=await r.json();verifyReleaseMetadata(value,platform);return{...value,verificationSource:RELEASE_API};}}catch{/* Official HTML is a separate pinned source, never a checksum bypass. */}
 const r=await fetcher(RELEASE_PAGE,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Cannot obtain official connector release metadata');return releaseFromOfficialPage(await r.text(),platform);
}
export function verifyConnectorBytes(bytes,platform){
 const asset=platformAssets(platform);
 if(bytes.length!==asset.connectorBytes||createHash('sha256').update(bytes).digest('hex')!==asset.connectorSha||bytes.readUInt32LE(0)!==0x464c457f||bytes[4]!==2||bytes[5]!==1||bytes.readUInt16LE(18)!==asset.elfMachine)throw new Error('Official connector asset size/checksum/ELF architecture mismatch');
}
