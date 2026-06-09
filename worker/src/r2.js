// SaveBook R2 Storage Module
// Handles file uploads, signed URL generation, and deletion
//
// NOTE: The official Cloudflare R2 binding does NOT expose createSignedUrl.
// We implement S3-compatible presigned URLs using HMAC-SHA256 (aws4-style).
// For production, consider using a Cloudflare Worker with R2's S3-compatible
// API endpoint and aws4-fetch or @aws-sdk/s3-request-presigner.

const AWS_REGION = 'auto';
const SERVICE = 's3';

// ============================================================
// Upload
// ============================================================
export async function uploadToR2(bucket, key, data, contentType) {
    await bucket.put(key, data, {
        httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=604800', // 7 days
        },
        customMetadata: {
            uploadedAt: new Date().toISOString(),
        },
    });
}

// ============================================================
// Signed URL generation (S3-compatible, R2-compatible)
// ============================================================
export async function getSignedUrl(bucket, publicUrl, key, expiresIn = 3600) {
    // If a public R2 URL is configured, prefer it (no signing needed)
    if (publicUrl) {
        return `${publicUrl.replace(/\/$/, '')}/${key}`;
    }

    // Otherwise, check if the bucket binding exposes getSignedUrl (newer API)
    if (typeof bucket.createSignedUrl === 'function') {
        return await bucket.createSignedUrl(key, { expiresIn });
    }
    if (typeof bucket.getSignedUrl === 'function') {
        return await bucket.getSignedUrl(key, { expiresIn });
    }

    // Fallback: build an S3-compatible presigned URL
    // This requires the bucket to be accessed via the S3 endpoint with
    // access key/secret key configured in env. Adjust per your setup.
    const accessKeyId = bucket._accessKeyId || '';
    const secretAccessKey = bucket._secretAccessKey || '';
    if (!accessKeyId || !secretAccessKey) {
        // Last resort: assume R2.dev public access pattern
        throw new Error('Signed URL generation requires R2_PUBLIC_URL env or R2 S3 credentials');
    }

    return buildS3PresignedUrl({
        bucket: bucket.bucketName || 'savebook-files',
        key,
        region: AWS_REGION,
        accessKeyId,
        secretAccessKey,
        expiresIn,
    });
}

async function buildS3PresignedUrl({ bucket, key, region, accessKeyId, secretAccessKey, expiresIn }) {
    const endpoint = `https://${bucket}.${region}.r2.cloudflarestorage.com`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
    const signedHeaders = 'host';
    const algorithm = 'AWS4-HMAC-SHA256';

    const queryParams = new URLSearchParams({
        'X-Amz-Algorithm': algorithm,
        'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expiresIn),
        'X-Amz-SignedHeaders': signedHeaders,
    });

    const canonicalRequest = [
        'GET',
        `/${key}`,
        queryParams.toString(),
        `host:${bucket}.${region}.r2.cloudflarestorage.com\n`,
        signedHeaders,
        'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, SERVICE);
    const signature = await hmacSha256Hex(signingKey, stringToSign);

    queryParams.append('X-Amz-Signature', signature);

    return `${endpoint}/${key}?${queryParams.toString()}`;
}

async function sha256Hex(message) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        typeof key === 'string' ? new TextEncoder().encode(key) : key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = await hmacSha256Raw('AWS4' + key, dateStamp);
    const kRegion = await hmacSha256Raw(kDate, regionName);
    const kService = await hmacSha256Raw(kRegion, serviceName);
    return hmacSha256Raw(kService, 'aws4_request');
}

async function hmacSha256Raw(key, data) {
    const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(sig);
}

// ============================================================
// Delete
// ============================================================
export async function deleteFromR2(bucket, key) {
    await bucket.delete(key);
}

// ============================================================
// List (utility for cleanup scripts)
// ============================================================
export async function listR2Objects(bucket, prefix = '', limit = 1000) {
    const listed = await bucket.list({ prefix, limit });
    return listed.objects || [];
}
