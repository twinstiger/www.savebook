// SaveBook Kindle Push Module
// Sends generated files to Kindle devices via SMTP email
//
// IMPORTANT NOTE:
// Nodemailer relies on Node.js TCP sockets which are NOT available in
// Cloudflare Workers (only outbound fetch is supported). For production,
// use one of these alternatives:
//   1. Cloudflare Email Workers (native email send, no SMTP needed)
//   2. An external transactional email API (Resend, SendGrid, Mailgun)
//   3. An SMTP relay service accessible via HTTP API
//
// This module is structured to be swappable: replace sendViaSMTP with
// an Email-Workers or API implementation. The current implementation
// uses Resend as a reference example (configure RESEND_API_KEY in secrets).

// ============================================================
// Send via Resend (HTTP API - works in Cloudflare Workers)
// ============================================================
export async function sendToKindle(env, fileBuffer, filename, kindleEmail) {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error('Email service not configured. Set RESEND_API_KEY in wrangler secrets.');
    }

    const fromEmail = env.FROM_EMAIL || 'SaveBook <noreply@savebook.net>';

    // Build a multipart/form-data request
    const formData = new FormData();
    formData.append('from', fromEmail);
    formData.append('to', kindleEmail);
    formData.append('subject', 'Convert'); // Kindle convention
    formData.append('text', 'Your SaveBook document is attached.');
    formData.append(
        'attachment',
        new Blob([fileBuffer], { type: filename.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip' }),
        filename
    );

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Email send failed: ${response.status} ${errorText}`);
    }

    return await response.json();
}

// ============================================================
// (Reference only - NOT compatible with Cloudflare Workers)
// SMTP-based send via nodemailer. Kept for documentation; do not
// enable in production unless using a Node.js runtime.
// ============================================================
/*
import nodemailer from 'nodemailer';

export async function sendToKindleSMTP(env, fileBuffer, filename, kindleEmail) {
    const transporter = nodemailer.createTransport({
        host: env.KINDLE_SMTP_HOST,
        port: parseInt(env.KINDLE_SMTP_PORT) || 587,
        secure: false,
        auth: {
            user: env.KINDLE_SMTP_USER,
            pass: env.KINDLE_SMTP_PASS,
        },
    });

    await transporter.sendMail({
        from: env.KINDLE_SMTP_USER,
        to: kindleEmail,
        subject: 'Convert',
        text: 'Your SaveBook document is attached.',
        attachments: [
            {
                filename,
                content: fileBuffer,
            },
        ],
    });
}
*/
