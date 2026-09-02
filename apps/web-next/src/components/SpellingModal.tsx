import { useState, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { Word, QuickDictEntry } from '../types';
import { WORDS } from '../data';
import { lookupWord } from '../services/quickDict';
import { audioService } from '../services/audioService';

export type SpellingPracticeMode = 'legacy' | 'quick_spelling' | 'dictation';

interface SpellingModalProps {
  active: boolean;
  wordData: Word | QuickDictEntry | string | null;
  mode?: SpellingPracticeMode;
  cueText?: string;
  onClose: () => void;
  toast: (msg: string) => void;
}

export const SpellingModal = ({
  active,
  wordData,
  mode = 'legacy',
  cueText = '',
  onClose,
  toast,
}: SpellingModalProps) => {
  const [typedText, setTypedText] = useState('');
  const [isStarred, setIsStarred] = useState(false);
  const [status, setStatus] = useState<'normal' | 'success' | 'error'>('normal');
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 统一提取目标单词
  let targetWord = '';
  if (wordData) {
    if (typeof wordData === 'string') {
      targetWord = wordData;
    } else if ('w' in wordData) {
      targetWord = wordData.w;
    } else {
      targetWord = wordData.word;
    }
  }

  // 获取该词的完整信息以供提示使用
  const fullWord: Word | undefined = WORDS.find(
    (w) => w.w.toLowerCase() === targetWord.toLowerCase()
  );
  const quickEntry = targetWord ? lookupWord(targetWord) : null;

  let briefDef = '';
  if (fullWord) {
    briefDef = fullWord.senses
      .map((s) => `${s.pos} ${s.items.join('；')}`)
      .join('  ');
  } else if (quickEntry) {
    briefDef = quickEntry.senses
      .map((s) => `${s.pos} ${s.text}`)
      .join('  ');
  }
  if (cueText.trim()) {
    briefDef = cueText.trim();
  }

  // 听写使用声音提示；随手拼写直接显示当前 Sense 提示；旧入口保持原行为。
  useEffect(() => {
    if (active && targetWord) {
      setTypedText('');
      setStatus('normal');
      setShowHint(mode === 'quick_spelling');

      const audioTimer = mode === 'quick_spelling'
        ? undefined
        : setTimeout(() => {
            void audioService.playWord(targetWord, 'us');
          }, 120);

      const focusTimer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 80);

      return () => {
        if (audioTimer) clearTimeout(audioTimer);
        clearTimeout(focusTimer);
        audioService.stop();
      };
    }
  }, [active, mode, targetWord]);

  // 发音朗读
  const speakWord = () => {
    audioService.playWord(targetWord, 'us');
  };

  // 校验拼写
  const handleCheckSpelling = () => {
    const cleanInput = typedText.trim().toLowerCase();
    const cleanTarget = targetWord.trim().toLowerCase();

    if (!cleanInput) {
      toast('请先输入拼写字母');
      return;
    }

    if (cleanInput === cleanTarget) {
      setStatus('success');
      speakWord();
      toast(mode === 'dictation' ? '🎉 听写正确！' : '🎉 拼写正确！');
      setTimeout(() => {
        onClose();
      }, 700);
    } else {
      setStatus('error');
      toast(mode === 'dictation' ? '听写有误，再试一次吧~' : '拼写有误，再试一次吧~');
      setTimeout(() => {
        setStatus('normal');
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 650);
    }
  };

  // 提示功能：播放发音，并给出释义或补全下一个正确字母
  const handleHint = () => {
    speakWord();
    setShowHint(true);

    const cleanTarget = targetWord.trim().toLowerCase();
    const cleanInput = typedText.trim().toLowerCase();

    // 智能补全下一个正确字母
    if (cleanTarget.startsWith(cleanInput) && cleanInput.length < cleanTarget.length) {
      const nextChar = cleanTarget[cleanInput.length];
      const nextText = cleanInput + nextChar;
      setTypedText(nextText);
      toast(`提示：下一个字母是「${nextChar.toUpperCase()}」`);
      if (nextText === cleanTarget) {
        setTimeout(() => {
          setStatus('success');
          toast('🎉 拼写正确！');
          setTimeout(() => {
            onClose();
          }, 700);
        }, 300);
      }
    } else if (!cleanTarget.startsWith(cleanInput)) {
      // 输入有误，重置为正确前缀
      setTypedText(cleanTarget.slice(0, 1));
      toast(`提示：首字母是「${cleanTarget[0].toUpperCase()}」`);
    } else {
      toast(`释义提示：${briefDef || targetWord}`);
    }

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // 键盘快捷键监听
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCheckSpelling();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // 收藏切换
  const handleToggleStar = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !isStarred;
    setIsStarred(next);
    toast(next ? `已收藏 "${targetWord}"` : `已取消收藏 "${targetWord}"`);
  };

  if (!active || !wordData) return null;

  return (
    <div
      className={`spelling-modal-backdrop${active ? ' active' : ''}`}
      onClick={() => inputRef.current?.focus()}
    >
      <div
        className="spelling-modal-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'dictation' ? '听写' : '随手拼写'}
      >
        {/* 顶部右上角工具按钮：收藏 + 设置 */}
        <div className="spelling-header">
          <div className="spelling-tools">
            <button
              className={`spelling-tool-btn${isStarred ? ' on' : ''}`}
              onClick={handleToggleStar}
              aria-label="收藏"
            >
              <svg
                className="icon"
                style={{
                  fill: isStarred ? '#f2701c' : 'none',
                  stroke: isStarred ? '#f2701c' : 'currentColor',
                }}
              >
                <use href="#i-star" />
              </svg>
            </button>
            <button
              className="spelling-tool-btn"
              onClick={() => toast('拼写偏好：严格大小写已关闭，标点自动忽略')}
              aria-label="设置"
            >
              <svg className="icon">
                <use href="#i-sliders" />
              </svg>
            </button>
          </div>
        </div>

        {/* 隐藏的真实输入框（全自动捕获软硬件键盘） */}
        <input
          ref={inputRef}
          type="text"
          className="spelling-hidden-input"
          value={typedText}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            setTypedText(e.target.value);
            if (status !== 'normal') setStatus('normal');
          }}
          onKeyDown={handleKeyDown}
        />

        {/* 居中核心拼写展示视口 */}
        <div
          className={`spelling-center-viewport ${status}`}
          onClick={() => inputRef.current?.focus()}
        >
          <div className="spelling-text-row">
            <span className="spelling-display-text">{typedText}</span>
            <span className="spelling-cursor" />
          </div>

          {/* 提示释义浮层 */}
          {showHint && briefDef && (
            <div className="spelling-hint-def">
              <span className="hint-label">{mode === 'quick_spelling' ? '当前意思：' : '提示：'}</span>
              <span>{briefDef}</span>
            </div>
          )}
        </div>

        {/* 底部三枚悬浮毛玻璃圆形操作按钮：✕ 取消 | 💡 提示 | ✓ 确认 */}
        <div className="spelling-bottom-actions">
          <button
            className="spelling-circle-btn btn-cancel"
            onClick={onClose}
            aria-label="取消"
            title="退出拼写练习"
          >
            <svg className="icon">
              <use href="#i-close" />
            </svg>
          </button>

          <button
            className="spelling-circle-btn btn-hint"
            onClick={handleHint}
            aria-label="提示"
            title="查看提示 / 朗读发音"
          >
            <svg className="icon">
              <use href="#i-bulb" />
            </svg>
          </button>

          <button
            className="spelling-circle-btn btn-confirm"
            onClick={handleCheckSpelling}
            aria-label="确认"
            title="提交拼写检查"
          >
            <svg className="icon">
              <use href="#i-chk-simple" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
