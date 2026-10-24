// Cloudflare R2 (S3-compatible) helpers. The bucket is assumed PRIVATE: bytes
// are only ever reachable through short-lived presigned GET URLs minted after
// ICDS has authorized the viewer (see media.controller.js). Credentials never
// leave the server and are never rendered into HTML or returned by any API.
const crypto = require('crypto');
const {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Short-lived: long enough to start/seek, short enough that a leaked URL dies
// quickly. The player transparently fetches a fresh one when it expires.
const SIGNED_URL_TTL_SECONDS = 600;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 3600;

const PART_SIZE = 16 * 1024 * 1024; // multipart part size (R2 minimum is 5 MiB)
const QUEUE_SIZE = 3; // parts in flight => bounded memory (~PART_SIZE * QUEUE_SIZE)

// courses/<courseId>/lessons/<lessonId|new>/<uuid>.<mp4|webm>
const OBJECT_KEY_RE = /^courses\/\d{1,10}\/lessons\/(?:\d{1,10}|new)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|webm)$/;
// courses/<courseId|slug>/resources/<uuid|filename>.<ext>
const RESOURCE_KEY_RE = /^courses\/(?:\d{1,10}|[a-z0-9_-]+)\/resources\/[a-zA-Z0-9_.-]+\.(?:pdf|zip|docx?|xlsx?|png|jpe?g)$/i;

// courses/<courseId>/testimonials/<testimonialId|new>/<uuid>.<mp4|webm> - PUBLIC marketing
// videos. A separate prefix so they can never be mistaken for (or served as) protected
// lesson videos: the testimonial delivery path signs ONLY this shape.
const TESTIMONIAL_KEY_RE = /^courses\/\d{1,10}\/testimonials\/(?:\d{1,10}|new)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp4|webm)$/;

function isTestimonialObjectKey(key) {
  return typeof key === 'string' && key.length <= 200 && TESTIMONIAL_KEY_RE.test(key);
}

function isOwnedObjectKey(key) {
  return typeof key === 'string' && key.length <= 200 && (OBJECT_KEY_RE.test(key) || RESOURCE_KEY_RE.test(key) || TESTIMONIAL_KEY_RE.test(key));
}

function buildTestimonialObjectKey(courseId, testimonialId, extension) {
  if (!Number.isInteger(courseId) || courseId < 1) throw new Error('Invalid course id.');
  if (testimonialId !== 'new' && (!Number.isInteger(testimonialId) || testimonialId < 1)) throw new Error('Invalid testimonial id.');
  if (extension !== '.mp4' && extension !== '.webm') throw new Error('Unsupported video extension.');
  return `courses/${courseId}/testimonials/${testimonialId}/${crypto.randomUUID()}${extension}`;
}

// Keys are always server-generated; the uploaded filename is never used.
function buildObjectKey(courseId, lessonId, extension) {
  if (!Number.isInteger(courseId) || courseId < 1) throw new Error('Invalid course id.');
  if (lessonId !== 'new' && (!Number.isInteger(lessonId) || lessonId < 1)) throw new Error('Invalid lesson id.');
  if (extension !== '.mp4' && extension !== '.webm') throw new Error('Unsupported video extension.');
  return `courses/${courseId}/lessons/${lessonId}/${crypto.randomUUID()}${extension}`;
}

function buildResourceObjectKey(courseId, extension = '.pdf') {
  if (!Number.isInteger(courseId) || courseId < 1) throw new Error('Invalid course id.');
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return `courses/${courseId}/resources/${crypto.randomUUID()}${ext}`;
}

function endpointFor(config) {
  if (config.endpoint) return config.endpoint.replace(/\/+$/, '');
  return `https://${config.accountId}.r2.cloudflarestorage.com`;
}

const clientCache = new Map();
function getClient(config) {
  const cacheKey = crypto
    .createHash('sha256')
    .update([endpointFor(config), config.accessKeyId, config.secretAccessKey, config.bucket].join('\u0000'))
    .digest('hex');
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: endpointFor(config),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // R2 does not accept the SDK's newer default CRC32 trailer/params.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    clientCache.clear(); // only the active config is kept
    clientCache.set(cacheKey, client);
  }
  return client;
}

// Streams `body` to R2 as a multipart upload without buffering the file.
// Resolves with the uploaded object's metadata; aborts the multipart upload
// (leaving no orphan parts) if anything fails.
async function uploadStream(config, key, body, contentType) {
  if (!isOwnedObjectKey(key)) throw new Error('Refusing to upload to an invalid object key.');
  const upload = new Upload({
    client: getClient(config),
    params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
    partSize: PART_SIZE,
    queueSize: QUEUE_SIZE,
    leavePartsOnError: false,
  });
  try {
    await upload.done();
  } catch (err) {
    try { await upload.abort(); } catch { /* best effort */ }
    throw err;
  }
  return headObject(config, key);
}

async function headObject(config, key) {
  const out = await getClient(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  return { size: Number(out.ContentLength), contentType: out.ContentType || null };
}

async function objectExists(config, key) {
  try {
    await headObject(config, key);
    return true;
  } catch (err) {
    if (err && (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404)) return false;
    throw err;
  }
}

// Only ICDS-generated keys can ever be deleted; anything else is a no-op.
async function deleteObject(config, key) {
  if (!isOwnedObjectKey(key)) return false;
  await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  return true;
}

async function signedGetUrl(config, key, ttlSeconds = SIGNED_URL_TTL_SECONDS, options = {}) {
  if (!isOwnedObjectKey(key)) throw new Error('Invalid object key.');
  const ttl = Math.min(Math.max(Math.floor(ttlSeconds), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
  const commandParams = { Bucket: config.bucket, Key: key };
  if (options && options.filename) {
    commandParams.ResponseContentDisposition = `inline; filename="${options.filename.replace(/"/g, '')}"`;
  }
  const url = await getSignedUrl(
    getClient(config),
    new GetObjectCommand(commandParams),
    { expiresIn: ttl }
  );
  return { url, expiresInSeconds: ttl };
}

// --- Direct browser -> R2 multipart upload -------------------------------------
// ICDS authorizes and orchestrates; the browser PUTs each part straight to R2
// with a short-lived presigned URL, so large videos never pass through the VPS
// or its reverse proxy (which would time out). The Secret Access Key never
// reaches the browser - only per-part signed URLs do.
const PART_URL_TTL_SECONDS = 3600;

async function createMultipart(config, key, contentType) {
  if (!isOwnedObjectKey(key)) throw new Error('Invalid object key.');
  const out = await getClient(config).send(
    new CreateMultipartUploadCommand({ Bucket: config.bucket, Key: key, ContentType: contentType })
  );
  return out.UploadId;
}

async function signUploadPartUrl(config, key, uploadId, partNumber) {
  if (!isOwnedObjectKey(key)) throw new Error('Invalid object key.');
  return getSignedUrl(
    getClient(config),
    new UploadPartCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: PART_URL_TTL_SECONDS }
  );
}

async function completeMultipart(config, key, uploadId, parts) {
  if (!isOwnedObjectKey(key)) throw new Error('Invalid object key.');
  await getClient(config).send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
    })
  );
}

async function abortMultipart(config, key, uploadId) {
  if (!isOwnedObjectKey(key)) return;
  await getClient(config).send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }));
}

// First `n` bytes of an object (for file-signature verification).
async function readHead(config, key, n = 16) {
  const out = await getClient(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: `bytes=0-${n - 1}` })
  );
  const chunks = [];
  for await (const c of out.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

// Safe connectivity check: bucket HEAD (exists + credentials valid) and a
// tiny temporary object written then deleted under a reserved prefix. Never
// touches lesson videos.
async function testConnection(config) {
  const client = getClient(config);
  const result = { bucketReachable: false, canWrite: false, canDelete: false };
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  result.bucketReachable = true;
  const key = `_icds-connection-test/${crypto.randomUUID()}.txt`;
  await client.send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: 'icds connection test', ContentType: 'text/plain' })
  );
  result.canWrite = true;
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  result.canDelete = true;
  return result;
}

// Strips anything credential-like from an SDK error before it is shown.
function describeError(err) {
  const code = (err && (err.name || err.Code)) || 'Error';
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  const hints = {
    NoSuchBucket: 'Bucket not found - check the bucket name.',
    InvalidAccessKeyId: 'Access Key ID is not valid.',
    SignatureDoesNotMatch: 'Secret Access Key does not match the Access Key ID.',
    AccessDenied: 'Access denied - the API token needs Object Read & Write on this bucket.',
    Forbidden: 'Access denied - the API token needs Object Read & Write on this bucket.',
  };
  const hint = hints[code] || (status === 403 ? hints.AccessDenied : null);
  return hint || `Connection failed (${code}${status ? `, HTTP ${status}` : ''}).`;
}

module.exports = {
  SIGNED_URL_TTL_SECONDS,
  isOwnedObjectKey,
  isTestimonialObjectKey,
  buildTestimonialObjectKey,
  buildObjectKey,
  buildResourceObjectKey,
  endpointFor,
  uploadStream,
  headObject,
  objectExists,
  deleteObject,
  signedGetUrl,
  createMultipart,
  signUploadPartUrl,
  completeMultipart,
  abortMultipart,
  readHead,
  testConnection,
  describeError,
};
