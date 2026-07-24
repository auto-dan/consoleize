import { writeFile } from 'node:fs/promises';

/** Download progress callback: bytes received so far and total (0 if unknown). */
export type DownloadProgress = (received: number, total: number) => void;

/**
 * Download a URL to a local file, reporting byte progress. Follows redirects
 * (GitHub asset URLs 302 to a CDN). Uses a browser-grade user agent:
 * CurseForge's public download endpoint rejects anything else.
 */
export async function downloadFile(
  url: string,
  destinationPath: string,
  onProgress?: DownloadProgress,
): Promise<void> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    onProgress?.(received, total);
  }

  await writeFile(destinationPath, Buffer.concat(chunks));
}
