const chordEditor = document.getElementById('chordEditor');
const preview = document.getElementById('preview');

chordEditor.addEventListener('input', updatePreview);

function updatePreview() {
  const input = chordEditor.value;
  const lines = input.split('\n');
  let html = '';

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith('{title:') || line.startsWith('{artist:') || line.startsWith('{key:')) continue;

    if (line.startsWith('{start_of_')) {
      const name = line.match(/{start_of_(\w+)}/)[1];
      html += `<div class="section-title">${name.toUpperCase()}</div>`;
      continue;
    }

    if (line.startsWith('{end_of_')) continue;

    if (line.startsWith('|')) {
      const chords = line
        .replace(/\|/g, '')
        .split(' ')
        .filter(c => c.trim() !== '')
        .map(chord => `<div class="bar">${chord.trim()}</div>`)
        .join('');
      html += `<div class="bar-row">${chords}</div>`;
      continue;
    }

    if (line !== '') {
      html += `<div class="lyric-line">${line}</div>`;
    }
  }

  preview.innerHTML = html;
}

function clearEditor() {
  chordEditor.value = '';
  updatePreview();
}

function generatePDF() {
  const printWindow = window.open('', '_blank');
  const content = preview.innerHTML;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Chord Sheet</title>
      <style>
        body {
          font-family: 'Times New Roman', serif;
          padding: 40px;
        }
        .section-title {
          font-weight: bold;
          margin: 20px 0 10px;
          text-transform: uppercase;
          border-bottom: 2px solid #000;
          font-size: 16px;
        }
        .bar-row {
          display: flex;
          gap: 6px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .bar {
          border: 2px solid #000;
          padding: 12px 18px;
          min-width: 70px;
          text-align: center;
          font-weight: bold;
          font-family: 'Courier New', monospace;
        }
      </style>
    </head>
    <body>${content}</body>
    </html>
  `);

  printWindow.document.close();
  printWindow.print();
}
