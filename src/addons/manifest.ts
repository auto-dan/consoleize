/** GitHub repository source for an addon. */
export interface GitHubSourceSpec {
  type: 'github';
  owner: string;
  repo: string;
  /**
   * Regex for tags to ignore when resolving "latest" from the tags endpoint
   * (e.g. DynamicCam tags classic releases as 'classic-x.y.z').
   */
  excludeTagPattern?: string;
  /**
   * Regex a tag must match to be considered (e.g. '^\d' keeps retail
   * version tags and drops 'Beta_*' / 'classic-*' tags).
   */
  includeTagPattern?: string;
}

/**
 * CurseForge source: download the official CurseForge-packaged release zip.
 * Preferred whenever available: the packager embeds all libraries (Ace3,
 * author-private libs like LibHideUI), substitutes packager tokens, and
 * regenerates locales - it is exactly what a manual CurseForge install is.
 */
export interface CurseForgeSourceSpec {
  type: 'curseforge';
  /** CurseForge project id (from the addon page / its toc X-Curse-Project-ID). */
  projectId: number;
}

/** Where an addon's releases come from. */
export type AddonSourceSpec = GitHubSourceSpec | CurseForgeSourceSpec;

/** An addon approved for installation by consoleize. */
export interface ManifestAddon {
  /** Stable id used as the cache key in the user config. */
  id: string;
  /** Display name. */
  name: string;
  /** Folder name inside Interface/AddOns. */
  directory: string;
  /** Canonical CurseForge page (reference / attribution). */
  curseforgeUrl: string;
  source: AddonSourceSpec;
}

/**
 * The MVP manifest: a fixed, opinionated list of addons sourced from their
 * public GitHub mirrors or official CurseForge packages.
 */
export const ADDON_MANIFEST: ManifestAddon[] = [
  {
    id: 'console-port',
    name: 'ConsolePort',
    directory: 'ConsolePort',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/console-port',
    source: { type: 'github', owner: 'seblindfors', repo: 'ConsolePort' },
  },
  {
    id: 'dynamic-cam',
    name: 'DynamicCam',
    directory: 'DynamicCam',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/dynamiccam',
    // CurseForge-packaged release: complete with all embedded libraries
    // (its GitHub repo ships no releases and lacks author-private libs).
    source: { type: 'curseforge', projectId: 101120 },
  },
  {
    id: 'dialogue-ui',
    name: 'DialogueUI',
    directory: 'DialogueUI',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/dialogueui',
    source: { type: 'github', owner: 'Peterodox', repo: 'YUI-Dialogue' },
  },
  {
    id: 'dynamic-profiles',
    name: 'Dynamic Profiles',
    directory: 'DynamicProfiles',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/dynamic-profiles',
    // CurseForge-packaged release: ships with all libraries embedded
    // (LibStub, CallbackHandler, LibDataBroker, LibEditMode). Its only
    // declared dependency (BetterAddonList) is optional, so there is
    // nothing extra to install.
    source: { type: 'curseforge', projectId: 1615362 },
  },
  {
    id: 'auctionator',
    name: 'Auctionator',
    directory: 'Auctionator',
    curseforgeUrl: 'https://www.curseforge.com/wow/addons/auctionator',
    // CurseForge-packaged release: ships with all libraries embedded
    // (LibStub, LibCBOR, and even its optional dep LibAHTab), so there is
    // nothing extra to install. One zip covers all flavors incl. retail.
    source: { type: 'curseforge', projectId: 6124 },
  },
];
