import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

interface ExampleCardCarouselProps {
  itemCount: number;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  itemKeys?: readonly string[];
  children: ReactNode;
  className?: string;
}

/** Shared gesture and pagination shell for Learning and Reference examples. */
export function ExampleCardCarousel({
  itemCount,
  currentIndex,
  onIndexChange,
  itemKeys = [],
  children,
  className = '',
}: ExampleCardCarouselProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const pointerStartX = useRef(0);
  const dragOffsetRef = useRef(0);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < itemCount - 1;

  useEffect(() => {
    dragOffsetRef.current = 0;
    setDragOffset(0);
    setIsDragging(false);
  }, [currentIndex, itemCount]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, textarea, .tok-word')) return;
    pointerStartX.current = event.clientX;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; visible controls remain available.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    let offset = event.clientX - pointerStartX.current;
    if ((!hasPrevious && offset > 0) || (!hasNext && offset < 0)) offset *= 0.25;
    dragOffsetRef.current = offset;
    setDragOffset(offset);
  };

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore browsers that already released pointer capture.
    }
    const offset = dragOffsetRef.current;
    if (offset < -44 && hasNext) onIndexChange(currentIndex + 1);
    if (offset > 44 && hasPrevious) onIndexChange(currentIndex - 1);
    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  return (
    <>
      <div
        className={`example-card-carousel${className ? ` ${className}` : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
        style={{
          transform: `translateX(${dragOffset * 0.16}px)`,
          transition: isDragging ? 'none' : 'transform 220ms cubic-bezier(.16,1,.3,1)',
        }}
      >
        {children}
      </div>

      {itemCount > 1 && (
        <nav className="sensa-example-pagination" aria-label="切换例句">
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={() => onIndexChange(currentIndex - 1)}
            aria-label="上一条例句"
          >
            <svg className="icon" aria-hidden="true"><use href="#i-chev-l" /></svg>
          </button>
          <div>
            {Array.from({ length: itemCount }, (_, index) => (
              <button
                type="button"
                key={itemKeys[index] ?? index}
                className={index === currentIndex ? 'active' : ''}
                onClick={() => onIndexChange(index)}
                aria-label={`查看第 ${index + 1} 条例句`}
                aria-current={index === currentIndex ? 'true' : undefined}
              />
            ))}
            <span>{currentIndex + 1} / {itemCount}</span>
          </div>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onIndexChange(currentIndex + 1)}
            aria-label="下一条例句"
          >
            <svg className="icon" aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </nav>
      )}
    </>
  );
}
