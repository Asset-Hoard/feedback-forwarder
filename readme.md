# Asset Hoard Feedback Forwarder

A Cloudflare Worker that proxies feedback submissions from the Asset Hoard desktop app to email via Resend. This keeps the Resend API key secure server-side while remaining free to host.

## Setup

### Prerequisites

- Cloudflare account (free tier)
- Resend account (free tier — 3,000 emails/month)
- GitHub account

### 1. Configure Resend

1. Sign up at https://resend.com
2. Add and verify your domain in the Resend dashboard
3. Create an API key with "Sending access" permission
4. Save the API key for later

### 2. Configure Cloudflare & Deploy

1. Sign up at https://dash.cloudflare.com
2. Create a new Worker or open an existing one
3. In **Settings → Environment Variables**:
   - Add `RESEND_API_KEY` with your Resend API key
   - Add `TO_EMAIL` with your email (e.g., `mark@example.com`)
   - Add `FROM_EMAIL` with the verified sender email (e.g., `feedback@assethoard.com`)
4. Go to **Settings → Deployments**
5. Under **GitHub**, click **Connect a repository**
6. Select your GitHub repo and authorize Cloudflare
7. Choose the branch to deploy from (`main` recommended)

After setup, your worker will automatically deploy whenever you push to your selected branch. Your worker URL will be:
`https://asset-hoard-feedback.<your-subdomain>.workers.dev`

### Manual Deployment (Alternative)

If you prefer to deploy locally without GitHub integration:

```bash
npm install
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TO_EMAIL
npx wrangler secret put FROM_EMAIL
npm run deploy
```

## Local Development

### Prerequisites

- Node.js 16+ installed
- npm or yarn

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.dev.vars` file** in the project root with your environment variables:
   ```env
   RESEND_API_KEY=your_resend_api_key_here
   TO_EMAIL=your_email@assethoard.com
   FROM_EMAIL=feedback@assethoard.com
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```

The worker will be available at `http://localhost:8787` by default.

### Running Tests

Run the test suite with:

```bash
npm test
```

### Manual Testing

You can test the endpoint with curl:

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "message": "This is a test",
    "appVersion": "1.0.0"
  }'
```

## API Usage

Send a POST request to your worker URL:

```bash
curl -X POST https://asset-hoard-feedback.your-subdomain.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Great app!",
    "appVersion": "1.0.0"
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The feedback message |
| `email` | string | Yes | Sender's email for replies |
| `name` | string | No | Sender's name |
| `appVersion` | string | No | App version for context |

### Responses

- `200` - Success: `{ "success": true }`
- `400` - Bad request (missing message or invalid JSON)
- `405` - Method not allowed (only POST is accepted)
- `500` - Server error

## License

MIT License - see [LICENSE](LICENSE)
