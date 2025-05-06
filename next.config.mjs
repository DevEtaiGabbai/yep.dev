/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true, // You might have other configurations here

    async headers() {
    return [
        {
        source: '/(.*)', // Apply headers to all routes
        headers: [
            {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
            },
            {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
            },
        ],
        },
    ];
    },
};

export default nextConfig;