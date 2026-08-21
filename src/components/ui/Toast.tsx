"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

type ToastTone = "success" | "error" | "info";

type Toast = { id: string; tone: ToastTone; message: string };

const ToastContext = createContext<{
  show: (message: string, tone?: ToastTone) => void;
} | null>(null);

/**
 * The app previously had no notification channel at all — feedback was a
 * button that relabelled itself. That works for a save in place, but not for
 * submitting an order or a kitchen status change that happens away from the
 * control that triggered it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors stay up longer — they usually ask the reader to do something.
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl2 border px-3 py-2.5 text-sm shadow-card",
              toast.tone === "error"
                ? "border-tomato-dark bg-tomato-dark text-cream"
                : toast.tone === "info"
                ? "border-cream-deep bg-white text-charcoal"
                : "border-basil bg-basil text-cream"
            )}
          >
            <span className="mt-0.5 shrink-0">
              {toast.tone === "error" ? (
                <AlertTriangle size={16} />
              ) : toast.tone === "info" ? (
                <Info size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
            </span>
            <span className="min-w-0 flex-1 font-600">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a no-op outside the provider so a component can never crash on it. */
export function useToast() {
  return useContext(ToastContext) ?? { show: () => {} };
}
