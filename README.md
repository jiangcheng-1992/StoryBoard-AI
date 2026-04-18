# StoryBoard AI

Render-ready version of StoryBoard AI with a backend proxy for model calls.

## What Changed

- Moves visual model requests from the browser to the Render backend.
- Moves ASR requests from the browser to the Render backend.
- Resolves Douyin links on the server instead of public CORS proxy services.
- Proxies remote media through the backend to reduce browser CORS failures.

## Local Run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` and configure these values in Render:

- `ARK_API_KEY`
- `ARK_API_ENDPOINT`
- `ARK_MODEL`
- `ASR_API_KEY`
- `ASR_API_URL`
- `ASR_RESOURCE_ID`
- `MAX_JSON_BODY`
- `REQUEST_TIMEOUT_MS`

## Render Setup

1. Create a new `Web Service` from this repository.
2. Render detects `render.yaml`, or set:
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Add the environment variables listed above.

## API Endpoints

- `GET /api/health`
- `GET /api/config`
- `POST /api/ai/frames`
- `POST /api/asr`
- `POST /api/video/resolve`
- `GET /api/media/proxy`

## Notes

- Real secrets now stay on the server only.
- The browser no longer contains hard-coded model keys.
- Large videos can still be limited by browser-side audio extraction and client memory for local uploads.
