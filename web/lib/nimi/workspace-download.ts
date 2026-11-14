import { webBusinessCall } from './web-connection';
import { isMobileWorkspace } from '@/shared/storage/mobile-drafts';

export async function downloadWorkspaceFile(blob: Blob, filename: string) {
  if (isMobileWorkspace()) {
    await webBusinessCall('client.save-file', { blob, name: filename });
    return;
  }
  const url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
