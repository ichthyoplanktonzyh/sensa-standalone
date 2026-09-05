/**
 * 状态栏上的时钟。
 *
 * 每 20 秒更新一次显示到分钟的时间。分钟只在整分变化，20 秒的周期保证跨过整分
 * 后最多迟 20 秒——比每秒重渲染整个 App 便宜得多，而在只显示到分钟的地方看不出区别。
 */
import { useEffect, useState } from 'react';

const TICK_MS = 20_000;

const nowLabel = (): string => {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function useClock(): string {
  const [time, setTime] = useState(nowLabel);
  useEffect(() => {
    const timer = setInterval(() => setTime(nowLabel()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return time;
}
