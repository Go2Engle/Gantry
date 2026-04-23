import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Entity, FlowNode } from '../lib/types';
import { entityKey, isMockNode, nodeEntityKey } from '../lib/flow';

const FLOW_HEALTH_POLL_INTERVAL_MS = 30_000;
const FLOW_HEALTH_REQUEST_TIMEOUT_MS = 12_000;

export function useFlowHealth(nodes: FlowNode[], entities: Entity[]) {
  const [healthStatuses, setHealthStatuses] = useState<Map<string, boolean | null>>(new Map());

  const healthUrlKey = useMemo(() => {
    const entityMap = new Map(entities.map((entity) => [entityKey(entity), entity]));
    const pairs: string[] = [];
    for (const node of nodes) {
      if (isMockNode(node)) continue;
      const entity = entityMap.get(nodeEntityKey(node));
      const url = entity?.spec?.healthCheckUrl;
      if (typeof url === 'string' && url.trim()) {
        pairs.push(`${nodeEntityKey(node)}|${url.trim()}`);
      }
    }
    return pairs.sort().join('\n');
  }, [entities, nodes]);

  useEffect(() => {
    let active = true;
    let runVersion = 0;
    const inFlight = new Map<string, AbortController>();
    const urls = new Map<string, string>();

    for (const pair of healthUrlKey.split('\n').filter(Boolean)) {
      const sep = pair.indexOf('|');
      urls.set(pair.slice(0, sep), pair.slice(sep + 1));
    }

    if (urls.size === 0) {
      setHealthStatuses(new Map());
      return () => {
        active = false;
      };
    }

    const check = async () => {
      const currentRun = ++runVersion;
      const next = new Map<string, boolean | null>();

      await Promise.all(
        [...urls.entries()].map(async ([key, url]) => {
          inFlight.get(key)?.abort();

          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), FLOW_HEALTH_REQUEST_TIMEOUT_MS);
          inFlight.set(key, controller);

          try {
            const res = await api.checkHealth(url, controller.signal);
            if (!active || runVersion !== currentRun || controller.signal.aborted) return;
            next.set(key, res.reachable);
          } catch {
            if (!active || runVersion !== currentRun || controller.signal.aborted) return;
            next.set(key, null);
          } finally {
            window.clearTimeout(timeoutId);
            if (inFlight.get(key) === controller) {
              inFlight.delete(key);
            }
          }
        })
      );

      if (active && runVersion === currentRun) {
        setHealthStatuses(next);
      }
    };

    void check();
    const interval = window.setInterval(() => {
      void check();
    }, FLOW_HEALTH_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      for (const controller of inFlight.values()) {
        controller.abort();
      }
      inFlight.clear();
    };
  }, [healthUrlKey]);

  return healthStatuses;
}
