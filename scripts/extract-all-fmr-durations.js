const { prisma } = require('./src/config/db');
const r2 = require('./src/lib/r2');
const videoStorageSettings = require('./src/services/videoStorageSettings.service');

function parseMvhd(buffer) {
  const idx = buffer.indexOf(Buffer.from('mvhd'));
  if (idx === -1) return null;

  const version = buffer.readUInt8(idx + 4);
  let timescale, duration;

  if (version === 0) {
    timescale = buffer.readUInt32BE(idx + 4 + 12);
    duration = buffer.readUInt32BE(idx + 4 + 16);
  } else if (version === 1) {
    timescale = buffer.readUInt32BE(idx + 4 + 20);
    const high = buffer.readUInt32BE(idx + 4 + 24);
    const low = buffer.readUInt32BE(idx + 4 + 28);
    duration = high * 4294967296 + low;
  } else {
    return null;
  }

  if (timescale > 0) {
    return duration / timescale;
  }
  return null;
}

async function getDurationForUrl(url) {
  // First try 512KB
  let res = await fetch(url, { headers: { Range: 'bytes=0-524287' } });
  let ab = await res.arrayBuffer();
  let buf = Buffer.from(ab);
  let dur = parseMvhd(buf);
  if (dur !== null) return dur;

  // Try last 1MB
  const cr = res.headers.get('content-range');
  if (cr) {
    const total = parseInt(cr.split('/')[1], 10);
    if (total > 524288) {
      const start = Math.max(0, total - 1048576);
      res = await fetch(url, { headers: { Range: `bytes=${start}-${total - 1}` } });
      ab = await res.arrayBuffer();
      buf = Buffer.from(ab);
      dur = parseMvhd(buf);
      if (dur !== null) return dur;
    }
  }

  // Try first 4MB
  res = await fetch(url, { headers: { Range: 'bytes=0-4194303' } });
  ab = await res.arrayBuffer();
  buf = Buffer.from(ab);
  return parseMvhd(buf);
}

function formatDuration(totalSec) {
  const sec = Math.round(totalSec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m} min`;
  return `${s}s`;
}

async function main() {
  const config = await videoStorageSettings.getR2ConfigOrNull();
  if (!config) throw new Error('No R2 config');

  const course = await prisma.course.findFirst({
    where: { slug: 'advanced-fmr-master-class' },
    include: {
      lessons: {
        where: { status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });

  console.log(`Found ${course.lessons.length} published lessons.`);
  const results = [];

  for (const lesson of course.lessons) {
    process.stdout.write(`Checking lesson ${lesson.id}: "${lesson.title}" ... `);
    if (!lesson.videoObjectKey) {
      console.log('NO videoObjectKey!');
      continue;
    }
    const { url } = await r2.signedGetUrl(config, lesson.videoObjectKey);
    const duration = await getDurationForUrl(url);
    if (duration !== null) {
      const rounded = Math.round(duration);
      const formatted = formatDuration(duration);
      console.log(`${duration.toFixed(2)}s (${rounded}s) -> "${formatted}"`);
      results.push({
        id: lesson.id,
        title: lesson.title,
        videoDurationSeconds: rounded,
        duration: formatted,
      });
    } else {
      console.log('FAILED TO PARSE DURATION');
    }
  }

  console.log('\n=== SUMMARY OF ALL 15 PUBLISHED LESSONS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
