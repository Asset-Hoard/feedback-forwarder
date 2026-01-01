import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { escapeHtml } from './index.js';

// Mock send function that can be configured per test
const mockSend = vi.fn().mockResolvedValue({ error: null });

// Mock the Resend module with a proper class
vi.mock('resend', () => ({
  Resend: class MockResend {
    constructor() {
      this.emails = { send: mockSend };
    }
  }
}));

const mockEnv = {
  RESEND_API_KEY: 'test_key',
  TO_EMAIL: 'test@example.com',
  FROM_EMAIL: 'from@example.com',
  HMAC_SECRET: 'test_secret_key_for_hmac_signing'
};

async function getValidToken() {
  const request = createRequest('GET');
  const response = await worker.fetch(request, mockEnv);
  const body = await response.json();
  return body.token;
}

function createRequest(method, body = null) {
  const options = { method };
  if (body) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request('http://localhost', options);
}

describe('escapeHtml', () => {
  it('should escape ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape less than signs', () => {
    expect(escapeHtml('foo < bar')).toBe('foo &lt; bar');
  });

  it('should escape greater than signs', () => {
    expect(escapeHtml('foo > bar')).toBe('foo &gt; bar');
  });

  it('should escape double quotes', () => {
    expect(escapeHtml('foo "bar" baz')).toBe('foo &quot;bar&quot; baz');
  });

  it('should escape all special characters together', () => {
    expect(escapeHtml('<script>"alert(1)"</script> & more'))
      .toBe('&lt;script&gt;&quot;alert(1)&quot;&lt;/script&gt; &amp; more');
  });

  it('should handle XSS payloads', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});

describe('Feedback Forwarder Worker', () => {
  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = createRequest('OPTIONS');
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });
  });

  describe('HTTP Methods', () => {
    it('should accept GET requests and return a token', async () => {
      const request = createRequest('GET');
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.token).toBeDefined();
      expect(body.token).toMatch(/^\d+\..+$/);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should reject PUT requests', async () => {
      const request = createRequest('PUT');
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(405);
      const body = await response.json();
      expect(body.error).toBe('Method not allowed');
    });

    it('should reject DELETE requests', async () => {
      const request = createRequest('DELETE');
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(405);
      const body = await response.json();
      expect(body.error).toBe('Method not allowed');
    });
  });

  describe('Token Validation', () => {
    it('should reject POST without token', async () => {
      const request = createRequest('POST', {
        email: 'test@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Token is required');
    });

    it('should reject POST with invalid token format', async () => {
      const request = createRequest('POST', {
        checktoken: 'invalid-token-no-dot',
        email: 'test@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Invalid token format');
    });

    it('should reject POST with expired token', async () => {
      const expiredTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
      const request = createRequest('POST', {
        checktoken: `${expiredTimestamp}.fakesignature`,
        email: 'test@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Token expired');
    });

    it('should reject POST with invalid signature', async () => {
      const timestamp = Date.now().toString();
      const request = createRequest('POST', {
        checktoken: `${timestamp}.invalidsignature`,
        email: 'test@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Invalid token signature');
    });

    it('should accept POST with valid token', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', {
        checktoken: token,
        email: 'test@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid JSON', async () => {
      const request = createRequest('POST', 'not valid json');
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid JSON');
    });

    it('should require message field', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', { checktoken: token, email: 'test@example.com' });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Message is required');
    });

    it('should reject empty message', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', { checktoken: token, email: 'test@example.com', message: '   ' });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Message is required');
    });

    it('should require email field', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', { checktoken: token, message: 'Test feedback' });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Email is required');
    });

    it('should reject empty email', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', { checktoken: token, message: 'Test feedback', email: '  ' });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Email is required');
    });
  });

  describe('Successful Requests', () => {
    it('should accept valid feedback with all fields', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', {
        checktoken: token,
        name: 'John Doe',
        email: 'john@example.com',
        message: 'Great app!',
        appVersion: '1.2.3'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should accept valid feedback with only required fields', async () => {
      const token = await getValidToken();
      const request = createRequest('POST', {
        checktoken: token,
        email: 'john@example.com',
        message: 'Great app!'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle Resend API errors gracefully', async () => {
      mockSend.mockResolvedValueOnce({ error: { message: 'API Error' } });

      const token = await getValidToken();
      const request = createRequest('POST', {
        checktoken: token,
        email: 'john@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to send email');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle Resend exceptions gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      const token = await getValidToken();
      const request = createRequest('POST', {
        checktoken: token,
        email: 'john@example.com',
        message: 'Test'
      });
      const response = await worker.fetch(request, mockEnv);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});
