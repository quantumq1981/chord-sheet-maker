const chordEditor = document.getElementById('chordEditor');
const preview = document.getElementById('preview');

chordEditor.addEventListener('input', updatePreview);

function updatePreview() {
  preview.textContent = chordEditor.value;
}

function clearEditor() {
  chordEditor.value = '';
  updatePreview();
}

function convertToChordSheet() {
  const raw = document.getElementById("rawInput").value;
  const lines = raw.split('\n');
  let output = '';

  let titleSet = false, artistSet = false, keySet = false;
  let currentSection = '';
  let inSection = false;

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith('{title:')) {
      titleSet = true;
      output += line + '\n';
      continue;
    }
    if (line.startsWith('{artist:')) {
      artistSet = true;
      output += line + '\n';
      continue;
    }
    if (line.startsWith('{key:')) {
      keySet = true;
      output += line + '\n\n';
      continue;
    }

    const sectionMatch = line.match(/^\[?(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus)[\s\d]*\]?$/i);
    if (sectionMatch) {
      if (inSection) output += `{end_of_${currentSection.toLowerCase()}}\n\n`;
      currentSection = sectionMatch[1];
      output += `{start_of_${currentSection.toLowerCase()}}\n`;
      inSection = true;
      continue;
    }

    if (/^[|A-G#bmajdimaug0-9\s%\/()+\-\.]+$/.test(line)) {
      output += '| ' + line.replace(/\s+/g, ' ').trim() + ' |\n';
    } else {
      output += line + '\n';
    }
  }

  if (inSection) output += `{end_of_${currentSection.toLowerCase()}}\n`;

  if (!titleSet) output = `{title: Untitled Song}\n` + output;
  if (!artistSet) output = `{artist: Unknown}\n` + output;
  if (!keySet) output = `{key: C}\n\n` + output;

  chordEditor.value = output;
  updatePreview();
}

function generatePDF() {
  const content = chordEditor.value.replace(/\n/g, '<br/>');

  const win = window.open('', '_blank');
  win.document.write(`
    <html>
    <head>
      <title>Chord Sheet PDF</title>
      <style>
        body { font-family: 'Times New Roman', serif; padding: 40px; }
        .bar { border: 1px solid #000; padding: 10px; margin: 5px 0; }
      </style>
    </head>
    <body>
      <h1>Chord Sheet</h1>
      <pre>${content}</pre>
    </body>
    </html>
  `);
  win.document.close();
  win.print();
}
