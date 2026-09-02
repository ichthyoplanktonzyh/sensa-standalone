import { useEffect, useState, type FormEvent } from 'react';
import type { SensaExpressionType } from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';
import { useJourneyGateway } from '../personalMeaningJourney';

interface PersonalMeaningComposerProps {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onCreated?: (personalMeaningId: string) => void;
}

const expressionTypeOptions: Array<{
  value: SensaExpressionType;
  label: string;
}> = [
  { value: 'word', label: '一个词' },
  { value: 'phrase', label: '短语' },
  { value: 'construction', label: '构式' },
  { value: 'sentence', label: '完整句子' },
  { value: 'utterance_strategy', label: '表达方式' },
];

export const PersonalMeaningComposer = ({
  open,
  onClose,
  onSaved,
  onCreated,
}: PersonalMeaningComposerProps) => {
  const gateway = useJourneyGateway();
  const [familiarExpression, setFamiliarExpression] = useState('');
  const [familiarExpressionType, setFamiliarExpressionType] = useState<SensaExpressionType>('phrase');
  const [experience, setExperience] = useState('');
  const [error, setError] = useState('');

  const canSave = !!familiarExpression.trim() || !!experience.trim();

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const reset = () => {
    setFamiliarExpression('');
    setFamiliarExpressionType('phrase');
    setExperience('');
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      const result = await gateway.createPersonalMeaning({
        operationId: newUuid(),
        familiarExpression: familiarExpression.trim()
          ? {
              surfaceForm: familiarExpression.trim(),
              expressionType: familiarExpressionType,
              languageTag: 'zh-CN',
            }
          : undefined,
        experience: experience.trim() || undefined,
      });
      onCreated?.(result.personalMeaningId);
      reset();
      onSaved('个人意义已创建；下一步可以澄清你真正关注的侧面');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法保存，请再试一次。');
    }
  };

  if (!open) return null;

  return (
    <div className="personal-meaning-composer-layer" onMouseDown={handleClose}>
      <section
        className="personal-meaning-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-meaning-composer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="personal-meaning-composer-grip" aria-hidden="true" />
        <header>
          <div>
            <span>PERSONAL CONSTRUCTION</span>
            <h2 id="personal-meaning-composer-title">创建个人意义</h2>
          </div>
          <button type="button" onClick={handleClose} aria-label="关闭添加面板">×</button>
        </header>

        <form onSubmit={handleSubmit}>
          <p className="personal-meaning-intro">
            从一句你熟悉的表达，或一段你真正想保留的经验开始。现在不需要先找到英文对应。
          </p>
          <label className="personal-meaning-field">
            <span>熟悉的表达 <em>与具体经验至少填写一项</em></span>
            <input
              autoFocus
              value={familiarExpression}
              onChange={(event) => setFamiliarExpression(event.target.value)}
              placeholder="例如：表达不同意见，但不让对方难堪"
              maxLength={100}
            />
            <small>它只是进入这个意义的熟悉语言锚点，不会被当作英文的等价翻译。</small>
          </label>
          {familiarExpression.trim() && (
            <label className="personal-meaning-field">
              <span>这个表达属于</span>
              <select
                value={familiarExpressionType}
                onChange={(event) => setFamiliarExpressionType(
                  event.target.value as SensaExpressionType,
                )}
              >
                {expressionTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="personal-meaning-field">
            <span>具体经验 <em>可选</em></span>
            <textarea
              value={experience}
              onChange={(event) => setExperience(event.target.value)}
              placeholder="写下一个你经历过或能够进入的具体场景，而不是词义解释。"
              maxLength={320}
              rows={4}
            />
          </label>

          {error && <p className="personal-meaning-error" role="alert">{error}</p>}
          <div className="personal-meaning-boundary">
            <i aria-hidden="true">◇</i>
            <span>
              <b>创建后进入你的个人语义世界</b>
              <small>不会自动确认 Sense、加入学习或产生掌握状态</small>
            </span>
          </div>
          <button className="personal-meaning-save" type="submit" disabled={!canSave}>
            创建个人意义
          </button>
        </form>
      </section>
    </div>
  );
};
