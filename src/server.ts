/**
 * ENSv2 Subname Registration HTTP Server
 *
 * Exposes POST /subnames for agent-assisted registration.
 * Validates labels, addresses, rate-limits, and maintains a nonce-safe
 * retry queue. Never logs secrets.
 *
 * Ref: R-ENS-2, R-ENS-4, R-ENS-7, AGENTS.md §12
 */

import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { viemClient } from "./config";
import {
  ADDRESSES,
  type SubnameConfig,
  runPreflight,
  assertPreflight,
  registerSubname,
  type PreflightChecks,
} from "./";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const log = require("pino")({ level: "info" });

// ── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Validation schemas ───────────────────────────────────────────────────────

const labelSchema = z.string()
  .regex(/^[a-z0-9-]+$/, "label must be lowercase alphanumeric and hyphens")
  .min(1)
  .max(63);

const ownerSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "owner must be a valid Ethereum address");

const subnameConfigSchema = z.object({
  label: labelSchema,
  owner: ownerSchema,
  roleBitmap: z.bigint().optional(),
  expiry: z.number().optional(),
});

type SubnameConfigZod = z.infer<typeof subnameConfigSchema>;

// ── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(helmet());
app.use(limiter);
app.use(express.json());

// ── POST /subnames ─────────────────────────────────────────────────────────

app.post(
  "/subnames",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = subnameConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() });
      }

      const body: SubnameConfigZod = parsed.data;

      // 1. Preflight checks
      const checks = await runPreflight([{
        label: parsed.data.label,
        owner: parsed.data.owner,
        roleBitmap: parsed.data.roleBitmap,
        expiry: parsed.data.expiry,
      }]);

      assertPreflight(checks, [{
        label: parsed.data.label,
        owner: parsed.data.owner,
        roleBitmap: parsed.data.roleBitmap,
        expiry: parsed.data.expiry,
      }]);

      // 2. Register the subname
      const result = await registerSubname({
        label: parsed.data.label,
        owner: parsed.data.owner,
        roleBitmap: parsed.data.roleBitmap,
        expiry: parsed.data.expiry,
      });

      if (result.success) {
        return res.status(200).json({
          success: true,
          txHash: result.txHash,
          idempotent: result.idempotent ?? false,
          label: parsed.data.label,
        });
      } else {
        return res.status(500).json({
          error: result.failure || "Registration failed",
        });
      }
    } catch (err: any) {
      log.error({ error: err.message, label: req.body.label }, "Subname registration error");
      return res.status(500).json({ error: err.message });
    }
  },
);

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/health", async (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.info(`ENSv2 Subname Server listening on port ${PORT}`);
  log.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;