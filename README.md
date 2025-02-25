# Description

*Capture* is a service for uploading, storing, and retrieving image files instantly.<br>
It runs on Cloudflare Workers using the Hono framework and utilizes Cloudflare's cloud infrastructure for storage.

## Requirements

* Cloudflare account (free plan is OK)
  * Cloudflare Workers, R2
  * Custom domain name (optional)

## API Endpoints

### POST /*

Uploads a file. The path name is saved as the category in the metadata.

- **URL**: `/:prefix[/...]`
- **Method**: `POST`
- **Form Data**:
  - `file`: The file to be uploaded

The path prefix delimiter (`/`) is preserved and becomes the prefix delimiter in R2.<br>
Prefix help in setting rules in R2. <br>
For example, you can set `/temporary/foo` and `/temporary/bar` to be deleted in 1 week and 1 month respectively.<br>

#### Response

plain text

- **Success**: The URL which will be constructed with domainname and R2 `key` to access the uploaded file.
- **Failure**: Error message

### GET /:key

Retrieves a file.

- **URL**: `/:key`
- **Method**: `GET`

Retrieves the image file associated with the given `:key`.<br>
The `:key` should contain prefix.

#### Response

- **Success**: File content (image data)
- **Failure**: Error message (plain text)

## Development

### Environment Variables

The following environment variables need to be set:

- `CAPTURE_BUCKET`: Instance of R2 Bucket
- `R2_DOMAIN`: Custom Domain Name for R2 Bucket

### Install Dependencies

```bash
npm install
```

### Run Locally

```bash
npx wrangler dev
```

### Deploy

```bash
npx wrangler deploy
```

## License

This project is licensed under the MIT License.