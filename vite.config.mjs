import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    base: './',
    plugins: [
        tailwindcss(),
    ],
    // ffmpeg.wasm spawns its own worker; pre-bundling breaks the worker URL.
    optimizeDeps: {
        exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    server: {
        proxy: {
            '/api': {
                target: 'https://api.kie.ai',
                changeOrigin: true,
                secure: false
            },
            '/gpt-5-2': {
                target: 'https://api.kie.ai',
                changeOrigin: true,
                secure: false
            },
            '/.netlify/functions': {
                target: 'https://higgsfield-matu.netlify.app',
                changeOrigin: true,
                secure: true
            },
            '/download-media': {
                target: 'https://higgsfield-matu.netlify.app',
                changeOrigin: true,
                secure: true
            }
        }
    }
});
