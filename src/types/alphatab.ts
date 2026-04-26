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
}
