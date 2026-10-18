const nextConfig = {
  output: 'standalone',
  eslint: {
    // Vercel sets CI=true, which turns lint warnings into failed builds even when
    // `next build` succeeds locally. App is JS (no tsconfig typecheck); keep deploy
    // compiling while lint stays a local `next lint` concern.
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
    // Remove if not using Server Components
    serverComponentsExternalPackages: ['mongodb', 'googleapis', 'unpdf', 'tesseract.js', 'tesseract.js-core'],
    // Playwright is a local-agent devDependency. NFT tracing it into every
    // serverless function blows past Vercel's size limit after a successful compile.
    // The bid-report route must not trace fixtures, sample PDFs, or the CLI scripts.
    outputFileTracingExcludes: {
      '*': [
        'node_modules/playwright/**',
        'node_modules/playwright-core/**',
        'node_modules/@playwright/**',
        'scripts/gem-local-agent.js',
        'scripts/gem-agent-server.js',
        './fixtures/**',
        './sample_tenders/**',
        './scripts/**',
        './test_reports/**',
        './tests/**',
        './.git/**',
        'fixtures/**',
        'sample_tenders/**',
        'scripts/**',
        'test_reports/**',
        'tests/**',
        '.git/**',
      ],
      '/api/**': [
        './fixtures/**',
        './sample_tenders/**',
        './scripts/**',
        './test_reports/**',
        './tests/**',
        './.git/**',
        'fixtures/**',
        'sample_tenders/**',
        'scripts/**',
        'test_reports/**',
        'tests/**',
        '.git/**',
      ],
    },
    // tesseract.js loads these wasm files by path. Keep only this package, not the repo.
    outputFileTracingIncludes: {
      '/api/reports/bid': ['./node_modules/tesseract.js-core/**/*', './node_modules/tesseract.js/src/worker-script/**/*'],
      '/api/reports/bid/route': ['./node_modules/tesseract.js-core/**/*', './node_modules/tesseract.js/src/worker-script/**/*'],
    },
    // Required on Next 14.x for instrumentation.js's register() hook to fire (it's
    // stable/default from Next 15 onward). Used to auto-start the local GeM agent
    // bridge — see instrumentation.js.
    instrumentationHook: true,
  },
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
