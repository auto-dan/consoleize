import type { CurseForgeSourceSpec } from '../manifest.ts';
import type { LatestRelease } from './github.ts';
import type { FetchLike } from './github.ts';

/**
 * Keyless CurseForge source. File metadata comes from cfwidget (a public
 * mirror of CurseForge project data; the official API requires a key).
 * Downloads use CurseForge's own public download endpoint - the same one
 * the website hands to every browser.
 */

interface CfWidgetFile {
  id: number;
  display: string;
  type: string;
  uploaded_at?: string;
}

interface CfWidgetProject {
  files?: CfWidgetFile[];
}

const CFWIDGET_API = 'https://api.cfwidget.com/wow/mods';

const REQUEST_INIT: RequestInit = {
  headers: {
    Accept: 'application/json',
    // The download endpoint only serves browser-like user agents.
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  },
};

/** CurseForge's public file download endpoint (keyless, browser-grade). */
export function curseForgeDownloadUrl(projectId: number, fileId: number): string {
  return `https://www.curseforge.com/api/v1/mods/${projectId}/files/${fileId}/download`;
}

/** Rank file release types: prefer stable releases over beta/alpha. */
function releaseTypeRank(type: string): number {
  switch (type) {
    case 'release':
      return 0;
    case 'beta':
      return 1;
    default:
      return 2;
  }
}

/**
 * Resolve the latest CurseForge-packaged release of an addon: newest stable
 * file (falling back to beta/alpha when no stable exists).
 */
export async function fetchLatestFromCurseForge(
  spec: CurseForgeSourceSpec,
  fetchImpl: FetchLike = fetch,
): Promise<LatestRelease> {
  const response = await fetchImpl(`${CFWIDGET_API}/${spec.projectId}`, REQUEST_INIT);
  if (!response.ok) {
    throw new Error(
      `CurseForge metadata lookup failed for project ${spec.projectId}: HTTP ${response.status}`,
    );
  }

  const project = (await response.json()) as CfWidgetProject;
  const files = [...(project.files ?? [])];
  if (files.length === 0) {
    throw new Error(`no files listed for CurseForge project ${spec.projectId}`);
  }

  files.sort((a, b) => {
    const rankDiff = releaseTypeRank(a.type) - releaseTypeRank(b.type);
    if (rankDiff !== 0) return rankDiff;
    return (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? '');
  });

  const latest = files[0]!;
  return {
    version: latest.display,
    downloadUrl: curseForgeDownloadUrl(spec.projectId, latest.id),
    publishedAt: latest.uploaded_at ?? null,
  };
}
