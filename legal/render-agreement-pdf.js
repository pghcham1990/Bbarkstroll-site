// Render the IC agreement HTML to PDF. Run after editing the HTML source:
//   node /opt/barkstroll/legal/render-agreement-pdf.js
//
// Output: /var/www/barkstroll.com/legal/independent-contractor-agreement.pdf
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'independent-contractor-agreement.html');
const OUT = '/var/www/barkstroll.com/legal/independent-contractor-agreement.pdf';

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('Source HTML not found:', SRC);
    process.exit(1);
  }
  const html = fs.readFileSync(SRC, 'utf8');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.pdf({
      path: OUT,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.7in', right: '0.7in' }
    });
    console.log('Wrote', OUT);
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
