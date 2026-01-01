import { Resend } from 'resend';

export const escapeHtml = (str) => str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

async function generateHmac(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifyHmac(message, signature, secret) {
  const expectedSignature = await generateHmac(message, secret);
  return signature === expectedSignature;
}

export default {
  async fetch(request, env) {
    // Handle CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // GET endpoint: Generate HMAC token
    if (request.method === 'GET') {
      const timestamp = Date.now().toString();
      const signature = await generateHmac(timestamp, env.HMAC_SECRET);
      const token = `${timestamp}.${signature}`;

      return new Response(JSON.stringify({ token }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { name, email, message, appVersion, checktoken } = body;

    // Validate token
    if (!checktoken) {
      return new Response(JSON.stringify({ error: 'Token is required' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const [timestamp, signature] = checktoken.split('.');
    if (!timestamp || !signature) {
      return new Response(JSON.stringify({ error: 'Invalid token format' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (isNaN(tokenAge) || tokenAge > TOKEN_EXPIRY_MS) {
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const isValidSignature = await verifyHmac(timestamp, signature, env.HMAC_SECRET);
    if (!isValidSignature) {
      return new Response(JSON.stringify({ error: 'Invalid token signature' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (!message || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!email || email.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const senderName = name || 'Anonymous';
    const version = appVersion || 'Unknown';

    const emailHtml = `
      <p><strong>Feedback from Asset Hoard</strong> — version ${escapeHtml(version)}</p>
      <p><strong>From:</strong> ${escapeHtml(senderName)} &lt;${escapeHtml(email)}&gt;</p>
      <hr>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `;

    try {
      const resend = new Resend(env.RESEND_API_KEY);

      const { error } = await resend.emails.send({
        to: [env.TO_EMAIL],
        replyTo: email,
        from: env.FROM_EMAIL,
        subject: 'Feedback from Asset Hoard',
        html: emailHtml
      });

      if (error) {
        console.error('Resend error:', error);
        return new Response(JSON.stringify({ error: 'Failed to send email' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
