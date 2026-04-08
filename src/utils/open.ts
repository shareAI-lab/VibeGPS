import { execa } from 'execa';

export async function openInBrowser(path: string): Promise<void> {
  const target = `file://${path}`;

  if (process.platform === 'darwin') {
    await execa('open', [target]);
    return;
  }

  await execa('xdg-open', [target]);
}
