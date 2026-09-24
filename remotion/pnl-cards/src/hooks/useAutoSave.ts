import { useEffect, useRef } from "react";

/** 跳过首次 hydrate，之后 debounce 自动写入 localStorage；卸载或切换 key 时立即 flush */
export function useAutoSave<T>(
  value: T | null,
  save: (value: T) => void,
  resetKey?: string | number,
  delayMs = 400
): void {
  const skip = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    return () => {
      if (valueRef.current != null) save(valueRef.current);
    };
  }, [save, resetKey]);

  useEffect(() => {
    skip.current = true;
  }, [resetKey]);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (value == null) return;
    const timer = window.setTimeout(() => save(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, save, delayMs]);
}
