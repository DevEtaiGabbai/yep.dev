// app/api/s3-upload/route.ts
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextRequest, NextResponse } from 'next/server';

const s3Client = new S3Client({
  region: process.env.S3_UPLOAD_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_UPLOAD_KEY!,
    secretAccessKey: process.env.S3_UPLOAD_SECRET!,
  },
});

// Helper function to get signed URL for images
async function getImageSignedUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_UPLOAD_BUCKET,
    Key: key,
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 5 * 24 * 60 * 60, // URL valid for 5 days
  });

  return signedUrl;
}

export async function POST(request: NextRequest) {
  try {
    // Check if required environment variables are set
    if (!process.env.S3_UPLOAD_KEY || !process.env.S3_UPLOAD_SECRET || !process.env.S3_UPLOAD_BUCKET) {
      console.error('Missing S3 environment variables');
      return NextResponse.json(
        { error: 'S3 configuration is missing. Please check your environment variables.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = file.name.split('.').pop() || 'jpg';
    const key = `chat-images/${timestamp}-${randomString}.${fileExtension}`;

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: process.env.S3_UPLOAD_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      ContentLength: buffer.length,
    });

    await s3Client.send(command);

    const signUrl = await getImageSignedUrl(key)
    const relativeUrl = `/api/images/${encodeURIComponent(key)}`;

    return NextResponse.json({ url: relativeUrl, signUrl });
  } catch (error) {
    console.error('Error uploading to S3:', error);
    return NextResponse.json(
      { error: 'Failed to upload image. Please try again.' },
      { status: 500 }
    );
  }
}
