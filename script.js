function renderChart() {
  const input = document.getElementById('chordInput').value;
  const lines = input.split('\n');
  const output = document.getElementById('chartOutput');
  output.innerHTML = '';

  lines.forEach((line) => {
    line = line.trim();

    if (line === '') return;

    // Section headers
    if (line.startsWith('{section:')) {
      const title = line.match(/{section:\s*(.+?)}/i)?.[1] || '';
      output.innerHTML += `<div class="section-title">${title.toUpperCase()}</div>`;
      return;
    }

    if (line.startsWith('{title:') || line.startsWith('{artist:') || line.startsWith('{key:')) {
      return; // Ignore metadata for now
    }

    if (line.startsWith('|')) {
      const bars = line
        .split('|')
        .map((bar) => bar.trim())
        .filter((bar) => bar !== '')
        .map((bar) => `<div class="bar">${bar}</div>`)
        .join('');
      output.innerHTML += `<div class="bar-line">${bars}</div>`;
    }
  });
}

function clearInput() {
  document.getElementById('chordInput').value = '';
  document.getElementById('chartOutput').innerHTML = '';
}

function downloadPDF() {
  const win = window.open('', '', 'height=800,width=800');
  const style = `
    <style>
      body { font-family: 'Courier New'; padding: 40px; }
      .bar-line { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
      .bar { flex: 1 1 22%; border: 2px solid black; padding: 12px; text-align: center; font-size: 16px; }
      .section-title { font-weight: bold; font-size: 16px; text-transform: uppercase; margin: 20px 0 10px; border-bottom: 2px solid #000; }
    </style>
  `;
  win.document.write(`
    <html>
    <head><title>Chord Chart PDF</title>${style}</head>
    <body>${document.getElementById('chartOutput').innerHTML}</body>
    </html>
  `);
  win.document.close();
  win.print();
}
