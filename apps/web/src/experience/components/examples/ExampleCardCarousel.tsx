import {cardText} from '../../../i18n/originalCards';
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
    if (itemCount < 2 || (event.target as HTMLElement).closest('button, a, input, textarea, summary, video, iframe, button.tok-word')) return;
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
    if (event.type !== 'pointercancel') {
      if (offset < -44 && hasNext) onIndexChange(currentIndex + 1);
      if (offset > 44 && hasPrevious) onIndexChange(currentIndex - 1);
    }
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
          transition: isDragging ? 'none' : 'transform var(--sensa-motion-duration-component) var(--sensa-motion-easing-enter)',
        }}
      >
        {children}
      </div>

      {itemCount > 1 && (
        <nav className="sensa-example-pagination mt-3 grid min-h-14 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2 [&>button]:grid [&>button]:size-11 [&>button]:place-items-center [&>button]:rounded-pill [&>button]:border [&>button]:border-border-subtle [&>button]:bg-surface-panel [&>button]:text-action-primary [&>button]:transition-colors [&>button:hover]:bg-surface-subtle [&>button:disabled]:cursor-default [&>button:disabled]:opacity-30 [&>button:last-child]:justify-self-end [&>div]:flex [&>div]:items-center [&>div]:justify-center [&>div]:gap-2 [&>div>button]:size-2 [&>div>button]:rounded-pill [&>div>button]:bg-progress [&>div>button]:opacity-45 [&>div>button]:transition-[transform,opacity,background-color] [&>div>button.active]:scale-125 [&>div>button.active]:bg-action-primary [&>div>button.active]:opacity-100 [&>div>span]:ml-2 [&>div>span]:text-metadata [&>div>span]:text-fg-tertiary motion-reduce:[&_*]:transition-none" aria-label={cardText('switchExample')}>
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={() => onIndexChange(currentIndex - 1)}
            aria-label={cardText('previousExample')}
          >
            <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-chev-l" /></svg>
          </button>
          <div>
            {Array.from({ length: itemCount }, (_, index) => (
              <button
                type="button"
                key={itemKeys[index] ?? index}
                className={index === currentIndex ? 'active' : ''}
                onClick={() => onIndexChange(index)}
                aria-label={cardText('viewExampleNumber',{index:index+1})}
                aria-current={index === currentIndex ? 'true' : undefined}
              />
            ))}
            <span>{currentIndex + 1} / {itemCount}</span>
          </div>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onIndexChange(currentIndex + 1)}
            aria-label={cardText('nextExample')}
          >
            <svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-chev-r" /></svg>
          </button>
        </nav>
      )}
    </>
  );
}
