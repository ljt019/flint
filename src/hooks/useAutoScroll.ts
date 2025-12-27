import { useRef, useEffect, useCallback } from "react";

interface UseAutoScrollOptions<T> {
  messages: T[];
  bottomThreshold?: number;
  scrollDelay?: number;
}

export function useAutoScroll<T>({
  messages,
  bottomThreshold = 50,
  scrollDelay = 10,
}: UseAutoScrollOptions<T>) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const getViewport = (): HTMLElement | null => {
    if (!scrollAreaRef.current) return null;
    return scrollAreaRef.current.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;
  };

  const handleScroll = () => {
    const viewport = getViewport();
    if (viewport) {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      wasAtBottomRef.current = scrollHeight - scrollTop - clientHeight < bottomThreshold;
    }
  };

  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (viewport) {
      setTimeout(() => {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: "smooth",
        });
      }, scrollDelay);
    }
  }, [scrollDelay]);

  useEffect(() => {
    if (messages.length > 0 && wasAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  return {
    scrollAreaRef,
    handleScroll,
    scrollToBottom,
  };
}
