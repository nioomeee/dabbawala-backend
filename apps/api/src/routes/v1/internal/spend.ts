/**
 * POST /v1/internal/spend/buy-intel — Spend Controller buys route intel via x402.
 *
 * The Spend Controller is the SOLE holder of the Hedera payment key.
 * Robot and Fleet Brain hold no payment keys (invariant §4.3.1).
 *
 * ref: ROADMAP.md §4.5 interface C, §B-6
 */

import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@dabbawala/observability";
import { createSpendController, SpendControllerImpl } from "@dabbawala/spend-controller";

const log = createLogger("api:spend");

// ── Spend Controller singleton ────────────────────────────────────────────────

let spendController: SpendControllerImpl | null = null;

async function getSpendController(): Promise<SpendControllerImpl | null> {
  if (!spendController) {
    const result = createSpendController();
    if (!result.ok) {
      log.warn({ missing: result.error }, "Spend Controller not configured - returning PAYMENT_FAILED");
      return null;
    }
    spendController = result.value;
    log.info("Spend Controller initialized");
  }
  return spendController;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const internalSpendRoutes: FastifyPluginAsync = async (app) => {
  // POST /v1/internal/spend/buy-intel
  app.post(
    "/internal/spend/buy-intel",
    {
      schema: {
        tags: ["internal"],
        summary: "Spend Controller buys route intel via x402 payment",
        body: {
          type: "object",
          required: ["legId", "robotId"],
          properties: {
            legId: { type: "string" },
            robotId: { type: "string", enum: ["ramu", "sakhu", "janu"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              intel: { type: "object" },
              txId: { type: "string" },
              source: { type: "string", enum: ["live", "sim"] },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" }, ruleId: { type: "string" } } },
          503: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const { legId, robotId } = req.body as { legId: string; robotId: "ramu" | "sakhu" | "janu" };

      if (!legId || !robotId) {
        return reply.status(400).send({ error: "INVALID_REQUEST_BODY" });
      }

      const controller = await getSpendController();
      if (!controller) {
        log.warn({ legId, robotId }, "Spend Controller not configured — returning PAYMENT_FAILED");
        return reply.status(503).send({ error: "SPEND_CONTROLLER_UNCONFIGURED" });
      }

      try {
        const result = await controller.buyIntel(legId);

        if ("refused" in result) {
          log.warn(
            { legId, robotId, ruleId: result.ruleId },
            "Spend Controller refused payment",
          );
          return reply.status(403).send({
            error: "PAYMENT_REFUSED",
            ruleId: result.ruleId,
          });
        }

        log.info(
          { legId, robotId, txId: result.txId },
          "Spend Controller: payment successful",
        );

        return reply.send({
          intel: result.intel,
          txId: result.txId,
          source: "live",
        });
      } catch (err: unknown) {
        log.error({ err, legId, robotId }, "Spend Controller: unexpected error");
        return reply.status(503).send({ error: "INTERNAL_ERROR" });
      }
    },
  );
};