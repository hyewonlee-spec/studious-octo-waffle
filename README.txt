Arcane Binder Vercel build fix

Replace this file in your GitHub repository:

/tsconfig.json

This changes moduleResolution from deprecated Node/node10 resolution to Bundler resolution, which is appropriate for a Vite app and fixes TS5107 on Vercel.
