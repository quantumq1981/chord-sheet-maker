function renderChart() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  const lines = input.split('\\n');

  let rendered = '';
  lines.forEach((line) => {
    line = line.trim();

    if (!line) {
      rendered += '\\n';
      return;
    }

    if (line.startsWith('{title:') || line.startsWith('{artist:') || line.startsWith('{key:')) {
      return; // Ignore metadata for now
    }

    if (line.startsWith('{section:')) {
      const section = line.match(/{section:\\s*(.+?)}/i)?.[1] || '';
      rendered += `\\n\\n<span class="section-title">${section}</span>\\n`;
      return;
    }

    // Leave chord lines as-is
    rendered += line + '\\n';
  });

  output.innerHTML = rendered;
}

function printChart() {
  const content = document.getElementById('output').innerHTML;
  const win = window.open('', '', 'height=800,width=800');
  win.document.write(\`
    <html>
    <head>
      <title>Chord Chart</title>
      <style>
        body { font-family: 'Courier New', monospace; padding: 40px; white-space: pre-wrap; }
        .section-title { font-weight: bold; margin-top: 20px; text-transform: uppercase; border-bottom: 1px solid #000; }
      </style>
    </head>
    <body>\${content}</body>
    </html>
  \`);
  win.document.close();
  win.print();
}

function clearInput() {
  document.getElementById('input').value = '';
  document.getElementById('output').innerHTML = '';
}
