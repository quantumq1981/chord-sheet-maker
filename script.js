function renderChart() {
  const input = document.getElementById('chordInput').value;
  const lines = input.split('\n');
  const output = document.getElementById('chartOutput');
  output.innerHTML = '';

  lines.forEach((line) => {
    line = line.trim();

    if (!line) return;

    // Handle section headers like {section: Verse}
    if (line.startsWith('{section:')) {
      const title = line.match(/{section:\s*(.+?)}/i)?.[1] || '';
      output.innerHTML += `<div class="section-title">${title.toUpperCase()}</div>`;
      return;
    }

    // Skip metadata
    if (line.startsWith('{title:') || line.startsWith('{artist:') || line.startsWith('{key:') || line.startsWith('{tempo:') || line.startsWith('{style:')) {
      return;
    }

    // Handle chord lines
    if (line.startsWith('|')) {
      const bars = line
        .split('|')
        .map(bar => bar.trim())
        .filter(bar => bar !== '')
        .map(bar => {
          if (bar === '%') {
            return `<div class="bar simile-bar">%</div>`;
          } else if (bar === '|:' || bar === ':|') {
            return `<div class="bar repeat-bar">${bar}</div>`;
          } else {
            return `<div class="bar">${bar}</div>`;
          }
        });

      // Group into lines of 4 bars each
      for (let i = 0; i < bars.length; i += 4) {
        const lineBars = bars.slice(i, i + 4).join('');
        output.innerHTML += `<div class="bar-line">${lineBars}</div>`;
      }
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
      .simile-bar { font-style: italic; color: #555; }
      .repeat-bar { font-weight: bold; background: #f0f0f0; }
    </style>
  `;
  win.document.write(\`
    <html>
    <head><title>Chord Chart PDF</title>\${style}</head>
    <body>\${document.getElementById('chartOutput').innerHTML}</body>
    </html>
  \`);
  win.document.close();
  win.print();
}
