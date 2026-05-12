// AlphaTab display and settings types used across the app.

export type AlphaTabStaveProfile = 'default' | 'scoreTab' | 'score' | 'tab';
export type AlphaTabLayoutMode = 'page' | 'horizontal';

export interface AlphaTabDisplaySettings {
  staveProfile: AlphaTabStaveProfile;
  layoutMode: AlphaTabLayoutMode;
  /** Bars per system row; -1 = auto. */
  barsPerRow: number;
  /** Render scale multiplier; 1 = 100%. */
  scale: number;
}

export interface AlphaTabUiSettings {
  display: AlphaTabDisplaySettings;
  enablePlayer: boolean;
  partIndex: number;
  /** Temporary calibrated print profile for iOS/Safari Print → Save PDF. */
  printProfile?: boolean;
  /** Semitone offset applied via notation.transpositionPitches (GP files only).
   *  MusicXML files use the transposeMusicXML() XML-level path instead. */
  transposeSemitones?: number;
}
