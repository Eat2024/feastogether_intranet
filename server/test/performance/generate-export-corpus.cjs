#!/usr/bin/env node
// 僅生成無個資合成資料；從呼叫者指定的 repository 載入既有 dependency。
const fs = require('node:fs'),
  path = require('node:path'),
  zlib = require('node:zlib'),
  crypto = require('node:crypto'),
  cp = require('node:child_process');
const repo = process.argv[2] || process.cwd();
const { PDFDocument, StandardFonts, rgb } = require(
  require.resolve('pdf-lib', { paths: [path.join(repo, 'server')] }),
);
const out = path.resolve(process.argv[3] || '/tmp/esign009-capacity-corpus');
const dir = path.join(out, 'corpus');
fs.mkdirSync(dir, { recursive: true });
function random(seed) {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
}
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    size = Buffer.alloc(4),
    check = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  check.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([size, t, data, check]);
}
function png(w, h, seed) {
  const r = random(seed),
    raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    let p = y * (w * 3 + 1);
    raw[p++] = 0;
    for (let x = 0; x < w * 3; x++) raw[p++] = r() & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
(async () => {
  const files = [];
  for (let i = 0; i < 24; i++) {
    const group = Math.floor(i / 6),
      within = i % 6,
      kind = ['text-vector', 'jpeg-scan', 'png-scan', 'mixed-report'][group];
    const pdf = await PDFDocument.create();
    pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
    pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
    pdf.setTitle(`Synthetic capacity fixture ${i + 1}`);
    pdf.setProducer('Spec009 synthetic fixture generator');
    pdf.setCreator('Spec009 local benchmark');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages =
      group === 0
        ? 12 + within * 3
        : group === 1
          ? 2 + (within % 3)
          : group === 2
            ? 1 + (within % 2)
            : 4 + within;
    let img;
    if (group) {
      const side =
        group === 1
          ? 1250 + within * 20
          : group === 2
            ? 640 + within * 12
            : 800 + within * 20;
      const source = png(side, side, 9000 + i);
      if (group === 2) img = await pdf.embedPng(source);
      else {
        const input = path.join(dir, `temp-${i}.png`),
          output = path.join(dir, `temp-${i}.jpg`);
        fs.writeFileSync(input, source);
        cp.execFileSync(
          '/usr/bin/sips',
          [
            '-s',
            'format',
            'jpeg',
            '-s',
            'formatOptions',
            '85',
            input,
            '--out',
            output,
          ],
          { stdio: 'ignore' },
        );
        img = await pdf.embedJpg(fs.readFileSync(output));
        fs.unlinkSync(input);
        fs.unlinkSync(output);
      }
    }
    for (let p = 0; p < pages; p++) {
      const landscape = (p + i) % 3 === 0;
      const page = pdf.addPage(landscape ? [842, 595] : [595, 842]);
      const { width, height } = page.getSize();
      page.drawText(
        `SYNTHETIC ONLY | ${kind} #${i + 1} | page ${p + 1}/${pages}`,
        { x: 28, y: height - 30, size: 11, font },
      );
      if (img && p % 2 === 0)
        page.drawImage(img, {
          x: 30,
          y: 60,
          width: width - 60,
          height: height - 110,
        });
      else {
        for (let line = 0; line < 30; line++)
          page.drawText(
            `Test record ${i}-${p}-${line}: employee fixture, no personal data; amount ${line * 17 + i}.`,
            { x: 30, y: height - 60 - line * 14, size: 8, font },
          );
        for (let v = 0; v < 50; v++)
          page.drawRectangle({
            x: 25 + (v % 10) * 45,
            y: 20 + Math.floor(v / 10) * 13,
            width: 38,
            height: 9,
            color: rgb((v % 3) / 3, (i % 7) / 7, (p % 5) / 5),
          });
      }
    }
    const bytes = Buffer.from(await pdf.save({ useObjectStreams: true })),
      name = `fixture-${String(i + 1).padStart(2, '0')}-${kind}.pdf`;
    fs.writeFileSync(path.join(dir, name), bytes);
    files.push({
      name,
      kind,
      pages,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      seed: 9000 + i,
    });
  }
  const total = files.reduce((s, f) => s + f.bytes, 0),
    manifest = {
      schemaVersion: 1,
      generator: 'generate-export-corpus.cjs',
      generatorSha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(__filename))
        .digest('hex'),
      dependencies: {
        node: process.version,
        pdfLib: '1.17.1',
        jpegEncoder: cp
          .execFileSync('/usr/bin/sips', ['--version'], { encoding: 'utf8' })
          .trim(),
      },
      synthetic: true,
      files,
      balanced6000: {
        repetitions: 250,
        totalBytes: total * 250,
        gib: (total * 250) / 2 ** 30,
        averageBytes: total / 24,
      },
      limitations: [
        '24 unique synthetic PDFs repeated 250 times; not 6000 unique real signed documents',
        'Hardlinks and repeated content create warm filesystem-cache bias',
        'Fixed metadata and PRNG; JPEG bytes reproducible only with recorded sips version',
        'Many PDFs reuse embedded image across pages; page count does not imply independent image bytes',
      ],
    };
  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(JSON.stringify(manifest.balanced6000));
})();
