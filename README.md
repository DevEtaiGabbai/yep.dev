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

### AWS Credential Mapping:
- `S3_UPLOAD_KEY` = Your **AWS Access Key ID** (from AWS IAM)
- `S3_UPLOAD_SECRET` = Your **AWS Secret Access Key** (from AWS IAM)
- `S3_UPLOAD_BUCKET` = Your **S3 Bucket Name**
- `S3_UPLOAD_REGION` = Your **AWS Region** (e.g., us-west-1, us-east-1)

### S3 Bucket Permissions:
Make sure your S3 bucket has the following CORS configuration:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT"],
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

## Features

- AI-powered code generation and assistance
- Image upload support with drag & drop and paste functionality
- Real-time collaboration
- WebContainer integration for live code execution

## Database Setup

Init database locally:

```bash
docker run --name my-postgres-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=aichatbot -p 5432:5432 -v pgdata:/var/lib/postgresql/data -d postgres
```
