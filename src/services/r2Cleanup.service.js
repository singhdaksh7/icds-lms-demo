// Best-effort R2 object cleanup for lessons/courses. Only ever deletes object
// keys that pass the ICDS key-shape check AND are read from our own DB rows -
// never a key supplied by a request.
const { prisma } = require('../config/db');
const r2 = require('../lib/r2');
const videoStorageSettings = require('./videoStorageSettings.service');

// Deletes `key` unless another lesson still references it. Never throws:
// a failed cleanup must not break the admin action that triggered it.
async function deleteObjectIfUnreferenced(key, excludeLessonIds = []) {
  if (!r2.isOwnedObjectKey(key)) return false;
  try {
    const stillUsed = await prisma.lesson.findFirst({
      where: { videoObjectKey: key, id: { notIn: excludeLessonIds } },
      select: { id: true },
    });
    if (stillUsed) return false;
    const config = await videoStorageSettings.getR2ConfigOrNull();
    if (!config) return false;
    return await r2.deleteObject(config, key);
  } catch (err) {
    console.error('R2 cleanup failed:', err && err.name);
    return false;
  }
}

async function deleteObjectsForCourse(lessons) {
  for (const l of lessons) {
    if (l.videoType === 'R2' && l.videoObjectKey) {
      await deleteObjectIfUnreferenced(l.videoObjectKey, lessons.map((x) => x.id));
    }
  }
}

module.exports = { deleteObjectIfUnreferenced, deleteObjectsForCourse };
