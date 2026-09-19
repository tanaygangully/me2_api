import { app } from '../src/app.js';

// Vercel calls this handler per-request; Express's app object itself is a
// valid (req, res) handler, so nothing else is needed here.
export default app;
