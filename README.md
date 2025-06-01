# GeminiCoder

A powerful AI-powered coding assistant with image upload support.

## Environment Configuration

To enable image uploads, create a `.env.local` file in your project root with your AWS S3 credentials:

```bash
# S3 Configuration for Image Uploads
S3_UPLOAD_KEY=your_aws_access_key_id
S3_UPLOAD_SECRET=your_aws_secret_access_key
S3_UPLOAD_BUCKET=your_s3_bucket_name
S3_UPLOAD_REGION=your_aws_region

# Optional: Custom S3 endpoint (for services like DigitalOcean Spaces)
# S3_UPLOAD_ENDPOINT=https://your-region.digitaloceanspaces.com
```

## Database Setup

Init database locally:

```bash
docker run --name my-postgres-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=aichatbot -p 5432:5432 -v pgdata:/var/lib/postgresql/data -d postgres
```
# run migrations
```bash
npx prisma migrate dev
```

## Running the Application
To start the application, run:
```bash
npm run build

npm run start
```
