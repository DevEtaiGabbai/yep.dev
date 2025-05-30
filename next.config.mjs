/** @type {import('next').NextConfig} */
// const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";

const nextConfig = {
    reactStrictMode: true,

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

    webpack: (config, { isServer }) => {
        // Enable WebAssembly
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
            layers: true,
        };

        // Add Monaco Editor plugin for client-side only
        if (!isServer) {
            config.plugins.push(
                new MonacoWebpackPlugin({
                    languages: ['javascript', 'typescript', 'html', 'css', 'json', 'markdown', 'python', 'shell', 'java', 'go', 'ruby', 'php', 'scss', 'less', 'yaml', 'xml', 'sql', 'graphql', 'vue', 'astro', 'svelte'],
                    filename: 'static/[name].worker.js',
                })
            );
        }

        return config;
    },
};

export default nextConfig;
