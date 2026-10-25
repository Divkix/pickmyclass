import { z } from "zod";

// Zod probes `new Function("")` for its JIT when each object schema is built,
// which the CSP blocks and reports. Import this before anything that defines schemas.
z.config({ jitless: true });
