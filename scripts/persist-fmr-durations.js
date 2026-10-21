const { prisma } = require('./src/config/db');

const DURATIONS = [
  { id: 7, videoDurationSeconds: 18, duration: '18s' },
  { id: 8, videoDurationSeconds: 1401, duration: '23m 21s' },
  { id: 9, videoDurationSeconds: 1910, duration: '31m 50s' },
  { id: 10, videoDurationSeconds: 308, duration: '5m 8s' },
  { id: 11, videoDurationSeconds: 1384, duration: '23m 4s' },
  { id: 12, videoDurationSeconds: 1364, duration: '22m 44s' },
  { id: 13, videoDurationSeconds: 325, duration: '5m 25s' },
  { id: 14, videoDurationSeconds: 1192, duration: '19m 52s' },
  { id: 15, videoDurationSeconds: 1369, duration: '22m 49s' },
  { id: 16, videoDurationSeconds: 1906, duration: '31m 46s' },
  { id: 17, videoDurationSeconds: 941, duration: '15m 41s' },
  { id: 18, videoDurationSeconds: 570, duration: '9m 30s' },
  { id: 19, videoDurationSeconds: 755, duration: '12m 35s' },
  { id: 20, videoDurationSeconds: 636, duration: '10m 36s' },
  { id: 24, videoDurationSeconds: 1862, duration: '31m 2s' },
];

async function main() {
  console.log(`Persisting verified durations for ${DURATIONS.length} published FMR lessons...`);

  for (const item of DURATIONS) {
    const updated = await prisma.lesson.update({
      where: { id: item.id },
      data: {
        videoDurationSeconds: item.videoDurationSeconds,
        duration: item.duration,
      },
    });
    console.log(`Updated lesson ${updated.id} ("${updated.title}"): videoDurationSeconds = ${updated.videoDurationSeconds}, duration = "${updated.duration}"`);
  }

  // Also update any existing LessonProgress rows that have durationSeconds = 0
  for (const item of DURATIONS) {
    await prisma.lessonProgress.updateMany({
      where: {
        lessonId: item.id,
        durationSeconds: 0,
      },
      data: {
        durationSeconds: item.videoDurationSeconds,
      },
    });
  }

  console.log('Durations successfully persisted to lessons and lesson_progress.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
