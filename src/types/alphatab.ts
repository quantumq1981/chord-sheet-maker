export type AlphaTabLayoutMode = 'page' | 'horizontal';

export interface AlphaTabSettings {
  core: {
    engine: 'svg' | 'html5';
    fontDirectory: string;
  };
  display: {
    layoutMode: AlphaTabLayoutMode;
    barsPerRow: number;
    startBar: number;
    barCount: number;
    scale: number;
  };
  notation: {
    smallGraceTabNotes: boolean;
  };
  player: {
    enablePlayer: boolean;
    soundFont: string;
  };
}
