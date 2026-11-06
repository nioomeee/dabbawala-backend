/**
 * 0G Runtime service lifecycle management.
 *
 * Initialised once per backend process, reused across requests,
 * and closed cleanly during graceful shutdown.
 * ref: user prompt §3, §7, §10
 */

import {
  createZeroGRuntime,
  type ZeroGRuntime,
} from "@dabbawala/zero-g-adapter";
import { createLogger } from "@dabbawala/observability";
import { lintEpisodeLog } from "./log-lint.js";

const log = createLogger("api:zerog");

let _zeroG: ZeroGRuntime | null = null;
let _configIssues: readonly string[] = [];

export function initZeroG(env: NodeJS.ProcessEnv = process.env): ZeroGRuntime | null {
  if (_zeroG) return _zeroG;

  const adapterLogger = {
    info: (obj: Record<string, unknown>, msg: string) => log.info(obj, msg),
    warn: (obj: Record<string, unknown>, msg: string) => log.warn(obj, msg),
    error: (obj: Record<string, unknown>, msg: string) => log.error(obj, msg),
  };

  const runtimeResult = createZeroGRuntime(env, {
    logger: adapterLogger,
    extraLint: (content: string) => {
      const lintRes = lintEpisodeLog(content);
      if (!lintRes.ok) {
        return {
          ok: false,
          findings: lintRes.violations.map((v) => ({
            pattern: v.pattern,
            path: "$",
          })),
        };
      }
      return { ok: true };
    },
  });

  if (!runtimeResult.ok) {
    // Report configuration issue names ONLY — never log secret values.
    _configIssues = runtimeResult.error.map((i) => i.variable);
    log.warn(
      { configIssues: _configIssues },
      "0G adapter configuration incomplete/invalid — runtime entering blocked fallback",
    );
    return null;
  }

  _zeroG = runtimeResult.value;
  const readiness = _zeroG.readiness();
  log.info(
    {
      computeStatus: readiness.compute.status,
      storageStatus: readiness.storage.status,
      computeModel: readiness.compute.model,
    },
    "0G runtime successfully initialised",
  );

  return _zeroG;
}

export function getZeroG(): ZeroGRuntime | null {
  return _zeroG;
}

export function getConfigIssues(): readonly string[] {
  return _configIssues;
}

export async function closeZeroG(): Promise<void> {
  if (_zeroG) {
    try {
      await _zeroG.close();
      log.info("0G runtime closed cleanly");
    } catch (err) {
      log.error({ err }, "Error closing 0G runtime");
    } finally {
      _zeroG = null;
    }
  }
}
