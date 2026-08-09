// Reserved structures for cmux / ghosty configuration support.
//
// NOTE: This is a skeleton placeholder scoped to the framework setup change.
// Actual parsing/editing of cmux (ghosty) hand-written config files will be
// implemented in a follow-up change. Keep this file as the extension point.

export interface GhostyConfigMeta {
  /** Human-readable name shown in the UI */
  label: string;
  /** Where the hand-written config file lives on disk */
  path: string;
  /** Whether the file currently exists */
  exists: boolean;
  /** Raw file content (unparsed) */
  raw: string | null;
}

export interface GhostyConfigDescriptor {
  /** Stable identifier for this config */
  id: string;
  meta: GhostyConfigMeta;
}

/** Placeholder: lists ghosty config files we know about. */
export function listGhostyConfigs(): GhostyConfigDescriptor[] {
  return [];
}
