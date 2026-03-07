export function loadMusicXmlFromString(xmlText: string): string {
  const trimmed = xmlText.trim();
  if (!trimmed) {
    throw new Error('MusicXML payload was empty.');
  }
  if (!trimmed.includes('<score-partwise') && !trimmed.includes('<score-timewise')) {
    throw new Error('Response did not contain a MusicXML score-partwise/score-timewise document.');
  }
  return trimmed;
}
