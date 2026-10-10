# Description

_Capture_ is a service for uploading, storing, and retrieving image files instantly.<br>
It runs on Cloudflare Workers using the Hono framework and utilizes Cloudflare's cloud infrastructure for storage.

_Capture_ returns an R2 public access URL, so using a custom domain for R2 is highly recommended.

## Requirements

- Cloudflare account (free plan is OK)
  - Cloudflare Workers, R2
  - Custom domain name (optional)

## API Endpoints

### POST /\*

Uploads a file. The path name is saved as the category in the metadata.

- **URL**: `/:prefix[/...]`
- **Method**: `POST`
- **Headers**: `Authorization: Bearer <API_TOKEN>` (when `API_TOKEN` is set)
- **Form Data**:
  - `file`: The image file to be uploaded (PNG, JPEG, GIF, WebP or AVIF, up to 20 MiB)

The prefix is required and may contain only alphanumerics, `-` and `_` in each segment.
The file type is detected from its content (magic bytes); the declared Content-Type and file name are ignored.<br>
The object key is `<prefix>/<uuid>.<ext>`, where the extension is derived from the detected type.

The path prefix delimiter (`/`) is preserved and becomes the prefix delimiter in R2.<br>
Prefixes help in setting rules in R2. <br>
For example, you can set `/temporary/foo` and `/temporary/bar` to be deleted in 1 week and 1 month respectively.<br>

#### Response

plain text

- **Success** (`201`): The URL which has been constructed with the domain name and R2 `key` to access the uploaded file.
- **Failure**: Error message (`400` invalid prefix or missing file, `401` unauthorized, `413` too large, `415` unsupported type)

### GET /\*

Serves `static/<path>` from the bucket without authorization, cached by the Cloudflare edge.
Files uploaded with `POST /static` can be retrieved through this endpoint.

## Development

### Install Dependencies

```bash
npm install
```

### Run Locally

```bash
npx wrangler dev
```

### Test

```bash
npm run typecheck
npm test
```

### Deploy

```bash
npx wrangler deploy
```

### Environment Variables

The following environment variables need to be set:

- `CAPTURE_BUCKET`: R2 Bucket binding (bucket name is given by `R2_BUCKET_NAME` at deploy time).
- `R2_DOMAIN`: Custom Domain Name for R2 Bucket.
- `CORS_ORIGINS`: Comma-separated list of allowed origins for CORS.
- `API_TOKEN` (secret): API Token for upload authorization. If it's not set or empty, no authorization is required.
  Set it with `npx wrangler secret put API_TOKEN`, or via the `CAPTURE_API_TOKEN` repository secret in GitHub Actions.

## License

This project is licensed under the BSD 2-Clause License.
