import type { Entity, Repository } from "@/lib/storage/types";

export type StorageRequestKind = "plan" | "dish" | "house-recipe";
export const STORAGE_REQUEST_EVENT = "mamma-calories:storage-request";

export interface StorageRequestDetail {
  kind: StorageRequestKind;
  operation: keyof Repository<Entity>;
  phase: "start" | "end";
  durationMs?: number;
  ok?: boolean;
}

function emit(detail: StorageRequestDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StorageRequestDetail>(STORAGE_REQUEST_EVENT, { detail })
  );
  if (process.env.NODE_ENV === "development") {
    console.debug(
      `[storage:${detail.kind}] ${String(detail.operation)} ${detail.phase}`,
      detail
    );
  }
}

/** Adds observable timing around the three data reads that shape planner UI. */
export function instrumentRepository<T extends Entity>(
  kind: StorageRequestKind,
  repository: Repository<T>
): Repository<T> {
  const timed = <A extends unknown[], R>(
    operation: keyof Repository<T>,
    request: (...args: A) => Promise<R>
  ) => async (...args: A): Promise<R> => {
    const started =
      typeof performance === "undefined" ? Date.now() : performance.now();
    emit({ kind, operation, phase: "start" });
    try {
      const result = await request(...args);
      const ended =
        typeof performance === "undefined" ? Date.now() : performance.now();
      emit({
        kind,
        operation,
        phase: "end",
        durationMs: ended - started,
        ok: true,
      });
      return result;
    } catch (error) {
      const ended =
        typeof performance === "undefined" ? Date.now() : performance.now();
      emit({
        kind,
        operation,
        phase: "end",
        durationMs: ended - started,
        ok: false,
      });
      throw error;
    }
  };

  return {
    list: timed("list", repository.list.bind(repository)),
    latest: timed("latest", repository.latest.bind(repository)),
    get: timed("get", repository.get.bind(repository)),
    save: timed("save", repository.save.bind(repository)),
    remove: timed("remove", repository.remove.bind(repository)),
  };
}
