const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Backblaze B2 via its S3-compatible API; bucket stays private, reads are presigned (1h)
const { B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT, B2_REGION } = process.env;
let client = null;
if (B2_KEY_ID && B2_APP_KEY && B2_BUCKET && B2_ENDPOINT && B2_REGION)
  client = new S3Client({ endpoint: B2_ENDPOINT, region: B2_REGION, credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY } });
else console.warn('image upload disabled — set B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT, B2_REGION');

const putImage = (key, buffer, mime) =>
  client.send(new PutObjectCommand({ Bucket: B2_BUCKET, Key: key, Body: buffer, ContentType: mime }));

const signGet = (key) => (client && key ? getSignedUrl(client, new GetObjectCommand({ Bucket: B2_BUCKET, Key: key }), { expiresIn: 3600 }) : null);

module.exports = { get enabled() { return !!client; }, putImage, signGet };
